'use client';

import { useEffect } from 'react';

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

// global-error.tsx wraps the root layout, so it must include <html> and <body>.
export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error('[Global Error]', error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: '#FAFAF8' }}>
        <div
          style={{
            display: 'flex',
            minHeight: '100vh',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem',
            textAlign: 'center',
          }}
        >
          {/* Logo mark */}
          <svg width="40" height="40" viewBox="0 0 32 32" style={{ marginBottom: '1.5rem' }} aria-hidden="true">
            <rect width="32" height="32" fill="#8B5CF6" rx="8" />
            <path d="M6 3h14l7 7v18a3 3 0 01-3 3H6a3 3 0 01-3-3V6a3 3 0 013-3z" fill="#FFFFFF" fillOpacity="0.95" />
            <path d="M20 3v5a2 2 0 002 2h5" fill="#DDD6FE" />
            <path d="M8 16h10" stroke="#8B5CF6" strokeWidth="2.5" strokeLinecap="round" />
          </svg>

          <h1
            style={{
              fontSize: '1.25rem',
              fontWeight: 600,
              color: '#18181B',
              marginBottom: '0.5rem',
            }}
          >
            Something went wrong
          </h1>
          <p
            style={{
              fontSize: '0.875rem',
              color: '#71717A',
              maxWidth: '360px',
              marginBottom: '1.5rem',
              lineHeight: 1.6,
            }}
          >
            A critical error occurred while loading the page. Please try again or{' '}
            <a
              href="mailto:support@webpeel.dev"
              style={{ color: '#8B5CF6', textDecoration: 'underline' }}
            >
              contact support
            </a>{' '}
            if the problem persists.
          </p>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              onClick={reset}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0.625rem 1.25rem',
                borderRadius: '0.5rem',
                backgroundColor: '#8B5CF6',
                color: '#FFFFFF',
                fontSize: '0.875rem',
                fontWeight: 500,
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
            <a
              href="/"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0.625rem 1.25rem',
                borderRadius: '0.5rem',
                backgroundColor: '#FFFFFF',
                color: '#3F3F46',
                fontSize: '0.875rem',
                fontWeight: 500,
                border: '1px solid #E4E4E7',
                textDecoration: 'none',
                cursor: 'pointer',
              }}
            >
              Go home
            </a>
          </div>

          {error.digest && (
            <p style={{ marginTop: '1.5rem', fontSize: '0.75rem', color: '#A1A1AA' }}>
              Error ID: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
