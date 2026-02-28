'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import useSWR from 'swr';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, ExternalLink, Sparkles, Zap, Crown, AlertCircle } from 'lucide-react';
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
      '500 fetches per week',
      '50/hr burst limit',
      'All features included',
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
      'All features included',
      'Priority support',
      'Extra usage available',
    ],
    popular: true,
    icon: Zap,
    iconColor: 'text-zinc-800',
    iconBg: 'bg-zinc-100',
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
  admin: {
    name: 'Admin',
    priceMonthly: 0,
    priceAnnual: 0,
    monthlyLink: '',
    annualLink: '',
    features: [
      '6,250 fetches per week',
      '500/hr burst limit',
      'All Max features',
      'Dedicated support',
      'Higher spending caps',
      'Advanced analytics',
      'Webhook notifications',
      'Internal admin account',
    ],
    popular: false,
    icon: Crown,
    iconColor: 'text-[#5865F2]',
    iconBg: 'bg-indigo-100',
  },
};

type PlanTier = 'free' | 'pro' | 'max' | 'admin';

function getCheckoutLink(baseLink: string, email?: string, userId?: string): string {
  if (!baseLink) return '#';
  const url = new URL(baseLink);
  if (email) url.searchParams.set('prefilled_email', email);
  if (userId) url.searchParams.set('client_reference_id', userId);
  return url.toString();
}

export default function BillingPage() {
  const { data: session } = useSession();
  const token = (session as any)?.apiToken;
  const rawTier = (session as any)?.tier || 'free';
  const currentTier: PlanTier = (plans[rawTier as PlanTier]) ? rawTier as PlanTier : 'free';
  const userEmail = (session as any)?.user?.email;
  const userId = (session as any)?.user?.id;
  const [isAnnual, setIsAnnual] = useState(false);

  const { data: usage, error, mutate } = useSWR<Usage>(
    token ? ['/v1/usage', token] : null,
    ([url, token]: [string, string]) => fetcher<Usage>(url, token),
    { refreshInterval: 30000 }
  );

  if (error) return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <AlertCircle className="h-8 w-8 text-red-500 mb-3" />
      <p className="text-sm text-muted-foreground mb-3">Failed to load data. Please try again.</p>
      <Button variant="outline" size="sm" onClick={() => mutate()}>Retry</Button>
    </div>
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
        <div className="absolute inset-0 bg-gradient-to-r from-zinc-900 to-zinc-800 opacity-5 rounded-xl" />
        <Card className="border-2 border-zinc-200 relative">
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
              <Badge className="bg-zinc-800 text-white text-base px-4 py-2 w-fit">
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
                    <p className="text-sm text-zinc-600 mb-3">
                      Need to update your payment method, cancel, or change plans? Reach out and we&apos;ll take care of it.
                    </p>
                    <Button variant="outline" className="w-full gap-2" asChild>
                      <a href="mailto:support@webpeel.dev?subject=Subscription%20Change%20Request">
                        Contact Support
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Extra Usage Info */}
      {currentTier !== 'free' && (
        <Card className="border-zinc-200">
          <CardHeader>
            <CardTitle className="text-xl">Extra Usage</CardTitle>
            <CardDescription>What happens when you exceed your plan limits</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 bg-zinc-50 rounded-lg border border-zinc-100">
              <p className="font-medium text-zinc-900 mb-2">Pay-as-you-go rates</p>
              <p className="text-sm text-zinc-600 mb-3">
                When you hit your weekly limit, you can keep fetching at these rates:
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center p-3 bg-white rounded-lg border border-zinc-100">
                  <p className="text-lg font-bold text-zinc-900">$0.002</p>
                  <p className="text-xs text-zinc-500">Basic fetch</p>
                </div>
                <div className="text-center p-3 bg-white rounded-lg border border-zinc-100">
                  <p className="text-lg font-bold text-zinc-900">$0.01</p>
                  <p className="text-xs text-zinc-500">Stealth fetch</p>
                </div>
                <div className="text-center p-3 bg-white rounded-lg border border-zinc-100">
                  <p className="text-lg font-bold text-zinc-900">$0.001</p>
                  <p className="text-xs text-zinc-500">Search</p>
                </div>
              </div>
            </div>
            <p className="text-xs text-zinc-500">
              Extra usage billing is coming soon. For now, soft limits apply — your requests slow down but never stop completely.
              Questions? Contact{' '}
              <a href="mailto:support@webpeel.dev" className="text-zinc-800 hover:underline">
                support@webpeel.dev
              </a>
            </p>
          </CardContent>
        </Card>
      )}

      {/* Upgrade Plans */}
      {currentTier !== 'max' && currentTier !== 'admin' && (
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
            {(Object.keys(plans) as PlanTier[]).filter((t) => t !== 'admin').map((tier) => {
              const plan = plans[tier];
              const Icon = plan.icon;
              const isCurrent = currentTier === tier;
              const price = isAnnual ? plan.priceAnnual : plan.priceMonthly;
              const rawLink = isAnnual ? plan.annualLink : plan.monthlyLink;
              const link = getCheckoutLink(rawLink, userEmail, userId);
              const monthlySavings = isAnnual ? (plan.priceMonthly * 12 - plan.priceAnnual) : 0;
              
              return (
                <div key={tier} className="relative">
                  {/* Most Popular Ribbon */}
                  {plan.popular && (
                    <div className="absolute -top-3 left-0 right-0 flex justify-center z-10">
                      <Badge className="bg-zinc-800 text-white px-4 py-1 shadow-md">
                        Most Popular
                      </Badge>
                    </div>
                  )}
                  
                  <Card 
                    className={`relative h-full transition-all ${
                      isCurrent 
                        ? 'border-2 border-zinc-800 shadow-lg' 
                        : plan.popular 
                        ? 'border-2 border-zinc-200 shadow-md hover:shadow-lg hover:border-zinc-500' 
                        : 'border border-zinc-200 hover:border-zinc-300 hover:shadow-md'
                    }`}
                  >
                    {plan.popular && !isCurrent && (
                      <div className="absolute inset-0 bg-gradient-to-br from-zinc-900/5 to-zinc-800/5 rounded-xl pointer-events-none" />
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
                              ? 'bg-zinc-800 hover:bg-zinc-800 shadow-md' 
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
