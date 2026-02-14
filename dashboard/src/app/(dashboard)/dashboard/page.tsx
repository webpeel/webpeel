'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import useSWR from 'swr';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UsageBar } from '@/components/usage-bar';
import { StatCard } from '@/components/stat-card';
import { ActivityTable } from '@/components/activity-table';
import { CopyButton } from '@/components/copy-button';
import { OnboardingModal } from '@/components/onboarding-modal';
import { RefreshCw, ExternalLink, Activity, Clock, CheckCircle2, Zap, Copy } from 'lucide-react';
import { apiClient, Usage, ApiKey } from '@/lib/api';

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

export default function DashboardPage() {
  const { data: session } = useSession();
  const token = (session as any)?.apiToken;
  const [copied, setCopied] = useState(false);

  const { data: usage, isLoading: usageLoading, mutate: refreshUsage } = useSWR<Usage>(
    token ? ['/v1/usage', token] : null,
    ([url, token]: [string, string]) => fetcher<Usage>(url, token),
    { refreshInterval: 30000 }
  );

  const { data: keys } = useSWR<{ keys: ApiKey[] }>(
    token ? ['/v1/keys', token] : null,
    ([url, token]: [string, string]) => fetcher<{ keys: ApiKey[] }>(url, token)
  );

  const { data: stats, isLoading: statsLoading } = useSWR<StatsData>(
    token ? ['/v1/stats', token] : null,
    ([url, token]: [string, string]) => fetcher<StatsData>(url, token),
    { refreshInterval: 60000 }
  );

  const { data: activity, isLoading: activityLoading } = useSWR<ActivityData>(
    token ? ['/v1/activity', token] : null,
    ([url, token]: [string, string]) => fetcher<ActivityData>(url, token),
    { refreshInterval: 30000 }
  );

  const primaryKey = keys?.keys?.[0];
  const apiKey = primaryKey ? `${primaryKey.prefix}_${primaryKey.id}` : 'YOUR_API_KEY';
  const userName = session?.user?.name?.split(' ')[0] || session?.user?.email?.split('@')[0] || 'there';

  // Calculate stats
  const totalRequests = stats?.totalRequests || 0;
  const remaining = usage?.weekly ? usage.weekly.totalAvailable - usage.weekly.totalUsed : 0;
  const successRate = stats?.successRate || 100;
  const avgResponseTime = stats?.avgResponseTime || 0;
  const weeklyPercentage = usage?.weekly ? (usage.weekly.totalUsed / usage.weekly.totalAvailable) * 100 : 0;

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Code examples for different languages
  const codeExamples = {
    curl: `curl "https://api.webpeel.dev/v1/fetch?url=https://example.com" \\
  -H "Authorization: Bearer ${apiKey}"`,
    node: `const response = await fetch(
  'https://api.webpeel.dev/v1/fetch?url=https://example.com',
  { headers: { 'Authorization': 'Bearer ${apiKey}' } }
);
const data = await response.json();`,
    python: `import requests

response = requests.get(
    'https://api.webpeel.dev/v1/fetch',
    params={'url': 'https://example.com'},
    headers={'Authorization': f'Bearer ${apiKey}'}
)
data = response.json()`
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 md:space-y-8">
      {/* Onboarding Modal */}
      <OnboardingModal apiKey={apiKey} />
      
      {/* Hero Section */}
      <div>
        <h1 className="text-3xl md:text-4xl font-bold text-zinc-900 mb-2">
          Welcome back, <span className="font-serif italic text-violet-600">{userName}</span>
        </h1>
        <p className="text-base text-zinc-500">Here's your API activity at a glance</p>
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
            <StatCard
              icon={Activity}
              label="Total Requests"
              value={totalRequests.toLocaleString()}
              delay={0}
            />
            <StatCard
              icon={Zap}
              label="Remaining"
              value={remaining.toLocaleString()}
              iconColor="text-emerald-600"
              iconBg="bg-emerald-100"
              delay={100}
            />
            <StatCard
              icon={CheckCircle2}
              label="Success Rate"
              value={`${successRate.toFixed(1)}%`}
              iconColor="text-blue-600"
              iconBg="bg-blue-100"
              delay={200}
            />
            <StatCard
              icon={Clock}
              label="Avg Response"
              value={`${avgResponseTime}ms`}
              iconColor="text-amber-600"
              iconBg="bg-amber-100"
              delay={300}
            />
          </>
        )}
      </div>

      {/* Usage Section with Visual Ring */}
      <Card className="border-zinc-200">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-xl">Usage Overview</CardTitle>
              <CardDescription>Track your API usage and limits</CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refreshUsage()}
              disabled={usageLoading}
              className="gap-2 w-full sm:w-auto"
            >
              <RefreshCw className={`h-4 w-4 ${usageLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Weekly Usage with Visual Donut */}
          <div className="grid md:grid-cols-2 gap-6">
            {/* Donut Chart */}
            <div className="flex items-center justify-center p-6">
              <div className="relative w-48 h-48">
                <svg className="w-full h-full -rotate-90 transform">
                  {/* Background circle */}
                  <circle
                    cx="96"
                    cy="96"
                    r="80"
                    fill="none"
                    stroke="#F4F4F5"
                    strokeWidth="16"
                  />
                  {/* Progress circle */}
                  <circle
                    cx="96"
                    cy="96"
                    r="80"
                    fill="none"
                    stroke={weeklyPercentage > 80 ? 'url(#warningGradient)' : 'url(#gradient)'}
                    strokeWidth="16"
                    strokeDasharray={`${(weeklyPercentage / 100) * 502.65} 502.65`}
                    strokeLinecap="round"
                    className="transition-all duration-700 ease-out"
                  />
                  <defs>
                    <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#A78BFA" />
                      <stop offset="100%" stopColor="#8B5CF6" />
                    </linearGradient>
                    <linearGradient id="warningGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#FCD34D" />
                      <stop offset="100%" stopColor="#EF4444" />
                    </linearGradient>
                  </defs>
                </svg>
                {/* Center text */}
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-bold text-zinc-900">{Math.round(weeklyPercentage)}%</span>
                  <span className="text-xs text-zinc-500 mt-1">Used this week</span>
                </div>
              </div>
            </div>

            {/* Usage Details */}
            <div className="space-y-4 flex flex-col justify-center">
              {usage?.weekly ? (
                <>
                  <UsageBar
                    label="All fetches"
                    used={usage.weekly.totalUsed}
                    limit={usage.weekly.totalAvailable}
                    resetInfo={`Resets ${new Date(usage.weekly.resetsAt).toLocaleDateString()}`}
                  />
                  <UsageBar
                    label="Stealth fetches"
                    used={usage.weekly.stealthUsed}
                    limit={usage.weekly.totalAvailable}
                  />
                </>
              ) : (
                <>
                  <div className="h-20 animate-pulse rounded-lg bg-zinc-100" />
                  <div className="h-20 animate-pulse rounded-lg bg-zinc-100" />
                </>
              )}
            </div>
          </div>

          <Separator />

          {/* Burst Limits */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-900">Current Session</h3>
              <a
                href="https://github.com/JakeLiuMe/webpeel#usage-limits"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-violet-600 hover:underline flex items-center gap-1"
              >
                Learn about limits
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            {usage?.session ? (
              <UsageBar
                label="Burst usage"
                used={usage.session.burstUsed}
                limit={usage.session.burstLimit}
                resetInfo={`Resets in ${usage.session.resetsIn}`}
              />
            ) : (
              <div className="h-20 animate-pulse rounded-lg bg-zinc-100" />
            )}
          </div>
        </CardContent>
      </Card>

      {/* Quick Start Section with Tabs */}
      <Card className="border-zinc-200">
        <CardHeader>
          <CardTitle className="text-xl">Quick Start</CardTitle>
          <CardDescription>Start making requests in seconds</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* API Key Display */}
          <div className="space-y-3">
            <label className="text-sm font-semibold text-zinc-900">Your API Key</label>
            <div className="flex items-center gap-2 p-3 bg-zinc-50 border border-zinc-200 rounded-lg font-mono text-sm">
              <code className="flex-1 truncate text-zinc-700">{apiKey}</code>
              <button
                onClick={() => handleCopy(apiKey)}
                className="p-2 hover:bg-zinc-200 rounded-md transition-colors"
              >
                {copied ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                ) : (
                  <Copy className="h-4 w-4 text-zinc-500" />
                )}
              </button>
            </div>
            {!primaryKey && (
              <p className="text-xs text-zinc-500">
                No API key found.{' '}
                <a href="/keys" className="text-violet-600 hover:underline">
                  Create one
                </a>{' '}
                to get started.
              </p>
            )}
          </div>

          {/* Code Examples with Tabs */}
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
                    <button
                      onClick={() => handleCopy(code)}
                      className="absolute top-3 right-3 p-2 hover:bg-zinc-800 rounded-md transition-colors"
                    >
                      {copied ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      ) : (
                        <Copy className="h-4 w-4 text-zinc-400" />
                      )}
                    </button>
                  </div>
                </TabsContent>
              ))}
            </Tabs>
          </div>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-3">
            <Button asChild className="bg-violet-600 hover:bg-violet-700 flex-1">
              <a href="https://github.com/JakeLiuMe/webpeel#readme" target="_blank" rel="noopener noreferrer">
                View Documentation
              </a>
            </Button>
            <Button variant="outline" asChild className="flex-1">
              <a href="/keys">Manage API Keys</a>
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
              <a href="/usage">View all</a>
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
