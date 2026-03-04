"use client";

import { useState } from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/v1/auth/forgot-password`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        }
      );
      // Always show success to prevent email enumeration
      void res;
    } catch {
      // Silently handle — don't reveal if email exists
    }

    setSubmitted(true);
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 sm:px-6 py-8" style={{ backgroundColor: '#0A0A0F' }}>
      <div className="w-full max-w-[380px]">
        {/* Logo */}
        <div className="mb-8 sm:mb-12">
          <svg width="36" height="36" viewBox="0 0 32 32" className="mb-4 sm:mb-6">
            <rect width="32" height="32" fill="#5865F2" rx="8"/>
            <path d="M6 3h14l7 7v18a3 3 0 01-3 3H6a3 3 0 01-3-3V6a3 3 0 013-3z" fill="#FFFFFF" fillOpacity="0.95"/>
            <path d="M20 3v5a2 2 0 002 2h5" fill="#C7D2FE"/>
            <path d="M8 16h10" stroke="#5865F2" strokeWidth="2.5" strokeLinecap="round"/>
            <path d="M8 21h14" stroke="#52525B" strokeWidth="2.5" strokeLinecap="round"/>
          </svg>
          <h1 className="font-serif text-[28px] sm:text-[32px] leading-tight text-zinc-100">
            Reset your password
          </h1>
          <p className="mt-3 text-[14px] sm:text-[15px] text-zinc-400">
            Enter your email and we&apos;ll send you a reset link.
          </p>
        </div>

        {submitted ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-center">
            <p className="text-sm font-medium text-emerald-300">
              If an account exists with that email, you&apos;ll receive a
              password reset link shortly.
            </p>
            <Link
              href="/login"
              className="mt-3 inline-block text-sm font-medium text-zinc-300 hover:text-zinc-100"
            >
              ← Back to login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-zinc-400">
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@example.com"
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-[15px] text-zinc-100 placeholder-zinc-500 shadow-sm outline-none transition-all focus:border-[#5865F2] focus:ring-2 focus:ring-[#5865F2]/20"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-zinc-200 px-4 py-3 text-[15px] font-medium text-zinc-900 shadow-sm transition-all hover:bg-zinc-100 active:scale-[0.99] disabled:opacity-50"
            >
              {loading ? "Sending..." : "Send reset link"}
            </button>

            <p className="text-center text-[13px] text-zinc-500">
              Remember your password?{" "}
              <Link
                href="/login"
                className="text-zinc-200 font-medium hover:underline"
              >
                Sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
