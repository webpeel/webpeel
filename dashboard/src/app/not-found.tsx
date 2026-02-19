import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center" style={{ backgroundColor: '#FAFAF8' }}>
      {/* Logo */}
      <div className="mb-8">
        <svg width="40" height="40" viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" fill="#8B5CF6" rx="8" />
          <path d="M6 3h14l7 7v18a3 3 0 01-3 3H6a3 3 0 01-3-3V6a3 3 0 013-3z" fill="#FFFFFF" fillOpacity="0.95" />
          <path d="M20 3v5a2 2 0 002 2h5" fill="#DDD6FE" />
          <path d="M8 16h10" stroke="#8B5CF6" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </div>

      <div className="mb-2 inline-flex items-center justify-center rounded-full bg-zinc-100 px-3 py-1">
        <span className="text-xs font-semibold text-zinc-500 tracking-widest">404</span>
      </div>

      <h1 className="mt-4 mb-3 text-2xl font-semibold text-zinc-900">Page not found</h1>
      <p className="mb-8 max-w-sm text-sm text-zinc-500 leading-relaxed">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Link
          href="/dashboard"
          className="inline-flex items-center justify-center rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 transition-colors"
        >
          Go to dashboard
        </Link>
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-lg border border-zinc-200 bg-white px-5 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2 transition-colors"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
