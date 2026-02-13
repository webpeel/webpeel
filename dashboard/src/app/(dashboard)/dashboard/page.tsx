'use client';

import { useSession } from 'next-auth/react';
import useSWR from 'swr';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { UsageBar } from '@/components/usage-bar';
import { ApiKeyDisplay } from '@/components/api-key-display';
import { CodeBlock } from '@/components/code-block';
import { RefreshCw, ExternalLink } from 'lucide-react';
import { apiClient, Usage, ApiKey } from '@/lib/api';

const fetcher = async <T,>(url: string, token: string): Promise<T> => {
  return apiClient<T>(url, { token });
};

export default function DashboardPage() {
  const { data: session } = useSession();
  const token = (session as any)?.apiToken;

  const { data: usage, isLoading: usageLoading, mutate: refreshUsage } = useSWR<Usage>(
    token ? ['/v1/usage', token] : null,
    ([url, token]: [string, string]) => fetcher<Usage>(url, token),
    { refreshInterval: 30000 }
  );

  const { data: keys } = useSWR<{ keys: ApiKey[] }>(
    token ? ['/v1/keys', token] : null,
    ([url, token]: [string, string]) => fetcher<{ keys: ApiKey[] }>(url, token)
  );

  const primaryKey = keys?.keys?.[0];
  const tier = (session as any)?.tier || 'free';
  const userName = session?.user?.name || session?.user?.email?.split('@')[0] || 'there';

  return (
    <div className="mx-auto max-w-6xl space-y-6 md:space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Welcome back, {userName}</h1>
          <p className="text-sm md:text-base text-muted-foreground">Here's what's happening with your account</p>
        </div>
        <Badge variant="secondary" className="bg-violet-100 text-violet-700 text-sm px-3 py-1 w-fit">
          {tier.toUpperCase()} Plan
        </Badge>
      </div>

      <div className="grid gap-4 md:gap-6">
        {/* Usage Overview */}
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <CardTitle className="text-lg md:text-xl">Plan Usage Limits</CardTitle>
                <CardDescription className="text-sm">Track your API usage and limits</CardDescription>
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
            {/* Current Session */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Current Session</h3>
              {usage?.current_session ? (
                <UsageBar
                  label="Session usage"
                  used={usage.current_session.used}
                  limit={usage.current_session.limit}
                  resetInfo={`Resets in ${usage.current_session.resets_in}`}
                />
              ) : (
                <div className="h-20 animate-pulse rounded-lg bg-zinc-100" />
              )}
            </div>

            <Separator />

            {/* Weekly Limits */}
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <h3 className="text-sm font-semibold">Weekly Limits</h3>
                <a
                  href="https://webpeel.dev/docs/limits"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-violet-600 hover:underline flex items-center gap-1"
                >
                  Learn more about usage limits
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              {usage?.weekly ? (
                <>
                  <UsageBar
                    label="All fetches"
                    used={usage.weekly.all_fetches.used}
                    limit={usage.weekly.all_fetches.limit}
                    resetInfo={`Resets ${new Date(usage.weekly.resets_at).toLocaleDateString()}`}
                  />
                  <UsageBar
                    label="CAPTCHA solves"
                    used={usage.weekly.captcha_solves.used}
                    limit={usage.weekly.captcha_solves.limit}
                    showTooltip
                  />
                </>
              ) : (
                <>
                  <div className="h-20 animate-pulse rounded-lg bg-zinc-100" />
                  <div className="h-20 animate-pulse rounded-lg bg-zinc-100" />
                </>
              )}

              {usage && (
                <p className="text-xs text-muted-foreground">
                  Last updated: just now
                </p>
              )}
            </div>

            {/* Extra Usage */}
            {usage?.extra_usage && (
              <>
                <Separator />
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">Extra Usage</h3>
                      <p className="text-xs text-muted-foreground">
                        Keep fetching if you hit a limit
                      </p>
                    </div>
                    <Switch checked={usage.extra_usage.enabled} />
                  </div>

                  <UsageBar
                    label="Spending this month"
                    used={usage.extra_usage.spent}
                    limit={usage.extra_usage.limit}
                    resetInfo="Resets Mar 1"
                  />

                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-xl md:text-2xl font-bold">
                        ${usage.extra_usage.limit.toFixed(2)}
                      </span>
                      <span className="text-muted-foreground text-xs md:text-sm">Monthly spending limit</span>
                    </div>
                    <Button variant="outline" size="sm" className="w-full sm:w-auto">Adjust limit</Button>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-sm">
                    <div>
                      <span className="text-lg md:text-xl font-bold">
                        ${usage.extra_usage.balance.toFixed(2)}
                      </span>
                      <span className="text-muted-foreground ml-2 text-xs md:text-sm">
                        Current balance · auto-reload {usage.extra_usage.auto_reload ? 'on' : 'off'}
                      </span>
                    </div>
                    <Button variant="outline" size="sm" className="w-full sm:w-auto">Buy more</Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Quick Start */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg md:text-xl">Quick Start</CardTitle>
            <CardDescription className="text-sm">Get started with the WebPeel API</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Your API Key</h3>
              {primaryKey ? (
                <ApiKeyDisplay apiKey={primaryKey.prefix + '_' + primaryKey.id} />
              ) : (
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 bg-zinc-50 border rounded-lg">
                  <span className="text-sm text-muted-foreground">No API keys found</span>
                  <Button variant="outline" size="sm" className="w-full sm:w-auto" asChild>
                    <a href="/keys">Create Key</a>
                  </Button>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Example Request</h3>
              <CodeBlock
                code={`curl "https://webpeel-api.onrender.com/v1/fetch?url=https://example.com" \\
  -H "Authorization: Bearer YOUR_KEY"`}
              />
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Or install the CLI</h3>
              <CodeBlock code="npm install -g webpeel && webpeel login" />
            </div>

            <div className="flex flex-col sm:flex-row gap-3 md:gap-4">
              <Button asChild className="bg-violet-600 hover:bg-violet-700 w-full sm:flex-1">
                <a href="https://webpeel.dev/docs" target="_blank" rel="noopener noreferrer">
                  View Documentation
                </a>
              </Button>
              <Button variant="outline" asChild className="w-full sm:flex-1">
                <a href="/keys">Manage API Keys</a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
