'use client';

import { useSession } from 'next-auth/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Check, ExternalLink } from 'lucide-react';

const plans = {
  free: {
    name: 'Free',
    price: '$0',
    priceMonthly: '$0',
    priceAnnual: '$0',
    monthlyLink: '',
    annualLink: '',
    features: [
      '125 fetches per week',
      '25/hr burst limit',
      'Basic fetch mode',
      'Community support',
    ],
  },
  pro: {
    name: 'Pro',
    price: '$9',
    priceMonthly: '$9',
    priceAnnual: '$90',
    monthlyLink: 'https://buy.stripe.com/5kQeVcb800BGgx7gMn3AY00',
    annualLink: 'https://buy.stripe.com/28E14mekcdosa8Jbs33AY01',
    features: [
      '1,250 fetches per week',
      '100/hr burst limit',
      'Stealth mode included',
      'CAPTCHA solving',
      'Priority support',
      'Extra usage available',
    ],
  },
  max: {
    name: 'Max',
    price: '$29',
    priceMonthly: '$29',
    priceAnnual: '$290',
    monthlyLink: 'https://buy.stripe.com/28E7sKgskfwAdkV67J3AY02',
    annualLink: 'https://buy.stripe.com/bJe9AS4JC4RW4OpgMn3AY03',
    features: [
      '6,250 fetches per week',
      '500/hr burst limit',
      'All Pro features',
      'Dedicated support',
      'Higher spending caps',
      'Advanced analytics',
      'Webhook notifications',
    ],
  },
};

type PlanTier = 'free' | 'pro' | 'max';

export default function BillingPage() {
  const { data: session } = useSession();
  const currentTier: PlanTier = (session as any)?.tier || 'free';
  
  // Helper to check tier (avoids TypeScript narrowing issues)
  const isTier = (tier: PlanTier) => currentTier === tier;

  return (
    <div className="mx-auto max-w-6xl space-y-6 md:space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Billing & Plans</h1>
        <p className="text-sm md:text-base text-muted-foreground">Manage your subscription and billing</p>
      </div>

      {/* Current Plan */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-lg md:text-xl">Current Plan</CardTitle>
              <CardDescription className="text-sm">You are currently on the {plans[currentTier].name} plan</CardDescription>
            </div>
            <Badge className="bg-violet-600 text-white text-sm sm:text-base px-3 sm:px-4 py-1 w-fit">
              {plans[currentTier].name}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <h3 className="font-semibold">Features</h3>
              <ul className="space-y-2">
                {plans[currentTier].features.map((feature) => (
                  <li key={feature} className="flex items-center gap-2 text-sm">
                    <Check className="h-4 w-4 text-green-600" />
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
            {currentTier !== 'free' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm md:text-base font-semibold mb-2">Manage Subscription</h3>
                  <Button variant="outline" className="w-full text-sm" asChild>
                    <a
                      href="https://billing.stripe.com/p/login/test_xxx"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="gap-2"
                    >
                      Stripe Customer Portal
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Manage your payment methods, view invoices, and cancel your subscription
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Extra Usage Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg md:text-xl">Extra Usage</CardTitle>
          <CardDescription className="text-sm">Control spending when you exceed your plan limits</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 md:space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm md:text-base font-medium">Enable extra usage</p>
              <p className="text-xs sm:text-sm text-muted-foreground">
                Continue making requests if you hit your plan limit
              </p>
            </div>
            <Switch />
          </div>
          <div className="space-y-3 md:space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <span className="text-xs sm:text-sm">Monthly spending limit</span>
              <div className="flex items-center gap-2">
                <span className="text-sm md:text-base font-medium">$50.00</span>
                <Button variant="outline" size="sm" className="text-xs sm:text-sm">Adjust</Button>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <span className="text-xs sm:text-sm">Current balance</span>
              <div className="flex items-center gap-2">
                <span className="text-sm md:text-base font-medium">$20.72</span>
                <Button variant="outline" size="sm" className="text-xs sm:text-sm">Buy more</Button>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <span className="text-xs sm:text-sm">Auto-reload</span>
              <Switch />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Upgrade Plans */}
      {currentTier !== 'max' && (
        <div className="space-y-4 md:space-y-6">
          <div>
            <h2 className="text-xl md:text-2xl font-bold">Upgrade Your Plan</h2>
            <p className="text-sm md:text-base text-muted-foreground">Choose the plan that fits your needs</p>
          </div>

          <Tabs defaultValue="monthly" className="space-y-4 md:space-y-6">
            <TabsList className="grid w-full grid-cols-2 max-w-full sm:max-w-md">
              <TabsTrigger value="monthly">Monthly</TabsTrigger>
              <TabsTrigger value="annual">
                Annual
                <Badge variant="secondary" className="ml-2">Save 17%</Badge>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="monthly" className="space-y-6">
              <div className="grid gap-6 md:grid-cols-3">
                {/* Free Plan */}
                <Card className={currentTier === 'free' ? 'border-violet-600 border-2' : ''}>
                  <CardHeader>
                    <CardTitle>Free</CardTitle>
                    <div className="mt-4">
                      <span className="text-4xl font-bold">$0</span>
                      <span className="text-muted-foreground">/month</span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <ul className="space-y-2">
                      {plans.free.features.map((feature) => (
                        <li key={feature} className="flex items-start gap-2 text-sm">
                          <Check className="h-4 w-4 text-green-600 mt-0.5" />
                          {feature}
                        </li>
                      ))}
                    </ul>
                    {currentTier === 'free' ? (
                      <Badge variant="secondary" className="w-full justify-center py-2">
                        Current Plan
                      </Badge>
                    ) : (
                      <Button variant="outline" className="w-full" disabled>
                        Downgrade
                      </Button>
                    )}
                  </CardContent>
                </Card>

                {/* Pro Plan */}
                <Card className={currentTier === 'pro' ? 'border-violet-600 border-2' : 'border-violet-200'}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle>Pro</CardTitle>
                      <Badge className="bg-violet-600">Popular</Badge>
                    </div>
                    <div className="mt-4">
                      <span className="text-4xl font-bold">{plans.pro.priceMonthly}</span>
                      <span className="text-muted-foreground">/month</span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <ul className="space-y-2">
                      {plans.pro.features.map((feature) => (
                        <li key={feature} className="flex items-start gap-2 text-sm">
                          <Check className="h-4 w-4 text-green-600 mt-0.5" />
                          {feature}
                        </li>
                      ))}
                    </ul>
                    {currentTier === 'pro' ? (
                      <Badge variant="secondary" className="w-full justify-center py-2">
                        Current Plan
                      </Badge>
                    ) : (
                      <Button className="w-full bg-violet-600 hover:bg-violet-700" asChild>
                        <a href={plans.pro.monthlyLink} target="_blank" rel="noopener noreferrer">
                          {currentTier === 'free' ? 'Upgrade to Pro' : 'Switch to Pro'}
                        </a>
                      </Button>
                    )}
                  </CardContent>
                </Card>

                {/* Max Plan */}
                <Card className={isTier('max') ? 'border-violet-600 border-2' : ''}>
                  <CardHeader>
                    <CardTitle>Max</CardTitle>
                    <div className="mt-4">
                      <span className="text-4xl font-bold">{plans.max.priceMonthly}</span>
                      <span className="text-muted-foreground">/month</span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <ul className="space-y-2">
                      {plans.max.features.map((feature) => (
                        <li key={feature} className="flex items-start gap-2 text-sm">
                          <Check className="h-4 w-4 text-green-600 mt-0.5" />
                          {feature}
                        </li>
                      ))}
                    </ul>
                    {isTier('max') ? (
                      <Badge variant="secondary" className="w-full justify-center py-2">
                        Current Plan
                      </Badge>
                    ) : (
                      <Button className="w-full bg-violet-600 hover:bg-violet-700" asChild>
                        <a href={plans.max.monthlyLink} target="_blank" rel="noopener noreferrer">
                          Upgrade to Max
                        </a>
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="annual" className="space-y-6">
              <div className="grid gap-6 md:grid-cols-3">
                {/* Free Plan */}
                <Card className={currentTier === 'free' ? 'border-violet-600 border-2' : ''}>
                  <CardHeader>
                    <CardTitle>Free</CardTitle>
                    <div className="mt-4">
                      <span className="text-4xl font-bold">$0</span>
                      <span className="text-muted-foreground">/year</span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <ul className="space-y-2">
                      {plans.free.features.map((feature) => (
                        <li key={feature} className="flex items-start gap-2 text-sm">
                          <Check className="h-4 w-4 text-green-600 mt-0.5" />
                          {feature}
                        </li>
                      ))}
                    </ul>
                    {currentTier === 'free' ? (
                      <Badge variant="secondary" className="w-full justify-center py-2">
                        Current Plan
                      </Badge>
                    ) : (
                      <Button variant="outline" className="w-full" disabled>
                        Downgrade
                      </Button>
                    )}
                  </CardContent>
                </Card>

                {/* Pro Plan Annual */}
                <Card className={currentTier === 'pro' ? 'border-violet-600 border-2' : 'border-violet-200'}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle>Pro</CardTitle>
                      <Badge className="bg-violet-600">Save $18</Badge>
                    </div>
                    <div className="mt-4">
                      <span className="text-4xl font-bold">{plans.pro.priceAnnual}</span>
                      <span className="text-muted-foreground">/year</span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <ul className="space-y-2">
                      {plans.pro.features.map((feature) => (
                        <li key={feature} className="flex items-start gap-2 text-sm">
                          <Check className="h-4 w-4 text-green-600 mt-0.5" />
                          {feature}
                        </li>
                      ))}
                    </ul>
                    {currentTier === 'pro' ? (
                      <Badge variant="secondary" className="w-full justify-center py-2">
                        Current Plan
                      </Badge>
                    ) : (
                      <Button className="w-full bg-violet-600 hover:bg-violet-700" asChild>
                        <a href={plans.pro.annualLink} target="_blank" rel="noopener noreferrer">
                          {currentTier === 'free' ? 'Upgrade to Pro' : 'Switch to Pro'}
                        </a>
                      </Button>
                    )}
                  </CardContent>
                </Card>

                {/* Max Plan Annual */}
                <Card className={isTier('max') ? 'border-violet-600 border-2' : ''}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle>Max</CardTitle>
                      <Badge className="bg-violet-600">Save $58</Badge>
                    </div>
                    <div className="mt-4">
                      <span className="text-4xl font-bold">{plans.max.priceAnnual}</span>
                      <span className="text-muted-foreground">/year</span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <ul className="space-y-2">
                      {plans.max.features.map((feature) => (
                        <li key={feature} className="flex items-start gap-2 text-sm">
                          <Check className="h-4 w-4 text-green-600 mt-0.5" />
                          {feature}
                        </li>
                      ))}
                    </ul>
                    {isTier('max') ? (
                      <Badge variant="secondary" className="w-full justify-center py-2">
                        Current Plan
                      </Badge>
                    ) : (
                      <Button className="w-full bg-violet-600 hover:bg-violet-700" asChild>
                        <a href={plans.max.annualLink} target="_blank" rel="noopener noreferrer">
                          Upgrade to Max
                        </a>
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}
