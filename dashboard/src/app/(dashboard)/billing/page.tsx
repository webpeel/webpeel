'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import useSWR from 'swr';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Check, ExternalLink, Sparkles, Zap, Crown } from 'lucide-react';
import { apiClient, Usage } from '@/lib/api';

const fetcher = async <T,>(url: string, token: string): Promise<T> => {
  return apiClient<T>(url, { token });
};

const plans = {
  free: {
    name: 'Free',
    priceMonthly: 0,
    priceAnnual: 0,
    monthlyLink: '',
    annualLink: '',
    features: [
      '125 fetches per week',
      '25/hr burst limit',
      'Basic fetch mode',
      'Community support',
    ],
    popular: false,
    icon: Sparkles,
    iconColor: 'text-zinc-600',
    iconBg: 'bg-zinc-100',
  },
  pro: {
    name: 'Pro',
    priceMonthly: 9,
    priceAnnual: 90,
    monthlyLink: 'https://buy.stripe.com/5kQeVcb800BGgx7gMn3AY00',
    annualLink: 'https://buy.stripe.com/28E14mekcdosa8Jbs33AY01',
    features: [
      '1,250 fetches per week',
      '100/hr burst limit',
      'Anti-bot stealth mode',
      'Priority support',
      'Extra usage available',
    ],
    popular: true,
    icon: Zap,
    iconColor: 'text-violet-600',
    iconBg: 'bg-violet-100',
  },
  max: {
    name: 'Max',
    priceMonthly: 29,
    priceAnnual: 290,
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
    popular: false,
    icon: Crown,
    iconColor: 'text-amber-600',
    iconBg: 'bg-amber-100',
  },
};

type PlanTier = 'free' | 'pro' | 'max';

export default function BillingPage() {
  const { data: session } = useSession();
  const token = (session as any)?.apiToken;
  const currentTier: PlanTier = (session as any)?.tier || 'free';
  const [isAnnual, setIsAnnual] = useState(false);

  const { data: usage } = useSWR<Usage>(
    token ? ['/v1/usage', token] : null,
    ([url, token]: [string, string]) => fetcher<Usage>(url, token),
    { refreshInterval: 30000 }
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 md:space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl md:text-4xl font-bold text-zinc-900">Billing & Plans</h1>
        <p className="text-base text-zinc-500 mt-2">Manage your subscription and billing</p>
      </div>

      {/* Current Plan - Visual Card */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-violet-500 to-violet-600 opacity-5 rounded-xl" />
        <Card className="border-2 border-violet-200 relative">
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className={`w-14 h-14 rounded-xl ${plans[currentTier].iconBg} flex items-center justify-center flex-shrink-0`}>
                  {(() => {
                    const Icon = plans[currentTier].icon;
                    return <Icon className={`h-7 w-7 ${plans[currentTier].iconColor}`} />;
                  })()}
                </div>
                <div>
                  <CardTitle className="text-2xl">Current Plan: {plans[currentTier].name}</CardTitle>
                  <CardDescription className="mt-1">
                    {currentTier === 'free' 
                      ? 'Upgrade to unlock more features' 
                      : 'Thank you for being a valued customer'}
                  </CardDescription>
                </div>
              </div>
              <Badge className="bg-violet-600 text-white text-base px-4 py-2 w-fit">
                {plans[currentTier].name}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-3">
                <h3 className="font-semibold text-zinc-900">Plan Features</h3>
                <ul className="space-y-2.5">
                  {plans[currentTier].features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5 text-sm">
                      <Check className="h-5 w-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                      <span className="text-zinc-700">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {currentTier !== 'free' && (
                <div className="space-y-4">
                  <div>
                    <h3 className="font-semibold text-zinc-900 mb-3">Manage Subscription</h3>
                    <Button variant="outline" className="w-full gap-2" disabled>
                      Stripe Customer Portal
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-zinc-500">
                    Subscription management coming soon. Contact{' '}
                    <a href="mailto:support@webpeel.dev" className="text-violet-600 hover:underline">
                      support@webpeel.dev
                    </a>{' '}
                    for changes.
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Extra Usage Controls */}
      {currentTier !== 'free' && (
        <Card className="border-zinc-200">
          <CardHeader>
            <CardTitle className="text-xl">Extra Usage</CardTitle>
            <CardDescription>Control spending when you exceed your plan limits</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4 bg-violet-50 rounded-lg border border-violet-100">
              <div className="space-y-1">
                <p className="font-medium text-zinc-900">Enable extra usage</p>
                <p className="text-sm text-zinc-600">
                  Continue making requests if you hit your plan limit
                </p>
              </div>
              <Switch checked={usage?.extraUsage?.enabled} />
            </div>
            
            {usage?.extraUsage ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 border border-zinc-200 rounded-lg">
                  <div>
                    <span className="text-sm text-zinc-600">Monthly spending limit</span>
                    <p className="text-2xl font-bold text-zinc-900 mt-1">
                      ${usage.extraUsage.spendingLimit.toFixed(2)}
                    </p>
                  </div>
                  <Button variant="outline" size="sm">Adjust</Button>
                </div>
                
                <div className="flex items-center justify-between p-4 border border-zinc-200 rounded-lg">
                  <div>
                    <span className="text-sm text-zinc-600">Current balance</span>
                    <p className="text-2xl font-bold text-zinc-900 mt-1">
                      ${usage.extraUsage.balance.toFixed(2)}
                    </p>
                  </div>
                  <Button variant="outline" size="sm">Buy more</Button>
                </div>
                
                <div className="flex items-center justify-between p-4 bg-zinc-50 rounded-lg">
                  <span className="text-sm text-zinc-700">Auto-reload when balance is low</span>
                  <Switch checked={usage.extraUsage.autoReload} />
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-zinc-500">
                <p className="text-sm">Extra usage data will appear here when available</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Upgrade Plans */}
      {currentTier !== 'max' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-2xl md:text-3xl font-bold text-zinc-900">
                {currentTier === 'free' ? 'Upgrade Your Plan' : 'Switch Plans'}
              </h2>
              <p className="text-base text-zinc-500 mt-1">Choose the plan that fits your needs</p>
            </div>
            
            {/* Pill Toggle for Monthly/Annual */}
            <div className="flex items-center gap-3 p-1 bg-zinc-100 rounded-full w-fit">
              <button
                onClick={() => setIsAnnual(false)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                  !isAnnual 
                    ? 'bg-white text-zinc-900 shadow-sm' 
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                Monthly
              </button>
              <button
                onClick={() => setIsAnnual(true)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-2 ${
                  isAnnual 
                    ? 'bg-white text-zinc-900 shadow-sm' 
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                Annual
                <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 text-xs">
                  Save 17%
                </Badge>
              </button>
            </div>
          </div>

          {/* Plan Cards */}
          <div className="grid gap-6 md:grid-cols-3">
            {(Object.keys(plans) as PlanTier[]).map((tier) => {
              const plan = plans[tier];
              const Icon = plan.icon;
              const isCurrent = currentTier === tier;
              const price = isAnnual ? plan.priceAnnual : plan.priceMonthly;
              const link = isAnnual ? plan.annualLink : plan.monthlyLink;
              const monthlySavings = isAnnual ? (plan.priceMonthly * 12 - plan.priceAnnual) : 0;
              
              return (
                <div key={tier} className="relative">
                  {/* Most Popular Ribbon */}
                  {plan.popular && (
                    <div className="absolute -top-3 left-0 right-0 flex justify-center z-10">
                      <Badge className="bg-violet-600 text-white px-4 py-1 shadow-md">
                        Most Popular
                      </Badge>
                    </div>
                  )}
                  
                  <Card 
                    className={`relative h-full transition-all ${
                      isCurrent 
                        ? 'border-2 border-violet-600 shadow-lg' 
                        : plan.popular 
                        ? 'border-2 border-violet-200 shadow-md hover:shadow-lg hover:border-violet-300' 
                        : 'border border-zinc-200 hover:border-zinc-300 hover:shadow-md'
                    }`}
                  >
                    {plan.popular && !isCurrent && (
                      <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 to-violet-600/5 rounded-xl pointer-events-none" />
                    )}
                    
                    <CardHeader className="relative">
                      <div className="flex items-center gap-3 mb-4">
                        <div className={`w-12 h-12 rounded-xl ${plan.iconBg} flex items-center justify-center`}>
                          <Icon className={`h-6 w-6 ${plan.iconColor}`} />
                        </div>
                        <CardTitle className="text-2xl">{plan.name}</CardTitle>
                      </div>
                      
                      <div className="flex items-baseline gap-1">
                        <span className="text-5xl font-bold text-zinc-900">
                          ${price}
                        </span>
                        <span className="text-zinc-500">
                          /{isAnnual ? 'year' : 'mo'}
                        </span>
                      </div>
                      
                      {isAnnual && monthlySavings > 0 && (
                        <p className="text-sm text-emerald-600 font-medium mt-2">
                          Save ${monthlySavings} per year
                        </p>
                      )}
                    </CardHeader>
                    
                    <CardContent className="space-y-6 relative">
                      <ul className="space-y-3">
                        {plan.features.map((feature) => (
                          <li key={feature} className="flex items-start gap-2.5 text-sm">
                            <Check className="h-5 w-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                            <span className="text-zinc-700">{feature}</span>
                          </li>
                        ))}
                      </ul>
                      
                      {isCurrent ? (
                        <Badge variant="secondary" className="w-full justify-center py-3 text-sm">
                          Current Plan
                        </Badge>
                      ) : tier === 'free' ? (
                        <Button variant="outline" className="w-full" disabled>
                          Downgrade
                        </Button>
                      ) : (
                        <Button 
                          className={`w-full ${
                            plan.popular 
                              ? 'bg-violet-600 hover:bg-violet-700 shadow-md' 
                              : 'bg-zinc-900 hover:bg-zinc-800'
                          }`}
                          asChild
                        >
                          <a href={link} target="_blank" rel="noopener noreferrer">
                            {currentTier === 'free' ? `Upgrade to ${plan.name}` : `Switch to ${plan.name}`}
                          </a>
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
