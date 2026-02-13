'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Key, BarChart3, CreditCard, Settings, ExternalLink, BookOpen, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const navigation = [
  { name: 'Overview', href: '/dashboard', icon: LayoutDashboard },
  { name: 'API Keys', href: '/keys', icon: Key },
  { name: 'Usage', href: '/usage', icon: BarChart3 },
  { name: 'Billing', href: '/billing', icon: CreditCard },
  { name: 'Settings', href: '/settings', icon: Settings },
];

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
  collapsed?: boolean;
}

export function Sidebar({ isOpen = true, onClose, collapsed = false }: SidebarProps) {
  const pathname = usePathname();

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="flex h-14 items-center border-b border-zinc-100 px-5">
        <Link href="/dashboard" className="flex items-center gap-2.5" onClick={onClose}>
          <svg width="24" height="24" viewBox="0 0 32 32">
            <rect width="32" height="32" fill="#8B5CF6" rx="7"/>
            <path d="M6 3h14l7 7v18a3 3 0 01-3 3H6a3 3 0 01-3-3V6a3 3 0 013-3z" fill="#FFFFFF" fillOpacity="0.95"/>
            <path d="M20 3v5a2 2 0 002 2h5" fill="#DDD6FE"/>
            <path d="M8 16h10" stroke="#8B5CF6" strokeWidth="2.5" strokeLinecap="round"/>
            <path d="M8 21h14" stroke="#A78BFA" strokeWidth="2.5" strokeLinecap="round"/>
          </svg>
          {!collapsed && <span className="text-[15px] font-semibold text-zinc-900">WebPeel</span>}
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {navigation.map((item) => {
          const isActive = item.href === '/dashboard' 
            ? pathname === '/dashboard' 
            : pathname.startsWith(item.href);
          return (
            <Link
              key={item.name}
              href={item.href}
              onClick={onClose}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors',
                isActive
                  ? 'bg-zinc-100 text-zinc-900'
                  : 'text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700',
                collapsed && 'justify-center'
              )}
              title={collapsed ? item.name : undefined}
            >
              <item.icon className="h-4 w-4 flex-shrink-0" />
              {!collapsed && item.name}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-zinc-100 px-3 py-3 space-y-0.5">
        <a
          href="https://webpeel.dev/docs"
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-zinc-400 transition-colors hover:bg-zinc-50 hover:text-zinc-600",
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
            className="fixed inset-0 bg-black/50 z-40 transition-opacity"
            onClick={onClose}
          />
        )}
        
        {/* Sliding sidebar */}
        <div className={cn(
          "fixed top-0 left-0 bottom-0 w-[280px] bg-white border-r border-zinc-200 z-50 transform transition-transform duration-300 ease-in-out flex flex-col",
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}>
          {/* Close button for mobile */}
          <div className="flex items-center justify-between h-14 px-5 border-b border-zinc-100">
            <Link href="/dashboard" className="flex items-center gap-2.5" onClick={onClose}>
              <svg width="24" height="24" viewBox="0 0 32 32">
                <rect width="32" height="32" fill="#8B5CF6" rx="7"/>
                <path d="M6 3h14l7 7v18a3 3 0 01-3 3H6a3 3 0 01-3-3V6a3 3 0 013-3z" fill="#FFFFFF" fillOpacity="0.95"/>
                <path d="M20 3v5a2 2 0 002 2h5" fill="#DDD6FE"/>
                <path d="M8 16h10" stroke="#8B5CF6" strokeWidth="2.5" strokeLinecap="round"/>
                <path d="M8 21h14" stroke="#A78BFA" strokeWidth="2.5" strokeLinecap="round"/>
              </svg>
              <span className="text-[15px] font-semibold text-zinc-900">WebPeel</span>
            </Link>
            <button
              onClick={onClose}
              className="p-2 hover:bg-zinc-100 rounded-lg transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          
          {/* Navigation */}
          <nav className="flex-1 px-3 py-4 space-y-0.5">
            {navigation.map((item) => {
              const isActive = item.href === '/dashboard' 
                ? pathname === '/dashboard' 
                : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={onClose}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors',
                    isActive
                      ? 'bg-zinc-100 text-zinc-900'
                      : 'text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700'
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.name}
                </Link>
              );
            })}
          </nav>

          {/* Footer */}
          <div className="border-t border-zinc-100 px-3 py-3 space-y-0.5">
            <a
              href="https://webpeel.dev/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-zinc-400 transition-colors hover:bg-zinc-50 hover:text-zinc-600"
            >
              <BookOpen className="h-4 w-4" />
              Documentation
              <ExternalLink className="h-3 w-3 ml-auto" />
            </a>
          </div>
        </div>
      </div>

      {/* Tablet: Collapsed sidebar (icon-only) */}
      <div className="hidden md:flex lg:hidden h-full w-[60px] flex-col border-r border-zinc-200 bg-white">
        {/* Logo icon only */}
        <div className="flex h-14 items-center justify-center border-b border-zinc-100">
          <Link href="/dashboard">
            <svg width="24" height="24" viewBox="0 0 32 32">
              <rect width="32" height="32" fill="#8B5CF6" rx="7"/>
              <path d="M6 3h14l7 7v18a3 3 0 01-3 3H6a3 3 0 01-3-3V6a3 3 0 013-3z" fill="#FFFFFF" fillOpacity="0.95"/>
              <path d="M20 3v5a2 2 0 002 2h5" fill="#DDD6FE"/>
              <path d="M8 16h10" stroke="#8B5CF6" strokeWidth="2.5" strokeLinecap="round"/>
              <path d="M8 21h14" stroke="#A78BFA" strokeWidth="2.5" strokeLinecap="round"/>
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
                  'flex items-center justify-center rounded-lg p-2.5 transition-colors',
                  isActive
                    ? 'bg-zinc-100 text-zinc-900'
                    : 'text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700'
                )}
                title={item.name}
              >
                <item.icon className="h-4 w-4" />
              </Link>
            );
          })}
        </nav>
        {/* Icon-only footer */}
        <div className="border-t border-zinc-100 px-2 py-3">
          <a
            href="https://webpeel.dev/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center rounded-lg p-2.5 text-zinc-400 transition-colors hover:bg-zinc-50 hover:text-zinc-600"
            title="Documentation"
          >
            <BookOpen className="h-4 w-4" />
          </a>
        </div>
      </div>

      {/* Desktop: Full sidebar */}
      <div className="hidden lg:flex h-full w-[240px] flex-col border-r border-zinc-200 bg-white">
        {sidebarContent}
      </div>
    </>
  );
}
