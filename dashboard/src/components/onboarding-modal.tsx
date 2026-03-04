'use client';

import { useState, useEffect } from 'react';
import { Sparkles, Key, Copy, CheckCircle2, X } from 'lucide-react';

interface OnboardingModalProps {
  sessionApiKey?: string;
}

export function OnboardingBanner({ sessionApiKey }: OnboardingModalProps) {
  const [visible, setVisible] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onboarded =
      localStorage.getItem('webpeel_onboarded') ||
      localStorage.getItem('webpeel_onboarding_complete');
    if (!onboarded) {
      const storedKey = localStorage.getItem('webpeel_first_api_key');
      setApiKey(storedKey || sessionApiKey || null);
      setVisible(true);
    }
  }, [sessionApiKey]);

  const handleDismiss = () => {
    localStorage.setItem('webpeel_onboarded', 'true');
    localStorage.setItem('webpeel_onboarding_complete', 'true');
    localStorage.removeItem('webpeel_first_api_key');
    setVisible(false);
  };

  const handleCopy = () => {
    if (apiKey) {
      navigator.clipboard.writeText(apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!visible) return null;

  return (
    <div className="mb-6 rounded-xl border border-zinc-200 bg-gradient-to-r from-zinc-50 to-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-zinc-900 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-500 flex-shrink-0" />
            Welcome to WebPeel
          </h3>
          <p className="mt-1 text-sm text-zinc-500">
            Your account is ready. Start fetching any URL → clean, structured data for your AI.
          </p>

          {apiKey && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 rounded-lg bg-zinc-100 border border-zinc-200 px-3 py-2 font-mono text-xs text-zinc-700">
                <Key className="h-3.5 w-3.5 text-zinc-400 flex-shrink-0" />
                <span className="truncate max-w-[200px]">
                  {apiKey.slice(0, 16)}...{apiKey.slice(-4)}
                </span>
              </div>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white px-3 py-2 text-xs font-medium transition-colors"
              >
                {copied ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copy Key
                  </>
                )}
              </button>
              <span className="text-xs text-red-500 font-medium">← Save this — shown once only</span>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <a href="/docs" className="text-zinc-500 hover:text-zinc-800 underline underline-offset-2">
              Read docs
            </a>
            <span className="text-zinc-300 hidden sm:inline">·</span>
            <a href="/keys" className="text-zinc-500 hover:text-zinc-800 underline underline-offset-2">
              Manage API keys
            </a>
            <span className="text-zinc-300 hidden sm:inline">·</span>
            <a href="/playground" className="text-zinc-500 hover:text-zinc-800 underline underline-offset-2">
              Try playground
            </a>
          </div>
        </div>

        <button
          onClick={handleDismiss}
          className="text-zinc-400 hover:text-zinc-600 p-1 rounded-md hover:bg-zinc-100 transition-colors flex-shrink-0"
          aria-label="Dismiss welcome banner"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// Keep backward-compat alias so any other import of OnboardingModal still compiles
export { OnboardingBanner as OnboardingModal };
