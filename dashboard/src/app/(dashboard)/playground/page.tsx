'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
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
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.webpeel.dev';

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

export default function PlaygroundPage() {
  const { data: session } = useSession();
  const token = (session as any)?.apiToken as string | undefined;

  const [url, setUrl] = useState('');
  const [format, setFormat] = useState<Format>('markdown');
  const [renderBrowser, setRenderBrowser] = useState(false);
  const [stealthMode, setStealthMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FetchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);

  const handleFetch = async () => {
    if (!url.trim()) return;
    if (!token) {
      setError('No API token available. Please sign in again.');
      return;
    }

    // Add https if missing
    let fetchUrl = url.trim();
    if (!fetchUrl.startsWith('http://') && !fetchUrl.startsWith('https://')) {
      fetchUrl = 'https://' + fetchUrl;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    const startTime = Date.now();

    try {
      const params = new URLSearchParams({
        url: fetchUrl,
        format,
        ...(renderBrowser ? { render: 'true' } : {}),
        ...(stealthMode ? { stealth: 'true' } : {}),
      });

      const response = await fetch(`${API_URL}/v1/fetch?${params}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const ms = Date.now() - startTime;
      setElapsed(ms);

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ message: `HTTP ${response.status}` }));
        throw new Error(errData.message || `Request failed with status ${response.status}`);
      }

      const data = await response.json();
      setResult(data);
    } catch (err: any) {
      setElapsed(Date.now() - startTime);
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading) {
      handleFetch();
    }
  };

  const getContent = (): string => {
    if (!result) return '';
    return result.markdown || result.content || result.text || result.html || '';
  };

  const curlCommand = url
    ? `curl "${API_URL}/v1/fetch?url=${encodeURIComponent(url)}&format=${format}${renderBrowser ? '&render=true' : ''}${stealthMode ? '&stealth=true' : ''}" \\
  -H "Authorization: Bearer YOUR_API_KEY"`
    : `curl "${API_URL}/v1/fetch?url=https://example.com&format=markdown" \\
  -H "Authorization: Bearer YOUR_API_KEY"`;

  return (
    <div className="mx-auto max-w-6xl space-y-6 md:space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-zinc-900 flex items-center gap-2">
          <Play className="h-7 w-7 text-zinc-800" />
          Playground
        </h1>
        <p className="text-sm md:text-base text-zinc-500 mt-1">
          Test the WebPeel API live — fetch any URL and see the results instantly
        </p>
      </div>

      {/* Main Fetch Card */}
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
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="pl-9 font-mono text-sm"
                  disabled={loading}
                />
              </div>
              <Button
                onClick={handleFetch}
                disabled={loading || !url.trim()}
                className="bg-[#5865F2] hover:bg-[#4752C4] gap-2 px-6 flex-shrink-0"
              >
                {loading ? (
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
            {/* Example URLs */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-zinc-400">Try:</span>
              {exampleUrls.map((exUrl) => (
                <button
                  key={exUrl}
                  onClick={() => setUrl(exUrl)}
                  className="text-xs text-zinc-800 hover:text-zinc-800 hover:underline transition-colors"
                >
                  {exUrl.replace('https://', '')}
                </button>
              ))}
            </div>
          </div>

          {/* Options Row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Format Selector */}
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

            {/* Browser Rendering Toggle */}
            <div className="flex flex-col gap-2">
              <Label className="text-sm font-semibold text-zinc-900">Browser Rendering</Label>
              <div className="flex items-center gap-3 h-9 px-3 bg-zinc-50 rounded-lg border border-zinc-200">
                <Switch
                  id="render-toggle"
                  checked={renderBrowser}
                  onCheckedChange={setRenderBrowser}
                />
                <label htmlFor="render-toggle" className="text-xs text-zinc-600 cursor-pointer">
                  {renderBrowser ? 'JS rendering on' : 'Basic fetch'}
                </label>
              </div>
            </div>

            {/* Stealth Mode Toggle */}
            <div className="flex flex-col gap-2">
              <Label className="text-sm font-semibold text-zinc-900">Stealth Mode</Label>
              <div className="flex items-center gap-3 h-9 px-3 bg-zinc-50 rounded-lg border border-zinc-200">
                <Switch
                  id="stealth-toggle"
                  checked={stealthMode}
                  onCheckedChange={setStealthMode}
                />
                <label htmlFor="stealth-toggle" className="text-xs text-zinc-600 cursor-pointer">
                  {stealthMode ? 'Anti-bot bypass' : 'Standard mode'}
                </label>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error Display */}
      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="flex items-start gap-3 pt-4 md:pt-6">
            <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-900">Request Failed</p>
              <p className="text-xs text-red-700 mt-1">{error}</p>
              {elapsed != null && (
                <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Failed after {elapsed}ms
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results Display */}
      {result && (
        <div className="space-y-4">
          {/* Result Metadata Bar */}
          <div className="flex flex-wrap items-center gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
            <Badge className="bg-emerald-100 text-emerald-700 border-0">
              ✓ Success
            </Badge>
            {elapsed != null && (
              <span className="text-xs text-zinc-600 flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {elapsed}ms
              </span>
            )}
            {result.title && (
              <span className="text-xs text-zinc-600 truncate max-w-xs">
                <span className="text-zinc-400">Title:</span> {result.title}
              </span>
            )}
            {result.tokenCount && (
              <span className="text-xs text-zinc-600">
                <span className="text-zinc-400">~</span>{result.tokenCount.toLocaleString()} tokens
              </span>
            )}
            {result.url && (
              <a
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-zinc-800 hover:underline flex items-center gap-1 ml-auto"
              >
                View original
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>

          {/* Result Content Tabs */}
          <Card className="border-zinc-200">
            <CardHeader className="pb-0">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Result</CardTitle>
                <CopyButton text={getContent()} size="sm" />
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <Tabs defaultValue="content" className="w-full">
                <TabsList className="mb-4">
                  <TabsTrigger value="content">Content</TabsTrigger>
                  {result.links && result.links.length > 0 && (
                    <TabsTrigger value="links">Links ({result.links.length})</TabsTrigger>
                  )}
                  <TabsTrigger value="raw">Raw JSON</TabsTrigger>
                </TabsList>

                <TabsContent value="content" className="mt-0">
                  <pre className="p-4 bg-zinc-900 text-zinc-100 rounded-lg overflow-auto text-xs md:text-sm max-h-[60vh] whitespace-pre-wrap leading-relaxed">
                    <code>{getContent() || '(no content returned)'}</code>
                  </pre>
                </TabsContent>

                {result.links && result.links.length > 0 && (
                  <TabsContent value="links" className="mt-0">
                    <div className="rounded-lg border border-zinc-200 overflow-auto max-h-[60vh]">
                      {result.links.map((link, i) => (
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
                    <code>{JSON.stringify(result, null, 2)}</code>
                  </pre>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Loading State */}
      {loading && (
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

      {/* Empty State + Curl Example */}
      {!loading && !result && !error && (
        <div className="grid md:grid-cols-2 gap-6">
          {/* What it does */}
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

          {/* Curl Example */}
          <Card className="border-zinc-200">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Equivalent cURL</CardTitle>
                <CopyButton text={curlCommand} size="sm" />
              </div>
            </CardHeader>
            <CardContent>
              <pre className="p-3 bg-zinc-900 text-zinc-100 rounded-lg text-xs overflow-x-auto whitespace-pre-wrap">
                <code>{curlCommand}</code>
              </pre>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Show curl after results too */}
      {(result || error) && (
        <Card className="border-zinc-200">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Equivalent cURL command</CardTitle>
                <CardDescription>Reproduce this request in your terminal</CardDescription>
              </div>
              <CopyButton text={curlCommand} size="sm" />
            </div>
          </CardHeader>
          <CardContent>
            <pre className="p-3 bg-zinc-900 text-zinc-100 rounded-lg text-xs overflow-x-auto whitespace-pre-wrap">
              <code>{curlCommand}</code>
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
