'use client';

import { useEffect, useState, useCallback } from 'react';

const DEMO_SITES = [
  {
    url: 'https://openai.com/blog/gpt-5',
    title: 'Introducing GPT-5',
    markdown: '# Introducing GPT-5\n\nToday we announce our most capable\nmodel yet, with breakthrough\nperformance across every benchmark...',
    time: '164ms',
    mode: 'HTTP',
    modeColor: 'bg-emerald-100 text-emerald-700',
  },
  {
    url: 'https://github.com/trending',
    title: 'GitHub Trending',
    markdown: '# Trending repositories on GitHub\n\n## 🔥 webpeel/webpeel\nOpen-source web fetcher for AI\n⭐ 2,431 stars today',
    time: '312ms',
    mode: 'HTTP',
    modeColor: 'bg-emerald-100 text-emerald-700',
  },
  {
    url: 'https://news.ycombinator.com',
    title: 'Hacker News',
    markdown: '# Hacker News\n\n1. Show HN: WebPeel (423 pts)\n2. React Server Components (389 pts)\n3. The future of web scraping (301 pts)',
    time: '89ms',
    mode: 'HTTP',
    modeColor: 'bg-emerald-100 text-emerald-700',
  },
  {
    url: 'https://react.dev/learn',
    title: 'Quick Start – React',
    markdown: '# Quick Start\n\nWelcome to the React docs!\nThis page will give you an intro\nto the 80% of React concepts...',
    time: '441ms',
    mode: 'Browser',
    modeColor: 'bg-violet-100 text-violet-700',
  },
];

function TypeWriter({ text, speed = 30, onDone }: { text: string; speed?: number; onDone?: () => void }) {
  const [displayed, setDisplayed] = useState('');
  const stableDone = useCallback(() => onDone?.(), [onDone]);

  useEffect(() => {
    let i = 0;
    setDisplayed('');
    const interval = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) {
        clearInterval(interval);
        stableDone();
      }
    }, speed);
    return () => clearInterval(interval);
  }, [text, speed, stableDone]);

  return (
    <>
      {displayed}
      {displayed.length < text.length && <span className="animate-pulse text-violet-500">▎</span>}
    </>
  );
}

export function WebAnimation() {
  const [siteIndex, setSiteIndex] = useState(0);
  const [phase, setPhase] = useState<'typing' | 'fetching' | 'result'>('typing');

  const site = DEMO_SITES[siteIndex];

  useEffect(() => {
    const timer = setInterval(() => {
      setSiteIndex((prev) => (prev + 1) % DEMO_SITES.length);
      setPhase('typing');
    }, 10000); // Much slower — 10 seconds per site
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (phase === 'fetching') {
      const timer = setTimeout(() => setPhase('result'), 1800);
      return () => clearTimeout(timer);
    }
  }, [phase]);

  const handleTypeDone = useCallback(() => {
    setTimeout(() => setPhase('fetching'), 400);
  }, []);

  return (
    <div className="relative w-full max-w-[480px]">
      {/* Main Terminal Card */}
      <div className="rounded-2xl border border-zinc-200 bg-white shadow-xl overflow-hidden">
        {/* Title Bar */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-100 bg-zinc-50/80">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-zinc-300" />
            <div className="w-3 h-3 rounded-full bg-zinc-300" />
            <div className="w-3 h-3 rounded-full bg-zinc-300" />
          </div>
          <span className="text-[11px] text-zinc-400 font-mono ml-2">Terminal</span>
        </div>

        {/* Terminal Content */}
        <div className="bg-zinc-950 p-5 min-h-[320px]" key={siteIndex}>
          {/* Command */}
          <div className="font-mono text-[13px] leading-relaxed">
            <span className="text-zinc-500">$ </span>
            <span className="text-emerald-400">webpeel</span>
            <span className="text-zinc-400"> &quot;</span>
            <span className="text-amber-300">
              {phase === 'typing' ? (
                <TypeWriter
                  text={site.url}
                  speed={35}
                  onDone={handleTypeDone}
                />
              ) : (
                site.url
              )}
            </span>
            <span className="text-zinc-400">&quot;</span>
          </div>

          {/* Fetching state */}
          {phase !== 'typing' && (
            <div className="mt-4 animate-fade-in">
              <div className="text-[12px] text-zinc-500 font-mono">
                <span className="text-violet-400">⟳</span> Fetching...
              </div>
            </div>
          )}

          {/* Result */}
          {phase === 'result' && (
            <div className="mt-3 animate-float-up">
              <div className="flex items-center gap-2 text-[12px] font-mono mb-3">
                <span className="text-emerald-400">✓</span>
                <span className="text-zinc-400">Done in {site.time}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${site.modeColor}`}>
                  {site.mode}
                </span>
              </div>
              <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-4">
                <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-2 font-mono">Markdown Output</div>
                <pre className="text-[12px] text-zinc-300 whitespace-pre-wrap leading-[1.6] font-mono">
                  {site.markdown}
                </pre>
              </div>
            </div>
          )}

          {/* Processing dots */}
          {phase === 'fetching' && (
            <div className="flex items-center gap-1.5 mt-3">
              <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          )}
        </div>
      </div>

      {/* Floating Stats Card */}
      <div className="absolute -bottom-6 -right-6 rounded-xl border border-zinc-200 bg-white p-4 shadow-lg animate-float-up" style={{ animationDelay: '0.3s' }}>
        <div className="text-[11px] text-zinc-400 uppercase tracking-wider font-medium mb-2">Avg Response</div>
        <div className="text-2xl font-bold text-zinc-900">
          {site.time}
        </div>
        <div className="text-[11px] text-emerald-600 font-medium mt-0.5">3x faster than alternatives</div>
      </div>

      {/* Floating Badge */}
      <div className="absolute -top-4 -left-4 rounded-xl border border-zinc-200 bg-white px-3 py-2 shadow-lg">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-[12px] font-medium text-zinc-700">API Online</span>
        </div>
      </div>
    </div>
  );
}
