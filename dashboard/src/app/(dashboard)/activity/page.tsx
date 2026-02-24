'use client';

import { useState, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import useSWR from 'swr';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { apiClient } from '@/lib/api';
import {
  Activity,
  Search,
  RefreshCw,
  AlertCircle,
  Clock,
  ExternalLink,
  Filter,
  Globe,
} from 'lucide-react';

const fetcher = async <T,>(url: string, token: string): Promise<T> => {
  return apiClient<T>(url, { token });
};

interface ApiRequest {
  id: string;
  url: string;
  status: 'success' | 'error';
  responseTime: number;
  mode: 'basic' | 'stealth';
  timestamp: string;
  statusCode?: number;
}

interface ActivityData {
  requests: ApiRequest[];
}

type StatusFilter = 'all' | 'success' | 'error';
type ModeFilter = 'all' | 'basic' | 'stealth';

function timeAgo(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diff = now - then;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return `${seconds}s ago`;
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export default function ActivityPage() {
  const { data: session } = useSession();
  const token = (session as any)?.apiToken as string | undefined;

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [modeFilter, setModeFilter] = useState<ModeFilter>('all');

  const { data, isLoading, error, mutate } = useSWR<ActivityData>(
    token ? ['/v1/activity?limit=100', token] : null,
    ([url, token]: [string, string]) => fetcher<ActivityData>(url, token),
    { refreshInterval: 15000 }
  );

  const requests = data?.requests || [];

  const filteredRequests = useMemo(() => {
    return requests.filter((req) => {
      if (statusFilter !== 'all' && req.status !== statusFilter) return false;
      if (modeFilter !== 'all' && req.mode !== modeFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!req.url.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [requests, statusFilter, modeFilter, searchQuery]);

  // Stats
  const totalCount = requests.length;
  const successCount = requests.filter((r) => r.status === 'success').length;
  const errorCount = requests.filter((r) => r.status === 'error').length;
  const avgResponseTime = requests.length > 0
    ? Math.round(requests.reduce((sum, r) => sum + r.responseTime, 0) / requests.length)
    : 0;

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <AlertCircle className="h-8 w-8 text-red-500 mb-3" />
        <p className="text-sm text-zinc-500 mb-3">Failed to load activity. Please try again.</p>
        <Button variant="outline" size="sm" onClick={() => mutate()}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 md:space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-zinc-900 flex items-center gap-2">
            <Activity className="h-7 w-7 text-violet-600" />
            Activity
          </h1>
          <p className="text-sm md:text-base text-zinc-500 mt-1">
            Your full API request history
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => mutate()}
          disabled={isLoading}
          className="gap-2 w-full sm:w-auto"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Requests', value: totalCount.toLocaleString(), color: 'text-zinc-900' },
          { label: 'Successful', value: successCount.toLocaleString(), color: 'text-emerald-600' },
          { label: 'Errors', value: errorCount.toLocaleString(), color: errorCount > 0 ? 'text-red-600' : 'text-zinc-400' },
          { label: 'Avg Response', value: `${avgResponseTime}ms`, color: 'text-amber-600' },
        ].map((stat) => (
          <Card key={stat.label} className="border-zinc-200">
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-zinc-500 font-medium">{stat.label}</p>
              <p className={`text-2xl font-bold mt-1 ${stat.color}`}>{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card className="border-zinc-200">
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
              <Input
                placeholder="Search by URL..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 text-sm"
              />
            </div>

            {/* Status Filter */}
            <div className="flex items-center gap-1 p-1 bg-zinc-100 rounded-lg shrink-0">
              <Filter className="h-3.5 w-3.5 text-zinc-400 ml-1" />
              {(['all', 'success', 'error'] as StatusFilter[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all capitalize ${
                    statusFilter === s
                      ? 'bg-white text-zinc-900 shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-700'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>

            {/* Mode Filter */}
            <div className="flex items-center gap-1 p-1 bg-zinc-100 rounded-lg shrink-0">
              {(['all', 'basic', 'stealth'] as ModeFilter[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setModeFilter(m)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all capitalize ${
                    modeFilter === m
                      ? 'bg-white text-zinc-900 shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-700'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Activity Table */}
      <Card className="border-zinc-200">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Request Log</CardTitle>
              <CardDescription>
                {isLoading
                  ? 'Loading...'
                  : `${filteredRequests.length} ${filteredRequests.length === 1 ? 'request' : 'requests'}`
                  + (filteredRequests.length !== totalCount ? ` (filtered from ${totalCount})` : '')}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-lg bg-zinc-100" />
              ))}
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4">
              {requests.length === 0 ? (
                <>
                  <div className="w-16 h-16 rounded-full bg-violet-100 flex items-center justify-center mb-4">
                    <Activity className="h-8 w-8 text-violet-600" />
                  </div>
                  <h3 className="text-lg font-semibold text-zinc-900 mb-2">No requests yet</h3>
                  <p className="text-sm text-zinc-500 text-center max-w-sm mb-4">
                    Your API requests will appear here. Try the{' '}
                    <a href="/playground" className="text-violet-600 hover:underline font-medium">
                      Playground
                    </a>{' '}
                    to make your first request.
                  </p>
                </>
              ) : (
                <>
                  <Search className="h-12 w-12 text-zinc-300 mb-3" />
                  <h3 className="text-base font-semibold text-zinc-900 mb-1">No matching requests</h3>
                  <p className="text-sm text-zinc-500">Try adjusting your filters or search query</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => { setSearchQuery(''); setStatusFilter('all'); setModeFilter('all'); }}
                  >
                    Clear filters
                  </Button>
                </>
              )}
            </div>
          ) : (
            <>
              {/* Mobile: Card view */}
              <div className="space-y-2 md:hidden">
                {filteredRequests.map((req) => (
                  <div
                    key={req.id}
                    className={`border rounded-lg p-3 space-y-2 ${
                      req.status === 'success' ? 'border-l-4 border-l-emerald-400' : 'border-l-4 border-l-red-400'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <Globe className="h-3 w-3 text-zinc-400 flex-shrink-0" />
                          <span className="text-xs text-zinc-500 truncate">{extractDomain(req.url)}</span>
                        </div>
                        <a
                          href={req.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-zinc-900 hover:text-violet-600 transition-colors truncate block font-medium"
                        >
                          {req.url}
                        </a>
                      </div>
                      <Badge
                        className={req.status === 'success'
                          ? 'bg-emerald-100 text-emerald-700 border-0 flex-shrink-0'
                          : 'bg-red-100 text-red-700 border-0 flex-shrink-0'
                        }
                      >
                        {req.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-zinc-400">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {req.responseTime}ms
                      </span>
                      <Badge variant="secondary" className="bg-zinc-100 text-zinc-600 text-xs px-1.5 py-0">
                        {req.mode}
                      </Badge>
                      <span className="ml-auto">{timeAgo(req.timestamp)}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop: Table view */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-zinc-200">
                      <th className="text-left py-3 px-4 text-xs font-semibold text-zinc-500 uppercase tracking-wide">URL</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Status</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Time</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Mode</th>
                      <th className="text-right py-3 px-4 text-xs font-semibold text-zinc-500 uppercase tracking-wide">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRequests.map((req) => (
                      <tr
                        key={req.id}
                        className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 transition-colors group"
                      >
                        <td className="py-3 px-4 max-w-xs">
                          <div className="flex items-center gap-2">
                            <a
                              href={req.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-zinc-900 hover:text-violet-600 transition-colors truncate block"
                              title={req.url}
                            >
                              {req.url}
                            </a>
                            <ExternalLink className="h-3 w-3 text-zinc-300 group-hover:text-violet-400 flex-shrink-0 transition-colors" />
                          </div>
                          <span className="text-xs text-zinc-400">{extractDomain(req.url)}</span>
                        </td>
                        <td className="py-3 px-4">
                          <Badge
                            className={req.status === 'success'
                              ? 'bg-emerald-100 text-emerald-700 border-0'
                              : 'bg-red-100 text-red-700 border-0'
                            }
                          >
                            {req.statusCode ? `${req.statusCode} ` : ''}{req.status}
                          </Badge>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`text-sm font-medium ${
                            req.responseTime < 1000 ? 'text-emerald-600' :
                            req.responseTime < 3000 ? 'text-amber-600' : 'text-red-600'
                          }`}>
                            {req.responseTime}ms
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <Badge variant="secondary" className={`${
                            req.mode === 'stealth'
                              ? 'bg-violet-100 text-violet-700'
                              : 'bg-zinc-100 text-zinc-600'
                          }`}>
                            {req.mode}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <span className="text-xs text-zinc-400">{timeAgo(req.timestamp)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
