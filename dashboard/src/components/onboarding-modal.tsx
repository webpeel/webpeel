'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Copy, Sparkles, Key, Terminal, BookOpen, AlertTriangle, ExternalLink, Play, Zap, Globe } from 'lucide-react';

interface OnboardingModalProps {
  sessionApiKey?: string;
}

function CopyBlock({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="space-y-1">
      {label && <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">{label}</p>}
      <div className="relative group">
        <pre className="p-3 bg-zinc-900 text-zinc-100 rounded-lg overflow-x-auto text-xs pr-10">
          <code>{text}</code>
        </pre>
        <button
          onClick={handleCopy}
          className="absolute top-2.5 right-2.5 p-1.5 hover:bg-zinc-700 rounded-md transition-colors"
          title="Copy"
        >
          {copied ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
          ) : (
            <Copy className="h-3.5 w-3.5 text-zinc-400" />
          )}
        </button>
      </div>
    </div>
  );
}

export function OnboardingModal({ sessionApiKey }: OnboardingModalProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [apiKeyCopied, setApiKeyCopied] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);

  useEffect(() => {
    const onboarded = localStorage.getItem('webpeel_onboarded');
    if (!onboarded) {
      const storedKey = localStorage.getItem('webpeel_first_api_key');
      setApiKey(storedKey || sessionApiKey || null);
      setOpen(true);
    }
  }, [sessionApiKey]);

  const handleComplete = () => {
    localStorage.setItem('webpeel_onboarded', 'true');
    localStorage.removeItem('webpeel_first_api_key');
    setOpen(false);
  };

  const handleCopyKey = () => {
    if (apiKey) {
      navigator.clipboard.writeText(apiKey);
      setApiKeyCopied(true);
      setTimeout(() => setApiKeyCopied(false), 2000);
    }
  };

  const displayKey = apiKey || 'YOUR_API_KEY';

  const steps = [
    {
      icon: Sparkles,
      iconBg: 'bg-violet-100',
      iconColor: 'text-violet-600',
      title: 'Welcome to WebPeel',
      subtitle: 'Your AI-ready web scraping API',
    },
    {
      icon: Key,
      iconBg: 'bg-amber-100',
      iconColor: 'text-amber-600',
      title: apiKey ? 'Save Your API Key' : 'Your API Key',
      subtitle: apiKey ? '⚠️ This is the only time you\'ll see it' : 'Access the WebPeel API',
    },
    {
      icon: Terminal,
      iconBg: 'bg-zinc-800',
      iconColor: 'text-zinc-100',
      title: 'Quick Start',
      subtitle: 'Three ways to start in 60 seconds',
    },
    {
      icon: BookOpen,
      iconBg: 'bg-emerald-100',
      iconColor: 'text-emerald-600',
      title: "You're all set!",
      subtitle: 'Start building with WebPeel',
    },
  ];

  const stepContent = [
    /* Step 0 — Welcome */
    <div className="space-y-4" key="step0">
      <p className="text-sm text-zinc-600 leading-relaxed">
        WebPeel turns any website into clean, structured data — perfect for AI agents, scrapers, and developer tools.
      </p>
      <div className="grid gap-3">
        {[
          {
            icon: Globe,
            title: 'Fetch any URL',
            desc: 'Get clean markdown, plain text, or raw HTML from any page',
            color: 'text-violet-600',
            bg: 'bg-violet-50',
          },
          {
            icon: Zap,
            title: 'Bypass bot detection',
            desc: 'Stealth mode handles CAPTCHAs, Cloudflare, and JS-heavy sites',
            color: 'text-amber-600',
            bg: 'bg-amber-50',
          },
          {
            icon: Play,
            title: 'MCP server included',
            desc: 'Drop WebPeel directly into Claude, Cursor, or any MCP-compatible AI',
            color: 'text-emerald-600',
            bg: 'bg-emerald-50',
          },
        ].map(({ icon: Icon, title, desc, color, bg }) => (
          <div key={title} className={`flex items-start gap-3 p-3 ${bg} rounded-lg`}>
            <div className={`${color} flex-shrink-0 mt-0.5`}>
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-900">{title}</p>
              <p className="text-xs text-zinc-600 mt-0.5">{desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>,

    /* Step 1 — API Key */
    <div className="space-y-4" key="step1">
      {apiKey ? (
        <>
          <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
            <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-800">
              <strong>Copy this now!</strong> We only show API keys once and cannot recover them.
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold text-zinc-700 uppercase tracking-wide">Your API Key</p>
            <div className="flex items-center gap-2 p-3 bg-zinc-50 border border-zinc-200 rounded-lg">
              <code className="flex-1 text-xs font-mono text-zinc-800 break-all">{apiKey}</code>
              <button
                onClick={handleCopyKey}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium rounded-md transition-colors"
              >
                {apiKeyCopied ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copy
                  </>
                )}
              </button>
            </div>
          </div>
          <div className="p-3 bg-zinc-50 border border-zinc-200 rounded-lg space-y-1">
            <p className="text-xs font-medium text-zinc-700">Store it safely:</p>
            <ul className="text-xs text-zinc-600 space-y-0.5 list-disc list-inside">
              <li>Add to your <code className="bg-zinc-200 px-1 rounded">.env</code> file as <code className="bg-zinc-200 px-1 rounded">WEBPEEL_API_KEY</code></li>
              <li>Save in a password manager</li>
              <li>Never commit to version control</li>
            </ul>
          </div>
        </>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-zinc-600">
            Create your API key from the <a href="/keys" className="text-violet-600 hover:underline font-medium">Keys page</a>. Keep it safe — it's only shown once!
          </p>
          <div className="p-4 bg-violet-50 border border-violet-200 rounded-lg">
            <p className="text-sm font-semibold text-violet-900 mb-1">How to get your key:</p>
            <ol className="text-xs text-violet-800 space-y-1 list-decimal list-inside">
              <li>Go to API Keys in the sidebar</li>
              <li>Click "Create New Key"</li>
              <li>Name it and copy the key immediately</li>
              <li>Store it in your <code className="bg-violet-100 px-1 rounded">.env</code> file</li>
            </ol>
          </div>
        </div>
      )}
    </div>,

    /* Step 2 — Quick Start */
    <div className="space-y-5" key="step2">
      <CopyBlock
        label="1. Install CLI"
        text={`npm install -g webpeel-cli

# Or use it without installing:
npx webpeel "https://example.com"`}
      />
      <CopyBlock
        label="2. Make your first fetch"
        text={`curl "https://api.webpeel.dev/v1/fetch?url=https://example.com" \\
  -H "Authorization: Bearer ${displayKey}"`}
      />
      <CopyBlock
        label="3. Add to Claude / Cursor (MCP)"
        text={`# Add to your MCP config (claude_desktop_config.json):
{
  "mcpServers": {
    "webpeel": {
      "command": "npx",
      "args": ["webpeel-mcp"],
      "env": {
        "WEBPEEL_API_KEY": "${displayKey}"
      }
    }
  }
}`}
      />
    </div>,

    /* Step 3 — What's Next */
    <div className="space-y-4" key="step3">
      <p className="text-sm text-zinc-600">
        You're ready to start scraping. Here's where to go next:
      </p>
      <div className="grid gap-3">
        {[
          {
            href: '/playground',
            icon: Play,
            title: 'Try the Playground',
            desc: 'Test any URL and see results live in your browser',
            color: 'text-violet-600',
            bg: 'bg-violet-50 hover:bg-violet-100',
          },
          {
            href: 'https://webpeel.dev/docs',
            icon: BookOpen,
            title: 'Read the Docs',
            desc: 'Full API reference, guides, and examples',
            color: 'text-emerald-600',
            bg: 'bg-emerald-50 hover:bg-emerald-100',
            external: true,
          },
          {
            href: '/keys',
            icon: Key,
            title: 'Manage API Keys',
            desc: 'Create additional keys for different environments',
            color: 'text-amber-600',
            bg: 'bg-amber-50 hover:bg-amber-100',
          },
        ].map(({ href, icon: Icon, title, desc, color, bg, external }) => (
          <a
            key={title}
            href={href}
            target={external ? '_blank' : undefined}
            rel={external ? 'noopener noreferrer' : undefined}
            onClick={external ? undefined : handleComplete}
            className={`flex items-start gap-3 p-3 ${bg} rounded-lg transition-colors cursor-pointer`}
          >
            <Icon className={`h-5 w-5 ${color} flex-shrink-0 mt-0.5`} />
            <div className="flex-1">
              <p className="text-sm font-semibold text-zinc-900 flex items-center gap-1">
                {title}
                {external && <ExternalLink className="h-3 w-3 text-zinc-400" />}
              </p>
              <p className="text-xs text-zinc-600 mt-0.5">{desc}</p>
            </div>
          </a>
        ))}
      </div>
    </div>,
  ];

  const currentStep = steps[step];
  const Icon = currentStep.icon;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto p-0">
        {/* Progress bar */}
        <div className="h-1 bg-zinc-100 rounded-t-lg overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-violet-500 to-violet-600 transition-all duration-500 ease-out"
            style={{ width: `${((step + 1) / steps.length) * 100}%` }}
          />
        </div>

        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex items-start gap-4">
            <div className={`w-12 h-12 rounded-xl ${currentStep.iconBg} flex items-center justify-center flex-shrink-0`}>
              <Icon className={`h-6 w-6 ${currentStep.iconColor}`} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-zinc-900 leading-tight">{currentStep.title}</h2>
              <p className="text-sm text-zinc-500 mt-0.5">{currentStep.subtitle}</p>
            </div>
          </div>

          {/* Step content */}
          <div>{stepContent[step]}</div>

          {/* Progress dots */}
          <div className="flex items-center justify-center gap-2">
            {steps.map((_, index) => (
              <button
                key={index}
                onClick={() => setStep(index)}
                className={`h-2 rounded-full transition-all ${
                  index === step
                    ? 'w-8 bg-violet-600'
                    : index < step
                    ? 'w-2 bg-violet-300'
                    : 'w-2 bg-zinc-200'
                }`}
              />
            ))}
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between pt-2 border-t border-zinc-100">
            {step > 0 ? (
              <Button variant="ghost" size="sm" onClick={() => setStep(step - 1)} className="text-zinc-500">
                ← Back
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleComplete}
                className="text-zinc-400 hover:text-zinc-600"
              >
                Skip
              </Button>
            )}

            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400">{step + 1} of {steps.length}</span>
              {step < steps.length - 1 ? (
                <Button
                  onClick={() => setStep(step + 1)}
                  size="sm"
                  className="bg-violet-600 hover:bg-violet-700"
                >
                  Next →
                </Button>
              ) : (
                <Button
                  onClick={handleComplete}
                  size="sm"
                  className="bg-violet-600 hover:bg-violet-700"
                >
                  Start Building 🚀
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
