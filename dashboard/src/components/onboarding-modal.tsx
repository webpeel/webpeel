'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CheckCircle2, Copy, Sparkles, Code, Rocket } from 'lucide-react';

interface OnboardingModalProps {
  apiKey?: string;
}

export function OnboardingModal({ apiKey = 'YOUR_API_KEY' }: OnboardingModalProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Check if user has been onboarded
    const onboarded = localStorage.getItem('webpeel_onboarded');
    if (!onboarded) {
      setOpen(true);
    }
  }, []);

  const handleComplete = () => {
    localStorage.setItem('webpeel_onboarded', 'true');
    setOpen(false);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const exampleCode = `const response = await fetch(
  'https://api.webpeel.dev/v1/fetch?url=https://example.com',
  { headers: { 'Authorization': 'Bearer ${apiKey}' } }
);
const data = await response.json();
console.log(data.content);`;

  const steps = [
    {
      title: 'Welcome to WebPeel!',
      icon: Sparkles,
      content: (
        <div className="space-y-4">
          <p className="text-zinc-600">
            WebPeel is your fast, reliable web scraping API designed for AI agents and developers.
          </p>
          <div className="grid gap-3">
            <div className="flex items-start gap-3 p-3 bg-violet-50 rounded-lg">
              <CheckCircle2 className="h-5 w-5 text-violet-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-sm">Clean Markdown Output</p>
                <p className="text-xs text-zinc-600">AI-ready content with smart extraction</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-violet-50 rounded-lg">
              <CheckCircle2 className="h-5 w-5 text-violet-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-sm">Bypass Bot Detection</p>
                <p className="text-xs text-zinc-600">Stealth mode for protected sites</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-violet-50 rounded-lg">
              <CheckCircle2 className="h-5 w-5 text-violet-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-sm">Fast & Reliable</p>
                <p className="text-xs text-zinc-600">Optimized for performance</p>
              </div>
            </div>
          </div>
        </div>
      ),
    },
    {
      title: 'Your API Key',
      icon: Code,
      content: (
        <div className="space-y-4">
          <p className="text-zinc-600">
            Your API key is your access token. Keep it secure and never share it publicly.
          </p>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-zinc-900">API Key</label>
            <div className="flex items-center gap-2 p-3 bg-zinc-50 border border-zinc-200 rounded-lg">
              <code className="flex-1 truncate text-sm font-mono text-zinc-700">{apiKey}</code>
              <button
                onClick={() => handleCopy(apiKey)}
                className="p-2 hover:bg-zinc-200 rounded-md transition-colors"
              >
                {copied ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                ) : (
                  <Copy className="h-4 w-4 text-zinc-500" />
                )}
              </button>
            </div>
          </div>
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-xs text-amber-800">
              <strong>Tip:</strong> You can manage your API keys from the Keys page.
            </p>
          </div>
        </div>
      ),
    },
    {
      title: 'Try It Out',
      icon: Rocket,
      content: (
        <div className="space-y-4">
          <p className="text-zinc-600">
            Here's a simple example to get you started. Copy and run it in your terminal or code editor.
          </p>
          <div className="relative">
            <pre className="p-4 bg-zinc-900 text-zinc-100 rounded-lg overflow-x-auto text-xs">
              <code>{exampleCode}</code>
            </pre>
            <button
              onClick={() => handleCopy(exampleCode)}
              className="absolute top-3 right-3 p-2 hover:bg-zinc-800 rounded-md transition-colors"
            >
              {copied ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              ) : (
                <Copy className="h-4 w-4 text-zinc-400" />
              )}
            </button>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-zinc-900">What you'll get:</p>
            <ul className="text-xs text-zinc-600 space-y-1 list-disc list-inside">
              <li>Clean markdown content from the page</li>
              <li>Extracted metadata (title, description, author)</li>
              <li>All links found on the page</li>
              <li>Response time and token count</li>
            </ul>
          </div>
        </div>
      ),
    },
  ];

  const currentStep = steps[step];
  const Icon = currentStep.icon;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-violet-100 flex items-center justify-center">
              <Icon className="h-6 w-6 text-violet-600" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-zinc-900">{currentStep.title}</h2>
              <p className="text-sm text-zinc-500">
                Step {step + 1} of {steps.length}
              </p>
            </div>
          </div>

          {/* Content */}
          <div>{currentStep.content}</div>

          {/* Progress Dots */}
          <div className="flex items-center justify-center gap-2">
            {steps.map((_, index) => (
              <div
                key={index}
                className={`h-2 rounded-full transition-all ${
                  index === step
                    ? 'w-8 bg-violet-600'
                    : index < step
                    ? 'w-2 bg-violet-400'
                    : 'w-2 bg-zinc-300'
                }`}
              />
            ))}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-4 border-t">
            {step > 0 ? (
              <Button
                variant="outline"
                onClick={() => setStep(step - 1)}
              >
                Back
              </Button>
            ) : (
              <div />
            )}
            {step < steps.length - 1 ? (
              <Button
                onClick={() => setStep(step + 1)}
                className="bg-violet-600 hover:bg-violet-700"
              >
                Next
              </Button>
            ) : (
              <Button
                onClick={handleComplete}
                className="bg-violet-600 hover:bg-violet-700"
              >
                Start Building
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
