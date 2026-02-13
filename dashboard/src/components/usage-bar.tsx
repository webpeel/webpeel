'use client';

import { Progress } from './ui/progress';
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
  
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <span className="text-foreground">{label}</span>
          {showTooltip && <Info className="h-3 w-3 text-muted-foreground" />}
        </div>
        <span className="text-muted-foreground">{Math.round(percentage)}%</span>
      </div>
      <Progress value={percentage} className="h-2" />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{used.toLocaleString()} / {limit.toLocaleString()}</span>
        {resetInfo && <span>{resetInfo}</span>}
      </div>
    </div>
  );
}
