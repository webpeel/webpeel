/**
 * Transcript export format converters.
 *
 * Converts YouTube transcript data into SRT, plain text, Markdown, or JSON
 * so users can download transcripts in their preferred format.
 */

import type { TranscriptSegment, YouTubeTranscript } from './youtube.js';

// Re-export types so consumers can import from a single location
export type { TranscriptSegment, YouTubeTranscript as TranscriptResult };

// ---------------------------------------------------------------------------
// Timestamp helpers
// ---------------------------------------------------------------------------

/**
 * Format seconds as an SRT timestamp: HH:MM:SS,mmm
 *
 * @example formatSRTTimestamp(3661.5) → "01:01:01,500"
 */
export function formatSRTTimestamp(seconds: number): string {
  const totalMs = Math.round(Math.max(0, seconds) * 1000);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  return (
    `${String(h).padStart(2, '0')}:` +
    `${String(m).padStart(2, '0')}:` +
    `${String(s).padStart(2, '0')},` +
    `${String(ms).padStart(3, '0')}`
  );
}

/**
 * Format seconds as a human-readable timestamp: M:SS or H:MM:SS
 *
 * @example formatReadableTimestamp(125.3) → "2:05"
 */
function formatReadableTimestamp(seconds: number): string {
  const totalSec = Math.floor(Math.max(0, seconds));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Export functions
// ---------------------------------------------------------------------------

/**
 * Convert transcript segments to SRT subtitle format.
 *
 * SRT structure:
 * ```
 * 1
 * 00:00:01,000 --> 00:00:04,500
 * We're no strangers to love
 *
 * 2
 * 00:00:04,500 --> 00:00:08,000
 * You know the rules and so do I
 * ```
 */
export function toSRT(segments: TranscriptSegment[]): string {
  if (segments.length === 0) return '';

  return segments
    .map((seg, i) => {
      const start = formatSRTTimestamp(seg.start);
      const end = formatSRTTimestamp(seg.start + Math.max(0, seg.duration));
      return `${i + 1}\n${start} --> ${end}\n${seg.text}`;
    })
    .join('\n\n');
}

/**
 * Convert transcript segments to plain text.
 * One line per segment, no timestamps.
 */
export function toTXT(segments: TranscriptSegment[]): string {
  return segments.map((seg) => seg.text).join('\n');
}

/**
 * Convert transcript to a clean Markdown document.
 * Includes title, channel header, and timestamped transcript lines.
 *
 * @param title   - Video title
 * @param channel - Channel name
 * @param segments - Transcript segments
 */
export function toMarkdownDoc(
  title: string,
  channel: string,
  segments: TranscriptSegment[],
): string {
  const lines: string[] = [];

  lines.push(`# ${title || 'Transcript'}`);
  lines.push('');

  if (channel) {
    lines.push(`**Channel:** ${channel}`);
    lines.push('');
  }

  lines.push('## Transcript');
  lines.push('');

  for (const seg of segments) {
    const ts = formatReadableTimestamp(seg.start);
    lines.push(`**[${ts}]** ${seg.text}`);
  }

  return lines.join('\n');
}

/**
 * Convert full transcript result to pretty-printed JSON.
 */
export function toJSON(result: YouTubeTranscript): string {
  return JSON.stringify(result, null, 2);
}
