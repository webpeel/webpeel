'use client';

import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';
import { Sidebar } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';
import { ApiErrorBanner } from '@/components/api-error-banner';
import { checkApiHealth } from '@/lib/api';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session, status, update } = useSession();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [recovering, setRecovering] = useState(false);

  // Pre-warm the API on dashboard mount — fire and forget.
  // By pinging /health now we ensure the connection is established before
  // SWR makes its first data requests.
  useEffect(() => {
    checkApiHealth().catch(() => { /* silent — this is best-effort */ });
  }, []);

  const hasApiError = (session as any)?.apiError === true;
  const hasToken = !!(session as any)?.apiToken;
  const showRecoveryBanner = hasApiError || !hasToken;

  // -------------------------------------------------------------------
  // Auto-recovery: when the session has apiError, periodically refresh
  // the session which re-runs the jwt callback (which now auto-retries
  // the API registration). Once the API is back, the session heals
  // silently and the banner disappears.
  // -------------------------------------------------------------------
  const attemptRecovery = useCallback(async () => {
    if (!showRecoveryBanner) return;
    setRecovering(true);
    try {
      // Check if API is back first to avoid unnecessary jwt retries
      const { healthy } = await checkApiHealth();
      if (healthy) {
        // API is back — trigger session refresh which re-runs jwt callback
        await update();
      }
    } catch {
      // silent
    } finally {
      setRecovering(false);
    }
  }, [showRecoveryBanner, update]);

  useEffect(() => {
    if (!showRecoveryBanner) return;

    // Try immediately
    attemptRecovery();

    // Then poll every 30 seconds
    const interval = setInterval(attemptRecovery, 30_000);
    return () => clearInterval(interval);
  }, [showRecoveryBanner, attemptRecovery]);

  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-200 border-t-violet-600" />
      </div>
    );
  }

  if (!session) {
    redirect('/login');
  }

  const tier = (session as any)?.tier || 'free';

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        tier={tier}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar
          user={session.user}
          tier={tier}
          onMenuClick={() => setSidebarOpen(!sidebarOpen)}
        />
        <main className="flex-1 overflow-y-auto p-4 md:p-6" style={{ backgroundColor: '#FAFAF8' }}>
          {showRecoveryBanner && (
            <div className="mb-6">
              <ApiErrorBanner
                title="API Connection Issue"
                message={
                  recovering
                    ? "Reconnecting to the WebPeel API..."
                    : "We couldn't connect to the API during sign-in. Retrying automatically — or you can sign out and try again."
                }
                reconnecting={recovering}
              />
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
