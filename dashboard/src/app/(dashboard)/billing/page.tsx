'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import useSWR from 'swr';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Check,
  ExternalLink,
  Sparkles,
  Zap,
  Crown,
  AlertCircle,
  CreditCard,
  Receipt,
  ArrowRight,
  Info,
} from 'lucide-react';
import { apiClient, Usage } from '@/lib/api';

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

const fetcher = async <T,>(url: string, token: string): Promise<T> =>
  apiClient<T>(url, { token });

type PlanTier = 'free' | 'pro' | 'max' | 'admin';

interface PlanMeta {
  name: string;
  priceMonthly: number;
  priceAnnual: number;
  fetchesPerWeek: string;
  fetchesPerWeekNum: number;
  description: string;
  monthlyLink: string;
  annualLink: string;
  features: string[];
  popular: boolean;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
}

const plans: Record<PlanTier, PlanMeta> = {
  free: {
    name: 'Free',
    priceMonthly: 0,
    priceAnnual: 0,
    fetchesPerWeek: '500',
    fetchesPerWeekNum: 500,
    description: '500 fetches per week',
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
    iconBg: 'bg-zinc-800',
  },
  pro: {
    name: 'Pro',
    priceMonthly: 9,
    priceAnnual: 90,
    fetchesPerWeek: '1,250',
    fetchesPerWeekNum: 1250,
    description: '1,250 fetches per week',
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
    iconColor: 'text-[#5865F2]',
    iconBg: 'bg-[#5865F2]/20',
  },
  max: {
    name: 'Max',
    priceMonthly: 29,
    priceAnnual: 290,
    fetchesPerWeek: '6,250',
    fetchesPerWeekNum: 6250,
    description: '6,250 fetches per week',
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
    fetchesPerWeek: 'Unlimited',
    fetchesPerWeekNum: 999999,
    description: 'Unlimited fetches',
    monthlyLink: '',
    annualLink: '',
    features: [
      'Unlimited fetches',
      '500/hr burst limit',
      'All Max features',
      'Internal admin account',
    ],
    popular: false,
    icon: Crown,
    iconColor: 'text-[#5865F2]',
    iconBg: 'bg-[#5865F2]/20',
  },
};

function getCheckoutLink(baseLink: string, email?: string, userId?: string): string {
  if (!baseLink) return '#';
  const url = new URL(baseLink);
  if (email) url.searchParams.set('prefilled_email', email);
  if (userId) url.searchParams.set('client_reference_id', userId);
  return url.toString();
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PlanIcon({ tier, size = 'md' }: { tier: PlanTier; size?: 'sm' | 'md' | 'lg' }) {
  const plan = plans[tier];
  const Icon = plan.icon;
  const sizeMap = {
    sm: { wrap: 'w-9 h-9', icon: 'h-4 w-4' },
    md: { wrap: 'w-12 h-12', icon: 'h-6 w-6' },
    lg: { wrap: 'w-16 h-16', icon: 'h-8 w-8' },
  };
  const s = sizeMap[size];
  return (
    <div className={`${s.wrap} rounded-xl ${plan.iconBg} flex items-center justify-center flex-shrink-0`}>
      <Icon className={`${s.icon} ${plan.iconColor}`} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function BillingPage() {
  const { data: session } = useSession();
  const token = (session as any)?.apiToken;
  const rawTier = (session as any)?.tier || 'free';
  const currentTier: PlanTier = plans[rawTier as PlanTier] ? (rawTier as PlanTier) : 'free';
  const userEmail = (session as any)?.user?.email;
  const userId = (session as any)?.user?.id;
  const [isAnnual, setIsAnnual] = useState(false);

  const currentPlan = plans[currentTier];
  const isPaid = currentTier === 'pro' || currentTier === 'max';
  const isAdmin = currentTier === 'admin';

  const { data: usage, error, mutate } = useSWR<Usage>(
    token ? ['/v1/usage', token] : null,
    ([url, tok]: [string, string]) => fetcher<Usage>(url, tok),
    { refreshInterval: 30000 }
  );

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <AlertCircle className="h-8 w-8 text-red-500 mb-3" />
        <p className="text-sm text-muted-foreground mb-3">Failed to load billing data. Please try again.</p>
        <Button variant="outline" size="sm" onClick={() => mutate()}>Retry</Button>
      </div>
    );
  }

  // Usage math
  const usedFetches = usage?.weekly?.totalUsed ?? 0;
  const availFetches = usage?.weekly?.totalAvailable ?? currentPlan.fetchesPerWeekNum;
  const usedPct = availFetches > 0 ? Math.min((usedFetches / availFetches) * 100, 100) : 0;
  const resetsAt = usage?.weekly?.resetsAt
    ? new Date(usage.weekly.resetsAt).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      })
    : null;

  // Plan comparison (show Free/Pro/Max only)
  const comparisonTiers: PlanTier[] = ['free', 'pro', 'max'];

  return (
    <div className="mx-auto max-w-5xl space-y-8">

      {/* ------------------------------------------------------------------ */}
      {/* Page header                                                         */}
      {/* ------------------------------------------------------------------ */}
      <div>
        <h1 className="text-3xl font-bold text-zinc-100">Billing &amp; Plans</h1>
        <p className="text-sm text-zinc-500 mt-1.5">Manage your subscription and view usage</p>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Section 1: Current Plan Card                                        */}
      {/* ------------------------------------------------------------------ */}
      <div className={`relative rounded-2xl overflow-hidden border-2 ${
        isPaid || isAdmin
          ? 'border-[#5865F2] shadow-[0_0_0_1px_rgba(88,101,242,0.15),0_4px_24px_rgba(88,101,242,0.12)]'
          : 'border-zinc-700 shadow-sm'
      }`}>
        {/* Subtle blurple wash for paid plans */}
        {(isPaid || isAdmin) && (
          <div className="absolute inset-0 bg-[#5865F2]/10 pointer-events-none" />
        )}

        <div className="relative p-6 md:p-8">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6">
            {/* Left: plan identity */}
            <div className="flex items-start gap-4">
              <PlanIcon tier={currentTier} size="lg" />
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h2 className="text-2xl font-bold text-zinc-100">{currentPlan.name}</h2>
                  <Badge
                    className={`text-xs font-semibold px-2.5 py-0.5 ${
                      isPaid || isAdmin
                        ? 'bg-[#5865F2] text-white'
                        : 'bg-zinc-800 text-white'
                    }`}
                  >
                    {isAdmin ? 'Admin' : isPaid ? 'Active' : 'Free'}
                  </Badge>
                </div>
                <p className="text-sm text-zinc-500 mt-1">{currentPlan.description}</p>

                {/* Price row */}
                <div className="flex items-baseline gap-1 mt-3">
                  <span className="text-4xl font-bold text-zinc-100">
                    ${currentPlan.priceMonthly}
                  </span>
                  <span className="text-zinc-400 text-sm">/mo</span>
                </div>

                {/* Renewal or free note */}
                {isPaid && resetsAt && (
                  <p className="text-xs text-zinc-500 mt-2 flex items-center gap-1.5">
                    <Info className="h-3.5 w-3.5" />
                    Weekly quota resets on {resetsAt}
                  </p>
                )}
                {!isPaid && !isAdmin && (
                  <p className="text-xs text-zinc-400 mt-2">
                    Upgrade to unlock more fetches and priority support
                  </p>
                )}
              </div>
            </div>

            {/* Right: CTA */}
            <div className="flex flex-col items-start sm:items-end gap-3 sm:flex-shrink-0">
              {isPaid ? (
                <Button
                  variant="outline"
                  className="gap-2 border-zinc-300 hover:border-zinc-400"
                  asChild
                >
                  <a href="mailto:support@webpeel.dev?subject=Subscription%20Change%20Request">
                    Manage Plan
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              ) : isAdmin ? (
                <Badge className="bg-[#5865F2]/20 text-[#5865F2] text-sm px-3 py-1.5">
                  Admin Account
                </Badge>
              ) : (
                <Button
                  className="gap-2 bg-[#5865F2] hover:bg-[#4752C4] shadow-sm"
                  asChild
                >
                  <a
                    href={getCheckoutLink(plans.pro.monthlyLink, userEmail, userId)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Upgrade Plan
                    <ArrowRight className="h-4 w-4" />
                  </a>
                </Button>
              )}
            </div>
          </div>

          {/* Features list */}
          <div className="mt-6 pt-6 border-t border-zinc-800">
            <ul className="grid sm:grid-cols-2 gap-x-8 gap-y-2">
              {currentPlan.features.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-zinc-600">
                  <Check className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Section 2: Usage This Period                                        */}
      {/* ------------------------------------------------------------------ */}
      <Card className="border-zinc-700">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold text-zinc-100">Usage This Period</CardTitle>
            <Button variant="ghost" size="sm" className="text-xs text-zinc-500 hover:text-zinc-200 gap-1 -mr-1" asChild>
              <Link href="/usage">
                Full details
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
          {resetsAt && (
            <CardDescription className="text-xs">Resets on {resetsAt}</CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {usage?.weekly ? (
            <>
              {/* Compact label */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-300 font-medium">
                  {usedFetches.toLocaleString()} / {availFetches.toLocaleString()} fetches
                  <span className="text-zinc-400 font-normal ml-2">·</span>
                  <span className="text-zinc-400 font-normal ml-2">{usedPct.toFixed(1)}% used</span>
                </span>
                <span className="text-xs text-zinc-400">{usage.weekly.remaining.toLocaleString()} left</span>
              </div>

              {/* Progress bar */}
              <div className="h-2 w-full rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    usedPct > 80
                      ? 'bg-gradient-to-r from-amber-400 to-red-500'
                      : 'bg-gradient-to-r from-[#5865F2] to-indigo-400'
                  }`}
                  style={{ width: `${usedPct}%` }}
                />
              </div>

              {/* Type breakdown dots */}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-zinc-400 pt-0.5">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-zinc-700 inline-block" />
                  Basic: {usage.weekly.basicUsed.toLocaleString()}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
                  Stealth: {usage.weekly.stealthUsed.toLocaleString()}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                  Search: {usage.weekly.searchUsed.toLocaleString()}
                </span>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <div className="h-4 rounded-full bg-zinc-800 animate-pulse" />
              <div className="h-2 rounded-full bg-zinc-800 animate-pulse" />
            </div>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Section 3: Plan Comparison                                          */}
      {/* ------------------------------------------------------------------ */}
      <div className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-zinc-100">All Plans</h2>
            <p className="text-sm text-zinc-500 mt-0.5">Compare plans and switch anytime</p>
          </div>

          {/* Monthly / Annual toggle */}
          <div className="flex items-center gap-1 p-1 bg-zinc-800 rounded-full w-fit">
            <button
              onClick={() => setIsAnnual(false)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                !isAnnual ? 'bg-zinc-900 text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setIsAnnual(true)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all flex items-center gap-2 ${
                isAnnual ? 'bg-zinc-900 text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Annual
              <Badge className="bg-emerald-100 text-emerald-700 text-[10px] px-1.5 py-0 font-semibold">
                −17%
              </Badge>
            </button>
          </div>
        </div>

        {/* Upgrade CTA banner (only for free users) */}
        {currentTier === 'free' && (
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 px-5 py-4 rounded-xl bg-[#5865F2]/10 border border-[#5865F2]/30">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-[#5865F2] flex items-center justify-center flex-shrink-0">
                <Zap className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-zinc-100">Upgrade to Pro</p>
                <p className="text-xs text-zinc-400">Get 1,250 fetches/week, browser rendering, and more.</p>
              </div>
            </div>
            <Button
              size="sm"
              className="bg-[#5865F2] hover:bg-[#4752C4] gap-1.5 flex-shrink-0"
              asChild
            >
              <a
                href={getCheckoutLink(plans.pro.monthlyLink, userEmail, userId)}
                target="_blank"
                rel="noopener noreferrer"
              >
                Upgrade to Pro →
              </a>
            </Button>
          </div>
        )}

        {/* Plan cards grid */}
        <div className="grid gap-4 md:grid-cols-3">
          {comparisonTiers.map((tier) => {
            const plan = plans[tier];
            const Icon = plan.icon;
            const isCurrent = currentTier === tier;
            const price = isAnnual ? plan.priceAnnual : plan.priceMonthly;
            const rawLink = isAnnual ? plan.annualLink : plan.monthlyLink;
            const link = getCheckoutLink(rawLink, userEmail, userId);
            const annualSavings = isAnnual && plan.priceMonthly > 0
              ? plan.priceMonthly * 12 - plan.priceAnnual
              : 0;
            const isDowngrade = currentTier === 'pro' && tier === 'free'
              || currentTier === 'max' && (tier === 'free' || tier === 'pro')
              || isAdmin;

            return (
              <div key={tier} className="relative">
                {/* Popular ribbon */}
                {plan.popular && (
                  <div className="absolute -top-3 left-0 right-0 flex justify-center z-10">
                    <span className="bg-[#5865F2] text-white text-[11px] font-semibold px-3 py-0.5 rounded-full shadow-md">
                      Most Popular
                    </span>
                  </div>
                )}

                <div
                  className={`relative h-full flex flex-col rounded-xl border-2 transition-all overflow-hidden ${
                    isCurrent
                      ? 'border-[#5865F2] shadow-[0_0_0_1px_rgba(88,101,242,0.1),0_4px_16px_rgba(88,101,242,0.1)]'
                      : plan.popular
                      ? 'border-zinc-700 shadow-md hover:border-indigo-200 hover:shadow-lg'
                      : 'border-zinc-700 hover:border-zinc-300 hover:shadow-sm'
                  }`}
                >
                  {/* Subtle wash for current */}
                  {isCurrent && (
                    <div className="absolute inset-0 bg-[#5865F2]/10 pointer-events-none" />
                  )}

                  <div className="relative p-5 flex flex-col h-full">
                    {/* Header */}
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl ${plan.iconBg} flex items-center justify-center`}>
                          <Icon className={`h-5 w-5 ${plan.iconColor}`} />
                        </div>
                        <span className="font-bold text-zinc-100 text-lg">{plan.name}</span>
                      </div>
                      {isCurrent && (
                        <Badge className="bg-[#5865F2] text-white text-[10px] px-2 py-0.5">
                          Current
                        </Badge>
                      )}
                    </div>

                    {/* Price */}
                    <div className="mb-1">
                      <div className="flex items-baseline gap-1">
                        <span className="text-4xl font-bold text-zinc-100">${price}</span>
                        <span className="text-zinc-400 text-sm">/{isAnnual ? 'yr' : 'mo'}</span>
                      </div>
                      {annualSavings > 0 && (
                        <p className="text-xs text-emerald-600 font-medium mt-0.5">
                          Save ${annualSavings}/yr
                        </p>
                      )}
                      {!isAnnual && plan.priceMonthly > 0 && (
                        <p className="text-xs text-zinc-400 mt-0.5">{plan.fetchesPerWeek} fetches/week</p>
                      )}
                      {plan.priceMonthly === 0 && (
                        <p className="text-xs text-zinc-400 mt-0.5">{plan.fetchesPerWeek} fetches/week</p>
                      )}
                    </div>

                    {/* Features */}
                    <ul className="space-y-2 mt-4 mb-6 flex-1">
                      {plan.features.map((f) => (
                        <li key={f} className="flex items-start gap-2 text-sm text-zinc-600">
                          <Check className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                          {f}
                        </li>
                      ))}
                    </ul>

                    {/* CTA */}
                    {isCurrent ? (
                      <div className="w-full py-2 text-center rounded-lg bg-[#5865F2]/20 border border-[#5865F2]/40 text-[#5865F2] text-sm font-medium">
                        Current Plan
                      </div>
                    ) : isDowngrade || tier === 'free' ? (
                      <Button variant="outline" className="w-full text-zinc-400 border-zinc-700" disabled>
                        {tier === 'free' ? 'Downgrade' : 'Contact support'}
                      </Button>
                    ) : (
                      <Button
                        className="w-full bg-[#5865F2] hover:bg-[#4752C4] gap-1.5"
                        asChild
                      >
                        <a href={link} target="_blank" rel="noopener noreferrer">
                          {currentTier === 'free'
                            ? `Upgrade to ${plan.name}`
                            : `Switch to ${plan.name}`}
                          <ArrowRight className="h-4 w-4" />
                        </a>
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Section 4: Manage Subscription                                      */}
      {/* ------------------------------------------------------------------ */}
      <Card className="border-zinc-700">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-zinc-400" />
            <CardTitle className="text-base font-semibold text-zinc-100">Manage Subscription</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="bg-card border border-zinc-800 rounded-lg p-6">
            <h3 className="text-white font-semibold mb-1">Billing Portal</h3>
            <p className="text-zinc-400 text-sm mb-4">
              Update payment method, view invoices, and manage your billing details via the Stripe Customer Portal.
            </p>
            <button
              onClick={async () => {
                try {
                  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.webpeel.dev';
                  const res = await fetch(`${API_URL}/v1/billing/portal`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}` },
                  });
                  const data = await res.json();
                  if (data.url) {
                    window.open(data.url, '_blank');
                  } else if (data.message) {
                    alert(data.message);
                  }
                } catch (e) {
                  alert('Could not open billing portal. Please try again.');
                }
              }}
              className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-sm rounded-lg transition-colors cursor-pointer"
            >
              Open Billing Portal →
            </button>
            <p className="text-zinc-500 text-xs mt-3">
              You&apos;ll be redirected to Stripe&apos;s secure portal. Use your account email to authenticate.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Section 5: Invoices                                                 */}
      {/* ------------------------------------------------------------------ */}
      <Card className="border-zinc-700">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-zinc-400" />
            <CardTitle className="text-base font-semibold text-zinc-100">Invoices</CardTitle>
          </div>
          <CardDescription className="text-xs">Access your billing history</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-zinc-400 text-sm">
            Invoices are available in the{' '}
            <button
              onClick={async () => {
                try {
                  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.webpeel.dev';
                  const res = await fetch(`${API_URL}/v1/billing/portal`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}` },
                  });
                  const data = await res.json();
                  if (data.url) {
                    window.open(data.url, '_blank');
                  } else if (data.message) {
                    alert(data.message);
                  }
                } catch (e) {
                  alert('Could not open billing portal. Please try again.');
                }
              }}
              className="text-[#5865F2] hover:underline cursor-pointer bg-transparent border-none p-0 font-inherit"
            >
              Billing Portal
            </button>
            . Open the portal above to view and download your invoice history.
          </p>
        </CardContent>
      </Card>

    </div>
  );
}
