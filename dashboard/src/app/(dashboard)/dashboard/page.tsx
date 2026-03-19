'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
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
  Clock,
  ExternalLink,
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.webpeel.dev';

// ─── Types ───────────────────────────────────────────────────────────────────

type DetectedMode = 'read' | 'search' | 'ask';
type AppState = 'idle' | 'loading' | 'success' | 'error';
type SmartResultType = 'cars' | 'flights' | 'hotels' | 'rental' | 'restaurants' | 'general';

interface Source {
  url: string;
  title?: string;
  domain?: string;
  authority?: 'Official' | 'Verified' | 'General';
}

interface SmartResult {
  type: SmartResultType;
  source: string;
  sourceUrl: string;
  content: string;
  title?: string;
  domainData?: any;
  structured?: any;
  results?: any[];
  tokens: number;
  fetchTimeMs: number;
  loadingMessage?: string;
}

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
  videoId?: string;
  channel?: string;
  duration?: string;
  viewCount?: string;
  publishDate?: string;
  sources?: Source[];
  // Smart search result
  smartResult?: SmartResult;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  // Rich result fields (populated via progressive enrichment)
  content?: string;      // First ~200 words of extracted content
  wordCount?: number;    // Total word count from extraction
  method?: string;       // How it was fetched (domain-api, simple, stealth, etc.)
  fetchTimeMs?: number;  // How long the fetch took
  loading?: boolean;     // True while fetching content
  domain?: string;       // Extracted domain (e.g. "wikipedia.org")
  rank?: number;         // Credibility rank (1 = most trustworthy)
  credibility?: {
    tier: 'official' | 'verified' | 'general';
    stars: number;
    label: string;
  };
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

/** Strip JSON/HTML artifacts + music markers from transcript content */
function sanitizeContent(raw: string): string {
  return raw
    // Strip music note markers (YouTube transcripts)
    .replace(/\[(?:🎵|♪)+\]/g, '')
    .replace(/\[(?:🎵🎵🎵|♪♪♪|Music|Applause|Laughter|Cheering)\]/gi, '')
    .replace(/🎵/g, '')
    .replace(/♪/g, '')
    // Strip raw HTML blocks (tables, divs, spans with attributes)
    .replace(/<table[\s\S]*?<\/table>/gi, '')
    // Strip remaining HTML tags with attributes
    .replace(/<[a-z][a-z0-9]*\s[^>]*>/gi, '')
    .replace(/<\/[a-z][a-z0-9]*>/gi, '')
    // Strip self-closing tags
    .replace(/<(?:img|link|br|hr|input|meta)[^>]*\/?>/gi, '')
    // Strip any remaining angle-bracket fragments with quotes
    .replace(/["'{}]\s*>/g, '')
    .replace(/<[^>]{0,3}>/g, '') // tiny broken tags like <> <i>
    // Remove \n"}">" artifacts
    .replace(/\\n["{}>\s]+/g, '\n')
    .replace(/\\n["\s}]*>/g, '')
    .replace(/^["\s]*}["\s]*>[\s]*$/gm, '')
    // Wikipedia image badges
    .replace(/^\[?\!\[.*?\]\(\/wiki(?:pedia)?\/.*?\).*$/gm, '')
    // Empty markdown links
    .replace(/\[?\]\([^)]*\)/g, '')
    // Clean up multiple blank lines
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Extract first 2-3 sentences for TL;DR */
function extractTldr(content: string): string {
  const plain = content
    .replace(/#{1,6}\s+[^\n]+/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/^>\s+/gm, '')
    .replace(/\n+/g, ' ')
    .trim();
  const sentences = plain.match(/[^.!?]+[.!?]+(?:\s|$)/g) || [];
  const tldr = sentences.slice(0, 3).join('').trim();
  return tldr.length > 50 ? tldr : '';
}

/** Count words */
function getWordCount(content: string): number {
  return content.trim().split(/\s+/).filter(Boolean).length;
}

/** Estimated reading time in minutes (200 wpm) */
function getReadingTime(wordCount: number): number {
  return Math.max(1, Math.ceil(wordCount / 200));
}

// ─── Mode badge ───────────────────────────────────────────────────────────────

const MODE_BADGES: Record<DetectedMode, { emoji: string; label: string }> = {
  read:   { emoji: '📖', label: 'Read' },
  search: { emoji: '🔍', label: 'Search' },
  ask:    { emoji: '❓', label: 'Q&A' },
};

// ─── Example prompts ──────────────────────────────────────────────────────────

const EXAMPLE_PROMPTS = [
  { label: 'github.com/facebook/react', url: 'https://github.com/facebook/react', type: 'url' },
  { label: 'en.wikipedia.org/wiki/Mars', url: 'https://en.wikipedia.org/wiki/Mars', type: 'url' },
  { label: 'best AI coding assistants 2025', url: 'best AI coding assistants 2025', type: 'search' },
  { label: '🚗 used Tesla under $30000', url: 'used Tesla under $30000', type: 'search' },
  { label: '🍕 best pizza in Manhattan', url: 'best pizza in Manhattan', type: 'search' },
];

const EXAMPLE_URLS = EXAMPLE_PROMPTS;

// ─── Loading skeleton ─────────────────────────────────────────────────────────

const LOADING_STAGES = [
  { ms: 0,    text: 'Analyzing your request…' },
  { ms: 800,  text: 'Connecting to source…' },
  { ms: 2200, text: 'Extracting content…' },
  { ms: 5000, text: 'Processing with AI…' },
  { ms: 9000, text: 'Almost there…' },
];

function LoadingSkeleton({ query, intentMessage }: { query: string; intentMessage?: string }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => setElapsed(Date.now() - start), 80);
    return () => clearInterval(interval);
  }, []);

  const stage = [...LOADING_STAGES].reverse().find((s) => elapsed >= s.ms) ?? LOADING_STAGES[0];
  const isUrl = /^https?:\/\//i.test(query);
  const shortQuery = query.length > 50 ? query.slice(0, 50) + '…' : query;
  const displayText = intentMessage || stage.text;

  return (
    <div className="w-full max-w-2xl mx-auto mt-6 animate-float-up">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
        {/* Status bar */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-zinc-800/80 bg-zinc-900/40">
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-2 h-2 rounded-full bg-[#5865F2] animate-pulse" />
          </div>
          <span className="text-sm text-zinc-400 truncate flex-1 min-w-0">
            <span className="text-zinc-500 text-xs">{displayText}</span>
            {' '}
            <span className="text-zinc-500 font-mono text-xs">{isUrl ? shortQuery : ''}</span>
          </span>
          <span className="ml-auto text-xs text-zinc-600 tabular-nums font-mono shrink-0">
            {(elapsed / 1000).toFixed(1)}s
          </span>
        </div>

        {/* Shimmer content */}
        <div className="p-5 space-y-4">
          {/* Title skeleton */}
          <div className="shimmer h-5 rounded-lg w-[58%]" />

          {/* Body lines */}
          <div className="space-y-2.5">
            <div className="shimmer h-3.5 rounded-md w-full" />
            <div className="shimmer h-3.5 rounded-md w-[94%]" />
            <div className="shimmer h-3.5 rounded-md w-[87%]" />
          </div>

          {/* Paragraph break */}
          <div className="space-y-2.5 pt-1">
            <div className="shimmer h-3.5 rounded-md w-full opacity-70" />
            <div className="shimmer h-3.5 rounded-md w-[90%] opacity-70" />
            <div className="shimmer h-3.5 rounded-md w-[82%] opacity-70" />
            <div className="shimmer h-3.5 rounded-md w-[76%] opacity-70" />
          </div>

          {/* Sub-section */}
          <div className="space-y-2 pt-1">
            <div className="shimmer h-4 rounded-md w-[40%] opacity-50" />
            <div className="shimmer h-3 rounded-md w-full opacity-40" />
            <div className="shimmer h-3 rounded-md w-[70%] opacity-40" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── TL;DR card ───────────────────────────────────────────────────────────────

function TldrCard({ content }: { content: string }) {
  const tldr = extractTldr(content);
  if (!tldr) return null;

  return (
    <div className="mb-5 p-4 rounded-xl bg-[#5865F2]/10 border border-[#5865F2]/25">
      <div className="flex items-start gap-3">
        <span className="text-[10px] font-bold text-[#818CF8] uppercase tracking-widest shrink-0 mt-1 bg-[#5865F2]/20 px-2 py-0.5 rounded-full">
          TL;DR
        </span>
        <p className="text-sm text-zinc-300 leading-relaxed">{tldr}</p>
      </div>
    </div>
  );
}

// ─── Source cards ─────────────────────────────────────────────────────────────

function SourceCards({ sources }: { sources: Source[] }) {
  if (!sources.length) return null;

  const authorityStyles: Record<string, string> = {
    Official: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
    Verified: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
    General: 'bg-zinc-800 text-zinc-500 border-zinc-700',
  };

  return (
    <div className="mb-4">
      <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest mb-2">Sources</p>
      <div className="flex flex-wrap gap-2">
        {sources.map((src, i) => {
          const domain = src.domain || (() => {
            try { return new URL(src.url).hostname.replace(/^www\./, ''); }
            catch { return src.url; }
          })();
          const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
          return (
            <a
              key={i}
              href={src.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-800/60 border border-zinc-700 hover:bg-zinc-800 hover:border-zinc-600 transition-all group max-w-[220px]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={faviconUrl}
                alt=""
                className="w-3.5 h-3.5 rounded-sm shrink-0 opacity-75"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <span className="text-xs text-zinc-400 group-hover:text-zinc-300 truncate transition-colors flex-1 min-w-0">
                {src.title ? (src.title.length > 28 ? src.title.slice(0, 28) + '…' : src.title) : domain}
              </span>
              {src.authority && src.authority !== 'General' && (
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full border shrink-0 font-medium ${authorityStyles[src.authority] || authorityStyles.General}`}>
                  {src.authority}
                </span>
              )}
              <ExternalLink className="h-2.5 w-2.5 text-zinc-700 group-hover:text-zinc-500 shrink-0 transition-colors" />
            </a>
          );
        })}
      </div>
    </div>
  );
}

// ─── Search results component ─────────────────────────────────────────────────

function SearchResults({ results, onReadUrl }: { results: SearchResult[]; onReadUrl: (url: string) => void }) {
  const credBadgeStyles: Record<string, string> = {
    official: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    verified: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    general: 'bg-zinc-700/40 text-zinc-500 border-zinc-600/30',
  };
  return (
    <div className="space-y-3">
      {results.map((r, i) => (
        <div key={i} className="p-4 rounded-xl bg-zinc-800/40 border border-zinc-800 hover:bg-zinc-800/60 transition-all">
          {/* Title row with rank, domain badge, and credibility */}
          <div className="flex items-start gap-2 mb-1 flex-wrap">
            {r.rank && (
              <span className="shrink-0 flex items-center justify-center w-5 h-5 rounded-full bg-zinc-700/80 text-zinc-300 text-[10px] font-bold mt-0.5">
                {r.rank}
              </span>
            )}
            {r.domain && (
              <span className="shrink-0 bg-zinc-700/60 text-zinc-400 text-xs px-2 py-0.5 rounded-full mt-0.5">
                {r.domain}
              </span>
            )}
            {r.credibility && (
              <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full border font-medium mt-0.5 ${credBadgeStyles[r.credibility.tier] || credBadgeStyles.general}`}>
                {r.credibility.tier === 'official' ? '★★★ Official' : r.credibility.tier === 'verified' ? '★★ Verified' : '★ General'}
              </span>
            )}
            <a
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-[#818CF8] hover:underline line-clamp-1 flex-1 min-w-0"
            >
              {r.title}
            </a>
          </div>
          <div className="text-xs text-zinc-500 mb-2 truncate">{r.url}</div>

          {/* Content area: loading skeleton, rich content, or snippet fallback */}
          {r.loading ? (
            <div className="space-y-2 mt-2" aria-label="Loading content">
              <div className="bg-zinc-700/40 animate-pulse rounded h-4 w-full" />
              <div className="bg-zinc-700/40 animate-pulse rounded h-4 w-4/5" />
              <div className="bg-zinc-700/40 animate-pulse rounded h-4 w-3/5" />
            </div>
          ) : r.content ? (
            <div>
              <p className="text-zinc-300 text-sm line-clamp-4 leading-relaxed">
                {r.content}
                {r.content.length >= 1500 ? '…' : ''}
              </p>
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-zinc-600">
                  {r.wordCount != null ? `${r.wordCount.toLocaleString()} words` : ''}
                  {r.wordCount != null && r.method ? ' · ' : ''}
                  {r.method ?? ''}
                </span>
                {r.fetchTimeMs != null && (
                  <span className="text-xs text-zinc-600">{r.fetchTimeMs}ms</span>
                )}
              </div>
            </div>
          ) : r.snippet ? (
            <div className="text-sm text-zinc-400 line-clamp-2">{r.snippet}</div>
          ) : null}

          <button
            onClick={(e) => { e.stopPropagation(); onReadUrl(r.url); }}
            className="mt-2 inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-zinc-400 hover:text-white hover:bg-[#5865F2]/20 border border-zinc-700/50 hover:border-[#5865F2]/50 rounded-lg font-medium transition-all"
          >
            Read full page →
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── Smart Result Cards ────────────────────────────────────────────────────────

const SMART_SOURCE_ICONS: Record<string, string> = {
  cars: '🚗',
  flights: '✈️',
  hotels: '🏨',
  rental: '🔑',
  restaurants: '🍽️',
  general: '🔍',
};

function SmartResultCard({ smartResult }: { smartResult: SmartResult }) {
  const icon = SMART_SOURCE_ICONS[smartResult.type] || '🔍';

  // Try to use structured data first, fall back to parsed domainData listings, then raw content
  const listings: any[] = smartResult.structured?.listings
    || smartResult.domainData?.structured?.listings
    || smartResult.domainData?.listings
    || smartResult.results
    || [];

  return (
    <div className="space-y-3">
      {/* Source attribution */}
      <div className="flex items-center gap-2 text-xs text-zinc-500 pb-1">
        <span>{icon}</span>
        <span>Results from <a href={smartResult.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[#818CF8] hover:underline">{smartResult.source}</a></span>
        <span className="ml-auto text-zinc-600">{smartResult.fetchTimeMs}ms</span>
      </div>

      {/* If we have structured listings, render them as rich cards */}
      {listings.length > 0 ? (
        <div className="space-y-3">
          {listings.slice(0, 10).map((item: any, i: number) => (
            <SmartListingCard key={i} item={item} type={smartResult.type} />
          ))}
        </div>
      ) : (
        /* Fall back to markdown content */
        <div className="prose prose-invert prose-sm max-w-none">
          <ReactMarkdown components={markdownComponents}>
            {smartResult.content || '*No results found. Try a different query.*'}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}

function SmartListingCard({ item, type }: { item: any; type: SmartResultType }) {
  const url = item.url || item.link || item.detailUrl || '#';

  if (type === 'cars') {
    return (
      <div className="p-4 rounded-xl bg-zinc-800/40 border border-zinc-800 hover:bg-zinc-800/60 transition-all">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <a href={url} target="_blank" rel="noopener noreferrer"
              className="text-sm font-medium text-[#818CF8] hover:underline line-clamp-1">
              {item.title || item.name || item.year && `${item.year} ${item.make} ${item.model}` || 'Vehicle listing'}
            </a>
            <div className="flex flex-wrap gap-2 mt-1 text-xs text-zinc-400">
              {item.price && <span className="text-emerald-400 font-medium">{typeof item.price === 'number' ? `$${item.price.toLocaleString()}` : item.price}</span>}
              {item.mileage && <span>{typeof item.mileage === 'number' ? `${item.mileage.toLocaleString()} mi` : item.mileage}</span>}
              {item.year && <span>{item.year}</span>}
              {(item.make || item.model) && <span>{[item.make, item.model].filter(Boolean).join(' ')}</span>}
            </div>
            {item.dealer && <div className="text-xs text-zinc-500 mt-1">📍 {item.dealer}</div>}
          </div>
          {item.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.image} alt={item.title || 'Car'} className="w-20 h-14 object-cover rounded-lg shrink-0 bg-zinc-800" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          )}
        </div>
      </div>
    );
  }

  if (type === 'flights') {
    return (
      <div className="p-4 rounded-xl bg-zinc-800/40 border border-zinc-800 hover:bg-zinc-800/60 transition-all">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="text-center">
              <div className="text-sm font-mono font-bold text-zinc-100">{item.departure || item.departureTime || '—'}</div>
              <div className="text-xs text-zinc-500">{item.origin || item.from || ''}</div>
            </div>
            <div className="text-zinc-600 text-xs text-center">
              <div>✈️</div>
              <div>{item.duration || item.flightDuration || ''}</div>
              {item.stops != null && <div>{item.stops === 0 ? 'Nonstop' : `${item.stops} stop${item.stops > 1 ? 's' : ''}`}</div>}
            </div>
            <div className="text-center">
              <div className="text-sm font-mono font-bold text-zinc-100">{item.arrival || item.arrivalTime || '—'}</div>
              <div className="text-xs text-zinc-500">{item.destination || item.to || ''}</div>
            </div>
          </div>
          <div className="text-right">
            {item.price && <div className="text-emerald-400 font-bold text-sm">{typeof item.price === 'number' ? `$${item.price}` : item.price}</div>}
            {item.airline && <div className="text-xs text-zinc-500">{item.airline}</div>}
            {url !== '#' && (
              <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-[#818CF8] hover:underline mt-1 block">Book →</a>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (type === 'hotels') {
    return (
      <div className="p-4 rounded-xl bg-zinc-800/40 border border-zinc-800 hover:bg-zinc-800/60 transition-all">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <a href={url} target="_blank" rel="noopener noreferrer"
              className="text-sm font-medium text-[#818CF8] hover:underline line-clamp-1">
              {item.name || item.title || 'Hotel'}
            </a>
            <div className="flex flex-wrap gap-2 mt-1 text-xs text-zinc-400">
              {item.price && <span className="text-emerald-400 font-medium">{typeof item.price === 'number' ? `$${item.price}/night` : item.price}</span>}
              {item.rating && <span>⭐ {item.rating}</span>}
              {item.stars && <span>{'★'.repeat(Math.min(5, Math.round(item.stars)))}</span>}
            </div>
            {(item.address || item.location) && <div className="text-xs text-zinc-500 mt-1">📍 {item.address || item.location}</div>}
          </div>
          {item.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.image} alt={item.name || 'Hotel'} className="w-20 h-14 object-cover rounded-lg shrink-0 bg-zinc-800" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          )}
        </div>
      </div>
    );
  }

  if (type === 'rental') {
    return (
      <div className="p-4 rounded-xl bg-zinc-800/40 border border-zinc-800 hover:bg-zinc-800/60 transition-all">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-zinc-200">{item.carType || item.vehicleType || item.name || 'Rental car'}</div>
            <div className="flex flex-wrap gap-2 mt-1 text-xs text-zinc-400">
              {item.price && <span className="text-emerald-400 font-medium">{typeof item.price === 'number' ? `$${item.price}/day` : item.price}</span>}
              {item.company && <span>{item.company}</span>}
              {item.passengers && <span>{item.passengers} passengers</span>}
            </div>
          </div>
          {url !== '#' && (
            <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-[#818CF8] hover:underline shrink-0">Book →</a>
          )}
        </div>
      </div>
    );
  }

  if (type === 'restaurants') {
    return (
      <div className="p-4 rounded-xl bg-zinc-800/40 border border-zinc-800 hover:bg-zinc-800/60 transition-all">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <a href={url} target="_blank" rel="noopener noreferrer"
              className="text-sm font-medium text-[#818CF8] hover:underline line-clamp-1">
              {item.name || item.title || 'Restaurant'}
            </a>
            <div className="flex flex-wrap gap-2 mt-1 text-xs text-zinc-400">
              {item.rating && <span>⭐ {item.rating}</span>}
              {item.reviewCount && <span>({item.reviewCount} reviews)</span>}
              {item.price && <span>{item.price}</span>}
              {item.cuisine && <span>{item.cuisine}</span>}
            </div>
            {(item.address || item.location) && <div className="text-xs text-zinc-500 mt-1">📍 {item.address || item.location}</div>}
          </div>
          {item.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.image} alt={item.name || 'Restaurant'} className="w-16 h-16 object-cover rounded-lg shrink-0 bg-zinc-800" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          )}
        </div>
      </div>
    );
  }

  // General / fallback
  return (
    <div className="p-4 rounded-xl bg-zinc-800/40 border border-zinc-800 hover:bg-zinc-800/60 transition-all">
      <a href={url} target="_blank" rel="noopener noreferrer"
        className="text-sm font-medium text-[#818CF8] hover:underline line-clamp-1">
        {item.title || item.name || url}
      </a>
      {item.snippet && <p className="text-xs text-zinc-400 mt-1 line-clamp-2">{item.snippet}</p>}
    </div>
  );
}

// ─── Shared markdown components ───────────────────────────────────────────────

const markdownComponents = {
  pre: ({ children }: any) => (
    <pre className="bg-zinc-800/90 border border-zinc-700/60 rounded-xl p-4 overflow-x-auto text-xs my-4 shadow-inner">{children}</pre>
  ),
  code: ({ children, className }: any) => {
    const isInline = !className;
    return isInline ? (
      <code className="bg-zinc-800/90 px-1.5 py-0.5 rounded-md text-[#818CF8] text-xs font-mono">{children}</code>
    ) : (
      <code className="font-mono text-zinc-200 text-xs">{children}</code>
    );
  },
  a: ({ href, children }: any) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#818CF8] hover:underline">{children}</a>
  ),
  h1: ({ children }: any) => (
    <h1 className="text-2xl font-bold text-white mt-8 mb-4 pb-3 border-b border-zinc-800 tracking-tight">{children}</h1>
  ),
  h2: ({ children }: any) => (
    <h2 className="text-xl font-semibold text-zinc-100 mt-7 mb-3 pl-3 border-l-2 border-[#5865F2]">{children}</h2>
  ),
  h3: ({ children }: any) => (
    <h3 className="text-base font-semibold text-zinc-200 mt-5 mb-2 pl-3 border-l border-zinc-700">{children}</h3>
  ),
  p: ({ children }: any) => <p className="text-zinc-300 leading-relaxed mb-4">{children}</p>,
  ul: ({ children }: any) => <ul className="text-zinc-300 list-disc list-inside space-y-1.5 mb-4">{children}</ul>,
  ol: ({ children }: any) => <ol className="text-zinc-300 list-decimal list-inside space-y-1.5 mb-4">{children}</ol>,
  li: ({ children }: any) => <li className="text-zinc-300">{children}</li>,
  blockquote: ({ children }: any) => (
    <blockquote className="border-l-2 border-[#5865F2] pl-4 my-4 text-zinc-400 italic bg-zinc-800/20 py-2 pr-3 rounded-r-lg">{children}</blockquote>
  ),
  hr: () => <hr className="border-zinc-800 my-6" />,
  table: ({ children }: any) => (
    <div className="overflow-x-auto my-4 rounded-lg border border-zinc-800">
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }: any) => (
    <th className="text-left px-3 py-2.5 bg-zinc-800/80 border-b border-zinc-700 text-zinc-200 font-semibold text-xs uppercase tracking-wider">{children}</th>
  ),
  td: ({ children }: any) => (
    <td className="px-3 py-2 border-b border-zinc-800/60 text-zinc-400 last:border-b-0">{children}</td>
  ),
};

// ─── Result card ─────────────────────────────────────────────────────────────

function ResultCard({
  result,
  query,
  onReset,
  onReadUrl,
  token,
}: {
  result: ResultData;
  query: string;
  onReset: () => void;
  onReadUrl: (url: string) => void;
  token?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [shareState, setShareState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [shareUrl, setShareUrl] = useState('');
  const [shareUrlCopied, setShareUrlCopied] = useState(false);
  const [shareToast, setShareToast] = useState('');
  const detectedMode = result.detectedMode || 'read';
  const badge = MODE_BADGES[detectedMode];

  const textContent = result.content || result.answer || '';

  // Word count + reading time from actual text
  const cleanedText = textContent ? sanitizeContent(textContent) : '';
  const wordCount = cleanedText ? getWordCount(cleanedText) : 0;
  const readingTime = getReadingTime(wordCount);
  const isLongContent = wordCount > 500;

  const handleCopy = () => {
    copyToClipboard(textContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    downloadMarkdown(textContent, result.title);
  };

  const handleShare = async () => {
    if (shareState === 'done' && shareUrl) {
      copyToClipboard(shareUrl);
      setShareUrlCopied(true);
      setShareToast('Link copied! Expires in 30 days.');
      setTimeout(() => { setShareUrlCopied(false); setShareToast(''); }, 2500);
      return;
    }

    const intentUrl = (() => {
      const lines = query.split('\n').map((l) => l.trim());
      return lines.find((l) => /^https?:\/\//i.test(l)) || '';
    })();
    if (!intentUrl) return;

    setShareState('loading');
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${API_URL}/v1/share`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          url: intentUrl,
          content: textContent || undefined,
          title: result.title || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setShareState('error');
        setShareToast(json.error?.message || 'Share failed');
        setTimeout(() => { setShareState('idle'); setShareToast(''); }, 3000);
        return;
      }
      const url = json.shareUrl as string;
      setShareUrl(url);
      setShareState('done');
      copyToClipboard(url);
      setShareUrlCopied(true);
      setShareToast('Link copied! Expires in 30 days.');
      setTimeout(() => { setShareUrlCopied(false); setShareToast(''); }, 3000);
    } catch {
      setShareState('error');
      setShareToast('Share failed — try again');
      setTimeout(() => { setShareState('idle'); setShareToast(''); }, 3000);
    }
  };

  // Build title bar label
  const titleLabel = (() => {
    if (detectedMode === 'search' && result.smartResult) {
      return `${result.smartResult.source} — ${query}`;
    }
    if (detectedMode === 'search') return query;
    if (detectedMode === 'ask' && result.title) return `${result.title} — Q&A`;
    return result.title || query;
  })();

  const resultCount = result.smartResult
    ? (result.smartResult.structured?.listings?.length
      || result.smartResult.domainData?.structured?.listings?.length
      || result.smartResult.domainData?.listings?.length
      || result.smartResult.results?.length)
    : result.results?.length;

  return (
    <div
      className="w-full max-w-2xl mx-auto mt-6"
      style={{ opacity: 1, transform: 'translateY(0)', transition: 'opacity 0.3s ease, transform 0.3s ease' }}
    >
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
        {/* Metadata bar */}
        <div className="px-3 sm:px-5 py-3 border-b border-zinc-800 bg-zinc-900/40">
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            <span className="text-sm font-medium text-zinc-200 truncate flex-1 min-w-0">{titleLabel}</span>
            <div className="flex items-center gap-2 text-xs text-zinc-500 shrink-0 ml-auto flex-wrap justify-end">
              {resultCount != null && (
                <span>{resultCount} results</span>
              )}
              {/* Word count + reading time */}
              {wordCount > 0 && detectedMode !== 'search' && (
                <span className="flex items-center gap-1 text-zinc-500">
                  <Clock className="h-3 w-3" />
                  {wordCount.toLocaleString()} words · {readingTime} min
                </span>
              )}
              {result.fetchTimeMs != null && (
                <span>{result.fetchTimeMs}ms</span>
              )}
              {/* AI vs BM25 method badge */}
              {result.method && (
                <span className={`px-2 py-0.5 rounded-full border capitalize text-xs ${
                  result.method === 'ai'
                    ? 'bg-purple-500/10 border-purple-500/30 text-purple-400'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-400'
                }`}>
                  {result.method === 'ai' ? '✨ AI' : result.method}
                </span>
              )}
              {/* Mode badge — links to source URL when available */}
              {(() => {
                const sourceUrl = query.split('\n').map(l => l.trim()).find(l => /^https?:\/\//i.test(l));
                return sourceUrl ? (
                  <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-white hover:border-[#5865F2]/50 hover:bg-[#5865F2]/20 transition-all cursor-pointer no-underline">
                    {badge.emoji} {badge.label} ↗
                  </a>
                ) : (
                  <span className="px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-400">
                    {badge.emoji} {badge.label}
                  </span>
                );
              })()}
            </div>
          </div>
          {/* YouTube metadata row */}
          {result.videoId && (result.channel || result.duration || result.viewCount) && (
            <div className="flex items-center gap-3 mt-2 text-xs text-zinc-400 flex-wrap">
              {result.channel && <span><span className="text-zinc-500">Channel:</span> {result.channel}</span>}
              {result.duration && result.duration !== '0:00' && <span><span className="text-zinc-500">Duration:</span> {result.duration}</span>}
              {result.viewCount && (() => {
                const v = parseInt(result.viewCount, 10);
                if (isNaN(v)) return null;
                const formatted = v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
                  : v >= 1_000 ? `${(v / 1_000).toFixed(1).replace(/\.0$/, '')}K`
                  : v.toLocaleString();
                return <span>{formatted} views</span>;
              })()}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="p-3 sm:p-5 max-h-[60vh] overflow-y-auto">
          {/* Smart search results (cars, flights, hotels, rental, restaurants) */}
          {detectedMode === 'search' && result.smartResult && (
            <SmartResultCard smartResult={result.smartResult} />
          )}

          {/* General search results (classic format) */}
          {detectedMode === 'search' && !result.smartResult && result.results && (
            result.results.length > 0 ? (
              <SearchResults results={result.results} onReadUrl={onReadUrl} />
            ) : (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="text-3xl mb-3">🔍</div>
                <p className="text-zinc-300 font-medium mb-1">No results found</p>
                <p className="text-zinc-500 text-sm">Try rephrasing your query or adding more context</p>
              </div>
            )
          )}

          {/* Ask mode: question box + sources + answer */}
          {detectedMode === 'ask' && (
            <div className="space-y-4">
              {result.question && (
                <div className="p-3 rounded-xl bg-[#5865F2]/10 border border-[#5865F2]/20">
                  <p className="text-xs text-zinc-500 mb-1 font-medium uppercase tracking-wider">Your question</p>
                  <p className="text-sm text-zinc-200">{result.question}</p>
                </div>
              )}

              {/* Source cards */}
              {result.sources && result.sources.length > 0 && (
                <SourceCards sources={result.sources} />
              )}

              <div className="prose prose-invert prose-sm max-w-none">
                <ReactMarkdown components={markdownComponents}>
                  {sanitizeContent(result.answer || '')}
                </ReactMarkdown>
              </div>

              {/* Collapsible full page content below AI answer */}
              {result.content && (
                <details className="mt-4 border-t border-zinc-800 pt-4">
                  <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-300 transition-colors select-none">
                    📄 View full page content ({result.tokens?.toLocaleString()} words)
                  </summary>
                  <div className="mt-3 prose prose-invert prose-sm max-w-none">
                    <ReactMarkdown components={markdownComponents}>
                      {sanitizeContent(result.content)}
                    </ReactMarkdown>
                  </div>
                </details>
              )}
            </div>
          )}

          {/* Read mode: TL;DR card + markdown */}
          {detectedMode === 'read' && textContent && (
            <div>
              {isLongContent && <TldrCard content={cleanedText} />}
              <div className="prose prose-invert prose-sm max-w-none">
                <ReactMarkdown components={markdownComponents}>
                  {cleanedText}
                </ReactMarkdown>
              </div>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 sm:gap-2 px-3 sm:px-5 py-3 border-t border-zinc-800 bg-zinc-900/40 flex-wrap">
          {detectedMode !== 'search' && (
            <>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-all"
              >
                {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <button
                onClick={handleDownload}
                className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-all"
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </button>
              {/* Share button — only show when a URL is in the query */}
              {/^https?:\/\//i.test(query.split('\n').find((l) => /^https?:\/\//i.test(l.trim())) || '') && (
                <button
                  onClick={handleShare}
                  disabled={shareState === 'loading'}
                  className={`flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
                    shareState === 'done'
                      ? 'text-emerald-400 hover:text-emerald-300 hover:bg-zinc-800'
                      : shareState === 'error'
                      ? 'text-red-400 hover:text-red-300 hover:bg-zinc-800'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {shareState === 'loading' ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : shareState === 'done' ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <Share2 className="h-3.5 w-3.5" />
                  )}
                  {shareState === 'loading' ? 'Sharing…' : shareState === 'done' ? 'Shared!' : 'Share'}
                </button>
              )}
            </>
          )}
          <button
            onClick={onReset}
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-all ml-auto"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            New
          </button>
        </div>

        {/* Share URL strip */}
        {shareState === 'done' && shareUrl && (
          <div className="px-3 sm:px-5 py-3 border-t border-zinc-800 bg-emerald-500/5 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-emerald-400 shrink-0">🔗 Share link:</span>
            <input
              readOnly
              value={shareUrl}
              className="flex-1 min-w-0 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-200 font-mono outline-none focus:border-emerald-500 transition-colors cursor-pointer"
              onClick={() => { copyToClipboard(shareUrl); setShareUrlCopied(true); setShareToast('Link copied! Expires in 30 days.'); setTimeout(() => { setShareUrlCopied(false); setShareToast(''); }, 2500); }}
            />
            <button
              onClick={() => { copyToClipboard(shareUrl); setShareUrlCopied(true); setShareToast('Link copied! Expires in 30 days.'); setTimeout(() => { setShareUrlCopied(false); setShareToast(''); }, 2500); }}
              className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs font-medium transition-all"
            >
              {shareUrlCopied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {shareUrlCopied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        )}

        {/* Toast notification */}
        {shareToast && shareState !== 'error' && (
          <div className="px-3 sm:px-5 py-2 bg-emerald-500/10 border-t border-emerald-500/20 text-xs text-emerald-400 text-center">
            {shareToast}
          </div>
        )}
        {shareState === 'error' && shareToast && (
          <div className="px-3 sm:px-5 py-2 bg-red-500/10 border-t border-red-500/20 text-xs text-red-400 text-center">
            {shareToast}
          </div>
        )}
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
  const [loadingMessage, setLoadingMessage] = useState<string | undefined>(undefined);

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

  /** Core submit logic — accepts a raw input string so it can be called programmatically */
  const handleSubmitRaw = useCallback(async (raw: string) => {
    if (!raw.trim()) return;

    const intent = detectIntent(raw.trim());
    setAppState('loading');
    setSubmittedQuery(raw.trim());
    setResult(null);
    setErrorMsg('');
    setLoadingMessage(undefined);

    try {
      let data: ResultData = { detectedMode: intent.mode };
      const headers: Record<string, string> = token
        ? { Authorization: `Bearer ${token}` }
        : {};

      if (intent.mode === 'search') {
        // ── Smart Search — intent detection + travel/commerce routing ──────
        // Set intent-aware loading message immediately
        const intentHints: Record<string, string> = {
          car: 'Searching cars on Cars.com…',
          flight: 'Finding flights on Google Flights…',
          hotel: 'Looking up hotels on Google Hotels…',
          rent: 'Searching rental cars on Kayak…',
          restaurant: 'Finding restaurants on Yelp…',
          pizza: 'Finding restaurants on Yelp…',
          food: 'Finding restaurants on Yelp…',
        };
        const q = (intent.question || raw).toLowerCase();
        const hintKey = Object.keys(intentHints).find(k => q.includes(k));
        if (hintKey) setLoadingMessage(intentHints[hintKey]);

        const smartHeaders = { ...headers, 'Content-Type': 'application/json' };
        const res = await fetch(`${API_URL}/v1/search/smart`, {
          method: 'POST',
          headers: smartHeaders,
          body: JSON.stringify({ q: intent.question || raw }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error?.message || json.message || json.error || 'Search failed');

        const smart: SmartResult = json.data;
        const isGeneralSearch = smart.type === 'general';

        if (isGeneralSearch && smart.results) {
          // General fallback: render as classic search results
          const getDomain = (url: string) => {
            try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
          };
          data = {
            detectedMode: 'search',
            results: smart.results.map((r: any) => ({
              title: r.title || r.name || 'Untitled',
              url: r.url || r.link || '#',
              snippet: r.snippet || r.description || r.body || '',
              domain: getDomain(r.url || r.link || ''),
              content: r.content?.substring(0, 1500) || undefined,
              wordCount: r.wordCount || (r.content ? r.content.trim().split(/\s+/).length : undefined),
              method: r.method || undefined,
              fetchTimeMs: r.fetchTimeMs || undefined,
              loading: false,
              rank: r.rank || undefined,
              credibility: r.credibility || undefined,
            })),
            fetchTimeMs: smart.fetchTimeMs,
          };
        } else {
          // Specialized result (cars, flights, hotels, rental, restaurants)
          data = {
            detectedMode: 'search',
            smartResult: smart,
            content: smart.content,
            title: smart.title || `${smart.source} results`,
            tokens: smart.tokens,
            fetchTimeMs: smart.fetchTimeMs,
          };
        }

      } else if (intent.mode === 'ask') {
        // ── Ask mode — AI-powered Q&A via our server route ────────────────────
        const res = await fetch('/api/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: intent.url, question: intent.question }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error?.message || json.message || json.error || 'Ask failed');

        data = {
          detectedMode: 'ask',
          answer: json.answer || `Here's what we found on the page:\n\n${json.content || 'No content available'}`,
          title: json.title,
          tokens: json.tokens,
          fetchTimeMs: json.fetchTimeMs,
          question: intent.question,
          method: json.method,
          content: json.content,
          sources: json.sources?.map((s: any) => ({
            url: s.url || '',
            title: s.title,
            domain: s.domain,
            authority: s.authority,
          })),
        };

      } else if (intent.url && /(?:youtube\.com\/watch|youtu\.be\/|youtube\.com\/embed)/.test(intent.url)) {
        // ── YouTube mode — use Render API (has Webshare residential proxy) ──
        const res = await fetch(
          `${API_URL}/v1/fetch?url=${encodeURIComponent(intent.url)}&format=markdown`,
          { headers }
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json.error?.message || json.error || 'Failed to fetch YouTube transcript');

        const vidMatch = intent.url.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
        const videoId = vidMatch?.[1] ?? '';

        const rawContent = json.content ?? json.fullText ?? json.text ?? '';

        // Strip the title + metadata header (dashboard renders its own)
        let transcriptBody = rawContent;
        transcriptBody = transcriptBody.replace(/^#\s+[^\n]+\n*/, '');
        transcriptBody = transcriptBody.replace(/^\*\*(?:Channel|Duration|Published|Language|Available Languages|Words)[:\*][^\n]*\n*/gm, '');
        transcriptBody = transcriptBody.replace(/^---\n*/m, '');
        transcriptBody = transcriptBody.replace(/^\n+/, '');

        const title = json.title ?? json.metadata?.title ?? 'YouTube Transcript';
        const channel = json.structured?.channel ?? json.metadata?.channel ?? json.channel ?? '';
        const duration = json.structured?.duration ?? json.metadata?.duration ?? json.duration ?? '';
        const viewCount = json.structured?.viewCount ?? '';
        const publishDate = json.structured?.publishDate ?? '';
        const wordCount = json.wordCount ?? json.tokens ?? rawContent.split(/\s+/).length;

        data = {
          detectedMode: 'read',
          content: transcriptBody,
          title,
          tokens: wordCount,
          fetchTimeMs: json.elapsed ?? json.fetchTimeMs,
          videoId,
          channel,
          duration,
          viewCount,
          publishDate,
        };
      } else {
        // ── Read mode — fetch page as markdown ───────────────────────────────
        const res = await fetch(
          `${API_URL}/v1/fetch?url=${encodeURIComponent(intent.url!)}&format=markdown`,
          { headers }
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json.error?.message || json.message || json.error || 'Fetch failed');
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

      // Server-side enrichment via ?enrich=2 — no client-side fetches needed
    } catch (err: any) {
      const msg = typeof err.message === 'string' ? err.message : String(err.message || err);
      setErrorMsg(msg || 'Something went wrong. Please try again.');
      setAppState('error');
    }
  }, [token]);

  const handleSubmit = useCallback(() => {
    handleSubmitRaw(input);
  }, [input, handleSubmitRaw]);

  /** Called from SearchResults "Read this page →" button */
  const handleReadUrl = useCallback((url: string) => {
    setInput(url);
    handleSubmitRaw(url);
  }, [handleSubmitRaw]);

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
    setLoadingMessage(undefined);
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
          <h1 className="text-2xl sm:text-4xl font-light text-zinc-100 tracking-tight">
            <span className="mr-3 text-xl sm:text-3xl">{greeting.emoji}</span>
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
          <div className="relative rounded-2xl border border-zinc-800 bg-zinc-900/60 focus-within:border-zinc-700 transition-all shadow-lg shadow-black/20">
            <div className="flex items-start gap-3 p-4">
              <textarea
                ref={inputRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Paste a URL, ask a question, or search anything..."
                disabled={isLoading}
                rows={2}
                className="flex-1 resize-none bg-transparent text-zinc-100 placeholder-zinc-500 text-sm leading-relaxed outline-none ring-0 focus:ring-0 focus:outline-none border-none min-h-[44px] max-h-[200px] overflow-y-auto disabled:opacity-50"
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

          {/* Example URLs (idle) or hint text (active) */}
          {isIdle ? (
            <div className="mt-3 text-center space-y-2">
              <p className="text-xs text-zinc-600">Try one of these →</p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {EXAMPLE_URLS.map(({ label, url }) => (
                  <button
                    key={url}
                    onClick={() => {
                      setInput(url);
                      handleSubmitRaw(url);
                    }}
                    className="text-xs text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 px-3 py-1.5 rounded-full border border-zinc-800 hover:border-zinc-700 transition-all"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-center text-xs text-zinc-500 mt-3">
              Try: paste a URL to read&nbsp;•&nbsp;add a question on the next line for Q&amp;A&nbsp;•&nbsp;or just type to search
            </p>
          )}
        </div>

        {/* Loading skeleton with elapsed timer */}
        {isLoading && <LoadingSkeleton query={submittedQuery} intentMessage={loadingMessage} />}

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
            onReadUrl={handleReadUrl}
            token={token}
          />
        )}
      </div>

      {/* Idle capability hints */}
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
