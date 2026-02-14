/**
 * Stripe webhook handler for subscription management
 */
import { Router } from 'express';
import Stripe from 'stripe';
import pg from 'pg';
const { Pool } = pg;
/**
 * Tier configuration (weekly usage model)
 */
const TIER_LIMITS = {
    free: { weekly_limit: 125, burst_limit: 25, rate_limit: 10 },
    pro: { weekly_limit: 1250, burst_limit: 100, rate_limit: 60 },
    max: { weekly_limit: 6250, burst_limit: 500, rate_limit: 200 },
};
/**
 * Create Stripe webhook router
 */
export function createStripeRouter() {
    const router = Router();
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const dbUrl = process.env.DATABASE_URL;
    if (!stripeSecretKey) {
        console.warn('STRIPE_SECRET_KEY not configured - Stripe webhooks disabled');
        return router;
    }
    if (!webhookSecret) {
        console.warn('STRIPE_WEBHOOK_SECRET not configured - Stripe webhooks disabled');
        return router;
    }
    if (!dbUrl) {
        throw new Error('DATABASE_URL environment variable is required');
    }
    const stripe = new Stripe(stripeSecretKey);
    const pool = new Pool({
        connectionString: dbUrl,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    });
    /**
     * POST /v1/webhooks/stripe
     * Handle Stripe webhook events
     * SECURITY: Verifies webhook signature
     */
    router.post('/', async (req, res) => {
        try {
            const sig = req.headers['stripe-signature'];
            if (!sig || typeof sig !== 'string') {
                res.status(400).json({
                    error: 'missing_signature',
                    message: 'Stripe signature header missing',
                });
                return;
            }
            // SECURITY: Verify webhook signature
            let event;
            try {
                event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
            }
            catch (err) {
                console.error('Webhook signature verification failed:', err.message);
                res.status(400).json({
                    error: 'invalid_signature',
                    message: 'Webhook signature verification failed',
                });
                return;
            }
            // Handle different event types
            switch (event.type) {
                case 'checkout.session.completed': {
                    const session = event.data.object;
                    await handleCheckoutCompleted(pool, session);
                    break;
                }
                case 'customer.subscription.updated': {
                    const subscription = event.data.object;
                    await handleSubscriptionUpdated(pool, subscription);
                    break;
                }
                case 'customer.subscription.deleted': {
                    const subscription = event.data.object;
                    await handleSubscriptionDeleted(pool, subscription);
                    break;
                }
                case 'invoice.payment_failed': {
                    const invoice = event.data.object;
                    await handlePaymentFailed(pool, invoice);
                    break;
                }
                default:
                    console.log(`Unhandled event type: ${event.type}`);
            }
            res.json({ received: true });
        }
        catch (error) {
            console.error('Webhook error:', error);
            res.status(500).json({
                error: 'webhook_failed',
                message: 'Failed to process webhook',
            });
        }
    });
    return router;
}
/**
 * Handle checkout.session.completed
 * Upgrade user tier and set limits
 */
async function handleCheckoutCompleted(pool, session) {
    try {
        const customerId = session.customer;
        const subscriptionId = session.subscription;
        // Get subscription to determine tier
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        // Determine tier from price ID (you'll need to configure these)
        const priceId = subscription.items.data[0]?.price.id;
        const tier = getTierFromPriceId(priceId);
        const limits = TIER_LIMITS[tier];
        // Update user
        await pool.query(`UPDATE users 
      SET 
        stripe_customer_id = $1,
        stripe_subscription_id = $2,
        tier = $3,
        weekly_limit = $4,
        burst_limit = $5,
        rate_limit = $6,
        updated_at = now()
      WHERE stripe_customer_id = $1 OR email = $7`, [
            customerId,
            subscriptionId,
            tier,
            limits.weekly_limit,
            limits.burst_limit,
            limits.rate_limit,
            session.customer_email,
        ]);
        console.log(`Checkout completed for customer ${customerId}: upgraded to ${tier}`);
    }
    catch (error) {
        console.error('Failed to handle checkout completion:', error);
        throw error;
    }
}
/**
 * Handle customer.subscription.updated
 * Update user tier based on subscription changes
 */
async function handleSubscriptionUpdated(pool, subscription) {
    try {
        const customerId = subscription.customer;
        const priceId = subscription.items.data[0]?.price.id;
        const tier = getTierFromPriceId(priceId);
        const limits = TIER_LIMITS[tier];
        await pool.query(`UPDATE users 
      SET 
        tier = $1,
        weekly_limit = $2,
        burst_limit = $3,
        rate_limit = $4,
        stripe_subscription_id = $5,
        updated_at = now()
      WHERE stripe_customer_id = $6`, [tier, limits.weekly_limit, limits.burst_limit, limits.rate_limit, subscription.id, customerId]);
        console.log(`Subscription updated for customer ${customerId}: tier=${tier}`);
    }
    catch (error) {
        console.error('Failed to handle subscription update:', error);
        throw error;
    }
}
/**
 * Handle customer.subscription.deleted
 * Downgrade user to free tier
 */
async function handleSubscriptionDeleted(pool, subscription) {
    try {
        const customerId = subscription.customer;
        const limits = TIER_LIMITS.free;
        await pool.query(`UPDATE users 
      SET 
        tier = 'free',
        weekly_limit = $1,
        burst_limit = $2,
        rate_limit = $3,
        stripe_subscription_id = NULL,
        updated_at = now()
      WHERE stripe_customer_id = $4`, [limits.weekly_limit, limits.burst_limit, limits.rate_limit, customerId]);
        console.log(`Subscription deleted for customer ${customerId}: downgraded to free`);
    }
    catch (error) {
        console.error('Failed to handle subscription deletion:', error);
        throw error;
    }
}
/**
 * Handle invoice.payment_failed
 * Log payment failure (could add email notification here)
 */
async function handlePaymentFailed(pool, invoice) {
    try {
        const customerId = invoice.customer;
        // Get user email for logging
        const result = await pool.query('SELECT email FROM users WHERE stripe_customer_id = $1', [customerId]);
        if (result.rows.length > 0) {
            console.warn(`Payment failed for customer ${customerId} (${result.rows[0].email})`);
            // Note: Email notification not implemented. Log only for now.
        }
    }
    catch (error) {
        console.error('Failed to handle payment failure:', error);
        throw error;
    }
}
/**
 * Map Stripe price ID to tier
 * Maps Stripe price IDs to tiers (configured via STRIPE_PRICE_PRO and STRIPE_PRICE_MAX env vars)
 */
function getTierFromPriceId(priceId) {
    // Map price IDs to tiers
    const priceMap = {
        // Add your Stripe price IDs here
        [process.env.STRIPE_PRICE_PRO || '']: 'pro',
        [process.env.STRIPE_PRICE_MAX || '']: 'max',
    };
    return priceMap[priceId] || 'free';
}
//# sourceMappingURL=stripe.js.map