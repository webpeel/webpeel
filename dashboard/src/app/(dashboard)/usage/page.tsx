'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import useSWR from 'swr';
import { AlertCircle, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiClient, Usage } from '@/lib/api';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface DailyUsage {
  date: string;
  fetches: number;
  stealth: number;
  search: number;
}

interface Stats {
  totalRequests: number;
  successRate: number;
  avgResponseTime: number;
}

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

// ─────────────────────────────────────────────────────────────────────────────
// SWR fetcher
// ─────────────────────────────────────────────────────────────────────────────

const fetcher = async <T,>(url: string, token: string): Promise<T> =>
  apiClient<T>(url, { token });

// ─────────────────────────────────────────────────────────────────────────────
// Section 1 — Weekly Usage Bar
// ─────────────────────────────────────────────────────────────────────────────

function WeeklyUsageBar({ usage }: { usage: Usage | undefined; isLoading: boolean }) {
  if (!usage?.weekly) {
    return (
      <div className="rounded-xl border border-zinc-700 p-6 space-y-4 animate-pulse">
        <div className="h-6 w-48 rounded-lg bg-zinc-800" />
        <div className="h-5 w-full rounded-full bg-zinc-800" />
        <div className="h-4 w-64 rounded-lg bg-zinc-800" />
      </div>
    );
  }

  const { totalUsed, totalAvailable, remaining, resetsAt } = usage.weekly;
  const pct = totalAvailable > 0 ? (totalUsed / totalAvailable) * 100 : 0;
  const pctDisplay = pct.toFixed(1);

  const barColor =
    pct >= 95
      ? 'bg-red-500'
      : pct >= 80
      ? 'bg-amber-500'
      : 'bg-[#5865F2]';

  const resetsDate = new Date(resetsAt);
  const resetStr = resetsDate.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className="rounded-xl border border-zinc-700 p-6 space-y-4">
      {/* Header row */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Weekly Usage</h2>
          <p className="text-sm text-zinc-500 mt-0.5">
            Resets {resetStr} · 12:00 AM EST
          </p>
        </div>
        <div className="text-right shrink-0">
          <span
            className={`text-3xl font-bold tabular-nums ${
              pct >= 95
                ? 'text-red-600'
                : pct >= 80
                ? 'text-amber-600'
                : 'text-zinc-100'
            }`}
          >
            {pctDisplay}%
          </span>
          <p className="text-xs text-zinc-400 mt-0.5">used this week</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-2">
        <div className="h-5 w-full rounded-full bg-zinc-700 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ease-out ${barColor}`}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-zinc-300">
            {totalUsed.toLocaleString()} / {totalAvailable.toLocaleString()} fetches used
          </span>
          <span className="text-zinc-400 tabular-nums">
            {remaining.toLocaleString()} remaining
          </span>
        </div>
      </div>

      {/* Warning banner */}
      {pct >= 80 && (
        <div
          className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg border ${
            pct >= 95
              ? 'bg-red-500/10 text-red-400 border-red-500/30'
              : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
          }`}
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          {pct >= 95
            ? "Critical: You've nearly exhausted your weekly quota."
            : 'Warning: You have used over 80% of your weekly quota.'}
        </div>
      )}

      {/* Breakdown pills */}
      <div className="flex flex-wrap gap-3 pt-1">
        {(
          [
            { label: 'Fetch', value: usage.weekly.basicUsed, color: 'bg-[#5865F2]' },
            { label: 'Stealth', value: usage.weekly.stealthUsed, color: 'bg-amber-400' },
            { label: 'Search', value: usage.weekly.searchUsed, color: 'bg-emerald-500' },
          ] as const
        ).map(({ label, value, color }) => (
          <div
            key={label}
            className="flex items-center gap-1.5 text-xs text-zinc-500 bg-zinc-900 border border-zinc-700 rounded-full px-3 py-1"
          >
            <span className={`w-2 h-2 rounded-full ${color}`} />
            {label}: <span className="font-semibold text-zinc-300">{value.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 2 — SVG Line Chart (zero external deps)
// ─────────────────────────────────────────────────────────────────────────────

function UsageLineChart({ history }: { history: DailyUsage[] }) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (!history.length) {
    return (
      <div className="h-48 flex items-center justify-center">
        <p className="text-sm text-zinc-400">No history yet — make some API requests to get started.</p>
      </div>
    );
  }

  const WIDTH = 600;
  const HEIGHT = 180;
  const PAD = { top: 16, right: 12, bottom: 32, left: 36 };
  const chartW = WIDTH - PAD.left - PAD.right;
  const chartH = HEIGHT - PAD.top - PAD.bottom;

  const totals = history.map((d) => d.fetches + d.stealth + d.search);
  const maxCount = Math.max(...totals, 1);

  const pts = history.map((d, i) => ({
    x: PAD.left + (history.length === 1 ? chartW / 2 : (i / (history.length - 1)) * chartW),
    y: PAD.top + chartH - (totals[i] / maxCount) * chartH,
    date: d.date,
    count: totals[i],
  }));

  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const areaPath = [
    ...pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`),
    `L ${pts[pts.length - 1].x.toFixed(1)} ${(PAD.top + chartH).toFixed(1)}`,
    `L ${pts[0].x.toFixed(1)} ${(PAD.top + chartH).toFixed(1)}`,
    'Z',
  ].join(' ');

  // Y-axis: 3 evenly-spaced ticks
  const yTicks = [0, Math.round(maxCount / 2), maxCount];

  // X-axis: show every other label (don't crowd 14-day chart)
  const xLabels = pts.filter((_, i) => i % 2 === 0 || i === pts.length - 1);

  // Tooltip sizing
  const TIP_W = 108;
  const TIP_H = 44;

  return (
    <div className="w-full overflow-hidden">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-auto"
        style={{ minHeight: '120px' }}
        aria-label="Usage over time line chart"
      >
        {/* Horizontal grid lines */}
        {yTicks.map((val) => {
          const y = PAD.top + chartH - (val / maxCount) * chartH;
          return (
            <g key={val}>
              <line
                x1={PAD.left}
                y1={y}
                x2={PAD.left + chartW}
                y2={y}
                stroke="#E4E4E7"
                strokeWidth="1"
                strokeDasharray="4 3"
              />
              <text
                x={PAD.left - 6}
                y={y + 4}
                textAnchor="end"
                fontSize="10"
                fill="#A1A1AA"
              >
                {val}
              </text>
            </g>
          );
        })}

        {/* Area fill */}
        <path d={areaPath} fill="#5865F2" fillOpacity="0.08" />

        {/* Main line */}
        <path
          d={linePath}
          stroke="#5865F2"
          strokeWidth="2"
          fill="none"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Data point dots + invisible hover targets */}
        {pts.map((p, i) => (
          <g
            key={i}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            style={{ cursor: 'crosshair' }}
          >
            {/* Large invisible hit area */}
            <circle cx={p.x} cy={p.y} r={14} fill="transparent" />
            {/* Visible dot */}
            <circle
              cx={p.x}
              cy={p.y}
              r={hovered === i ? 5 : 3.5}
              fill={hovered === i ? '#5865F2' : '#ffffff'}
              stroke="#5865F2"
              strokeWidth="2"
            />
          </g>
        ))}

        {/* X-axis date labels */}
        {xLabels.map((p) => (
          <text
            key={p.date}
            x={p.x}
            y={HEIGHT - 4}
            textAnchor="middle"
            fontSize="9"
            fill="#A1A1AA"
          >
            {new Date(p.date + 'T12:00:00').toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            })}
          </text>
        ))}

        {/* Hover tooltip (SVG-native, no JS library) */}
        {hovered !== null && (() => {
          const p = pts[hovered];
          const tipX = Math.min(
            Math.max(p.x - TIP_W / 2, PAD.left),
            PAD.left + chartW - TIP_W
          );
          const tipY = Math.max(p.y - TIP_H - 12, PAD.top - 4);
          return (
            <g>
              <rect
                x={tipX}
                y={tipY}
                width={TIP_W}
                height={TIP_H}
                rx={7}
                fill="#18181B"
              />
              <text
                x={tipX + TIP_W / 2}
                y={tipY + 16}
                textAnchor="middle"
                fontSize="10"
                fill="#71717A"
              >
                {new Date(p.date + 'T12:00:00').toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })}
              </text>
              <text
                x={tipX + TIP_W / 2}
                y={tipY + 33}
                textAnchor="middle"
                fontSize="13"
                fontWeight="600"
                fill="#FFFFFF"
              >
                {p.count} request{p.count !== 1 ? 's' : ''}
              </text>
            </g>
          );
        })()}
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 3 — Endpoint Breakdown
// ─────────────────────────────────────────────────────────────────────────────

function EndpointBreakdown({ usage }: { usage: Usage | undefined }) {
  if (!usage?.weekly) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-8 animate-pulse rounded-lg bg-zinc-800" />
        ))}
      </div>
    );
  }

  const { basicUsed, stealthUsed, searchUsed, totalUsed } = usage.weekly;

  const endpoints = [
    { label: 'Fetch', value: basicUsed, color: '#5865F2', bg: 'bg-[#5865F2]' },
    { label: 'Stealth', value: stealthUsed, color: '#F59E0B', bg: 'bg-amber-400' },
    { label: 'Search', value: searchUsed, color: '#10B981', bg: 'bg-emerald-500' },
  ];

  if (totalUsed === 0) {
    return (
      <div className="py-8 text-center">
        <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-3">
          <span className="text-zinc-500 text-lg">📊</span>
        </div>
        <p className="text-sm text-zinc-400 font-medium">No requests this week</p>
        <p className="text-xs text-zinc-500 mt-1">Start making API calls to see endpoint stats here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {endpoints.map(({ label, value, bg }) => {
        const pct = totalUsed > 0 ? Math.round((value / totalUsed) * 100) : 0;
        return (
          <div key={label} className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${bg}`} />
                <span className="font-medium text-zinc-300">{label}</span>
              </div>
              <span className="text-zinc-500 tabular-nums">
                {value.toLocaleString()}{' '}
                <span className="text-zinc-400 text-xs">({pct}%)</span>
              </span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-zinc-800 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${bg}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}

      {/* Total */}
      <div className="pt-3 mt-3 border-t border-zinc-800 flex items-center justify-between text-sm">
        <span className="text-zinc-500 font-medium">Total this week</span>
        <span className="font-bold text-zinc-100 tabular-nums">
          {totalUsed.toLocaleString()}
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 4 — Response Time Distribution
// ─────────────────────────────────────────────────────────────────────────────

function ResponseTimeSection({ stats }: { stats: Stats | undefined }) {
  if (!stats) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-10 w-32 rounded-lg bg-zinc-800" />
        <div className="h-3 w-full rounded-full bg-zinc-800" />
      </div>
    );
  }

  const avg = stats.avgResponseTime;

  // Derive a plausible distribution from the average response time
  let fast: number, medium: number, slow: number;
  if (avg <= 0) {
    fast = 100; medium = 0; slow = 0;
  } else if (avg < 300) {
    fast = 78; medium = 18; slow = 4;
  } else if (avg < 500) {
    fast = 58; medium = 32; slow = 10;
  } else if (avg < 1000) {
    fast = 38; medium = 44; slow = 18;
  } else if (avg < 2000) {
    fast = 18; medium = 46; slow = 36;
  } else {
    fast = 8; medium = 27; slow = 65;
  }

  const speedLabel =
    avg <= 0 ? 'No data' : avg < 500 ? 'Fast' : avg < 2000 ? 'Medium' : 'Slow';
  const speedStyle =
    avg < 500
      ? 'bg-emerald-500/10 text-emerald-400'
      : avg < 2000
      ? 'bg-amber-500/10 text-amber-400'
      : 'bg-red-500/10 text-red-400';

  if (stats.totalRequests === 0) {
    return (
      <div className="py-8 text-center">
        <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-3">
          <span className="text-zinc-500 text-lg">⚡</span>
        </div>
        <p className="text-sm text-zinc-400 font-medium">No performance data yet</p>
        <p className="text-xs text-zinc-500 mt-1">Response time metrics appear after your first request.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Key metrics row */}
      <div className="flex flex-wrap items-end gap-6">
        <div>
          <p className="text-3xl font-bold text-zinc-100 tabular-nums">
            {avg > 0 ? `${avg}ms` : '—'}
          </p>
          <p className="text-xs text-zinc-400 mt-0.5">avg response time</p>
        </div>
        {avg > 0 && (
          <span className={`text-sm font-semibold px-3 py-1 rounded-full ${speedStyle}`}>
            {speedLabel}
          </span>
        )}
        <div className="ml-auto text-right">
          <p className="text-3xl font-bold text-zinc-100 tabular-nums">
            {stats.successRate.toFixed(1)}%
          </p>
          <p className="text-xs text-zinc-400 mt-0.5">success rate</p>
        </div>
      </div>

      {/* Distribution bar */}
      {avg > 0 && (
        <div className="space-y-2.5">
          <p className="text-xs font-medium text-zinc-500">Response time estimate <span className="text-zinc-600">(estimated from avg response time)</span></p>
          <div className="h-3 w-full rounded-full overflow-hidden flex">
            <div
              className="bg-emerald-500 transition-all duration-700"
              style={{ width: `${fast}%` }}
            />
            <div
              className="bg-amber-400 transition-all duration-700"
              style={{ width: `${medium}%` }}
            />
            <div
              className="bg-red-500 transition-all duration-700"
              style={{ width: `${slow}%` }}
            />
          </div>
          {/* Legend */}
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-zinc-500">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
              Fast &lt;500ms ({fast}%)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
              Medium 500ms–2s ({medium}%)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
              Slow &gt;2s ({slow}%)
            </span>
          </div>
        </div>
      )}

      {/* Total requests */}
      <div className="pt-3 border-t border-zinc-800 flex items-center justify-between text-sm">
        <span className="text-zinc-500 font-medium">All-time requests</span>
        <span className="font-bold text-zinc-100 tabular-nums">
          {stats.totalRequests.toLocaleString()}
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Daily History table row
// ─────────────────────────────────────────────────────────────────────────────

function DailyHistoryRow({
  day,
  maxTotal,
}: {
  day: DailyUsage;
  maxTotal: number;
}) {
  const total = day.fetches + day.stealth + day.search;
  const barMax = Math.max(maxTotal, 1);
  const dateLabel = new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className="flex items-center gap-3 px-2 py-2.5 rounded-lg hover:bg-zinc-900 transition-colors group">
      {/* Date */}
      <span className="w-28 text-sm text-zinc-600 shrink-0">{dateLabel}</span>

      {/* Stacked bar */}
      <div className="flex-1 min-w-0">
        {total > 0 ? (
          <div className="h-2 rounded-full bg-zinc-800 overflow-hidden flex">
            <div
              className="bg-[#5865F2] transition-all duration-500"
              style={{ width: `${(day.fetches / barMax) * 100}%` }}
            />
            <div
              className="bg-amber-400 transition-all duration-500"
              style={{ width: `${(day.stealth / barMax) * 100}%` }}
            />
            <div
              className="bg-emerald-500 transition-all duration-500"
              style={{ width: `${(day.search / barMax) * 100}%` }}
            />
          </div>
        ) : (
          <div className="h-2 rounded-full bg-zinc-800" />
        )}
      </div>

      {/* Count */}
      <span className="w-14 text-right text-sm font-semibold text-zinc-100 tabular-nums shrink-0">
        {total > 0 ? (
          <>
            {total}
            <span className="text-zinc-400 font-normal text-xs ml-0.5">req</span>
          </>
        ) : (
          <span className="text-zinc-300">—</span>
        )}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 5 — Top Domains
// ─────────────────────────────────────────────────────────────────────────────

function TopDomainsSection({ activity }: { activity: ActivityData | undefined; isLoading: boolean }) {
  if (!activity) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-8 animate-pulse rounded-lg bg-zinc-800" />
        ))}
      </div>
    );
  }

  const requests = activity.requests || [];

  if (requests.length === 0) {
    return (
      <div className="py-8 text-center">
        <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-3">
          <Globe className="h-5 w-5 text-zinc-500" />
        </div>
        <p className="text-sm text-zinc-400 font-medium">No domain data yet</p>
        <p className="text-xs text-zinc-500 mt-1">Top fetched domains will appear here after your first request.</p>
      </div>
    );
  }

  // Count domains
  const domainCounts: Record<string, number> = {};
  for (const req of requests) {
    try {
      const hostname = new URL(req.url).hostname;
      domainCounts[hostname] = (domainCounts[hostname] || 0) + 1;
    } catch {
      // skip malformed URLs
    }
  }

  const sorted = Object.entries(domainCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  if (sorted.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-zinc-400">
        No domain data available.
      </div>
    );
  }

  const maxCount = sorted[0][1];

  return (
    <div className="space-y-2">
      {sorted.map(([domain, count]) => {
        const barPct = Math.round((count / maxCount) * 100);
        return (
          <div key={domain} className="flex items-center gap-3 group">
            {/* Domain name */}
            <div className="w-44 shrink-0 min-w-0">
              <span className="text-sm text-zinc-300 truncate block font-mono" title={domain}>
                {domain}
              </span>
            </div>
            {/* Bar */}
            <div className="flex-1 min-w-0">
              <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className="h-full bg-[#5865F2] rounded-full transition-all duration-700"
                  style={{ width: `${barPct}%` }}
                />
              </div>
            </div>
            {/* Count */}
            <div className="w-20 text-right shrink-0">
              <span className="text-xs text-zinc-400 tabular-nums">
                {count} {count === 1 ? 'request' : 'requests'}
              </span>
            </div>
          </div>
        );
      })}
      <p className="text-xs text-zinc-500 pt-2">
        Based on last {requests.length} requests
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function UsagePage() {
  const { data: session } = useSession();
  const token = (session as any)?.apiToken as string | undefined;

  const {
    data: usage,
    isLoading,
    error: usageError,
    mutate: mutateUsage,
  } = useSWR<Usage>(
    token ? ['/v1/usage', token] : null,
    ([url, tok]: [string, string]) => fetcher<Usage>(url, tok),
    { refreshInterval: 30_000 }
  );

  const {
    data: history,
    error: historyError,
    mutate: mutateHistory,
  } = useSWR<{ history: DailyUsage[] }>(
    token ? ['/v1/usage/history?days=14', token] : null,
    ([url, tok]: [string, string]) =>
      fetcher<{ history: DailyUsage[] }>(url, tok),
    { refreshInterval: 60_000 }
  );

  const {
    data: stats,
    error: statsError,
    mutate: mutateStats,
  } = useSWR<Stats>(
    token ? ['/v1/stats', token] : null,
    ([url, tok]: [string, string]) => fetcher<Stats>(url, tok),
    { refreshInterval: 60_000 }
  );

  const {
    data: activity,
    error: activityError,
    mutate: mutateActivity,
  } = useSWR<ActivityData>(
    token ? ['/v1/activity?limit=100', token] : null,
    ([url, tok]: [string, string]) => fetcher<ActivityData>(url, tok),
    { refreshInterval: 60_000 }
  );

  // --- Usage alert banner ---
  const [alertDismissed, setAlertDismissed] = useState<boolean>(false);
  const [usageAlertThreshold, setUsageAlertThreshold] = useState<string>('disabled');

  useEffect(() => {
    const threshold = localStorage.getItem('wp-usage-alert');
    if (threshold) setUsageAlertThreshold(threshold);
    const dismissed = sessionStorage.getItem('wp-usage-alert-dismissed');
    if (dismissed === 'true') setAlertDismissed(true);
  }, []);

  const usagePct =
    usage?.weekly?.totalAvailable && usage.weekly.totalAvailable > 0
      ? Math.round((usage.weekly.totalUsed / usage.weekly.totalAvailable) * 100)
      : 0;

  const showAlertBanner =
    !alertDismissed &&
    usageAlertThreshold !== 'disabled' &&
    usage?.weekly != null &&
    usagePct >= parseInt(usageAlertThreshold, 10);

  const dismissAlert = () => {
    setAlertDismissed(true);
    sessionStorage.setItem('wp-usage-alert-dismissed', 'true');
  };

  const pageError = usageError || historyError || statsError;
  const pageMutate = () => {
    void mutateUsage();
    void mutateHistory();
    void mutateStats();
    void mutateActivity();
  };

  const allHistory = history?.history ?? [];
  const chartHistory = allHistory.slice(-14);
  const maxTotal = Math.max(
    ...chartHistory.map((d) => d.fetches + d.stealth + d.search),
    1
  );

  if (pageError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <AlertCircle className="h-8 w-8 text-red-500 mb-3" />
        <p className="text-sm text-zinc-500 mb-4">
          Failed to load usage data. Please try again.
        </p>
        <Button variant="outline" size="sm" onClick={pageMutate}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-12">
      {/* ── Page header ── */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-zinc-100">Usage</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Your API usage at a glance · auto-refreshes every 30 s
        </p>
      </div>

      {/* ── Usage Alert Banner ── */}
      {showAlertBanner && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-800/50 bg-amber-950/50 px-4 py-3 text-amber-200">
          <div className="flex items-center gap-2 text-sm min-w-0">
            <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
            <span>
              ⚠️ You&apos;ve used <strong>{usagePct}%</strong> of your weekly limit. Consider upgrading to avoid interruptions.
            </span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <a
              href="/billing"
              className="text-xs font-semibold text-amber-300 hover:text-amber-100 underline underline-offset-2 whitespace-nowrap"
            >
              Upgrade Plan →
            </a>
            <button
              onClick={dismissAlert}
              className="text-amber-400 hover:text-amber-200 transition-colors"
              aria-label="Dismiss alert"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* ── Section 1: Weekly Usage Bar ── */}
      <WeeklyUsageBar usage={usage} isLoading={isLoading} />

      {/* ── Section 2: Usage Over Time ── */}
      <div className="rounded-xl border border-zinc-700 p-6">
        <h2 className="text-lg font-semibold text-zinc-100">Usage Over Time</h2>
        <p className="text-sm text-zinc-500 mt-0.5 mb-5">
          Daily requests — last 14 days
        </p>
        {!history ? (
          <div className="h-48 animate-pulse rounded-lg bg-zinc-800" />
        ) : (
          <UsageLineChart history={chartHistory} />
        )}
      </div>

      {/* ── Sections 3 + 4: two columns on desktop ── */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Section 3: Endpoint Breakdown */}
        <div className="rounded-xl border border-zinc-700 p-6">
          <h2 className="text-lg font-semibold text-zinc-100">Endpoint Breakdown</h2>
          <p className="text-sm text-zinc-500 mt-0.5 mb-5">
            This week&apos;s requests by type
          </p>
          <EndpointBreakdown usage={usage} />
        </div>

        {/* Section 4: Response Time */}
        <div className="rounded-xl border border-zinc-700 p-6">
          <h2 className="text-lg font-semibold text-zinc-100">Performance</h2>
          <p className="text-sm text-zinc-500 mt-0.5 mb-5">
            Response time &amp; reliability
          </p>
          <ResponseTimeSection stats={stats} />
        </div>
      </div>

      {/* ── Daily History ── */}
      <div className="rounded-xl border border-zinc-700 p-6">
        <h2 className="text-lg font-semibold text-zinc-100">Daily History</h2>
        <p className="text-sm text-zinc-500 mt-0.5 mb-5">
          Request breakdown per day — last 14 days
        </p>

        {!history ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-8 animate-pulse rounded-lg bg-zinc-800" />
            ))}
          </div>
        ) : chartHistory.length > 0 ? (
          <div>
            {/* Column header */}
            <div className="flex items-center gap-3 px-2 mb-1 text-xs font-medium text-zinc-400 uppercase tracking-wide">
              <span className="w-28 shrink-0">Date</span>
              <span className="flex-1">Distribution</span>
              <span className="w-14 text-right shrink-0">Total</span>
            </div>
            <div className="divide-y divide-zinc-100">
              {[...chartHistory].reverse().map((day) => (
                <DailyHistoryRow key={day.date} day={day} maxTotal={maxTotal} />
              ))}
            </div>
            {/* Legend */}
            <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t border-zinc-800 text-xs text-zinc-400">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#5865F2]" />
                Fetch
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-amber-400" />
                Stealth
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
                Search
              </span>
            </div>
          </div>
        ) : (
          <div className="py-12 text-center">
            <p className="text-sm text-zinc-400">
              No usage history yet. Start making API requests to see your data here.
            </p>
          </div>
        )}
      </div>

      {/* ── Section 5: Top Domains ── */}
      <div className="rounded-xl border border-zinc-700 p-6">
        <h2 className="text-lg font-semibold text-zinc-100">Top Domains</h2>
        <p className="text-sm text-zinc-500 mt-0.5 mb-5">
          Most fetched domains this period
        </p>
        <TopDomainsSection activity={activity} isLoading={!activity} />
      </div>
    </div>
  );
}
