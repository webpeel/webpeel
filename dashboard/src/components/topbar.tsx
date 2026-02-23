'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { LogOut, Settings, ChevronDown, Menu } from 'lucide-react';
import { signOut, useSession } from 'next-auth/react';
import { checkApiHealth } from '@/lib/api';

interface TopbarProps {
  user?: {
    email?: string | null;
    name?: string | null;
  } | null;
  tier?: string;
  onMenuClick?: () => void;
}

export function Topbar({ user, tier = 'free', onMenuClick }: TopbarProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [apiOnline, setApiOnline] = useState(true);
  const prevOnline = useRef(true);
  const { data: session, update } = useSession();

  useEffect(() => {
    const check = async () => {
      const { healthy } = await checkApiHealth();
      const wasOffline = !prevOnline.current;
      prevOnline.current = healthy;
      setApiOnline(healthy);

      // When API transitions offline → online and session has an error,
      // trigger a session refresh to auto-recover the JWT
      if (healthy && wasOffline && (session as any)?.apiError) {
        update();
      }
    };
    check();
    // Check more frequently (30s) to detect recovery faster
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, [(session as any)?.apiError, update]);

  const initials = user?.name
    ? user.name.split(' ').map(n => n[0]).join('').toUpperCase()
    : user?.email?.substring(0, 2).toUpperCase() || 'U';

  return (
    <div className="flex h-14 items-center justify-between border-b border-zinc-100 bg-white px-4 md:px-6 shadow-sm">
      {/* Left — Hamburger (mobile) + API status + Plan badge */}
      <div className="flex items-center gap-3">
        {/* Hamburger menu button - only visible on mobile */}
        <button
          onClick={onMenuClick}
          className="md:hidden p-2 -ml-2 hover:bg-zinc-100 rounded-lg transition-colors"
          aria-label="Toggle menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        {/* API status */}
        <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 ${apiOnline ? 'bg-emerald-50' : 'bg-red-50'}`}>
          <div className={`w-1.5 h-1.5 rounded-full ${apiOnline ? 'bg-emerald-500' : 'bg-red-500'}`} />
          <span className={`text-[11px] font-medium ${apiOnline ? 'text-emerald-700' : 'text-red-700'}`}>
            {apiOnline ? 'API Online' : 'API Offline'}
          </span>
        </div>

        {/* Plan badge - clickable */}
        <Link href="/billing">
          <div className="flex items-center gap-1.5 rounded-full bg-violet-50 px-2.5 py-1 hover:bg-violet-100 transition-colors cursor-pointer">
            <span className="text-[11px] font-semibold text-violet-700 uppercase">{tier} Plan</span>
          </div>
        </Link>
      </div>

      {/* Right — User menu */}
      <div className="relative">
        <button 
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-zinc-50"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-100 text-[11px] font-semibold text-violet-700">
            {initials}
          </div>
          <span className="text-[13px] text-zinc-600 hidden sm:block">{user?.email || 'User'}</span>
          <ChevronDown className={`h-3.5 w-3.5 text-zinc-400 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
        </button>

        {/* Dropdown */}
        {dropdownOpen && (
          <>
            {/* Backdrop */}
            <div 
              className="fixed inset-0 z-40"
              onClick={() => setDropdownOpen(false)}
            />
            
            {/* Menu */}
            <div className="absolute right-0 top-full mt-1 w-48 rounded-xl border border-zinc-200 bg-white py-1 shadow-lg z-50 animate-fade-in">
              <div className="px-3 py-2 border-b border-zinc-100">
                <p className="text-[13px] font-medium text-zinc-900 truncate">{user?.name || 'User'}</p>
                <p className="text-[11px] text-zinc-400 truncate">{user?.email}</p>
              </div>
              <a 
                href="/settings" 
                className="flex items-center gap-2 px-3 py-2 text-[13px] text-zinc-600 hover:bg-zinc-50 transition-colors"
                onClick={() => setDropdownOpen(false)}
              >
                <Settings className="h-3.5 w-3.5" />
                Settings
              </a>
              <button
                onClick={() => signOut({ callbackUrl: '/login' })}
                className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-red-600 hover:bg-red-50 transition-colors"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign out
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
