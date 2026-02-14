'use client';

import { useSession } from 'next-auth/react';
import useSWR from 'swr';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UsageBar } from '@/components/usage-bar';
import { Badge } from '@/components/ui/badge';
import { BarChart3, TrendingUp, Clock } from 'lucide-react';
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
  const dailyHistory: Array<{ date: string; fetches: number; stealth: number; search: number }> = [];

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
          {/* Weekly Usage Trend Chart */}
          <Card className="border-zinc-200">
            <CardHeader>
              <CardTitle className="text-xl flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-violet-600" />
                Usage Trend
              </CardTitle>
              <CardDescription>Your API usage over the past 7 days</CardDescription>
            </CardHeader>
            <CardContent>
              {/* Simple SVG trend chart placeholder */}
              <div className="h-48 flex items-end justify-between gap-2 px-4">
                {[40, 55, 45, 70, 60, 80, 75].map((height, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-2">
                    <div 
                      className="w-full bg-gradient-to-t from-violet-500 to-violet-400 rounded-t-lg transition-all hover:from-violet-600 hover:to-violet-500"
                      style={{ height: `${height}%` }}
                    />
                    <span className="text-[10px] text-zinc-400">
                      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i]}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-zinc-500 text-center mt-4">
                Live usage data will appear when you start making API requests
              </p>
            </CardContent>
          </Card>

          {/* Current Session */}
          <Card className="border-zinc-200">
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

          {/* Extra Usage - coming soon */}
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
                          <span>{day.stealth} stealth</span>
                          <span>{day.search} searches</span>
                        </div>
                      </div>
                      <Badge variant="secondary" className="text-xs w-fit">
                        {day.fetches + day.stealth + day.search} total
                      </Badge>
                    </div>
                  ))
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 px-4">
                    <div className="w-16 h-16 rounded-full bg-violet-100 flex items-center justify-center mb-4">
                      <BarChart3 className="h-8 w-8 text-violet-600" />
                    </div>
                    <h3 className="text-lg font-semibold text-zinc-900 mb-2">No data yet</h3>
                    <p className="text-sm text-zinc-500 text-center max-w-md">
                      Daily usage history will appear here once you start making API requests.
                      Check out the{' '}
                      <a href="https://github.com/JakeLiuMe/webpeel#readme" className="text-violet-600 hover:underline">
                        documentation
                      </a>{' '}
                      to get started.
                    </p>
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
              <CardContent>
                {usage?.weekly && usage.weekly.totalUsed > 0 ? (
                  <div className="space-y-3 md:space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Basic Fetch</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs sm:text-sm text-muted-foreground">{usage.weekly.basicUsed} requests</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Stealth Mode</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs sm:text-sm text-muted-foreground">{usage.weekly.stealthUsed} requests</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Search API</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs sm:text-sm text-muted-foreground">{usage.weekly.searchUsed} requests</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 px-4">
                    <div className="w-12 h-12 rounded-full bg-violet-100 flex items-center justify-center mb-3">
                      <BarChart3 className="h-6 w-6 text-violet-600" />
                    </div>
                    <p className="text-sm text-zinc-500 text-center">No usage data yet this week</p>
                    <p className="text-xs text-zinc-400 mt-1">Make API requests to see your breakdown</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg md:text-xl">Response Times</CardTitle>
                <CardDescription className="text-sm">Average response times by type</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col items-center justify-center py-8 px-4">
                  <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mb-3">
                    <Clock className="h-6 w-6 text-amber-600" />
                  </div>
                  <p className="text-sm text-zinc-500 text-center">Response time analytics coming soon</p>
                  <p className="text-xs text-zinc-400 mt-1">We're building detailed performance tracking</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
