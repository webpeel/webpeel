'use client';

import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode; fallback?: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

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

          <h2 className="mb-2 text-xl font-semibold text-zinc-900">Something went wrong</h2>
          <p className="mb-6 max-w-sm text-sm text-zinc-500">
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>

          <button
            onClick={() => {
              this.setState({ hasError: false, error: undefined });
              window.location.reload();
            }}
            className="inline-flex items-center justify-center rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 transition-colors"
          >
            Reload page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
