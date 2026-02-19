'use client';

import { useEffect } from 'react';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function Error({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log to console for debugging; Sentry/error tracking picks this up in production
    console.error('[Route Error]', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <div className="mb-6">
        <svg
          width="48"
          height="48"
          viewBox="0 0 48 48"
          fill="none"
          className="mx-auto text-zinc-300"
          aria-hidden="true"
        >
          <circle cx="24" cy="24" r="22" stroke="currentColor" strokeWidth="2" />
          <path
            d="M24 14v12M24 32v2"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      </div>

      <h1 className="mb-2 text-xl font-semibold text-zinc-900">Something went wrong</h1>
      <p className="mb-6 max-w-sm text-sm text-zinc-500">
        {error.message && error.message !== 'An unexpected error occurred'
          ? error.message
          : 'An unexpected error occurred. We\'ve been notified and are looking into it.'}
      </p>

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          onClick={reset}
          className="inline-flex items-center justify-center rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 transition-colors"
        >
          Try again
        </button>
        <a
          href="/dashboard"
          className="inline-flex items-center justify-center rounded-lg border border-zinc-200 bg-white px-5 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2 transition-colors"
        >
          Go to dashboard
        </a>
      </div>

      {error.digest && (
        <p className="mt-6 text-xs text-zinc-400">Error ID: {error.digest}</p>
      )}
    </div>
  );
}
