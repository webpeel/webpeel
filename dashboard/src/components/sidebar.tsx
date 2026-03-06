'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import useSWR, { useSWRConfig } from 'swr';
import { LayoutDashboard, Key, CreditCard, Settings, ExternalLink, BookOpen, X, Zap, Play, Activity, BarChart2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiClient, Usage } from '@/lib/api';

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Playground', href: '/playground', icon: Play },
  { name: 'API Keys', href: '/keys', icon: Key },
  { name: 'Activity', href: '/activity', icon: Activity },
  { name: 'Usage', href: '/usage', icon: BarChart2 },
  { name: 'Billing', href: '/billing', icon: CreditCard },
  { name: 'Settings', href: '/settings', icon: Settings },
];

// ---------------------------------------------------------------------------
// Usage bar displayed at the bottom of the sidebar
// ---------------------------------------------------------------------------
function UsageWidget({ collapsed }: { collapsed?: boolean }) {
  const { data: session } = useSession();
  const { mutate } = useSWRConfig();
  const token = (session as any)?.apiToken as string | undefined;

  const { data: usage } = useSWR<Usage>(
    token ? ['/v1/usage', token] : null,
    ([url, tok]: [string, string]) => apiClient<Usage>(url, { token: tok }),
    { refreshInterval: 60_000 }
  );

  // Refresh usage immediately after a playground fetch/search/screenshot
  useEffect(() => {
    const handler = () => {
      if (token) mutate(['/v1/usage', token]);
    };
    window.addEventListener('webpeel:fetch-completed', handler);
    return () => window.removeEventListener('webpeel:fetch-completed', handler);
  }, [token, mutate]);

  const used = usage?.weekly?.totalUsed ?? 0;
  const total = usage?.weekly?.totalAvailable ?? 0;
  const percent = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const planTier = usage?.plan?.tier ?? 'free';
  const planLabel = planTier === 'admin' ? 'Admin' : planTier === 'pro' ? 'Pro plan' : planTier === 'max' ? 'Max plan' : 'Free plan';

  if (collapsed) {
    // Tablet: compact circle progress indicator
    return (
      <Link
        href="/usage"
        className="flex items-center justify-center rounded-lg p-2.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
        title={`Usage: ${used} / ${total} (${percent}%)`}
      >
        <div className="relative w-5 h-5">
          <svg viewBox="0 0 20 20" className="w-5 h-5 -rotate-90">
            <circle cx="10" cy="10" r="8" fill="none" stroke="#3f3f46" strokeWidth="2.5" />
            <circle
              cx="10"
              cy="10"
              r="8"
              fill="none"
              stroke="#5865F2"
              strokeWidth="2.5"
              strokeDasharray={`${2 * Math.PI * 8}`}
              strokeDashoffset={`${2 * Math.PI * 8 * (1 - percent / 100)}`}
              strokeLinecap="round"
            />
          </svg>
        </div>
      </Link>
    );
  }

  return (
    <Link
      href="/usage"
      className="block rounded-xl border border-zinc-800 bg-zinc-800/50 px-3 py-2.5 hover:bg-zinc-800 transition-colors group mx-1 mb-1"
    >
      {/* Usage counts */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-medium text-zinc-400">
          {total > 0 ? (
            <>
              <span className="text-zinc-200 font-semibold">{used.toLocaleString()}</span>
              {' / '}
              {total.toLocaleString()}
            </>
          ) : (
            <span className="text-zinc-500">Loading…</span>
          )}
        </span>
        <span className="text-[11px] text-zinc-500">{percent}%</span>
      </div>

      {/* Progress bar */}
      <div className="h-1 rounded-full bg-zinc-700 overflow-hidden mb-1.5">
        <div
          className="h-full rounded-full bg-[#5865F2] transition-all duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* Plan label */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-zinc-500 group-hover:text-zinc-400 transition-colors capitalize">
          {planLabel}
        </span>
        <span className="text-[10px] text-zinc-600 group-hover:text-zinc-500 transition-colors">View →</span>
      </div>
    </Link>
  );
}

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
  collapsed?: boolean;
  tier?: string;
}

export function Sidebar({ isOpen = true, onClose, collapsed = false, tier = 'free' }: SidebarProps) {
  const pathname = usePathname();
  const showUpgrade = tier === 'free';

  const NavItem = ({ item, onClick }: { item: typeof navigation[0]; onClick?: () => void }) => {
    const isActive = item.href === '/dashboard'
      ? pathname === '/dashboard'
      : pathname.startsWith(item.href);
    return (
      <Link
        key={item.name}
        href={item.href}
        onClick={onClick}
        className={cn(
          'relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-all group',
          isActive
            ? 'bg-zinc-800 text-zinc-100'
            : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 hover:translate-x-0.5',
          collapsed && 'justify-center'
        )}
        title={collapsed ? item.name : undefined}
      >
        {isActive && (
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-[#5865F2] rounded-r" />
        )}
        <item.icon className="h-4 w-4 flex-shrink-0" />
        {!collapsed && item.name}
      </Link>
    );
  };

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="flex h-14 items-center border-b border-zinc-800 px-5">
        <Link href="/dashboard" className="flex items-center gap-2.5" onClick={onClose}>
          <svg width="24" height="24" viewBox="0 0 32 32">
            <rect width="32" height="32" fill="#5865F2" rx="7"/>
            <path d="M6 3h14l7 7v18a3 3 0 01-3 3H6a3 3 0 01-3-3V6a3 3 0 013-3z" fill="#FFFFFF" fillOpacity="0.95"/>
            <path d="M20 3v5a2 2 0 002 2h5" fill="#C7D2FE"/>
            <path d="M8 16h10" stroke="#5865F2" strokeWidth="2.5" strokeLinecap="round"/>
            <path d="M8 21h14" stroke="#52525B" strokeWidth="2.5" strokeLinecap="round"/>
          </svg>
          {!collapsed && <span className="text-[15px] font-semibold text-zinc-100">WebPeel</span>}
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {navigation.map((item) => (
          <NavItem key={item.name} item={item} onClick={onClose} />
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-zinc-800 px-3 pt-3 pb-2 space-y-1">
        {/* Usage bar */}
        <UsageWidget collapsed={false} />

        {/* Upgrade CTA - only shown for free tier */}
        {showUpgrade && !collapsed && (
          <Link
            href="/billing"
            className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 bg-gradient-to-r from-[#5865F2] to-[#4752C4] text-white text-[13px] font-medium transition-all hover:from-[#4752C4] hover:to-[#4752C4] hover:shadow-md group"
          >
            <Zap className="h-4 w-4 flex-shrink-0 group-hover:scale-110 transition-transform" />
            Upgrade to Pro
          </Link>
        )}

        <a
          href="https://webpeel.dev/docs"
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-zinc-500 transition-all hover:bg-zinc-800 hover:text-zinc-300 hover:translate-x-0.5",
            collapsed && 'justify-center'
          )}
          title={collapsed ? 'Documentation' : undefined}
        >
          <BookOpen className="h-4 w-4 flex-shrink-0" />
          {!collapsed && (
            <>
              Documentation
              <ExternalLink className="h-3 w-3 ml-auto" />
            </>
          )}
        </a>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile: Overlay sidebar */}
      <div className="md:hidden">
        {/* Backdrop */}
        {isOpen && (
          <div
            className="fixed inset-0 bg-black/60 z-40 transition-opacity"
            onClick={onClose}
          />
        )}

        {/* Sliding sidebar */}
        <div className={cn(
          "fixed top-0 left-0 bottom-0 w-[280px] bg-[#0D0D12] border-r border-zinc-800 z-50 transform transition-transform duration-300 ease-in-out flex flex-col",
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}>
          {/* Close button for mobile */}
          <div className="flex items-center justify-between h-14 px-5 border-b border-zinc-800">
            <Link href="/dashboard" className="flex items-center gap-2.5" onClick={onClose}>
              <svg width="24" height="24" viewBox="0 0 32 32">
                <rect width="32" height="32" fill="#5865F2" rx="7"/>
                <path d="M6 3h14l7 7v18a3 3 0 01-3 3H6a3 3 0 01-3-3V6a3 3 0 013-3z" fill="#FFFFFF" fillOpacity="0.95"/>
                <path d="M20 3v5a2 2 0 002 2h5" fill="#C7D2FE"/>
                <path d="M8 16h10" stroke="#5865F2" strokeWidth="2.5" strokeLinecap="round"/>
                <path d="M8 21h14" stroke="#52525B" strokeWidth="2.5" strokeLinecap="round"/>
              </svg>
              <span className="text-[15px] font-semibold text-zinc-100">WebPeel</span>
            </Link>
            <button
              onClick={onClose}
              className="p-2 hover:bg-zinc-800 rounded-lg transition-colors text-zinc-400 hover:text-zinc-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-3 py-4 space-y-0.5">
            {navigation.map((item) => (
              <NavItem key={item.name} item={item} onClick={onClose} />
            ))}
          </nav>

          {/* Footer */}
          <div className="border-t border-zinc-800 px-3 pt-3 pb-2 space-y-1">
            {/* Usage bar */}
            <UsageWidget collapsed={false} />

            {showUpgrade && (
              <Link
                href="/billing"
                onClick={onClose}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 bg-gradient-to-r from-[#5865F2] to-[#4752C4] text-white text-[13px] font-medium transition-all hover:from-[#4752C4] hover:to-[#4752C4] hover:shadow-md"
              >
                <Zap className="h-4 w-4" />
                Upgrade to Pro
              </Link>
            )}

            <a
              href="https://webpeel.dev/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
            >
              <BookOpen className="h-4 w-4" />
              Documentation
              <ExternalLink className="h-3 w-3 ml-auto" />
            </a>
          </div>
        </div>
      </div>

      {/* Tablet: Collapsed sidebar (icon-only) */}
      <div className="hidden md:flex lg:hidden h-full w-[60px] flex-col border-r border-zinc-800 bg-[#0D0D12]">
        {/* Logo icon only */}
        <div className="flex h-14 items-center justify-center border-b border-zinc-800">
          <Link href="/dashboard">
            <svg width="24" height="24" viewBox="0 0 32 32">
              <rect width="32" height="32" fill="#5865F2" rx="7"/>
              <path d="M6 3h14l7 7v18a3 3 0 01-3 3H6a3 3 0 01-3-3V6a3 3 0 013-3z" fill="#FFFFFF" fillOpacity="0.95"/>
              <path d="M20 3v5a2 2 0 002 2h5" fill="#C7D2FE"/>
              <path d="M8 16h10" stroke="#5865F2" strokeWidth="2.5" strokeLinecap="round"/>
              <path d="M8 21h14" stroke="#52525B" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
          </Link>
        </div>
        {/* Icon-only nav */}
        <nav className="flex-1 px-2 py-4 space-y-1">
          {navigation.map((item) => {
            const isActive = item.href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname.startsWith(item.href);
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  'relative flex items-center justify-center rounded-lg p-2.5 transition-colors',
                  isActive
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                )}
                title={item.name}
              >
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-[#5865F2] rounded-r" />
                )}
                <item.icon className="h-4 w-4" />
              </Link>
            );
          })}
        </nav>
        {/* Icon-only footer */}
        <div className="border-t border-zinc-800 px-2 py-3 space-y-1">
          {/* Compact usage indicator */}
          <UsageWidget collapsed={true} />

          {showUpgrade && (
            <Link
              href="/billing"
              className="flex items-center justify-center rounded-lg p-2.5 bg-[#5865F2] text-white transition-colors hover:bg-[#4752C4]"
              title="Upgrade to Pro"
            >
              <Zap className="h-4 w-4" />
            </Link>
          )}
          <a
            href="https://webpeel.dev/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center rounded-lg p-2.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
            title="Documentation"
          >
            <BookOpen className="h-4 w-4" />
          </a>
        </div>
      </div>

      {/* Desktop: Full sidebar */}
      <div className="hidden lg:flex h-full w-[240px] flex-col border-r border-zinc-800 bg-[#0D0D12]">
        {sidebarContent}
      </div>
    </>
  );
}
