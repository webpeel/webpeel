'use client';

import { signIn } from 'next-auth/react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { WebAnimation } from '@/components/web-animation';

export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'oauth' | 'email'>('oauth');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) { toast.error('Passwords do not match'); return; }
    if (password.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) { const err = await res.json(); toast.error(err.message || 'Registration failed'); setLoading(false); return; }
      const result = await signIn('credentials', { email, password, redirect: false });
      if (result?.error) { toast.error('Please sign in manually.'); window.location.href = '/login'; }
      else { toast.success('Welcome to WebPeel!'); window.location.href = '/dashboard'; }
    } catch { toast.error('Something went wrong'); setLoading(false); }
  };

  const handleOAuth = (provider: 'github' | 'google') => {
    signIn(provider, { callbackUrl: '/dashboard' });
  };

  return (
    <div className="flex min-h-screen">
      {/* Left Side — Auth */}
      <div className="flex w-full flex-col items-center justify-center px-6 lg:w-1/2" style={{ backgroundColor: '#FAFAF8' }}>
        <div className="w-full max-w-[380px]">
          <div className="mb-12">
            <svg width="36" height="36" viewBox="0 0 32 32" className="mb-6">
              <rect width="32" height="32" fill="#8B5CF6" rx="8"/>
              <path d="M6 3h14l7 7v18a3 3 0 01-3 3H6a3 3 0 01-3-3V6a3 3 0 013-3z" fill="#FFFFFF" fillOpacity="0.95"/>
              <path d="M20 3v5a2 2 0 002 2h5" fill="#DDD6FE"/>
              <path d="M8 16h10" stroke="#8B5CF6" strokeWidth="2.5" strokeLinecap="round"/>
              <path d="M8 21h14" stroke="#A78BFA" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
            <h1 className="font-serif text-[32px] leading-tight text-zinc-900">
              Start fetching<br />
              <em className="font-serif">the web for free</em>
            </h1>
            <p className="mt-3 text-[15px] text-zinc-500">
              125 fetches/week included. No credit card required.
            </p>
          </div>

          {mode === 'oauth' ? (
            <>
              <div className="space-y-3">
                <button onClick={() => handleOAuth('github')} className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-[15px] font-medium text-zinc-900 shadow-sm transition-all hover:bg-zinc-50 hover:shadow-md active:scale-[0.99]">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
                  Continue with GitHub
                </button>
                <button onClick={() => handleOAuth('google')} className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-[15px] font-medium text-zinc-900 shadow-sm transition-all hover:bg-zinc-50 hover:shadow-md active:scale-[0.99]">
                  <svg className="h-5 w-5" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                  Continue with Google
                </button>
              </div>

              <div className="relative my-7">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-zinc-200" /></div>
                <div className="relative flex justify-center"><span className="px-3 text-[13px] text-zinc-400" style={{ backgroundColor: '#FAFAF8' }}>OR</span></div>
              </div>

              <div>
                <input type="email" placeholder="Enter your email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-[15px] text-zinc-900 placeholder-zinc-400 shadow-sm outline-none transition-all focus:border-violet-300 focus:ring-2 focus:ring-violet-100" />
                <button onClick={() => { if (email) setMode('email'); else toast.error('Please enter your email'); }} className="mt-3 w-full rounded-xl bg-zinc-900 px-4 py-3 text-[15px] font-medium text-white shadow-sm transition-all hover:bg-zinc-800 active:scale-[0.99]">
                  Continue with email
                </button>
              </div>
            </>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-[13px] font-medium text-zinc-500">Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-[15px] text-zinc-900 shadow-sm outline-none transition-all focus:border-violet-300 focus:ring-2 focus:ring-violet-100" />
              </div>
              <div>
                <label className="mb-1.5 block text-[13px] font-medium text-zinc-500">Password</label>
                <input type="password" placeholder="Min. 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-[15px] text-zinc-900 placeholder-zinc-400 shadow-sm outline-none transition-all focus:border-violet-300 focus:ring-2 focus:ring-violet-100" />
              </div>
              <div>
                <label className="mb-1.5 block text-[13px] font-medium text-zinc-500">Confirm password</label>
                <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required autoComplete="new-password" className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-[15px] text-zinc-900 shadow-sm outline-none transition-all focus:border-violet-300 focus:ring-2 focus:ring-violet-100" />
              </div>
              <button type="submit" disabled={loading} className="w-full rounded-xl bg-zinc-900 px-4 py-3 text-[15px] font-medium text-white shadow-sm transition-all hover:bg-zinc-800 active:scale-[0.99] disabled:opacity-50">
                {loading ? 'Creating account...' : 'Create account'}
              </button>
              <button type="button" onClick={() => setMode('oauth')} className="w-full text-center text-[13px] text-zinc-400 hover:text-zinc-600 transition-colors">
                ← Back to all options
              </button>
            </form>
          )}

          <p className="mt-8 text-center text-[13px] text-zinc-400">
            Already have an account?{' '}
            <Link href="/login" className="text-zinc-900 font-medium hover:underline">Sign in</Link>
          </p>
          <p className="mt-4 text-center text-[11px] text-zinc-400 leading-relaxed">
            By signing up, you agree to our <a href="https://webpeel.dev/terms" className="underline hover:text-zinc-600">Terms</a> and <a href="https://webpeel.dev/privacy" className="underline hover:text-zinc-600">Privacy Policy</a>.
          </p>
        </div>
      </div>

      <div className="hidden lg:flex flex-1 items-center justify-center p-16" style={{ backgroundColor: '#F5F3FF' }}>
        <WebAnimation />
      </div>
    </div>
  );
}
