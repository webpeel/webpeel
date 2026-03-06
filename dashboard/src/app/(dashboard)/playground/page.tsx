'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import useSWR from 'swr';
import { apiClient, ApiKey } from '@/lib/api';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CopyButton } from '@/components/copy-button';
import ReactMarkdown from 'react-markdown';
import {
  Play,
  Globe,
  Clock,
  FileText,
  Code,
  AlertCircle,
  Loader2,
  ExternalLink,
  Sparkles,
  Search,
  Camera,
  MessageSquare,
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.webpeel.dev';

// ── Fetch types ──────────────────────────────────────────────────────────────

interface FetchResult {
  content?: string;
  markdown?: string;
  text?: string;
  html?: string;
  title?: string;
  description?: string;
  url?: string;
  statusCode?: number;
  responseTime?: number;
  tokenCount?: number;
  tokens?: number;
  wordCount?: number;
  savings?: number;
  tokenSavingsPercent?: number;
  fetchTimeMs?: number;
  links?: string[];
  error?: string;
  answer?: string;
  summary?: string;
}

type Format = 'markdown' | 'text' | 'html';

const formatOptions: { value: Format; label: string; icon: React.ElementType }[] = [
  { value: 'markdown', label: 'Markdown', icon: FileText },
  { value: 'text', label: 'Plain Text', icon: FileText },
  { value: 'html', label: 'HTML', icon: Code },
];

const exampleUrls = [
  'https://example.com',
  'https://news.ycombinator.com',
  'https://github.com/trending',
];

// ── Search types ─────────────────────────────────────────────────────────────

interface SearchResultItem {
  title: string;
  url: string;
  snippet?: string;
  content?: string;
}

interface SearchResult {
  results: SearchResultItem[];
  query: string;
  total?: number;
}

const exampleSearchQueries = [
  'best web fetching APIs',
  'firecrawl alternatives',
  'how to fetch pages with AI',
];

// ── Screenshot types ─────────────────────────────────────────────────────────

type ScreenshotFormat = 'png' | 'jpeg';

// ── Mode type ────────────────────────────────────────────────────────────────

type Mode = 'fetch' | 'search' | 'screenshot';

// ── SWR fetcher ──────────────────────────────────────────────────────────────

const fetcher = async <T,>(url: string, token: string): Promise<T> => {
  return apiClient<T>(url, { token });
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function PlaygroundPage() {
  const { data: session } = useSession();
  const token = (session as any)?.apiToken as string | undefined;

  const { data: keysData } = useSWR<{ keys: ApiKey[] }>(
    token ? ['/v1/keys', token] : null,
    ([url, t]: [string, string]) => fetcher<{ keys: ApiKey[] }>(url, t)
  );
  const firstKeyPrefix = keysData?.keys?.find((k) => k.isActive && !k.isExpired)?.prefix;
  const displayApiKey = firstKeyPrefix ? `${firstKeyPrefix}...` : 'YOUR_API_KEY';

  // ── Mode ──────────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<Mode>('fetch');

  // ── Fetch state ───────────────────────────────────────────────────────────
  const [fetchUrl, setFetchUrl] = useState('');
  const [format, setFormat] = useState<Format>('markdown');
  const [renderBrowser, setRenderBrowser] = useState(false);
  const [stealthMode, setStealthMode] = useState(false);
  const [question, setQuestion] = useState('');
  const [summaryMode, setSummaryMode] = useState(false);
  const [budget, setBudget] = useState('');
  const [readable, setReadable] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchResult, setFetchResult] = useState<FetchResult | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchElapsed, setFetchElapsed] = useState<number | null>(null);

  // ── Search state ──────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchElapsed, setSearchElapsed] = useState<number | null>(null);

  // ── Screenshot state ──────────────────────────────────────────────────────
  const [screenshotUrl, setScreenshotUrl] = useState('');
  const [fullPage, setFullPage] = useState(false);
  const [screenshotFormat, setScreenshotFormat] = useState<ScreenshotFormat>('png');
  const [screenshotLoading, setScreenshotLoading] = useState(false);
  const [screenshotSrc, setScreenshotSrc] = useState<string | null>(null);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  const [screenshotElapsed, setScreenshotElapsed] = useState<number | null>(null);

  // ── Fetch handler ─────────────────────────────────────────────────────────

  const handleFetch = async () => {
    if (!fetchUrl.trim()) return;
    if (!token) {
      setFetchError('No API token available. Please sign in again.');
      return;
    }

    let normalizedUrl = fetchUrl.trim();
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = 'https://' + normalizedUrl;
    }

    setFetchLoading(true);
    setFetchError(null);
    setFetchResult(null);
    const startTime = Date.now();

    try {
      const params = new URLSearchParams({
        url: normalizedUrl,
        format,
        ...(renderBrowser ? { render: 'true' } : {}),
        ...(stealthMode ? { stealth: 'true' } : {}),
        ...(question.trim() ? { question: question.trim() } : {}),
        ...(summaryMode && !question.trim() ? { summary: 'true' } : {}),
        ...(budget.trim() ? { budget: budget.trim() } : {}),
        ...(readable ? { readable: 'true' } : {}),
      });

      const response = await fetch(`${API_URL}/v1/fetch?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const ms = Date.now() - startTime;
      setFetchElapsed(ms);

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ message: `HTTP ${response.status}` }));
        throw new Error(errData.message || `Request failed with status ${response.status}`);
      }

      const data = await response.json();
      setFetchResult(data);
      toast.success('Page fetched successfully');
    } catch (err: any) {
      setFetchElapsed(Date.now() - startTime);
      const msg = err.message || 'An unexpected error occurred';
      setFetchError(msg);
      toast.error(msg);
    } finally {
      setFetchLoading(false);
    }
  };

  const handleFetchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !fetchLoading) handleFetch();
  };

  const getFetchContent = (): string => {
    if (!fetchResult) return '';
    // If summary mode active, prefer summary field
    if (summaryMode && !question.trim() && fetchResult.summary) return fetchResult.summary;
    return fetchResult.markdown || fetchResult.content || fetchResult.text || fetchResult.html || '';
  };

  // ── Search handler ────────────────────────────────────────────────────────

  const handleSearch = async (queryOverride?: string) => {
    const q = (queryOverride ?? searchQuery).trim();
    if (!q) return;
    if (!token) {
      setSearchError('No API token available. Please sign in again.');
      return;
    }
    if (queryOverride) setSearchQuery(queryOverride);

    setSearchLoading(true);
    setSearchError(null);
    setSearchResult(null);
    const startTime = Date.now();

    try {
      const params = new URLSearchParams({ q });
      const response = await fetch(`${API_URL}/v1/search?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const ms = Date.now() - startTime;
      setSearchElapsed(ms);

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ message: `HTTP ${response.status}` }));
        throw new Error(errData.message || `Request failed with status ${response.status}`);
      }

      const raw = await response.json();
      const data: SearchResult = {
        results: raw.data?.web || raw.results || [],
        query: raw.query || q,
        total: raw.data?.web?.length || raw.results?.length || 0,
      };
      setSearchResult(data);
      toast.success(`Found ${data.results?.length ?? 0} results`);
    } catch (err: any) {
      setSearchElapsed(Date.now() - startTime);
      const msg = err.message || 'An unexpected error occurred';
      setSearchError(msg);
      toast.error(msg);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !searchLoading) handleSearch();
  };

  // ── Screenshot handler ────────────────────────────────────────────────────

  const handleScreenshot = async () => {
    if (!screenshotUrl.trim()) return;
    if (!token) {
      setScreenshotError('No API token available. Please sign in again.');
      return;
    }

    let normalizedUrl = screenshotUrl.trim();
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = 'https://' + normalizedUrl;
    }

    setScreenshotLoading(true);
    setScreenshotError(null);
    setScreenshotSrc(null);
    const startTime = Date.now();

    try {
      const response = await fetch(`${API_URL}/v1/screenshot`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: normalizedUrl,
          fullPage,
          format: screenshotFormat,
        }),
      });

      const ms = Date.now() - startTime;
      setScreenshotElapsed(ms);

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ message: `HTTP ${response.status}` }));
        throw new Error(errData.message || `Request failed with status ${response.status}`);
      }

      const json = await response.json();
      const dataUrl = json?.data?.screenshot;
      if (!dataUrl || typeof dataUrl !== 'string') {
        throw new Error('No screenshot data in response');
      }
      setScreenshotSrc(dataUrl);
      toast.success('Screenshot captured');
    } catch (err: any) {
      setScreenshotElapsed(Date.now() - startTime);
      const msg = err.message || 'An unexpected error occurred';
      setScreenshotError(msg);
      toast.error(msg);
    } finally {
      setScreenshotLoading(false);
    }
  };

  const handleScreenshotKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !screenshotLoading) handleScreenshot();
  };

  // ── cURL snippets ─────────────────────────────────────────────────────────

  const buildFetchParams = (): string => {
    const parts: string[] = [];
    const base = fetchUrl || 'https://example.com';
    parts.push(`url=${encodeURIComponent(base)}`);
    parts.push(`format=${format}`);
    if (renderBrowser) parts.push('render=true');
    if (stealthMode) parts.push('stealth=true');
    if (question.trim()) parts.push(`question=${encodeURIComponent(question.trim())}`);
    if (summaryMode && !question.trim()) parts.push('summary=true');
    if (budget.trim()) parts.push(`budget=${budget.trim()}`);
    if (readable) parts.push('readable=true');
    return parts.join('&');
  };

  const fetchCurl = `curl "${API_URL}/v1/fetch?${buildFetchParams()}" \\
  -H "Authorization: Bearer ${displayApiKey}"`;

  const searchCurl = searchQuery
    ? `curl "${API_URL}/v1/search?q=${encodeURIComponent(searchQuery)}" \\
  -H "Authorization: Bearer ${displayApiKey}"`
    : `curl "${API_URL}/v1/search?q=AI+web+fetching+tools" \\
  -H "Authorization: Bearer ${displayApiKey}"`;

  const screenshotCurl = screenshotUrl
    ? `curl -X POST "${API_URL}/v1/screenshot" \\
  -H "Authorization: Bearer ${displayApiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"${screenshotUrl}","fullPage":${fullPage},"format":"${screenshotFormat}"}' \\
  --output screenshot.${screenshotFormat}`
    : `curl -X POST "${API_URL}/v1/screenshot" \\
  -H "Authorization: Bearer ${displayApiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://example.com","fullPage":false,"format":"png"}' \\
  --output screenshot.png`;

  // ── Output stats ──────────────────────────────────────────────────────────

  const outputContent = getFetchContent();
  const displayWordCount = fetchResult?.wordCount ?? (outputContent ? countWords(outputContent) : null);
  const displayTokens = fetchResult?.tokenCount ?? fetchResult?.tokens ?? null;
  const displayTime = fetchResult?.fetchTimeMs ?? (fetchResult as any)?.elapsed ?? fetchElapsed ?? null;
  const displaySavings = fetchResult?.tokenSavingsPercent ?? fetchResult?.savings ?? null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-6xl space-y-6 md:space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-zinc-100 flex items-center gap-2">
          <Play className="h-7 w-7 text-zinc-200" />
          Playground
        </h1>
        <p className="text-sm md:text-base text-zinc-500 mt-1">
          Test the WebPeel API live — fetch, search, and screenshot any page instantly
        </p>
      </div>

      {/* Mode Tabs */}
      <div className="flex gap-1 p-1 bg-zinc-800 rounded-xl w-full sm:w-fit">
        {(
          [
            { value: 'fetch', label: 'Fetch', icon: Globe },
            { value: 'search', label: 'Search', icon: Search },
            { value: 'screenshot', label: 'Screenshot', icon: Camera },
          ] as { value: Mode; label: string; icon: React.ElementType }[]
        ).map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            onClick={() => setMode(value)}
            className={`flex flex-1 sm:flex-none items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              mode === value
                ? 'bg-zinc-900 text-white shadow-sm'
                : 'bg-transparent text-zinc-300 hover:text-zinc-100'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {/* ── FETCH MODE ────────────────────────────────────────────────────── */}
      {mode === 'fetch' && (
        <>
          <Card className="border-zinc-700">
            <CardHeader>
              <CardTitle className="text-lg">Fetch a URL</CardTitle>
              <CardDescription>Enter any URL to extract its content using your API key</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* URL Input */}
              <div className="space-y-2">
                <Label htmlFor="url-input" className="text-sm font-semibold text-zinc-100">URL</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                    <Input
                      id="url-input"
                      type="url"
                      placeholder="https://example.com"
                      value={fetchUrl}
                      onChange={(e) => setFetchUrl(e.target.value)}
                      onKeyDown={handleFetchKeyDown}
                      className="pl-9 font-mono text-sm"
                      disabled={fetchLoading}
                    />
                  </div>
                  <Button
                    onClick={handleFetch}
                    disabled={fetchLoading || !fetchUrl.trim()}
                    className="bg-[#5865F2] hover:bg-[#4752C4] gap-2 px-6 flex-shrink-0"
                  >
                    {fetchLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Fetching...
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4" />
                        Fetch
                      </>
                    )}
                  </Button>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-zinc-400">Try:</span>
                  {exampleUrls.map((exUrl) => (
                    <button
                      key={exUrl}
                      onClick={() => setFetchUrl(exUrl)}
                      className="text-xs text-zinc-200 hover:underline transition-colors"
                    >
                      {exUrl.replace('https://', '')}
                    </button>
                  ))}
                </div>
              </div>

              {/* Options Row — format + render + stealth */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-zinc-100">Output Format</Label>
                  <div className="flex gap-1 p-1 bg-zinc-800 rounded-lg">
                    {formatOptions.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setFormat(opt.value)}
                        className={`flex-1 py-1.5 px-2 text-xs font-medium rounded-md transition-all ${
                          format === opt.value
                            ? 'bg-zinc-700 text-zinc-100 shadow-sm'
                            : 'text-zinc-500 hover:text-zinc-300'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <Label className="text-sm font-semibold text-zinc-100">Browser Rendering</Label>
                  <div className="flex items-center gap-3 h-9 px-3 bg-zinc-900 rounded-lg border border-zinc-700">
                    <Switch id="render-toggle" checked={renderBrowser} onCheckedChange={setRenderBrowser} />
                    <label htmlFor="render-toggle" className="text-xs text-zinc-600 cursor-pointer">
                      {renderBrowser ? 'Enabled' : 'Off'}
                    </label>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <Label className="text-sm font-semibold text-zinc-100">Stealth Mode</Label>
                  <div className="flex items-center gap-3 h-9 px-3 bg-zinc-900 rounded-lg border border-zinc-700">
                    <Switch id="stealth-toggle" checked={stealthMode} onCheckedChange={setStealthMode} />
                    <label htmlFor="stealth-toggle" className="text-xs text-zinc-600 cursor-pointer">
                      {stealthMode ? 'Enabled' : 'Off'}
                    </label>
                  </div>
                </div>
              </div>

              {/* Advanced params */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1 border-t border-zinc-800">
                {/* Question */}
                <div className="space-y-1.5">
                  <Label htmlFor="question-input" className="text-sm font-semibold text-zinc-100">
                    Ask a question about this page
                  </Label>
                  <div className="relative">
                    <MessageSquare className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                    <Input
                      id="question-input"
                      type="text"
                      placeholder="What is the main topic?"
                      value={question}
                      onChange={(e) => {
                        setQuestion(e.target.value);
                        if (e.target.value.trim()) setSummaryMode(false);
                      }}
                      className="pl-9 text-sm bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500"
                      disabled={fetchLoading}
                    />
                  </div>
                </div>

                {/* Budget */}
                <div className="space-y-1.5">
                  <Label htmlFor="budget-input" className="text-sm font-semibold text-zinc-100">
                    Token budget
                  </Label>
                  <Input
                    id="budget-input"
                    type="number"
                    placeholder="No limit"
                    min={500}
                    max={10000}
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    className="text-sm bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500"
                    disabled={fetchLoading}
                  />
                  <p className="text-xs text-zinc-500">Limit output tokens. Lower = faster + cheaper.</p>
                </div>

                {/* Summary toggle */}
                <div className="flex flex-col gap-2">
                  <Label className="text-sm font-semibold text-zinc-100">Summary only</Label>
                  <div className="flex items-center gap-3 h-9 px-3 bg-zinc-900 rounded-lg border border-zinc-700">
                    <Switch
                      id="summary-toggle"
                      checked={summaryMode}
                      onCheckedChange={(v) => setSummaryMode(v)}
                      disabled={!!question.trim() || fetchLoading}
                    />
                    <label htmlFor="summary-toggle" className={`text-xs cursor-pointer ${question.trim() ? 'text-zinc-600 line-through' : 'text-zinc-500'}`}>
                      {summaryMode ? 'On' : 'Off'}{question.trim() ? ' (disabled while question set)' : ''}
                    </label>
                  </div>
                </div>

                {/* Readable toggle */}
                <div className="flex flex-col gap-2">
                  <Label className="text-sm font-semibold text-zinc-100">Article only</Label>
                  <div className="flex items-center gap-3 h-9 px-3 bg-zinc-900 rounded-lg border border-zinc-700">
                    <Switch id="readable-toggle" checked={readable} onCheckedChange={setReadable} disabled={fetchLoading} />
                    <label htmlFor="readable-toggle" className="text-xs text-zinc-500 cursor-pointer">
                      {readable ? 'On' : 'Off'}
                    </label>
                  </div>
                  <p className="text-xs text-zinc-500">Extract main article content only. Strips nav, footer, ads.</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Fetch Error */}
          {fetchError && (
            <Card className="border-red-500/30 bg-red-500/10">
              <CardContent className="flex items-start gap-3 pt-4 md:pt-6">
                <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-300">Request Failed</p>
                  <p className="text-xs text-red-400 mt-1">{fetchError}</p>
                  {fetchElapsed != null && (
                    <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                      <Clock className="h-3 w-3" /> Failed after {fetchElapsed}ms
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Fetch Results */}
          {fetchResult && (
            <div className="space-y-4">
              {/* Stats bar */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { icon: '⏱', label: 'Time', value: displayTime != null ? `${displayTime}ms` : '—' },
                  { icon: '📝', label: 'Words', value: displayWordCount != null ? `${displayWordCount.toLocaleString()} words` : '—' },
                  { icon: '🪙', label: 'Tokens', value: displayTokens != null ? `${displayTokens.toLocaleString()} tokens` : '—' },
                  { icon: '✂️', label: 'Savings', value: displaySavings != null ? `${displaySavings}% smaller` : '—' },
                ].map(({ icon, label, value }) => (
                  <div key={label} className="flex items-center gap-2 px-3 py-2 bg-[#111116] border border-zinc-800 rounded-lg">
                    <span className="text-sm">{icon}</span>
                    <div className="min-w-0">
                      <p className="text-xs text-zinc-500">{label}</p>
                      <p className="text-xs font-semibold text-[#5865F2] truncate">{value}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Answer card */}
              {fetchResult.answer && (
                <div className="flex items-start gap-3 p-4 bg-[#5865F2]/10 border border-[#5865F2]/30 rounded-lg">
                  <MessageSquare className="h-5 w-5 text-[#5865F2] flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-[#5865F2] mb-1">💬 Answer</p>
                    <p className="text-sm text-zinc-200 leading-relaxed">{fetchResult.answer}</p>
                  </div>
                </div>
              )}

              {/* Title / meta bar */}
              <div className="flex flex-wrap items-center gap-3 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
                <Badge className="bg-emerald-100 text-emerald-700 border-0">✓ Success</Badge>
                {fetchResult.title && (
                  <span className="text-xs text-zinc-600 truncate max-w-xs">
                    <span className="text-zinc-400">Title:</span> {fetchResult.title}
                  </span>
                )}
                {fetchResult.url && (
                  <a
                    href={fetchResult.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-zinc-200 hover:underline flex items-center gap-1 ml-auto"
                  >
                    View original <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>

              <Card className="border-zinc-700">
                <CardHeader className="pb-0">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">Result</CardTitle>
                    <CopyButton text={outputContent} size="sm" />
                  </div>
                </CardHeader>
                <CardContent className="pt-4">
                  <Tabs defaultValue="content" className="w-full">
                    <TabsList className="mb-4">
                      <TabsTrigger value="content">Content</TabsTrigger>
                      {fetchResult.links && fetchResult.links.length > 0 && (
                        <TabsTrigger value="links">Links ({fetchResult.links.length})</TabsTrigger>
                      )}
                      <TabsTrigger value="raw">Raw JSON</TabsTrigger>
                    </TabsList>

                    <TabsContent value="content" className="mt-0">
                      {format === 'markdown' ? (
                        <div className="p-4 bg-zinc-900 rounded-lg overflow-auto max-h-[60vh]">
                          <div className="prose-sm prose-invert max-w-none
                            [&_h1]:text-zinc-100 [&_h1]:text-xl [&_h1]:font-bold [&_h1]:mb-3 [&_h1]:mt-4
                            [&_h2]:text-zinc-100 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4
                            [&_h3]:text-zinc-200 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mb-2 [&_h3]:mt-3
                            [&_p]:text-zinc-300 [&_p]:text-sm [&_p]:leading-relaxed [&_p]:mb-3
                            [&_ul]:text-zinc-300 [&_ul]:text-sm [&_ul]:pl-5 [&_ul]:mb-3 [&_ul]:list-disc
                            [&_ol]:text-zinc-300 [&_ol]:text-sm [&_ol]:pl-5 [&_ol]:mb-3 [&_ol]:list-decimal
                            [&_li]:mb-1
                            [&_a]:text-[#5865F2] [&_a]:underline [&_a]:hover:text-[#7983f5]
                            [&_code]:text-zinc-200 [&_code]:bg-zinc-800 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono
                            [&_pre]:bg-zinc-800 [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre]:mb-3
                            [&_pre_code]:bg-transparent [&_pre_code]:p-0
                            [&_blockquote]:border-l-2 [&_blockquote]:border-zinc-600 [&_blockquote]:pl-4 [&_blockquote]:text-zinc-400 [&_blockquote]:italic
                            [&_hr]:border-zinc-700 [&_hr]:my-4
                            [&_strong]:text-zinc-100 [&_strong]:font-semibold
                            [&_em]:text-zinc-300 [&_em]:italic
                            [&_table]:w-full [&_table]:text-sm [&_table]:border-collapse
                            [&_th]:text-zinc-200 [&_th]:text-left [&_th]:p-2 [&_th]:border-b [&_th]:border-zinc-700
                            [&_td]:text-zinc-300 [&_td]:p-2 [&_td]:border-b [&_td]:border-zinc-800">
                            <ReactMarkdown>
                              {outputContent || '*(no content returned)*'}
                            </ReactMarkdown>
                          </div>
                        </div>
                      ) : (
                        <pre className="p-4 bg-zinc-900 text-zinc-100 rounded-lg overflow-auto text-xs md:text-sm max-h-[60vh] whitespace-pre-wrap leading-relaxed">
                          <code>{outputContent || '(no content returned)'}</code>
                        </pre>
                      )}
                    </TabsContent>

                    {fetchResult.links && fetchResult.links.length > 0 && (
                      <TabsContent value="links" className="mt-0">
                        <div className="rounded-lg border border-zinc-700 overflow-auto max-h-[60vh]">
                          {fetchResult.links.map((link, i) => (
                            <a
                              key={i}
                              href={link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 px-4 py-2.5 text-xs font-mono text-zinc-200 hover:bg-zinc-900 border-b border-zinc-800 last:border-0 transition-colors"
                            >
                              <ExternalLink className="h-3 w-3 flex-shrink-0 text-zinc-400" />
                              <span className="truncate">{link}</span>
                            </a>
                          ))}
                        </div>
                      </TabsContent>
                    )}

                    <TabsContent value="raw" className="mt-0">
                      <pre className="p-4 bg-zinc-900 text-zinc-100 rounded-lg overflow-auto text-xs max-h-[60vh]">
                        <code>{JSON.stringify(fetchResult, null, 2)}</code>
                      </pre>
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Fetch Loading */}
          {fetchLoading && (
            <Card className="border-zinc-700">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <div className="relative mb-4">
                  <div className="h-12 w-12 rounded-full border-4 border-zinc-800 border-t-zinc-800 animate-spin" />
                  <Globe className="absolute inset-0 m-auto h-5 w-5 text-zinc-200" />
                </div>
                <p className="text-sm font-medium text-zinc-300">Fetching content...</p>
                <p className="text-xs text-zinc-400 mt-1">This may take a moment for complex pages</p>
              </CardContent>
            </Card>
          )}

          {/* Fetch empty state + cURL */}
          {!fetchLoading && !fetchResult && !fetchError && (
            <div className="grid md:grid-cols-2 gap-6">
              <Card className="border-zinc-700">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-zinc-200" />
                    What the API returns
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    ['Content', 'Clean markdown, plain text, or HTML'],
                    ['Metadata', 'Title, description, author, open graph'],
                    ['Links', 'All URLs found on the page'],
                    ['Stats', 'Response time, token count, status code'],
                    ['Answer', 'AI answer when question param is set'],
                    ['Summary', 'Condensed summary of the page'],
                  ].map(([key, val]) => (
                    <div key={key} className="flex gap-3">
                      <span className="text-xs font-semibold text-zinc-200 w-20 flex-shrink-0 pt-0.5">{key}</span>
                      <span className="text-xs text-zinc-600">{val}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card className="border-zinc-700">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Equivalent cURL</CardTitle>
                    <CopyButton text={fetchCurl} size="sm" />
                  </div>
                </CardHeader>
                <CardContent>
                  <pre className="p-3 bg-zinc-900 text-zinc-100 rounded-lg text-xs overflow-x-auto whitespace-pre-wrap">
                    <code>{fetchCurl}</code>
                  </pre>
                </CardContent>
              </Card>
            </div>
          )}

          {/* cURL after result/error */}
          {(fetchResult || fetchError) && (
            <Card className="border-zinc-700">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Equivalent cURL command</CardTitle>
                    <CardDescription>Reproduce this request in your terminal</CardDescription>
                  </div>
                  <CopyButton text={fetchCurl} size="sm" />
                </div>
              </CardHeader>
              <CardContent>
                <pre className="p-3 bg-zinc-900 text-zinc-100 rounded-lg text-xs overflow-x-auto whitespace-pre-wrap">
                  <code>{fetchCurl}</code>
                </pre>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* ── SEARCH MODE ───────────────────────────────────────────────────── */}
      {mode === 'search' && (
        <>
          <Card className="border-zinc-700">
            <CardHeader>
              <CardTitle className="text-lg">Search the Web</CardTitle>
              <CardDescription>Enter a search query to get structured results from the web</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Query Input */}
              <div className="space-y-2">
                <Label htmlFor="search-input" className="text-sm font-semibold text-zinc-100">Search query</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                    <Input
                      id="search-input"
                      type="text"
                      placeholder="AI web fetching tools"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={handleSearchKeyDown}
                      className="pl-9 text-sm"
                      disabled={searchLoading}
                    />
                  </div>
                  <Button
                    onClick={() => handleSearch()}
                    disabled={searchLoading || !searchQuery.trim()}
                    className="bg-[#5865F2] hover:bg-[#4752C4] gap-2 px-6 flex-shrink-0"
                  >
                    {searchLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Searching...
                      </>
                    ) : (
                      <>
                        <Search className="h-4 w-4" />
                        Search
                      </>
                    )}
                  </Button>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-zinc-400">Try:</span>
                  {exampleSearchQueries.map((q) => (
                    <button
                      key={q}
                      onClick={() => handleSearch(q)}
                      className="text-xs text-zinc-200 hover:underline transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Search Error */}
          {searchError && (
            <Card className="border-red-500/30 bg-red-500/10">
              <CardContent className="flex items-start gap-3 pt-4 md:pt-6">
                <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-300">Search Failed</p>
                  <p className="text-xs text-red-400 mt-1">{searchError}</p>
                  {searchElapsed != null && (
                    <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                      <Clock className="h-3 w-3" /> Failed after {searchElapsed}ms
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Search Loading */}
          {searchLoading && (
            <Card className="border-zinc-700">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <div className="relative mb-4">
                  <div className="h-12 w-12 rounded-full border-4 border-zinc-800 border-t-zinc-800 animate-spin" />
                  <Search className="absolute inset-0 m-auto h-5 w-5 text-zinc-200" />
                </div>
                <p className="text-sm font-medium text-zinc-300">Searching the web...</p>
                <p className="text-xs text-zinc-400 mt-1">Fetching and ranking results</p>
              </CardContent>
            </Card>
          )}

          {/* Search Results */}
          {searchResult && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
                <Badge className="bg-emerald-100 text-emerald-700 border-0">✓ Success</Badge>
                {searchElapsed != null && (
                  <span className="text-xs text-zinc-600 flex items-center gap-1">
                    <Clock className="h-3 w-3" /> {searchElapsed}ms
                  </span>
                )}
                <span className="text-xs text-zinc-600">
                  <span className="text-zinc-400">Query:</span> {searchResult.query}
                </span>
                {searchResult.total != null && (
                  <span className="text-xs text-zinc-600">
                    <span className="text-zinc-400">Results:</span> {searchResult.total}
                  </span>
                )}
              </div>

              <div className="space-y-3">
                {searchResult.results?.map((item, i) => (
                  <Card key={i} className="border-zinc-700 hover:border-zinc-300 transition-colors">
                    <CardContent className="pt-4 pb-4">
                      <div className="space-y-1">
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-semibold text-[#5865F2] hover:underline flex items-start gap-1 group"
                        >
                          {item.title || item.url}
                          <ExternalLink className="h-3 w-3 flex-shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </a>
                        <p className="text-xs text-zinc-500 font-mono truncate">{item.url}</p>
                        {item.snippet && (
                          <p className="text-xs text-zinc-600 leading-relaxed pt-1">{item.snippet}</p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
                {(!searchResult.results || searchResult.results.length === 0) && (
                  <Card className="border-zinc-700">
                    <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                      <Search className="h-8 w-8 text-zinc-300 mb-3" />
                      <p className="text-sm text-zinc-500">No results found</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          )}

          {/* Search empty state + cURL */}
          {!searchLoading && !searchResult && !searchError && (
            <div className="grid md:grid-cols-2 gap-6">
              <Card className="border-zinc-700">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-zinc-200" />
                    What search returns
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    ['Title', 'Page title for each result'],
                    ['URL', 'Direct link to the source'],
                    ['Snippet', 'Relevant excerpt from the page'],
                    ['Content', 'Full extracted page content'],
                  ].map(([key, val]) => (
                    <div key={key} className="flex gap-3">
                      <span className="text-xs font-semibold text-zinc-200 w-20 flex-shrink-0 pt-0.5">{key}</span>
                      <span className="text-xs text-zinc-600">{val}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card className="border-zinc-700">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Equivalent cURL</CardTitle>
                    <CopyButton text={searchCurl} size="sm" />
                  </div>
                </CardHeader>
                <CardContent>
                  <pre className="p-3 bg-zinc-900 text-zinc-100 rounded-lg text-xs overflow-x-auto whitespace-pre-wrap">
                    <code>{searchCurl}</code>
                  </pre>
                </CardContent>
              </Card>
            </div>
          )}

          {/* cURL after result/error */}
          {(searchResult || searchError) && (
            <Card className="border-zinc-700">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Equivalent cURL command</CardTitle>
                    <CardDescription>Reproduce this request in your terminal</CardDescription>
                  </div>
                  <CopyButton text={searchCurl} size="sm" />
                </div>
              </CardHeader>
              <CardContent>
                <pre className="p-3 bg-zinc-900 text-zinc-100 rounded-lg text-xs overflow-x-auto whitespace-pre-wrap">
                  <code>{searchCurl}</code>
                </pre>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* ── SCREENSHOT MODE ───────────────────────────────────────────────── */}
      {mode === 'screenshot' && (
        <>
          <Card className="border-zinc-700">
            <CardHeader>
              <CardTitle className="text-lg">Screenshot a Page</CardTitle>
              <CardDescription>Capture a full-page or viewport screenshot of any URL</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* URL Input */}
              <div className="space-y-2">
                <Label htmlFor="screenshot-url-input" className="text-sm font-semibold text-zinc-100">URL</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                    <Input
                      id="screenshot-url-input"
                      type="url"
                      placeholder="https://example.com"
                      value={screenshotUrl}
                      onChange={(e) => setScreenshotUrl(e.target.value)}
                      onKeyDown={handleScreenshotKeyDown}
                      className="pl-9 font-mono text-sm"
                      disabled={screenshotLoading}
                    />
                  </div>
                  <Button
                    onClick={handleScreenshot}
                    disabled={screenshotLoading || !screenshotUrl.trim()}
                    className="bg-[#5865F2] hover:bg-[#4752C4] gap-2 px-6 flex-shrink-0"
                  >
                    {screenshotLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Capturing...
                      </>
                    ) : (
                      <>
                        <Camera className="h-4 w-4" />
                        Capture
                      </>
                    )}
                  </Button>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-zinc-400">Try:</span>
                  {exampleUrls.map((exUrl) => (
                    <button
                      key={exUrl}
                      onClick={() => setScreenshotUrl(exUrl)}
                      className="text-xs text-zinc-200 hover:underline transition-colors"
                    >
                      {exUrl.replace('https://', '')}
                    </button>
                  ))}
                </div>
              </div>

              {/* Options Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-sm">
                <div className="flex flex-col gap-2">
                  <Label className="text-sm font-semibold text-zinc-100">Full Page</Label>
                  <div className="flex items-center gap-3 h-9 px-3 bg-zinc-900 rounded-lg border border-zinc-700">
                    <Switch
                      id="fullpage-toggle"
                      checked={fullPage}
                      onCheckedChange={setFullPage}
                    />
                    <label htmlFor="fullpage-toggle" className="text-xs text-zinc-600 cursor-pointer">
                      {fullPage ? 'Enabled' : 'Viewport only'}
                    </label>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-zinc-100">Format</Label>
                  <div className="flex gap-1 p-1 bg-zinc-800 rounded-lg">
                    {(['png', 'jpeg'] as ScreenshotFormat[]).map((fmt) => (
                      <button
                        key={fmt}
                        onClick={() => setScreenshotFormat(fmt)}
                        className={`flex-1 py-1.5 px-2 text-xs font-medium rounded-md transition-all uppercase ${
                          screenshotFormat === fmt
                            ? 'bg-zinc-700 text-zinc-100 shadow-sm'
                            : 'text-zinc-500 hover:text-zinc-300'
                        }`}
                      >
                        {fmt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Screenshot Error */}
          {screenshotError && (
            <Card className="border-red-500/30 bg-red-500/10">
              <CardContent className="flex items-start gap-3 pt-4 md:pt-6">
                <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-300">Capture Failed</p>
                  <p className="text-xs text-red-400 mt-1">{screenshotError}</p>
                  {screenshotElapsed != null && (
                    <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                      <Clock className="h-3 w-3" /> Failed after {screenshotElapsed}ms
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Screenshot Loading */}
          {screenshotLoading && (
            <Card className="border-zinc-700">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <div className="relative mb-4">
                  <div className="h-12 w-12 rounded-full border-4 border-zinc-800 border-t-zinc-800 animate-spin" />
                  <Camera className="absolute inset-0 m-auto h-5 w-5 text-zinc-200" />
                </div>
                <p className="text-sm font-medium text-zinc-300">Capturing screenshot...</p>
                <p className="text-xs text-zinc-400 mt-1">Rendering the page in a headless browser</p>
              </CardContent>
            </Card>
          )}

          {/* Screenshot Result */}
          {screenshotSrc && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
                <Badge className="bg-emerald-100 text-emerald-700 border-0">✓ Captured</Badge>
                {screenshotElapsed != null && (
                  <span className="text-xs text-zinc-600 flex items-center gap-1">
                    <Clock className="h-3 w-3" /> {screenshotElapsed}ms
                  </span>
                )}
                <span className="text-xs text-zinc-500 uppercase font-mono">{screenshotFormat}</span>
                {fullPage && <span className="text-xs text-zinc-500">Full page</span>}
                <a
                  href={screenshotSrc}
                  download={`screenshot.${screenshotFormat}`}
                  className="text-xs text-zinc-200 hover:underline flex items-center gap-1 ml-auto"
                >
                  Download <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              <Card className="border-zinc-700">
                <CardHeader className="pb-0">
                  <CardTitle className="text-lg">Screenshot</CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={screenshotSrc}
                    alt="Page screenshot"
                    className="w-full rounded-lg border border-zinc-700 shadow-sm"
                  />
                </CardContent>
              </Card>
            </div>
          )}

          {/* Screenshot empty state + cURL */}
          {!screenshotLoading && !screenshotSrc && !screenshotError && (
            <div className="grid md:grid-cols-2 gap-6">
              <Card className="border-zinc-700">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-zinc-200" />
                    What screenshot returns
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    ['PNG / JPEG', 'Choose your preferred image format'],
                    ['Full page', 'Capture the entire page, not just viewport'],
                    ['Browser render', 'JavaScript is executed before capture'],
                    ['High res', 'Retina-quality 2× pixel density'],
                  ].map(([key, val]) => (
                    <div key={key} className="flex gap-3">
                      <span className="text-xs font-semibold text-zinc-200 w-24 flex-shrink-0 pt-0.5">{key}</span>
                      <span className="text-xs text-zinc-600">{val}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card className="border-zinc-700">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Equivalent cURL</CardTitle>
                    <CopyButton text={screenshotCurl} size="sm" />
                  </div>
                </CardHeader>
                <CardContent>
                  <pre className="p-3 bg-zinc-900 text-zinc-100 rounded-lg text-xs overflow-x-auto whitespace-pre-wrap">
                    <code>{screenshotCurl}</code>
                  </pre>
                </CardContent>
              </Card>
            </div>
          )}

          {/* cURL after result/error */}
          {(screenshotSrc || screenshotError) && (
            <Card className="border-zinc-700">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Equivalent cURL command</CardTitle>
                    <CardDescription>Reproduce this request in your terminal</CardDescription>
                  </div>
                  <CopyButton text={screenshotCurl} size="sm" />
                </div>
              </CardHeader>
              <CardContent>
                <pre className="p-3 bg-zinc-900 text-zinc-100 rounded-lg text-xs overflow-x-auto whitespace-pre-wrap">
                  <code>{screenshotCurl}</code>
                </pre>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
