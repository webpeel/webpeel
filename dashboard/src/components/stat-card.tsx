'use client';

import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  trend?: {
    value: string;
    isPositive: boolean;
  };
  iconColor?: string;
  iconBg?: string;
  delay?: number;
}

export function StatCard({
  icon: Icon,
  label,
  value,
  trend,
  iconColor = 'text-violet-600',
  iconBg = 'bg-violet-100',
  delay = 0,
}: StatCardProps) {
  return (
    <div
      className={cn(
        "bg-white border border-zinc-200 rounded-xl p-6 shadow-sm hover:shadow-md transition-all duration-300 opacity-0 animate-float-up",
        delay === 100 && "animate-delay-100",
        delay === 200 && "animate-delay-200",
        delay === 300 && "animate-delay-300",
        delay === 400 && "animate-delay-400"
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm text-zinc-500 mb-2">{label}</p>
          <div className="flex items-baseline gap-2">
            <p className="text-2xl md:text-3xl font-bold text-zinc-900">{value}</p>
            {trend && (
              <span className={cn(
                "text-xs font-medium",
                trend.isPositive ? "text-emerald-600" : "text-red-600"
              )}>
                {trend.isPositive ? '↑' : '↓'}{trend.value}
              </span>
            )}
          </div>
        </div>
        <div className={cn(
          "w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0",
          iconBg
        )}>
          <Icon className={cn("h-6 w-6", iconColor)} />
        </div>
      </div>
    </div>
  );
}
