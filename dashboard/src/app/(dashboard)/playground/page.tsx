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
  links?: string[];
  error?: string;
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
  'best web scraping APIs',
  'firecrawl alternatives',
  'how to scrape with AI',
];

// ── Screenshot types ─────────────────────────────────────────────────────────

type ScreenshotFormat = 'png' | 'jpeg';

// ── Mode type ────────────────────────────────────────────────────────────────

type Mode = 'fetch' | 'search' | 'screenshot';

// ── SWR fetcher ──────────────────────────────────────────────────────────────

const fetcher = async <T,>(url: string, token: string): Promise<T> => {
  return apiClient<T>(url, { token });
};

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
      // API returns { success, data: { web: [...] } } — normalize to { results, query }
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

  const fetchCurl = fetchUrl
    ? `curl "${API_URL}/v1/fetch?url=${encodeURIComponent(fetchUrl)}&format=${format}${renderBrowser ? '&render=true' : ''}${stealthMode ? '&stealth=true' : ''}" \\
  -H "Authorization: Bearer ${displayApiKey}"`
    : `curl "${API_URL}/v1/fetch?url=https://example.com&format=markdown" \\
  -H "Authorization: Bearer ${displayApiKey}"`;

  const searchCurl = searchQuery
    ? `curl "${API_URL}/v1/search?q=${encodeURIComponent(searchQuery)}" \\
  -H "Authorization: Bearer ${displayApiKey}"`
    : `curl "${API_URL}/v1/search?q=AI+web+scraping+tools" \\
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

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-6xl space-y-6 md:space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-zinc-900 flex items-center gap-2">
          <Play className="h-7 w-7 text-zinc-800" />
          Playground
        </h1>
        <p className="text-sm md:text-base text-zinc-500 mt-1">
          Test the WebPeel API live — fetch, search, and screenshot any page instantly
        </p>
      </div>

      {/* Mode Tabs */}
      <div className="flex gap-1 p-1 bg-zinc-100 rounded-xl w-fit">
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
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              mode === value
                ? 'bg-zinc-900 text-white shadow-sm'
                : 'bg-transparent text-zinc-700 hover:text-zinc-900'
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
          <Card className="border-zinc-200">
            <CardHeader>
              <CardTitle className="text-lg">Fetch a URL</CardTitle>
              <CardDescription>Enter any URL to extract its content using your API key</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* URL Input */}
              <div className="space-y-2">
                <Label htmlFor="url-input" className="text-sm font-semibold text-zinc-900">URL</Label>
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
                      className="text-xs text-zinc-800 hover:underline transition-colors"
                    >
                      {exUrl.replace('https://', '')}
                    </button>
                  ))}
                </div>
              </div>

              {/* Options Row */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-zinc-900">Output Format</Label>
                  <div className="flex gap-1 p-1 bg-zinc-100 rounded-lg">
                    {formatOptions.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setFormat(opt.value)}
                        className={`flex-1 py-1.5 px-2 text-xs font-medium rounded-md transition-all ${
                          format === opt.value
                            ? 'bg-white text-zinc-900 shadow-sm'
                            : 'text-zinc-500 hover:text-zinc-700'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <Label className="text-sm font-semibold text-zinc-900">Browser Rendering</Label>
                  <div className="flex items-center gap-3 h-9 px-3 bg-zinc-50 rounded-lg border border-zinc-200">
                    <Switch id="render-toggle" checked={renderBrowser} onCheckedChange={setRenderBrowser} />
                    <label htmlFor="render-toggle" className="text-xs text-zinc-600 cursor-pointer">
                      {renderBrowser ? 'Enabled' : 'Off'}
                    </label>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <Label className="text-sm font-semibold text-zinc-900">Stealth Mode</Label>
                  <div className="flex items-center gap-3 h-9 px-3 bg-zinc-50 rounded-lg border border-zinc-200">
                    <Switch id="stealth-toggle" checked={stealthMode} onCheckedChange={setStealthMode} />
                    <label htmlFor="stealth-toggle" className="text-xs text-zinc-600 cursor-pointer">
                      {stealthMode ? 'Enabled' : 'Off'}
                    </label>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Fetch Error */}
          {fetchError && (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="flex items-start gap-3 pt-4 md:pt-6">
                <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-900">Request Failed</p>
                  <p className="text-xs text-red-700 mt-1">{fetchError}</p>
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
              <div className="flex flex-wrap items-center gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                <Badge className="bg-emerald-100 text-emerald-700 border-0">✓ Success</Badge>
                {fetchElapsed != null && (
                  <span className="text-xs text-zinc-600 flex items-center gap-1">
                    <Clock className="h-3 w-3" /> {fetchElapsed}ms
                  </span>
                )}
                {fetchResult.title && (
                  <span className="text-xs text-zinc-600 truncate max-w-xs">
                    <span className="text-zinc-400">Title:</span> {fetchResult.title}
                  </span>
                )}
                {fetchResult.tokenCount && (
                  <span className="text-xs text-zinc-600">
                    <span className="text-zinc-400">~</span>{fetchResult.tokenCount.toLocaleString()} tokens
                  </span>
                )}
                {fetchResult.url && (
                  <a
                    href={fetchResult.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-zinc-800 hover:underline flex items-center gap-1 ml-auto"
                  >
                    View original <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>

              <Card className="border-zinc-200">
                <CardHeader className="pb-0">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">Result</CardTitle>
                    <CopyButton text={getFetchContent()} size="sm" />
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
                      <pre className="p-4 bg-zinc-900 text-zinc-100 rounded-lg overflow-auto text-xs md:text-sm max-h-[60vh] whitespace-pre-wrap leading-relaxed">
                        <code>{getFetchContent() || '(no content returned)'}</code>
                      </pre>
                    </TabsContent>

                    {fetchResult.links && fetchResult.links.length > 0 && (
                      <TabsContent value="links" className="mt-0">
                        <div className="rounded-lg border border-zinc-200 overflow-auto max-h-[60vh]">
                          {fetchResult.links.map((link, i) => (
                            <a
                              key={i}
                              href={link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 px-4 py-2.5 text-xs font-mono text-zinc-800 hover:bg-zinc-50 border-b border-zinc-100 last:border-0 transition-colors"
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
            <Card className="border-zinc-200">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <div className="relative mb-4">
                  <div className="h-12 w-12 rounded-full border-4 border-zinc-100 border-t-zinc-800 animate-spin" />
                  <Globe className="absolute inset-0 m-auto h-5 w-5 text-zinc-800" />
                </div>
                <p className="text-sm font-medium text-zinc-700">Fetching content...</p>
                <p className="text-xs text-zinc-400 mt-1">This may take a moment for complex pages</p>
              </CardContent>
            </Card>
          )}

          {/* Fetch empty state + cURL */}
          {!fetchLoading && !fetchResult && !fetchError && (
            <div className="grid md:grid-cols-2 gap-6">
              <Card className="border-zinc-200">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-zinc-800" />
                    What the API returns
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    ['Content', 'Clean markdown, plain text, or HTML'],
                    ['Metadata', 'Title, description, author, open graph'],
                    ['Links', 'All URLs found on the page'],
                    ['Stats', 'Response time, token count, status code'],
                  ].map(([key, val]) => (
                    <div key={key} className="flex gap-3">
                      <span className="text-xs font-semibold text-zinc-800 w-20 flex-shrink-0 pt-0.5">{key}</span>
                      <span className="text-xs text-zinc-600">{val}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card className="border-zinc-200">
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
            <Card className="border-zinc-200">
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
          <Card className="border-zinc-200">
            <CardHeader>
              <CardTitle className="text-lg">Search the Web</CardTitle>
              <CardDescription>Enter a search query to get structured results from the web</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Query Input */}
              <div className="space-y-2">
                <Label htmlFor="search-input" className="text-sm font-semibold text-zinc-900">Search query</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                    <Input
                      id="search-input"
                      type="text"
                      placeholder="AI web scraping tools"
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
                {/* Quick try queries */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-zinc-400">Try:</span>
                  {exampleSearchQueries.map((q) => (
                    <button
                      key={q}
                      onClick={() => handleSearch(q)}
                      className="text-xs text-zinc-800 hover:underline transition-colors"
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
            <Card className="border-red-200 bg-red-50">
              <CardContent className="flex items-start gap-3 pt-4 md:pt-6">
                <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-900">Search Failed</p>
                  <p className="text-xs text-red-700 mt-1">{searchError}</p>
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
            <Card className="border-zinc-200">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <div className="relative mb-4">
                  <div className="h-12 w-12 rounded-full border-4 border-zinc-100 border-t-zinc-800 animate-spin" />
                  <Search className="absolute inset-0 m-auto h-5 w-5 text-zinc-800" />
                </div>
                <p className="text-sm font-medium text-zinc-700">Searching the web...</p>
                <p className="text-xs text-zinc-400 mt-1">Fetching and ranking results</p>
              </CardContent>
            </Card>
          )}

          {/* Search Results */}
          {searchResult && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
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
                  <Card key={i} className="border-zinc-200 hover:border-zinc-300 transition-colors">
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
                  <Card className="border-zinc-200">
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
              <Card className="border-zinc-200">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-zinc-800" />
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
                      <span className="text-xs font-semibold text-zinc-800 w-20 flex-shrink-0 pt-0.5">{key}</span>
                      <span className="text-xs text-zinc-600">{val}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card className="border-zinc-200">
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
            <Card className="border-zinc-200">
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
          <Card className="border-zinc-200">
            <CardHeader>
              <CardTitle className="text-lg">Screenshot a Page</CardTitle>
              <CardDescription>Capture a full-page or viewport screenshot of any URL</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* URL Input */}
              <div className="space-y-2">
                <Label htmlFor="screenshot-url-input" className="text-sm font-semibold text-zinc-900">URL</Label>
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
                {/* Example URLs */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-zinc-400">Try:</span>
                  {exampleUrls.map((exUrl) => (
                    <button
                      key={exUrl}
                      onClick={() => setScreenshotUrl(exUrl)}
                      className="text-xs text-zinc-800 hover:underline transition-colors"
                    >
                      {exUrl.replace('https://', '')}
                    </button>
                  ))}
                </div>
              </div>

              {/* Options Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-sm">
                {/* Full Page Toggle */}
                <div className="flex flex-col gap-2">
                  <Label className="text-sm font-semibold text-zinc-900">Full Page</Label>
                  <div className="flex items-center gap-3 h-9 px-3 bg-zinc-50 rounded-lg border border-zinc-200">
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

                {/* Format Selector */}
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-zinc-900">Format</Label>
                  <div className="flex gap-1 p-1 bg-zinc-100 rounded-lg">
                    {(['png', 'jpeg'] as ScreenshotFormat[]).map((fmt) => (
                      <button
                        key={fmt}
                        onClick={() => setScreenshotFormat(fmt)}
                        className={`flex-1 py-1.5 px-2 text-xs font-medium rounded-md transition-all uppercase ${
                          screenshotFormat === fmt
                            ? 'bg-white text-zinc-900 shadow-sm'
                            : 'text-zinc-500 hover:text-zinc-700'
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
            <Card className="border-red-200 bg-red-50">
              <CardContent className="flex items-start gap-3 pt-4 md:pt-6">
                <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-900">Capture Failed</p>
                  <p className="text-xs text-red-700 mt-1">{screenshotError}</p>
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
            <Card className="border-zinc-200">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <div className="relative mb-4">
                  <div className="h-12 w-12 rounded-full border-4 border-zinc-100 border-t-zinc-800 animate-spin" />
                  <Camera className="absolute inset-0 m-auto h-5 w-5 text-zinc-800" />
                </div>
                <p className="text-sm font-medium text-zinc-700">Capturing screenshot...</p>
                <p className="text-xs text-zinc-400 mt-1">Rendering the page in a headless browser</p>
              </CardContent>
            </Card>
          )}

          {/* Screenshot Result */}
          {screenshotSrc && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
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
                  className="text-xs text-zinc-800 hover:underline flex items-center gap-1 ml-auto"
                >
                  Download <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              <Card className="border-zinc-200">
                <CardHeader className="pb-0">
                  <CardTitle className="text-lg">Screenshot</CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={screenshotSrc}
                    alt="Page screenshot"
                    className="w-full rounded-lg border border-zinc-200 shadow-sm"
                  />
                </CardContent>
              </Card>
            </div>
          )}

          {/* Screenshot empty state + cURL */}
          {!screenshotLoading && !screenshotSrc && !screenshotError && (
            <div className="grid md:grid-cols-2 gap-6">
              <Card className="border-zinc-200">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-zinc-800" />
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
                      <span className="text-xs font-semibold text-zinc-800 w-24 flex-shrink-0 pt-0.5">{key}</span>
                      <span className="text-xs text-zinc-600">{val}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card className="border-zinc-200">
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
            <Card className="border-zinc-200">
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
