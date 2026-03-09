'use client';

import { useState, useRef, useCallback } from 'react';
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
  BookOpen,
  Search,
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.webpeel.dev';

// ─── Types ───────────────────────────────────────────────────────────────────

type DetectedMode = 'read' | 'search' | 'ask';
type AppState = 'idle' | 'loading' | 'success' | 'error';

interface ResultData {
  content?: string;
  title?: string;
  tokens?: number;
  fetchTimeMs?: number;
  method?: string;
  results?: SearchResult[];
  answer?: string;
  detectedMode?: DetectedMode;
  question?: string;
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

/** Detect intent from user input — URL only, URL+text, or plain text */
function detectIntent(input: string): { mode: DetectedMode; url?: string; question?: string } {
  const lines = input.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  const urlLine = lines.find((l) => /^https?:\/\//i.test(l));
  const textLines = lines.filter((l) => !/^https?:\/\//i.test(l));
  const question = textLines.join(' ').trim();

  if (urlLine && question) {
    return { mode: 'ask', url: urlLine, question };
  }
  if (urlLine && !question) {
    return { mode: 'read', url: urlLine };
  }
  return { mode: 'search', question: input.trim() };
}

/** Strip JSON/HTML artifacts that leak into markdown content */
function sanitizeContent(raw: string): string {
  return raw
    // Strip raw HTML blocks (tables, divs, spans with attributes)
    .replace(/<table[\s\S]*?<\/table>/gi, '')
    // Strip remaining HTML tags with attributes (leaked from converter)
    .replace(/<[a-z][a-z0-9]*\s[^>]*>/gi, '')
    .replace(/<\/[a-z][a-z0-9]*>/gi, '')
    // Strip self-closing tags like <img ... /> <link ... />
    .replace(/<(?:img|link|br|hr|input|meta)[^>]*\/?>/gi, '')
    // Remove \n"}">" style artifacts
    .replace(/\\n["{}>\s]+/g, '\n')
    .replace(/\\n["\s}]*>/g, '')
    .replace(/^["\s]*}["\s]*>[\s]*$/gm, '')
    .replace(/["}\s]{0,3}>/g, (m) =>
      m.trim().length <= 3 && /["}\s]/.test(m) ? '' : m
    )
    // Remove Wikipedia image badge lines (broken after tag stripping)
    .replace(/^\[?\!\[.*?\]\(\/wiki(?:pedia)?\/.*?\).*$/gm, '')
    // Remove empty markdown links left after stripping
    .replace(/\[?\]\([^)]*\)/g, '')
    // Clean up multiple blank lines
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── Mode badge ───────────────────────────────────────────────────────────────

const MODE_BADGES: Record<DetectedMode, { emoji: string; label: string }> = {
  read:   { emoji: '📖', label: 'Read' },
  search: { emoji: '🔍', label: 'Search' },
  ask:    { emoji: '❓', label: 'Q&A' },
};

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function LoadingSkeleton({ query }: { query: string }) {
  return (
    <div className="w-full max-w-2xl mx-auto mt-6 animate-pulse">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 rounded-full bg-[#5865F2] animate-pulse" />
          <span className="text-sm text-zinc-400">
            Processing{' '}
            <span className="text-zinc-300 font-mono text-xs">
              {query.length > 60 ? query.slice(0, 60) + '…' : query}
            </span>
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

// ─── Search results component ─────────────────────────────────────────────────

function SearchResults({ results }: { results: SearchResult[] }) {
  return (
    <div className="space-y-3">
      {results.map((r, i) => (
        <a
          key={i}
          href={r.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block p-4 rounded-xl bg-zinc-800/40 border border-zinc-800 hover:bg-zinc-800/60 transition-all"
        >
          <div className="text-sm font-medium text-[#818CF8] hover:underline line-clamp-1">{r.title}</div>
          <div className="text-xs text-zinc-500 mt-1 truncate">{r.url}</div>
          {r.snippet && (
            <div className="text-sm text-zinc-400 mt-2 line-clamp-2">{r.snippet}</div>
          )}
        </a>
      ))}
    </div>
  );
}

// ─── Result card ─────────────────────────────────────────────────────────────

function ResultCard({
  result,
  query,
  onReset,
}: {
  result: ResultData;
  query: string;
  onReset: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const detectedMode = result.detectedMode || 'read';
  const badge = MODE_BADGES[detectedMode];

  const textContent = result.content || result.answer || '';

  const handleCopy = () => {
    copyToClipboard(textContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    downloadMarkdown(textContent, result.title);
  };

  const handleShare = () => {
    const shareUrl = `${API_URL}/v1/fetch?url=${encodeURIComponent(query)}&format=markdown`;
    copyToClipboard(shareUrl);
  };

  // Build title bar label
  const titleLabel = (() => {
    if (detectedMode === 'search') return `Search: ${query}`;
    if (detectedMode === 'ask' && result.title) return `${result.title} — Q&A`;
    return result.title || query;
  })();

  // Count search results
  const resultCount = result.results?.length;

  return (
    <div
      className="w-full max-w-2xl mx-auto mt-6"
      style={{ opacity: 1, transform: 'translateY(0)', transition: 'opacity 0.3s ease, transform 0.3s ease' }}
    >
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
        {/* Metadata bar */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-zinc-800 bg-zinc-900/40 flex-wrap">
          <span className="text-sm font-medium text-zinc-200 truncate flex-1 min-w-0">{titleLabel}</span>
          <div className="flex items-center gap-2 text-xs text-zinc-500 shrink-0 ml-auto">
            {resultCount != null && (
              <span>{resultCount} results</span>
            )}
            {result.tokens != null && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#5865F2] inline-block" />
                {result.tokens.toLocaleString()} tokens
              </span>
            )}
            {result.fetchTimeMs != null && (
              <span>{result.fetchTimeMs}ms</span>
            )}
            {/* Mode badge */}
            <span className="px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-400">
              {badge.emoji} {badge.label}
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="p-5 max-h-[60vh] overflow-y-auto">
          {/* Search results */}
          {detectedMode === 'search' && result.results && (
            <SearchResults results={result.results} />
          )}

          {/* Ask mode: question box + answer */}
          {detectedMode === 'ask' && (
            <div className="space-y-4">
              {result.question && (
                <div className="p-3 rounded-xl bg-[#5865F2]/10 border border-[#5865F2]/20">
                  <p className="text-xs text-zinc-500 mb-1 font-medium uppercase tracking-wider">Your question</p>
                  <p className="text-sm text-zinc-200">{result.question}</p>
                </div>
              )}
              <div className="prose prose-invert prose-sm max-w-none">
                <ReactMarkdown
                  components={{
                    pre: ({ children }) => (
                      <pre className="bg-zinc-800 border border-zinc-700 rounded-lg p-4 overflow-x-auto text-xs">{children}</pre>
                    ),
                    code: ({ children, className }) => {
                      const isInline = !className;
                      return isInline ? (
                        <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-[#818CF8] text-xs font-mono">{children}</code>
                      ) : (
                        <code className="font-mono text-zinc-200">{children}</code>
                      );
                    },
                    a: ({ href, children }) => (
                      <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#818CF8] hover:underline">{children}</a>
                    ),
                    h1: ({ children }) => <h1 className="text-xl font-bold text-zinc-100 mt-6 mb-3">{children}</h1>,
                    h2: ({ children }) => <h2 className="text-lg font-semibold text-zinc-100 mt-5 mb-2">{children}</h2>,
                    h3: ({ children }) => <h3 className="text-base font-semibold text-zinc-200 mt-4 mb-2">{children}</h3>,
                    p: ({ children }) => <p className="text-zinc-300 leading-relaxed mb-3">{children}</p>,
                    ul: ({ children }) => <ul className="text-zinc-300 list-disc list-inside space-y-1 mb-3">{children}</ul>,
                    ol: ({ children }) => <ol className="text-zinc-300 list-decimal list-inside space-y-1 mb-3">{children}</ol>,
                    li: ({ children }) => <li className="text-zinc-300">{children}</li>,
                    blockquote: ({ children }) => (
                      <blockquote className="border-l-2 border-[#5865F2] pl-4 my-3 text-zinc-400 italic">{children}</blockquote>
                    ),
                    hr: () => <hr className="border-zinc-700 my-4" />,
                  }}
                >
                  {sanitizeContent(textContent)}
                </ReactMarkdown>
              </div>
            </div>
          )}

          {/* Read mode: plain markdown */}
          {detectedMode === 'read' && textContent && (
            <div className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown
                components={{
                  pre: ({ children }) => (
                    <pre className="bg-zinc-800 border border-zinc-700 rounded-lg p-4 overflow-x-auto text-xs">{children}</pre>
                  ),
                  code: ({ children, className }) => {
                    const isInline = !className;
                    return isInline ? (
                      <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-[#818CF8] text-xs font-mono">{children}</code>
                    ) : (
                      <code className="font-mono text-zinc-200">{children}</code>
                    );
                  },
                  a: ({ href, children }) => (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#818CF8] hover:underline">{children}</a>
                  ),
                  h1: ({ children }) => <h1 className="text-xl font-bold text-zinc-100 mt-6 mb-3">{children}</h1>,
                  h2: ({ children }) => <h2 className="text-lg font-semibold text-zinc-100 mt-5 mb-2">{children}</h2>,
                  h3: ({ children }) => <h3 className="text-base font-semibold text-zinc-200 mt-4 mb-2">{children}</h3>,
                  p: ({ children }) => <p className="text-zinc-300 leading-relaxed mb-3">{children}</p>,
                  ul: ({ children }) => <ul className="text-zinc-300 list-disc list-inside space-y-1 mb-3">{children}</ul>,
                  ol: ({ children }) => <ol className="text-zinc-300 list-decimal list-inside space-y-1 mb-3">{children}</ol>,
                  li: ({ children }) => <li className="text-zinc-300">{children}</li>,
                  blockquote: ({ children }) => (
                    <blockquote className="border-l-2 border-[#5865F2] pl-4 my-3 text-zinc-400 italic">{children}</blockquote>
                  ),
                  hr: () => <hr className="border-zinc-700 my-4" />,
                }}
              >
                {sanitizeContent(textContent)}
              </ReactMarkdown>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 px-5 py-3 border-t border-zinc-800 bg-zinc-900/40">
          {detectedMode !== 'search' && (
            <>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-all"
              >
                {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <button
                onClick={handleDownload}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-all"
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </button>
              <button
                onClick={handleShare}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-all"
              >
                <Share2 className="h-3.5 w-3.5" />
                Share link
              </button>
            </>
          )}
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

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
  };

  const handleSubmit = useCallback(async () => {
    const raw = input.trim();
    if (!raw) return;

    const intent = detectIntent(raw);
    setAppState('loading');
    setSubmittedQuery(raw);
    setResult(null);
    setErrorMsg('');

    try {
      let data: ResultData = { detectedMode: intent.mode };
      const headers: Record<string, string> = token
        ? { Authorization: `Bearer ${token}` }
        : {};

      if (intent.mode === 'search') {
        // ── Search mode ─────────────────────────────────────────────────────
        const res = await fetch(
          `${API_URL}/v1/search?q=${encodeURIComponent(intent.question || raw)}`,
          { headers }
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || json.message || 'Search failed');
        const rawResults = json.results || json.data || [];
        data = {
          detectedMode: 'search',
          results: rawResults.map((r: any) => ({
            title: r.title || r.name || 'Untitled',
            url: r.url || r.link || '#',
            snippet: r.snippet || r.description || r.body || '',
          })),
          fetchTimeMs: json.fetchTimeMs,
        };

      } else if (intent.mode === 'ask') {
        // ── Ask mode — fetch page with question param ────────────────────────
        // /v1/fetch supports ?question= which runs quickAnswer() on the page content
        const url = new URL(`${API_URL}/v1/fetch`);
        url.searchParams.set('url', intent.url!);
        url.searchParams.set('format', 'markdown');
        url.searchParams.set('question', intent.question!);

        const res = await fetch(url.toString(), { headers });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || json.message || 'Fetch failed');

        const pageContent = json.content ?? json.markdown ?? json.text ?? '';
        const rawAnswer = json.answer;

        // Build human-readable content — NEVER show raw JSON
        let displayContent: string;
        if (rawAnswer && typeof rawAnswer === 'string' && rawAnswer.trim()) {
          // Got a direct answer from quickAnswer
          displayContent = rawAnswer;
        } else {
          // No direct answer — show page content with question as header
          const pageText = typeof pageContent === 'string' ? pageContent : JSON.stringify(pageContent, null, 2);
          displayContent = `### Your question: ${intent.question}\n\nHere's what we found on the page:\n\n${pageText}`;
        }

        data = {
          detectedMode: 'ask',
          answer: displayContent,
          title: json.title,
          tokens: json.tokens,
          fetchTimeMs: json.fetchTimeMs,
          question: intent.question,
        };

      } else {
        // ── Read mode — fetch page as markdown ───────────────────────────────
        const res = await fetch(
          `${API_URL}/v1/fetch?url=${encodeURIComponent(intent.url!)}&format=markdown`,
          { headers }
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || json.message || 'Fetch failed');
        const rawContent = json.content ?? json.markdown ?? json.text ?? json.data;
        data = {
          detectedMode: 'read',
          content: typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent, null, 2),
          title: json.title,
          tokens: json.tokens,
          fetchTimeMs: json.fetchTimeMs,
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
  }, [input, token]);

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

        {/* Unified input */}
        <div className="w-full max-w-2xl">
          <div className="relative rounded-2xl border border-zinc-800 bg-zinc-900/60 focus-within:border-zinc-600 focus-within:ring-1 focus-within:ring-zinc-700 transition-all shadow-lg shadow-black/20">
            <div className="flex items-start gap-3 p-4">
              <textarea
                ref={inputRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Paste a URL, ask a question, or search anything..."
                disabled={isLoading}
                rows={2}
                className="flex-1 resize-none bg-transparent text-zinc-100 placeholder-zinc-500 text-sm leading-relaxed outline-none min-h-[44px] max-h-[200px] overflow-y-auto disabled:opacity-50"
                style={{ height: '44px' }}
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
          </div>

          {/* Hint text */}
          <p className="text-center text-xs text-zinc-500 mt-3">
            Try: paste a URL to read&nbsp;•&nbsp;add a question on the next line for Q&amp;A&nbsp;•&nbsp;or just type to search
          </p>
        </div>

        {/* Loading skeleton */}
        {isLoading && <LoadingSkeleton query={submittedQuery} />}

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
            { icon: Globe, label: 'YouTube transcripts' },
            { icon: Search, label: 'Web search' },
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
