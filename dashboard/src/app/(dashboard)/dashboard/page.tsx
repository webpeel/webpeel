'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import useSWR from 'swr';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UsageBar } from '@/components/usage-bar';
import { StatCard } from '@/components/stat-card';
import { ActivityTable } from '@/components/activity-table';
import { OnboardingModal } from '@/components/onboarding-modal';
import { CopyButton } from '@/components/copy-button';
import {
  RefreshCw,
  ExternalLink,
  Activity,
  Clock,
  CheckCircle2,
  Zap,
  AlertCircle,
  Play,
  BookOpen,
  Terminal,
  ArrowRight,
  Globe,
  Key,
  BarChart3,
  Circle,
} from 'lucide-react';
import { apiClient, Usage, ApiKey } from '@/lib/api';
import { ApiErrorBanner } from '@/components/api-error-banner';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.webpeel.dev';

const fetcher = async <T,>(url: string, token: string): Promise<T> => {
  return apiClient<T>(url, { token });
};

interface StatsData {
  totalRequests: number;
  successRate: number;
  avgResponseTime: number;
}

interface ActivityData {
  requests: Array<{
    id: string;
    url: string;
    status: 'success' | 'error';
    responseTime: number;
    mode: 'basic' | 'stealth';
    timestamp: string;
  }>;
}

interface DailyUsage {
  date: string;
  fetches: number;
  stealth: number;
  search: number;
}

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const token = (session as any)?.apiToken as string | undefined;
  const [storedApiKey, setStoredApiKey] = useState<string | null>(null);

  useEffect(() => {
    const key = localStorage.getItem('webpeel_first_api_key');
    if (key) setStoredApiKey(key);
  }, []);

  // SWR config: limit retries to avoid thundering herd on failures
  const swrOpts = { errorRetryCount: 2, dedupingInterval: 5000 };

  const { data: usage, isLoading: usageLoading, error: usageError, mutate: refreshUsage } = useSWR<Usage>(
    token ? ['/v1/usage', token] : null,
    ([url, token]: [string, string]) => fetcher<Usage>(url, token),
    { refreshInterval: 30000, ...swrOpts }
  );

  const { data: keys } = useSWR<{ keys: ApiKey[] }>(
    token ? ['/v1/keys', token] : null,
    ([url, token]: [string, string]) => fetcher<{ keys: ApiKey[] }>(url, token),
    swrOpts
  );

  const { data: stats, isLoading: statsLoading, error: statsError, mutate: refreshStats } = useSWR<StatsData>(
    token ? ['/v1/stats', token] : null,
    ([url, token]: [string, string]) => fetcher<StatsData>(url, token),
    { refreshInterval: 60000, ...swrOpts }
  );

  const { data: activity, isLoading: activityLoading, error: activityError, mutate: refreshActivity } = useSWR<ActivityData>(
    token ? ['/v1/activity?limit=5', token] : null,
    ([url, token]: [string, string]) => fetcher<ActivityData>(url, token),
    { refreshInterval: 30000, ...swrOpts }
  );

  const { data: history } = useSWR<{ history: DailyUsage[] }>(
    token ? ['/v1/usage/history?days=7', token] : null,
    ([url, token]: [string, string]) => fetcher<{ history: DailyUsage[] }>(url, token),
    { refreshInterval: 60000, ...swrOpts }
  );

  const dashboardError = usageError || statsError || activityError;
  const dashboardMutate = () => { refreshUsage(); refreshStats(); refreshActivity(); };

  if (status === 'authenticated' && !token) {
    return (
      <div className="mx-auto max-w-6xl">
        <ApiErrorBanner
          title="API Connection Issue"
          message="We couldn't connect your account to the WebPeel API. This can happen if the API was temporarily unavailable during sign-in. Reconnecting automatically..."
          reconnecting
        />
      </div>
    );
  }

  if (dashboardError) return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <AlertCircle className="h-8 w-8 text-red-500 mb-3" />
      <p className="text-sm text-muted-foreground mb-3">Failed to load data. Please try again.</p>
      <Button variant="outline" size="sm" onClick={() => dashboardMutate()}>Retry</Button>
    </div>
  );

  const primaryKey = keys?.keys?.[0];
  const sessionApiKey = (session as any)?.apiKey;
  const realApiKey = sessionApiKey || storedApiKey || null;
  const displayApiKey = realApiKey || 'YOUR_API_KEY';
  const userName = session?.user?.name?.split(' ')[0] || session?.user?.email?.split('@')[0] || 'there';

  // Stats
  const totalRequests = stats?.totalRequests || 0;
  const remaining = usage?.weekly ? usage.weekly.totalAvailable - usage.weekly.totalUsed : 0;
  const successRate = stats?.successRate || 100;
  const avgResponseTime = stats?.avgResponseTime || 0;
  const weeklyPercentage = usage?.weekly ? (usage.weekly.totalUsed / usage.weekly.totalAvailable) * 100 : 0;

  // Usage chart data
  const dailyHistory = history?.history || [];
  const maxDailyValue = Math.max(...dailyHistory.map((d) => d.fetches + d.stealth + d.search), 1);

  // Code examples
  const codeExamples = {
    curl: `curl "${API_URL}/v1/fetch?url=https://example.com" \\
  -H "Authorization: Bearer ${displayApiKey}"`,
    node: `const res = await fetch(
  '${API_URL}/v1/fetch?url=https://example.com',
  { headers: { 'Authorization': 'Bearer ${displayApiKey}' } }
);
const { markdown } = await res.json();`,
    python: `import requests

r = requests.get(
    '${API_URL}/v1/fetch',
    params={'url': 'https://example.com'},
    headers={'Authorization': 'Bearer ${displayApiKey}'}
)
print(r.json()['markdown'])`,
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 md:space-y-8">
      {/* Onboarding Modal */}
      <OnboardingModal sessionApiKey={sessionApiKey} />

      {/* Hero Section */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold text-zinc-900 mb-1">
            Welcome back, <span className="font-serif italic text-zinc-800">{userName}</span>
          </h1>
          <p className="text-base text-zinc-500">Here's your API activity at a glance</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => dashboardMutate()}
          disabled={usageLoading}
          className="gap-2 w-full sm:w-auto shrink-0"
        >
          <RefreshCw className={`h-4 w-4 ${usageLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Stat Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        {statsLoading ? (
          <>
            <div className="h-32 animate-pulse rounded-lg bg-zinc-100" />
            <div className="h-32 animate-pulse rounded-lg bg-zinc-100" />
            <div className="h-32 animate-pulse rounded-lg bg-zinc-100" />
            <div className="h-32 animate-pulse rounded-lg bg-zinc-100" />
          </>
        ) : (
          <>
            <StatCard icon={Activity} label="Total Requests" value={totalRequests.toLocaleString()} delay={0} />
            <StatCard icon={Zap} label="Remaining" value={remaining.toLocaleString()} iconColor="text-emerald-600" iconBg="bg-emerald-100" delay={100} />
            <StatCard icon={CheckCircle2} label="Success Rate" value={`${successRate.toFixed(1)}%`} iconColor="text-blue-600" iconBg="bg-blue-100" delay={200} />
            <StatCard icon={Clock} label="Avg Response" value={`${avgResponseTime}ms`} iconColor="text-amber-600" iconBg="bg-amber-100" delay={300} />
          </>
        )}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <a
          href="/playground"
          className="group flex items-center gap-3 p-4 bg-white border border-zinc-200 rounded-xl hover:border-zinc-500 hover:shadow-sm transition-all"
        >
          <div className="w-10 h-10 rounded-lg bg-zinc-100 flex items-center justify-center group-hover:bg-zinc-200 transition-colors flex-shrink-0">
            <Play className="h-5 w-5 text-zinc-800" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-zinc-900">Fetch a URL</p>
            <p className="text-xs text-zinc-500 truncate">Try the playground</p>
          </div>
          <ArrowRight className="h-4 w-4 text-zinc-300 group-hover:text-zinc-600 transition-colors flex-shrink-0" />
        </a>

        <a
          href="/keys"
          className="group flex items-center gap-3 p-4 bg-white border border-zinc-200 rounded-xl hover:border-amber-300 hover:shadow-sm transition-all"
        >
          <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center group-hover:bg-amber-200 transition-colors flex-shrink-0">
            <Key className="h-5 w-5 text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-zinc-900">Manage Keys</p>
            <p className="text-xs text-zinc-500 truncate">Create & rotate API keys</p>
          </div>
          <ArrowRight className="h-4 w-4 text-zinc-300 group-hover:text-amber-400 transition-colors flex-shrink-0" />
        </a>

        <a
          href="/usage"
          className="group flex items-center gap-3 p-4 bg-white border border-zinc-200 rounded-xl hover:border-blue-300 hover:shadow-sm transition-all"
        >
          <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center group-hover:bg-blue-200 transition-colors flex-shrink-0">
            <BarChart3 className="h-5 w-5 text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-zinc-900">View Usage</p>
            <p className="text-xs text-zinc-500 truncate">Charts & quota breakdown</p>
          </div>
          <ArrowRight className="h-4 w-4 text-zinc-300 group-hover:text-blue-400 transition-colors flex-shrink-0" />
        </a>

        <a
          href="https://webpeel.dev/docs/mcp"
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-center gap-3 p-4 bg-white border border-zinc-200 rounded-xl hover:border-emerald-300 hover:shadow-sm transition-all"
        >
          <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center group-hover:bg-emerald-200 transition-colors flex-shrink-0">
            <Terminal className="h-5 w-5 text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-zinc-900">Set up MCP</p>
            <p className="text-xs text-zinc-500 truncate">Claude / Cursor / Windsurf</p>
          </div>
          <ExternalLink className="h-4 w-4 text-zinc-300 group-hover:text-emerald-400 transition-colors flex-shrink-0" />
        </a>
      </div>

      {/* Getting Started Checklist */}
      <Card className="border-zinc-200">
        <CardHeader>
          <CardTitle className="text-lg">Getting Started</CardTitle>
          <CardDescription>Complete these steps to get the most out of WebPeel</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              {
                label: 'Create an API key',
                desc: 'Generate a key from the Keys page',
                done: !!(keys?.keys && keys.keys.length > 0),
                href: '/keys',
              },
              {
                label: 'Make your first API request',
                desc: 'Fetch any URL via the API or playground',
                done: !!(usage?.weekly && usage.weekly.totalUsed > 0),
                href: '/playground',
              },
              {
                label: 'Install the WebPeel CLI',
                desc: 'Run: npm install -g webpeel',
                done: false,
                href: 'https://webpeel.dev/docs/cli',
                external: true,
              },
              {
                label: 'Set up MCP for AI coding',
                desc: 'Use WebPeel in Claude, Cursor, or Windsurf',
                done: false,
                href: 'https://webpeel.dev/docs/mcp',
                external: true,
              },
            ].map(({ label, desc, done, href, external }) => (
              <a
                key={label}
                href={href}
                target={external ? '_blank' : undefined}
                rel={external ? 'noopener noreferrer' : undefined}
                className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                  done
                    ? 'border-emerald-100 bg-emerald-50 hover:bg-emerald-100'
                    : 'border-zinc-100 bg-zinc-50 hover:border-zinc-200 hover:bg-white'
                }`}
              >
                {done ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-500 flex-shrink-0" />
                ) : (
                  <Circle className="h-5 w-5 text-zinc-300 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${done ? 'text-emerald-800 line-through opacity-70' : 'text-zinc-800'}`}>
                    {label}
                  </p>
                  <p className="text-xs text-zinc-400 mt-0.5 truncate">{desc}</p>
                </div>
                {!done && (
                  <ArrowRight className="h-4 w-4 text-zinc-300 flex-shrink-0" />
                )}
              </a>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Usage + Activity Chart */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Usage Overview */}
        <Card className="border-zinc-200">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">Usage Overview</CardTitle>
                <CardDescription>Weekly API usage and limits</CardDescription>
              </div>
              {usage?.weekly && (
                <span className="text-xs text-zinc-400">
                  Resets {new Date(usage.weekly.resetsAt).toLocaleDateString()}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Donut */}
            <div className="flex items-center gap-6">
              <div className="relative w-28 h-28 flex-shrink-0">
                <svg className="w-full h-full -rotate-90 transform">
                  <circle cx="56" cy="56" r="46" fill="none" stroke="#F4F4F5" strokeWidth="10" />
                  <circle
                    cx="56" cy="56" r="46" fill="none"
                    stroke={weeklyPercentage > 80 ? 'url(#warningGrad)' : 'url(#grad)'}
                    strokeWidth="10"
                    strokeDasharray={`${(weeklyPercentage / 100) * 289} 289`}
                    strokeLinecap="round"
                    className="transition-all duration-700 ease-out"
                  />
                  <defs>
                    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#52525B" />
                      <stop offset="100%" stopColor="#18181B" />
                    </linearGradient>
                    <linearGradient id="warningGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#FCD34D" />
                      <stop offset="100%" stopColor="#EF4444" />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-xl font-bold text-zinc-900">{Math.round(weeklyPercentage)}%</span>
                  <span className="text-[10px] text-zinc-500">used</span>
                </div>
              </div>
              <div className="flex-1 space-y-3">
                {usage?.weekly ? (
                  <>
                    <UsageBar label="All fetches" used={usage.weekly.totalUsed} limit={usage.weekly.totalAvailable} />
                    <UsageBar label="Stealth" used={usage.weekly.stealthUsed} limit={usage.weekly.totalAvailable} />
                  </>
                ) : (
                  <>
                    <div className="h-14 animate-pulse rounded-lg bg-zinc-100" />
                    <div className="h-14 animate-pulse rounded-lg bg-zinc-100" />
                  </>
                )}
              </div>
            </div>

            {usage?.session && (
              <>
                <Separator />
                <UsageBar
                  label="Session burst"
                  used={usage.session.burstUsed}
                  limit={usage.session.burstLimit}
                  resetInfo={`Resets in ${usage.session.resetsIn}`}
                />
              </>
            )}
          </CardContent>
        </Card>

        {/* Activity Chart */}
        <Card className="border-zinc-200">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">Requests (7 days)</CardTitle>
                <CardDescription>Daily API request volume</CardDescription>
              </div>
              <Button variant="ghost" size="sm" asChild className="text-xs text-zinc-500 hover:text-zinc-800">
                <a href="/activity">View all <ArrowRight className="h-3 w-3 ml-1" /></a>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {dailyHistory.length > 0 ? (
              <>
                <div className="h-40 flex items-end justify-between gap-1.5">
                  {dailyHistory.map((day, i) => {
                    const total = day.fetches + day.stealth + day.search;
                    const heightPct = maxDailyValue > 0 ? (total / maxDailyValue) * 100 : 0;
                    const dayName = new Date(day.date).toLocaleDateString('en-US', { weekday: 'short' });
                    const isToday = i === dailyHistory.length - 1;

                    return (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1.5 group">
                        <div
                          className="relative w-full"
                          title={`${dayName}: ${total} requests`}
                        >
                          <div
                            className={`w-full rounded-t-md transition-all ${
                              isToday
                                ? 'bg-gradient-to-t from-zinc-800 to-zinc-600'
                                : 'bg-gradient-to-t from-zinc-500 to-zinc-200 group-hover:from-zinc-600 group-hover:to-zinc-500'
                            }`}
                            style={{ height: heightPct > 0 ? `${Math.max(heightPct * 1.4, 6)}px` : '2px' }}
                          />
                          {/* Tooltip */}
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                            <div className="bg-zinc-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                              {total} req
                            </div>
                          </div>
                        </div>
                        <span className={`text-[9px] font-medium ${isToday ? 'text-zinc-800' : 'text-zinc-400'}`}>
                          {dayName}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 flex items-center gap-4 text-xs text-zinc-400">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-sm bg-zinc-900" />
                    <span>Today</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-sm bg-zinc-200" />
                    <span>Previous days</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="h-40 flex flex-col items-center justify-center">
                <Globe className="h-10 w-10 text-zinc-200 mb-2" />
                <p className="text-sm text-zinc-400 font-medium">No requests yet</p>
                <p className="text-xs text-zinc-300 mt-0.5">Try the playground to get started</p>
                <Button size="sm" variant="outline" asChild className="mt-3">
                  <a href="/playground">
                    <Play className="h-3 w-3 mr-1.5" />
                    Open Playground
                  </a>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* API Endpoint + Quick Start */}
      <Card className="border-zinc-200">
        <CardHeader>
          <CardTitle className="text-xl">Quick Start</CardTitle>
          <CardDescription>Start making requests in seconds</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* API Endpoint */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-zinc-900">API Endpoint</label>
            <div className="flex items-center gap-2 p-3 bg-zinc-50 border border-zinc-200 rounded-lg">
              <Globe className="h-4 w-4 text-zinc-400 flex-shrink-0" />
              <code className="flex-1 text-sm font-mono text-zinc-700 truncate">{API_URL}/v1/fetch</code>
              <CopyButton text={`${API_URL}/v1/fetch`} size="sm" variant="ghost" />
            </div>
          </div>

          {/* API Key Display */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-zinc-900">Your API Key</label>
            <div className="flex items-center gap-2 p-3 bg-zinc-50 border border-zinc-200 rounded-lg font-mono text-sm">
              <code className="flex-1 truncate text-zinc-700">{displayApiKey}</code>
              <CopyButton text={displayApiKey} size="sm" variant="ghost" />
            </div>
            {!realApiKey && (
              <p className="text-xs text-zinc-500">
                Get your key from the{' '}
                <a href="/keys" className="text-zinc-800 hover:underline">Keys page</a>.
              </p>
            )}
          </div>

          {/* Code Examples */}
          <div className="space-y-3">
            <label className="text-sm font-semibold text-zinc-900">Example Request</label>
            <Tabs defaultValue="curl" className="w-full">
              <TabsList className="grid w-full grid-cols-3 mb-3">
                <TabsTrigger value="curl">cURL</TabsTrigger>
                <TabsTrigger value="node">Node.js</TabsTrigger>
                <TabsTrigger value="python">Python</TabsTrigger>
              </TabsList>
              {Object.entries(codeExamples).map(([lang, code]) => (
                <TabsContent key={lang} value={lang} className="mt-0">
                  <div className="relative">
                    <pre className="p-4 bg-zinc-900 text-zinc-100 rounded-lg overflow-x-auto text-xs md:text-sm">
                      <code>{code}</code>
                    </pre>
                    <div className="absolute top-3 right-3">
                      <CopyButton text={code} size="sm" variant="ghost" />
                    </div>
                  </div>
                </TabsContent>
              ))}
            </Tabs>
          </div>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-3">
            <Button asChild className="bg-[#5865F2] hover:bg-[#4752C4] flex-1 gap-2">
              <a href="/playground">
                <Play className="h-4 w-4" />
                Try in Playground
              </a>
            </Button>
            <Button variant="outline" asChild className="flex-1 gap-2">
              <a href="https://webpeel.dev/docs" target="_blank" rel="noopener noreferrer">
                <BookOpen className="h-4 w-4" />
                View Documentation
                <ExternalLink className="h-3 w-3" />
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <Card className="border-zinc-200">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl">Recent Activity</CardTitle>
              <CardDescription>Your latest API requests</CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <a href="/activity" className="gap-1.5">
                View all
                <ArrowRight className="h-3.5 w-3.5" />
              </a>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {activityLoading ? (
            <div className="h-64 animate-pulse rounded-lg bg-zinc-100" />
          ) : (
            <ActivityTable requests={activity?.requests || []} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
