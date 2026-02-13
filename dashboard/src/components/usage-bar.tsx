'use client';

import { Info } from 'lucide-react';

interface UsageBarProps {
  label: string;
  used: number;
  limit: number;
  resetInfo?: string;
  showTooltip?: boolean;
}

export function UsageBar({ label, used, limit, resetInfo, showTooltip }: UsageBarProps) {
  const percentage = Math.min((used / limit) * 100, 100);
  const isWarning = percentage > 80;
  const isMedium = percentage > 50 && percentage <= 80;
  
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <span className="text-zinc-900 font-medium">{label}</span>
          {showTooltip && <Info className="h-3.5 w-3.5 text-zinc-400" />}
        </div>
        <span className="text-zinc-500 text-xs font-medium">{Math.round(percentage)}%</span>
      </div>
      
      {/* Beautiful gradient progress bar */}
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-zinc-100">
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${
            isWarning
              ? 'bg-gradient-to-r from-amber-400 to-red-500'
              : isMedium
              ? 'bg-gradient-to-r from-violet-400 to-violet-600'
              : 'bg-gradient-to-r from-violet-400 to-violet-600'
          }`}
          style={{ width: `${percentage}%` }}
        />
        
        {/* Floating percentage badge */}
        {percentage > 10 && (
          <div
            className="absolute top-1/2 -translate-y-1/2 transition-all duration-700"
            style={{ left: `${Math.min(percentage - 3, 94)}%` }}
          >
            <div className={`w-1.5 h-1.5 rounded-full ${
              isWarning ? 'bg-red-600' : 'bg-violet-600'
            } shadow-sm`} />
          </div>
        )}
      </div>
      
      <div className="flex items-center justify-between text-xs">
        <span className="text-zinc-500">
          <span className="font-medium text-zinc-700">{used.toLocaleString()}</span> / {limit.toLocaleString()}
        </span>
        {resetInfo && <span className="text-zinc-400">{resetInfo}</span>}
      </div>
    </div>
  );
}
