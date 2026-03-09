'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import ReactMarkdown from 'react-markdown';
import {
  ArrowRight,
  Copy,
  Download,
  Share2,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Globe,
  Camera,
  Search,
  BookOpen,
  Database,
  MessageSquare,
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.webpeel.dev';

// ─── Types ───────────────────────────────────────────────────────────────────

type Mode = 'read' | 'extract' | 'search' | 'screenshot' | 'ask';
type AppState = 'idle' | 'loading' | 'success' | 'error';

interface ResultData {
  content?: string;
  title?: string;
  tokens?: number;
  fetchTimeMs?: number;
  method?: string;
  imageUrl?: string;
  results?: SearchResult[];
  answer?: string;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return { emoji: '🌅', text: 'Good morning' };
  if (hour < 18) return { emoji: '☀️', text: 'Good afternoon' };
  return { emoji: '🌙', text: 'Good evening' };
}

function isUrl(input: string): boolean {
  return input.startsWith('http://') || input.startsWith('https://');
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

function downloadMarkdown(content: string, title?: string) {
  const filename = (title || 'webpeel-result').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.md';
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Chip config ─────────────────────────────────────────────────────────────

const CHIPS: { mode: Mode; emoji: string; label: string; placeholder: string }[] = [
  { mode: 'read', emoji: '📖', label: 'Read Article', placeholder: 'Paste a URL to read as clean markdown...' },
  { mode: 'extract', emoji: '📊', label: 'Extract Data', placeholder: 'Paste a URL to extract structured data...' },
  { mode: 'search', emoji: '🔍', label: 'Search Web', placeholder: 'Type anything to search the web...' },
  { mode: 'screenshot', emoji: '📸', label: 'Screenshot', placeholder: 'Paste a URL to capture a screenshot...' },
  { mode: 'ask', emoji: '❓', label: 'Ask a Question', placeholder: 'Paste a URL, then ask a question about it...' },
];

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function LoadingSkeleton({ url }: { url: string }) {
  return (
    <div className="w-full max-w-2xl mx-auto mt-6 animate-pulse">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 rounded-full bg-[#5865F2] animate-pulse" />
          <span className="text-sm text-zinc-400">
            Reading <span className="text-zinc-300 font-mono text-xs">{url.length > 60 ? url.slice(0, 60) + '…' : url}</span>
          </span>
        </div>
        <div className="space-y-3">
          <div className="h-4 bg-zinc-800 rounded w-3/4" />
          <div className="h-4 bg-zinc-800 rounded w-full" />
          <div className="h-4 bg-zinc-800 rounded w-5/6" />
          <div className="h-4 bg-zinc-800 rounded w-2/3" />
          <div className="h-4 bg-zinc-800 rounded w-full" />
          <div className="h-4 bg-zinc-800 rounded w-4/5" />
        </div>
      </div>
    </div>
  );
}

// ─── Result card ─────────────────────────────────────────────────────────────

function ResultCard({
  result,
  mode,
  query,
  onReset,
}: {
  result: ResultData;
  mode: Mode;
  query: string;
  onReset: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const text = result.content || result.answer || '';
    copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    downloadMarkdown(result.content || result.answer || '', result.title);
  };

  const handleShare = () => {
    const shareUrl = `${API_URL}/v1/fetch?url=${encodeURIComponent(query)}&format=markdown`;
    copyToClipboard(shareUrl);
  };

  return (
    <div
      className="w-full max-w-2xl mx-auto mt-6"
      style={{
        opacity: 1,
        transform: 'translateY(0)',
        transition: 'opacity 0.3s ease, transform 0.3s ease',
      }}
    >
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
        {/* Metadata bar */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-zinc-800 bg-zinc-900/40 flex-wrap">
          {result.title && (
            <span className="text-sm font-medium text-zinc-200 truncate flex-1 min-w-0">{result.title}</span>
          )}
          <div className="flex items-center gap-3 text-xs text-zinc-500 shrink-0 ml-auto">
            {result.tokens != null && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#5865F2] inline-block" />
                {result.tokens.toLocaleString()} tokens
              </span>
            )}
            {result.fetchTimeMs != null && (
              <span>{result.fetchTimeMs}ms</span>
            )}
            {result.method && (
              <span className="px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 capitalize">
                {result.method}
              </span>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="p-5 max-h-[60vh] overflow-y-auto">
          {/* Screenshot mode */}
          {mode === 'screenshot' && result.imageUrl && (
            <img
              src={result.imageUrl}
              alt="Screenshot"
              className="w-full rounded-lg border border-zinc-700"
            />
          )}

          {/* Search results mode */}
          {mode === 'search' && result.results && (
            <div className="space-y-4">
              {result.results.map((r, i) => (
                <div key={i} className="group">
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-2 hover:opacity-80 transition-opacity"
                  >
                    <Globe className="h-4 w-4 text-zinc-500 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-[#818CF8] group-hover:underline">{r.title}</p>
                      <p className="text-xs text-zinc-500 mt-0.5 break-all">{r.url}</p>
                      <p className="text-sm text-zinc-300 mt-1">{r.snippet}</p>
                    </div>
                  </a>
                  {i < result.results!.length - 1 && (
                    <div className="mt-4 border-t border-zinc-800" />
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Ask / Read / Extract markdown mode */}
          {(mode === 'read' || mode === 'extract' || mode === 'ask') && (result.content || result.answer) && (
            <div className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown
                components={{
                  pre: ({ children }) => (
                    <pre className="bg-zinc-800 border border-zinc-700 rounded-lg p-4 overflow-x-auto text-xs">
                      {children}
                    </pre>
                  ),
                  code: ({ children, className }) => {
                    const isInline = !className;
                    return isInline ? (
                      <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-[#818CF8] text-xs font-mono">
                        {children}
                      </code>
                    ) : (
                      <code className="font-mono text-zinc-200">{children}</code>
                    );
                  },
                  a: ({ href, children }) => (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#818CF8] hover:underline"
                    >
                      {children}
                    </a>
                  ),
                  h1: ({ children }) => <h1 className="text-xl font-bold text-zinc-100 mt-6 mb-3">{children}</h1>,
                  h2: ({ children }) => <h2 className="text-lg font-semibold text-zinc-100 mt-5 mb-2">{children}</h2>,
                  h3: ({ children }) => <h3 className="text-base font-semibold text-zinc-200 mt-4 mb-2">{children}</h3>,
                  p: ({ children }) => <p className="text-zinc-300 leading-relaxed mb-3">{children}</p>,
                  ul: ({ children }) => <ul className="text-zinc-300 list-disc list-inside space-y-1 mb-3">{children}</ul>,
                  ol: ({ children }) => <ol className="text-zinc-300 list-decimal list-inside space-y-1 mb-3">{children}</ol>,
                  li: ({ children }) => <li className="text-zinc-300">{children}</li>,
                  blockquote: ({ children }) => (
                    <blockquote className="border-l-2 border-[#5865F2] pl-4 my-3 text-zinc-400 italic">
                      {children}
                    </blockquote>
                  ),
                  hr: () => <hr className="border-zinc-700 my-4" />,
                }}
              >
                {result.content || result.answer || ''}
              </ReactMarkdown>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 px-5 py-3 border-t border-zinc-800 bg-zinc-900/40">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-all"
          >
            {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied!' : 'Copy'}
          </button>

          {(mode === 'read' || mode === 'ask' || mode === 'extract') && (
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-all"
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </button>
          )}

          <button
            onClick={handleShare}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-all"
          >
            <Share2 className="h-3.5 w-3.5" />
            Share link
          </button>

          <button
            onClick={onReset}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-all ml-auto"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            New
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ReadPage() {
  const { data: session } = useSession();
  const token = (session as any)?.apiToken as string | undefined;

  const [input, setInput] = useState('');
  const [mode, setMode] = useState<Mode>('read');
  const [askQuestion, setAskQuestion] = useState('');
  const [appState, setAppState] = useState<AppState>('idle');
  const [result, setResult] = useState<ResultData | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const greeting = getGreeting();

  const userName =
    session?.user?.name?.split(' ')[0] ||
    session?.user?.email?.split('@')[0] ||
    'there';

  // Auto-detect mode when typing
  useEffect(() => {
    if (isUrl(input.trim())) {
      if (mode === 'search') setMode('read');
    } else if (input.trim() && !isUrl(input.trim())) {
      if (mode === 'read' || mode === 'extract' || mode === 'screenshot') {
        setMode('search');
      }
    }
  }, [input]);

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
  };

  const currentChip = CHIPS.find((c) => c.mode === mode) || CHIPS[0];

  const handleSubmit = useCallback(async () => {
    const query = input.trim();
    if (!query) return;

    setAppState('loading');
    setSubmittedQuery(query);
    setResult(null);
    setErrorMsg('');

    try {
      let data: ResultData = {};
      const headers: Record<string, string> = token
        ? { Authorization: `Bearer ${token}` }
        : {};

      const effectiveMode = isUrl(query) ? (mode === 'search' ? 'read' : mode) : 'search';

      if (effectiveMode === 'search' || !isUrl(query)) {
        const res = await fetch(
          `${API_URL}/v1/search?q=${encodeURIComponent(query)}`,
          { headers }
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || json.message || 'Search failed');
        // Normalize search results
        const rawResults = json.results || json.data || [];
        data = {
          results: rawResults.map((r: any) => ({
            title: r.title || r.name || 'Untitled',
            url: r.url || r.link || '#',
            snippet: r.snippet || r.description || r.body || '',
          })),
          fetchTimeMs: json.fetchTimeMs,
          method: 'search',
        };
        setMode('search');

      } else if (effectiveMode === 'screenshot') {
        const res = await fetch(
          `${API_URL}/v1/screenshot?url=${encodeURIComponent(query)}`,
          { headers }
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || json.message || 'Screenshot failed');
        data = {
          imageUrl: json.screenshotUrl || json.url || json.screenshot,
          title: json.title || query,
          fetchTimeMs: json.fetchTimeMs,
          method: 'screenshot',
        };

      } else if (effectiveMode === 'ask') {
        const question = askQuestion.trim() || 'Summarize this page';
        const res = await fetch(`${API_URL}/v1/ask`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: query, question }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || json.message || 'Ask failed');
        data = {
          answer: json.answer || json.content || json.result || JSON.stringify(json),
          title: json.title || query,
          tokens: json.tokens,
          fetchTimeMs: json.fetchTimeMs,
          method: 'ask',
        };

      } else {
        // read or extract
        const format = effectiveMode === 'extract' ? 'json' : 'markdown';
        const res = await fetch(
          `${API_URL}/v1/fetch?url=${encodeURIComponent(query)}&format=${format}`,
          { headers }
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || json.message || 'Fetch failed');
        const rawContent = json.content ?? json.markdown ?? json.text ?? json.data;
        data = {
          content: typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent, null, 2),
          title: json.title,
          tokens: json.tokens,
          fetchTimeMs: json.fetchTimeMs,
          method: json.mode || effectiveMode,
        };
      }

      setResult(data);
      setAppState('success');

      // Notify sidebar to refresh usage
      window.dispatchEvent(new Event('webpeel:fetch-completed'));
    } catch (err: any) {
      setErrorMsg(err.message || 'Something went wrong. Please try again.');
      setAppState('error');
    }
  }, [input, mode, askQuestion, token]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleReset = () => {
    setAppState('idle');
    setResult(null);
    setInput('');
    setAskQuestion('');
    setErrorMsg('');
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  const isIdle = appState === 'idle';
  const isLoading = appState === 'loading';
  const isSuccess = appState === 'success';
  const isError = appState === 'error';

  return (
    <div className="flex flex-col min-h-full">
      {/* Center content vertically when idle */}
      <div
        className={`flex flex-col items-center px-4 transition-all duration-300 ${
          isIdle ? 'justify-center flex-1' : 'pt-10 pb-8'
        }`}
      >
        {/* Greeting */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-light text-zinc-100 tracking-tight">
            <span className="mr-3 text-3xl">{greeting.emoji}</span>
            {greeting.text},{' '}
            <span className="font-normal text-zinc-300">{userName}</span>
          </h1>
          {isIdle && (
            <p className="mt-2 text-sm text-zinc-500">
              Paste a URL or type a search query to get started
            </p>
          )}
        </div>

        {/* Input box */}
        <div className="w-full max-w-2xl">
          <div className="relative rounded-2xl border border-zinc-800 bg-zinc-900/60 focus-within:border-zinc-600 focus-within:ring-1 focus-within:ring-zinc-700 transition-all shadow-lg shadow-black/20">
            <div className="flex items-start gap-3 p-4">
              <textarea
                ref={inputRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={currentChip.placeholder}
                disabled={isLoading}
                rows={1}
                className="flex-1 resize-none bg-transparent text-zinc-100 placeholder-zinc-500 text-sm leading-relaxed outline-none min-h-[28px] max-h-[200px] overflow-y-auto disabled:opacity-50"
                style={{ height: '28px' }}
              />
              <button
                onClick={handleSubmit}
                disabled={isLoading || !input.trim()}
                className="shrink-0 flex items-center justify-center w-9 h-9 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-95"
                aria-label="Submit"
              >
                {isLoading ? (
                  <RefreshCw className="h-4 w-4 text-white animate-spin" />
                ) : (
                  <ArrowRight className="h-4 w-4 text-white" />
                )}
              </button>
            </div>

            {/* Ask mode: question input */}
            {mode === 'ask' && (
              <div className="px-4 pb-4 pt-0">
                <div className="border-t border-zinc-800 pt-3">
                  <input
                    type="text"
                    value={askQuestion}
                    onChange={(e) => setAskQuestion(e.target.value)}
                    placeholder="What would you like to know about this page?"
                    className="w-full bg-transparent text-zinc-100 placeholder-zinc-600 text-sm outline-none"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Quick action chips */}
          <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
            {CHIPS.map((chip) => (
              <button
                key={chip.mode}
                onClick={() => setMode(chip.mode)}
                disabled={isLoading}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium border transition-all disabled:opacity-50 ${
                  mode === chip.mode
                    ? 'bg-zinc-700 border-zinc-600 text-zinc-100 shadow-sm'
                    : 'bg-zinc-800/50 border-zinc-700/50 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 hover:border-zinc-600'
                }`}
              >
                <span>{chip.emoji}</span>
                <span>{chip.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Loading skeleton */}
        {isLoading && <LoadingSkeleton url={submittedQuery} />}

        {/* Error state */}
        {isError && (
          <div className="w-full max-w-2xl mx-auto mt-6">
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-300">Something went wrong</p>
                <p className="text-sm text-red-400/80 mt-1">{errorMsg}</p>
                <button
                  onClick={handleSubmit}
                  className="mt-3 flex items-center gap-1.5 text-xs font-medium text-red-300 hover:text-red-200 transition-colors"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Try again
                </button>
              </div>
              <button
                onClick={handleReset}
                className="text-xs text-red-400/60 hover:text-red-300 transition-colors shrink-0"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {/* Success result */}
        {isSuccess && result && (
          <ResultCard
            result={result}
            mode={mode}
            query={submittedQuery}
            onReset={handleReset}
          />
        )}
      </div>

      {/* Idle hints at the bottom */}
      {isIdle && (
        <div className="flex items-center justify-center gap-6 pb-6 px-4 flex-wrap">
          {[
            { icon: BookOpen, label: 'Any article or blog post' },
            { icon: Database, label: 'Structured data extraction' },
            { icon: Camera, label: 'Visual screenshots' },
            { icon: Search, label: 'Web search' },
            { icon: MessageSquare, label: 'Ask questions about URLs' },
          ].map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-1.5 text-xs text-zinc-600">
              <Icon className="h-3.5 w-3.5" />
              <span>{label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
