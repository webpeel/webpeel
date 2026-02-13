'use client';

import { useSession } from 'next-auth/react';
import useSWR from 'swr';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UsageBar } from '@/components/usage-bar';
import { Badge } from '@/components/ui/badge';
import { apiClient, Usage } from '@/lib/api';

const fetcher = async <T,>(url: string, token: string): Promise<T> => {
  return apiClient<T>(url, { token });
};

export default function UsagePage() {
  const { data: session } = useSession();
  const token = (session as any)?.apiToken;

  const { data: usage, isLoading } = useSWR<Usage>(
    token ? ['/v1/usage', token] : null,
    ([url, token]: [string, string]) => fetcher<Usage>(url, token),
    { refreshInterval: 30000 }
  );

  // TODO: Replace with real API data from /v1/usage/history endpoint
  const dailyHistory: Array<{ date: string; fetches: number; captcha: number; search: number }> = [];

  return (
    <div className="mx-auto max-w-6xl space-y-6 md:space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Usage</h1>
        <p className="text-sm md:text-base text-muted-foreground">Detailed breakdown of your API usage</p>
      </div>

      <Tabs defaultValue="overview" className="space-y-4 md:space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="overview" className="text-xs sm:text-sm">Overview</TabsTrigger>
          <TabsTrigger value="history" className="text-xs sm:text-sm">History</TabsTrigger>
          <TabsTrigger value="breakdown" className="text-xs sm:text-sm">Breakdown</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 md:space-y-6">
          {/* Current Session */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg md:text-xl">Current Session</CardTitle>
              <CardDescription className="text-sm">Your usage in the current session</CardDescription>
            </CardHeader>
            <CardContent>
              {usage?.session ? (
                <UsageBar
                  label="Session usage"
                  used={usage.session.burstUsed}
                  limit={usage.session.burstLimit}
                  resetInfo={`Resets in ${usage.session.resetsIn}`}
                />
              ) : (
                <div className="h-24 animate-pulse rounded-lg bg-zinc-100" />
              )}
            </CardContent>
          </Card>

          {/* Weekly Limits */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg md:text-xl">Weekly Limits</CardTitle>
              <CardDescription className="text-sm">
                {usage?.weekly ? `Resets ${new Date(usage.weekly.resetsAt).toLocaleDateString()}` : 'Loading...'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {usage?.weekly ? (
                <>
                  <UsageBar
                    label="All fetches"
                    used={usage.weekly.totalUsed}
                    limit={usage.weekly.totalAvailable}
                  />
                  <UsageBar
                    label="Stealth fetches"
                    used={usage.weekly.stealthUsed}
                    limit={usage.weekly.totalAvailable}
                  />
                </>
              ) : (
                <>
                  <div className="h-24 animate-pulse rounded-lg bg-zinc-100" />
                  <div className="h-24 animate-pulse rounded-lg bg-zinc-100" />
                </>
              )}
            </CardContent>
          </Card>

          {/* Extra Usage */}
          {usage?.extraUsage && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg md:text-xl">Extra Usage</CardTitle>
                <CardDescription className="text-sm">
                  Spending: ${usage.extraUsage.spent.toFixed(2)} / ${usage.extraUsage.spendingLimit.toFixed(2)}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <UsageBar
                  label="Monthly spending"
                  used={usage.extraUsage.spent}
                  limit={usage.extraUsage.spendingLimit}
                />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="history" className="space-y-4 md:space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg md:text-xl">Daily History</CardTitle>
              <CardDescription className="text-sm">Your API usage over the past 7 days</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 md:space-y-4">
                {dailyHistory.length > 0 ? (
                  dailyHistory.map((day) => (
                    <div key={day.date} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 md:p-4 border rounded-lg">
                      <div className="space-y-1">
                        <p className="font-medium text-sm">
                          {new Date(day.date).toLocaleDateString('en-US', { 
                            weekday: 'long', 
                            month: 'short', 
                            day: 'numeric' 
                          })}
                        </p>
                        <div className="flex flex-wrap gap-2 md:gap-4 text-xs sm:text-sm text-muted-foreground">
                          <span>{day.fetches} fetches</span>
                          <span>{day.captcha} CAPTCHA</span>
                          <span>{day.search} searches</span>
                        </div>
                      </div>
                      <Badge variant="secondary" className="text-xs w-fit">
                        {day.fetches + day.captcha + day.search} total
                      </Badge>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <p>No history data available yet.</p>
                    <p className="text-sm mt-2">Daily usage history will appear here once implemented.</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="breakdown" className="space-y-4 md:space-y-6">
          <div className="grid gap-4 md:gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg md:text-xl">By Request Type</CardTitle>
                <CardDescription className="text-sm">Distribution of your requests</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 md:space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Basic Fetch</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">65%</Badge>
                    <span className="text-xs sm:text-sm text-muted-foreground">520 requests</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Stealth Mode</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">25%</Badge>
                    <span className="text-xs sm:text-sm text-muted-foreground">200 requests</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">CAPTCHA Solving</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">5%</Badge>
                    <span className="text-xs sm:text-sm text-muted-foreground">40 requests</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Search API</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">5%</Badge>
                    <span className="text-xs sm:text-sm text-muted-foreground">40 requests</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg md:text-xl">Response Times</CardTitle>
                <CardDescription className="text-sm">Average response times by type</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 md:space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Basic Fetch</span>
                  <span className="text-sm font-medium">1.2s</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Stealth Mode</span>
                  <span className="text-sm font-medium">3.5s</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">CAPTCHA Solving</span>
                  <span className="text-sm font-medium">12.8s</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Search API</span>
                  <span className="text-sm font-medium">2.1s</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
