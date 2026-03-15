/**
 * Stripe webhook handler for subscription management
 */

import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import pg from 'pg';
import { createLogger } from '../logger.js';

const log = createLogger('stripe');

const { Pool } = pg;

/**
 * Tier configuration (weekly usage model)
 */
const TIER_LIMITS: Record<string, { weekly_limit: number; burst_limit: number; rate_limit: number }> = {
  free: { weekly_limit: 500, burst_limit: 50, rate_limit: 10 },
  pro: { weekly_limit: 1250, burst_limit: 100, rate_limit: 60 },
  max: { weekly_limit: 6250, burst_limit: 500, rate_limit: 200 },
  admin: { weekly_limit: 100000, burst_limit: 10000, rate_limit: 1000 },
  enterprise: { weekly_limit: 50000, burst_limit: 2000, rate_limit: 500 },
};

/**
 * Create Stripe Billing Portal router
 * POST /v1/billing/portal — create a Stripe Customer Portal session
 * Requires global auth middleware to already have run (req.user or req.auth set).
 */
export function createBillingPortalRouter(pool: pg.Pool | null): Router {
  const router = Router();

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    log.warn('STRIPE_SECRET_KEY not configured - billing portal disabled');
    return router;
  }

  const stripe = new Stripe(stripeSecretKey);

  router.post('/v1/billing/portal', async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.userId || (req as any).auth?.keyInfo?.accountId;
      if (!userId) {
        res.status(401).json({ success: false, error: { type: 'unauthorized', message: 'Authentication required.', docs: 'https://webpeel.dev/docs/authentication' }, requestId: req.requestId });
        return;
      }

      if (!pool) {
        res.status(503).json({
          success: false,
          error: {
            type: 'db_unavailable',
            message: 'Database not configured',
            docs: 'https://webpeel.dev/docs/errors#db_unavailable',
          },
          requestId: req.requestId,
        });
        return;
      }

      // Get user's stripe_customer_id from DB
      const result = await pool.query(
        'SELECT stripe_customer_id FROM users WHERE id = $1',
        [userId]
      );
      const stripeCustomerId = result.rows[0]?.stripe_customer_id;

      if (!stripeCustomerId) {
        res.status(400).json({ success: false, error: { type: 'no_subscription', message: 'No active subscription found. Upgrade to Pro or Max to manage billing.', hint: 'Upgrade at https://webpeel.dev/pricing', docs: 'https://webpeel.dev/docs/errors#no_subscription' }, requestId: req.requestId });
        return;
      }

      // Create portal session
      const session = await stripe.billingPortal.sessions.create({
        customer: stripeCustomerId,
        return_url: 'https://app.webpeel.dev/billing',
      });

      res.json({ url: session.url });
    } catch (err: any) {
      log.error('Failed to create portal session:', err);
      res.status(500).json({
        success: false,
        error: {
          type: 'portal_failed',
          message: 'Failed to create billing portal session',
          docs: 'https://webpeel.dev/docs/errors#portal_failed',
        },
        requestId: req.requestId,
      });
    }
  });

  return router;
}

/**
 * Create Stripe webhook router
 */
export function createStripeRouter(): Router {
  const router = Router();

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const dbUrl = process.env.DATABASE_URL;

  if (!stripeSecretKey) {
    log.warn('STRIPE_SECRET_KEY not configured - Stripe webhooks disabled');
    return router;
  }

  if (!webhookSecret) {
    log.warn('STRIPE_WEBHOOK_SECRET not configured - Stripe webhooks disabled');
    return router;
  }

  if (!dbUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const stripe = new Stripe(stripeSecretKey);

  const pool = new Pool({
    connectionString: dbUrl,
    // TLS: enabled when DATABASE_URL contains sslmode=require.
    // Secure by default (rejectUnauthorized: true); set PG_REJECT_UNAUTHORIZED=false
    // only for managed DBs (Render/Neon/Supabase) that use self-signed certs.
    ssl: process.env.DATABASE_URL?.includes('sslmode=require')
      ? { rejectUnauthorized: process.env.PG_REJECT_UNAUTHORIZED !== 'false' }
      : undefined,
  });

  /**
   * POST /v1/webhooks/stripe
   * Handle Stripe webhook events
   * SECURITY: Verifies webhook signature
   */
  router.post('/', async (req: Request, res: Response) => {
    try {
      const sig = req.headers['stripe-signature'];

      if (!sig || typeof sig !== 'string') {
        res.status(400).json({ success: false, error: { type: 'missing_signature', message: 'Stripe signature header missing', hint: 'Ensure the request includes the stripe-signature header', docs: 'https://webpeel.dev/docs/errors#missing_signature' }, requestId: req.requestId });
        return;
      }

      // SECURITY: Verify webhook signature
      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(
          req.body,
          sig,
          webhookSecret
        );
      } catch (err: any) {
        log.error('Webhook signature verification failed', { message: err.message });
        res.status(400).json({ success: false, error: { type: 'invalid_signature', message: 'Webhook signature verification failed', hint: 'Verify your STRIPE_WEBHOOK_SECRET matches the Stripe dashboard', docs: 'https://webpeel.dev/docs/errors#invalid_signature' }, requestId: req.requestId });
        return;
      }

      // Handle different event types
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session;
          await handleCheckoutCompleted(pool, session);
          break;
        }

        case 'customer.subscription.updated': {
          const subscription = event.data.object as Stripe.Subscription;
          await handleSubscriptionUpdated(pool, subscription);
          break;
        }

        case 'customer.subscription.deleted': {
          const subscription = event.data.object as Stripe.Subscription;
          await handleSubscriptionDeleted(pool, subscription);
          break;
        }

        case 'invoice.payment_failed': {
          const invoice = event.data.object as Stripe.Invoice;
          await handlePaymentFailed(pool, invoice);
          break;
        }

        default:
          log.warn(`Unhandled Stripe event type: ${event.type}`);
      }

      res.json({ received: true });
    } catch (error) {
      log.error('Webhook error', { error: error instanceof Error ? error.message : String(error) });
      res.status(500).json({
        success: false,
        error: {
          type: 'webhook_failed',
          message: 'Failed to process webhook',
          docs: 'https://webpeel.dev/docs/errors#webhook_failed',
        },
        requestId: req.requestId,
      });
    }
  });

  return router;
}

/**
 * Handle checkout.session.completed
 * Upgrade user tier and set limits
 */
async function handleCheckoutCompleted(
  pool: pg.Pool,
  session: Stripe.Checkout.Session
): Promise<void> {
  try {
    const customerId = session.customer as string;
    const subscriptionId = session.subscription as string;

    // Get subscription to determine tier
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);

    // Determine tier from price ID (you'll need to configure these)
    const priceId = subscription.items.data[0]?.price.id;
    const tier = getTierFromPriceId(priceId);

    const limits = TIER_LIMITS[tier];

    // Update user
    await pool.query(
      `UPDATE users 
      SET 
        stripe_customer_id = $1,
        stripe_subscription_id = $2,
        tier = $3,
        weekly_limit = $4,
        burst_limit = $5,
        rate_limit = $6,
        updated_at = now()
      WHERE stripe_customer_id = $1 OR email = $7`,
      [
        customerId,
        subscriptionId,
        tier,
        limits.weekly_limit,
        limits.burst_limit,
        limits.rate_limit,
        session.customer_email,
      ]
    );

    log.info(`Checkout completed for customer ${customerId}: upgraded to ${tier}`);
  } catch (error) {
    log.error('Failed to handle checkout completion', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Handle customer.subscription.updated
 * Update user tier based on subscription changes
 */
async function handleSubscriptionUpdated(
  pool: pg.Pool,
  subscription: Stripe.Subscription
): Promise<void> {
  try {
    const customerId = subscription.customer as string;
    const priceId = subscription.items.data[0]?.price.id;
    const tier = getTierFromPriceId(priceId);
    const limits = TIER_LIMITS[tier];

    await pool.query(
      `UPDATE users 
      SET 
        tier = $1,
        weekly_limit = $2,
        burst_limit = $3,
        rate_limit = $4,
        stripe_subscription_id = $5,
        updated_at = now()
      WHERE stripe_customer_id = $6`,
      [tier, limits.weekly_limit, limits.burst_limit, limits.rate_limit, subscription.id, customerId]
    );

    log.info(`Subscription updated for customer ${customerId}: tier=${tier}`);
  } catch (error) {
    log.error('Failed to handle subscription update', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Handle customer.subscription.deleted
 * Downgrade user to free tier
 */
async function handleSubscriptionDeleted(
  pool: pg.Pool,
  subscription: Stripe.Subscription
): Promise<void> {
  try {
    const customerId = subscription.customer as string;
    const limits = TIER_LIMITS.free;

    await pool.query(
      `UPDATE users 
      SET 
        tier = 'free',
        weekly_limit = $1,
        burst_limit = $2,
        rate_limit = $3,
        stripe_subscription_id = NULL,
        updated_at = now()
      WHERE stripe_customer_id = $4`,
      [limits.weekly_limit, limits.burst_limit, limits.rate_limit, customerId]
    );

    log.info(`Subscription deleted for customer ${customerId}: downgraded to free`);
  } catch (error) {
    log.error('Failed to handle subscription deletion', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Handle invoice.payment_failed
 * Log payment failure (could add email notification here)
 */
async function handlePaymentFailed(
  pool: pg.Pool,
  invoice: Stripe.Invoice
): Promise<void> {
  try {
    const customerId = invoice.customer as string;

    // Get user email for logging
    const result = await pool.query(
      'SELECT email FROM users WHERE stripe_customer_id = $1',
      [customerId]
    );

    if (result.rows.length > 0) {
      log.warn(`Payment failed for customer ${customerId}`, { email: result.rows[0].email });
      // Note: Email notification not implemented. Log only for now.
    }
  } catch (error) {
    log.error('Failed to handle payment failure', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Map Stripe price ID to tier
 * Maps Stripe price IDs to tiers (configured via STRIPE_PRICE_PRO and STRIPE_PRICE_MAX env vars)
 */
function getTierFromPriceId(priceId: string): 'free' | 'pro' | 'max' {
  // Map price IDs to tiers
  const priceMap: Record<string, 'free' | 'pro' | 'max'> = {
    // Add your Stripe price IDs here
    [process.env.STRIPE_PRICE_PRO || '']: 'pro',
    [process.env.STRIPE_PRICE_MAX || '']: 'max',
  };

  return priceMap[priceId] || 'free';
}
