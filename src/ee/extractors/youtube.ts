import { getYouTubeTranscript } from '../../core/youtube.js';
import type { DomainExtractResult } from './types.js';
import { fetchJson } from './shared.js';

// ---------------------------------------------------------------------------
// 6. YouTube extractor (oEmbed API-first)
// ---------------------------------------------------------------------------

export async function youtubeExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  // Helper: wrap a promise with a timeout
  function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)),
    ]);
  }

  // Run transcript fetch and oEmbed fetch in parallel
  // Proxy-based extraction takes 2-5s, but retry logic may need more time
  const transcriptPromise = withTimeout(getYouTubeTranscript(url), 30000);
  const oembedPromise = fetchJson(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
  const noembedPromise = fetchJson(`https://noembed.com/embed?url=${encodeURIComponent(url)}`).catch(() => null);

  // Fetch subscriber count from channel page (lightweight, parallel)
  const subscriberPromise = (async (): Promise<string> => {
    try {
      // Wait for oEmbed to get channel URL, then fetch subscriber count from channel page
      const oembed = await oembedPromise;
      const channelUrl = (oembed as any)?.author_url;
      if (!channelUrl) return '';
      const resp = await fetch(channelUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' },
        signal: AbortSignal.timeout(5000),
      });
      const html = await resp.text();
      // Look for subscriber count in page metadata (e.g. "4.12M subscribers")
      const subMatch = html.match(/(\d+(?:\.\d+)?[KMBkmb]?)\s*subscribers/i);
      return subMatch ? subMatch[1] + ' subscribers' : '';
    } catch { return ''; }
  })();

  const [transcriptResult, oembedResult, noembedResult, subscriberResult] = await Promise.allSettled([
    transcriptPromise,
    oembedPromise,
    noembedPromise,
    subscriberPromise,
  ]);

  const transcript = transcriptResult.status === 'fulfilled' ? transcriptResult.value : null;
  const oembedData = oembedResult.status === 'fulfilled' ? oembedResult.value : null;
  const noembedData = noembedResult.status === 'fulfilled' ? noembedResult.value : null;
  const subscriberCount = subscriberResult.status === 'fulfilled' ? subscriberResult.value : '';

  if (process.env.DEBUG) {
    if (transcriptResult.status === 'rejected') {
      console.debug('[webpeel]', 'YouTube transcript failed:', transcriptResult.reason instanceof Error ? transcriptResult.reason.message : transcriptResult.reason);
    }
    if (oembedResult.status === 'rejected') {
      console.debug('[webpeel]', 'YouTube oEmbed failed:', oembedResult.reason instanceof Error ? oembedResult.reason.message : oembedResult.reason);
    }
  }

  // If transcript succeeded, build rich content
  if (transcript) {
    const title = transcript.title || oembedData?.title || '';
    const channel = transcript.channel || oembedData?.author_name || '';
    const channelUrl = oembedData?.author_url || `https://www.youtube.com/@${channel}`;
    const description = transcript.description || (noembedData as any)?.description || (oembedData as any)?.description || '';
    const thumbnailUrl = (oembedData as any)?.thumbnail_url || '';
    const publishDate = transcript.publishDate || '';
    const hasTranscript = transcript.segments.length > 0;

    const structured: Record<string, any> = {
      title,
      channel,
      channelUrl,
      subscriberCount: subscriberCount || undefined,
      duration: transcript.duration,
      publishDate,
      language: transcript.language,
      availableLanguages: transcript.availableLanguages,
      transcriptSegments: transcript.segments.length,
      wordCount: transcript.wordCount ?? 0,
      viewCount: transcript.viewCount ?? '',
      likeCount: transcript.likeCount ?? '',
      description,
      thumbnailUrl,
      chapters: transcript.chapters ?? [],
      keyPoints: transcript.keyPoints ?? [],
      source: 'transcript',
    };

    // Format the publish date nicely if it's an ISO date
    let publishStr = '';
    if (publishDate) {
      try {
        const d = new Date(publishDate);
        publishStr = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', day: 'numeric' });
      } catch {
        publishStr = publishDate;
      }
    }

    // Format view count (e.g. "1,234,567" → "1.2M views")
    let viewStr = '';
    if (transcript.viewCount) {
      const v = parseInt(transcript.viewCount, 10);
      if (!isNaN(v)) {
        if (v >= 1_000_000) viewStr = `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M views`;
        else if (v >= 1_000) viewStr = `${(v / 1_000).toFixed(1).replace(/\.0$/, '')}K views`;
        else viewStr = `${v.toLocaleString()} views`;
      }
    }

    // Build header line
    const channelPart = subscriberCount ? `${channel} (${subscriberCount})` : channel;
    const headerParts = [`**Channel:** ${channelPart}`];
    if (transcript.duration && transcript.duration !== '0:00') headerParts.push(`**Duration:** ${transcript.duration}`);
    if (viewStr) headerParts.push(`**${viewStr}**`);
    if (publishStr) headerParts.push(`**Published:** ${publishStr}`);
    const headerLine = headerParts.join(' | ');

    const parts: string[] = [];
    parts.push(`# ${title}`);
    parts.push(headerLine);

    /**
     * Strip music note symbols from transcript/caption text.
     * YouTube auto-captions include ♪ and 🎵 as music cues.
     * Patterns cleaned:
     *   [♪♪♪]  →  (removed)
     *   ♪ text ♪  →  text
     *   standalone ♪ / 🎵  →  (removed)
     */
    const cleanMusicNotes = (text: string): string =>
      text
        // Remove bracketed music cues: [♪], [♪♪♪], [🎵🎵🎵], etc.
        .replace(/\[[♪🎵]+\]/g, '')
        // Unwrap ♪ text ♪ → text (keep the words between notes)
        .replace(/♪\s*([^♪]*?)\s*♪/g, (_, inner) => inner.trim())
        // Remove any remaining standalone ♪ or 🎵
        .replace(/[♪🎵]+/g, '')
        // Collapse extra whitespace introduced by removals
        .replace(/\s{2,}/g, ' ')
        .trim();

    // Summary section
    if (transcript.summary && hasTranscript) {
      let summaryText = cleanMusicNotes(transcript.summary);
      summaryText = summaryText.replace(/([.!?])\s+(?=[A-Z])/g, '$1\n\n');
      parts.push(`## Summary\n\n${summaryText}`);
    } else if (!hasTranscript && transcript.fullText) {
      parts.push(`## Description\n\n${transcript.fullText}`);
    }

    // Key Points section
    if (transcript.keyPoints && transcript.keyPoints.length > 0) {
      const kpLines = transcript.keyPoints.map(kp => `- ${kp}`).join('\n');
      parts.push(`## Key Points\n\n${kpLines}`);
    }

    // Chapters section
    if (transcript.chapters && transcript.chapters.length > 0) {
      const chLines = transcript.chapters.map(ch => `- ${ch.time} — ${ch.title}`).join('\n');
      parts.push(`## Chapters\n\n${chLines}`);
    }

    // Full Transcript section (only if we have real transcript segments)
    // Add intelligent paragraph breaks for readability
    if (hasTranscript) {
      let readableText = cleanMusicNotes(transcript.fullText);
      // Break into paragraphs: after sentence-ending punctuation followed by a capital letter
      readableText = readableText.replace(/([.!?])\s+(?=[A-Z])/g, '$1\n\n');
      // Collapse any triple+ newlines
      readableText = readableText.replace(/\n{3,}/g, '\n\n');
      parts.push(`## Full Transcript\n\n${readableText}`);
    }

    const cleanContent = parts.join('\n\n');

    return { domain: 'youtube.com', type: 'video', structured, cleanContent };
  }

  // Fall back to oEmbed if transcript failed
  if (oembedData && (oembedData as any).title) {
    const structured: Record<string, any> = {
      title: (oembedData as any).title,
      channel: (oembedData as any).author_name || '',
      channelUrl: (oembedData as any).author_url || '',
      thumbnailUrl: (oembedData as any).thumbnail_url || '',
      description: (noembedData as any)?.description || '',
      type: (oembedData as any).type || 'video',
      source: 'oembed',
    };

    const descSection = structured.description ? `\n\n${structured.description}` : '\n\nYouTube video';
    const cleanContent = `## 🎬 ${structured.title}\n\n**Channel:** [${structured.channel}](${structured.channelUrl})${descSection}`;

    return { domain: 'youtube.com', type: 'video', structured, cleanContent };
  }

  return null;
}

