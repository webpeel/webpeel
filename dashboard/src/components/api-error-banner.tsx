'use client';

import { signOut } from 'next-auth/react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ApiErrorBannerProps {
  title?: string;
  message?: string;
  showSignOut?: boolean;
  reconnecting?: boolean;
}

/**
 * Reusable banner shown when the WebPeel API is unreachable or the OAuth
 * back-end call failed during sign-in.
 *
 * When `reconnecting` is true, shows a spinner and softer messaging.
 * The dashboard layout auto-retries the session in the background —
 * when the API comes back, the session heals and this banner disappears.
 */
export function ApiErrorBanner({
  title = 'API Connection Issue',
  message = "We couldn't connect to the WebPeel API. Retrying automatically...",
  showSignOut = true,
  reconnecting = false,
}: ApiErrorBannerProps) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start gap-3">
        {reconnecting ? (
          <RefreshCw className="h-5 w-5 flex-shrink-0 text-amber-600 mt-0.5 animate-spin" />
        ) : (
          <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-600 mt-0.5" />
        )}
        <div className="flex-1 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-amber-900">
              {reconnecting ? 'Reconnecting...' : title}
            </h3>
            <p className="mt-1 text-sm text-amber-700">{message}</p>
          </div>
          {showSignOut && !reconnecting && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="border-amber-300 bg-white text-amber-800 hover:bg-amber-100 hover:border-amber-400"
            >
              Sign out &amp; retry
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
