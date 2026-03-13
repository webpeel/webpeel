/**
 * Tests for transcript export format converters.
 *
 * Covers: toSRT, toTXT, toMarkdownDoc, toJSON, formatSRTTimestamp
 */

import { describe, it, expect } from 'vitest';
import {
  toSRT,
  toTXT,
  toMarkdownDoc,
  toJSON,
  formatSRTTimestamp,
} from '../core/transcript-export.js';
import type { TranscriptSegment } from '../core/transcript-export.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const SAMPLE_SEGMENTS: TranscriptSegment[] = [
  { text: "We're no strangers to love", start: 1.0, duration: 3.5 },
  { text: 'You know the rules and so do I', start: 4.5, duration: 3.5 },
  { text: 'A full commitment is what I\'m thinking of', start: 8.0, duration: 4.0 },
];

const UNICODE_SEGMENTS: TranscriptSegment[] = [
  { text: '안녕하세요 여러분', start: 0.0, duration: 2.0 },
  { text: '日本語のテスト', start: 2.0, duration: 3.0 },
  { text: 'Ärger über Möhrenkuchen', start: 5.0, duration: 2.5 },
];

const LONG_SEGMENT: TranscriptSegment = {
  text: 'This is a very long line of text that contains many words and should still be handled correctly without being truncated or modified in any way by the export functions.',
  start: 100.0,
  duration: 10.0,
};

// ---------------------------------------------------------------------------
// formatSRTTimestamp
// ---------------------------------------------------------------------------

describe('formatSRTTimestamp', () => {
  it('formats zero as 00:00:00,000', () => {
    expect(formatSRTTimestamp(0)).toBe('00:00:00,000');
  });

  it('formats sub-second values with milliseconds', () => {
    expect(formatSRTTimestamp(0.5)).toBe('00:00:00,500');
    expect(formatSRTTimestamp(1.001)).toBe('00:00:01,001');
  });

  it('formats minutes correctly', () => {
    expect(formatSRTTimestamp(90)).toBe('00:01:30,000');
    expect(formatSRTTimestamp(61.25)).toBe('00:01:01,250');
  });

  it('formats hours correctly', () => {
    expect(formatSRTTimestamp(3661.5)).toBe('01:01:01,500');
    expect(formatSRTTimestamp(7322.123)).toBe('02:02:02,123');
  });

  it('pads all components with leading zeros', () => {
    const ts = formatSRTTimestamp(3600); // exactly 1 hour
    expect(ts).toBe('01:00:00,000');
  });

  it('handles large values (10+ hours)', () => {
    const ts = formatSRTTimestamp(36001);
    expect(ts).toMatch(/^\d{2}:\d{2}:\d{2},\d{3}$/);
  });

  it('handles negative numbers gracefully (clamps to 0)', () => {
    expect(formatSRTTimestamp(-5)).toBe('00:00:00,000');
  });
});

// ---------------------------------------------------------------------------
// toSRT
// ---------------------------------------------------------------------------

describe('toSRT', () => {
  it('returns empty string for empty segments', () => {
    expect(toSRT([])).toBe('');
  });

  it('produces numbered entries starting at 1', () => {
    const out = toSRT(SAMPLE_SEGMENTS);
    const lines = out.split('\n');
    expect(lines[0]).toBe('1');
    // find second block
    const block2Start = lines.indexOf('2');
    expect(block2Start).toBeGreaterThan(0);
  });

  it('formats timestamps as HH:MM:SS,mmm --> HH:MM:SS,mmm', () => {
    const out = toSRT(SAMPLE_SEGMENTS);
    expect(out).toContain('00:00:01,000 --> 00:00:04,500');
    expect(out).toContain('00:00:04,500 --> 00:00:08,000');
  });

  it('includes segment text after the timestamp line', () => {
    const out = toSRT(SAMPLE_SEGMENTS);
    expect(out).toContain("We're no strangers to love");
    expect(out).toContain('You know the rules and so do I');
  });

  it('separates entries with a blank line', () => {
    const out = toSRT(SAMPLE_SEGMENTS);
    // Each block ends with \n\n separating it from the next
    expect(out).toContain('\n\n');
  });

  it('numbers entries sequentially', () => {
    const out = toSRT(SAMPLE_SEGMENTS);
    const numbers = out.split('\n').filter(l => /^\d+$/.test(l.trim())).map(Number);
    expect(numbers).toEqual([1, 2, 3]);
  });

  it('handles a single segment', () => {
    const single = [{ text: 'Hello world', start: 5.0, duration: 2.0 }];
    const out = toSRT(single);
    expect(out).toBe('1\n00:00:05,000 --> 00:00:07,000\nHello world');
  });

  it('uses start + duration as end time', () => {
    const seg = [{ text: 'Test', start: 10.5, duration: 4.5 }];
    const out = toSRT(seg);
    // 10.5 + 4.5 = 15.0 seconds
    expect(out).toContain('00:00:10,500 --> 00:00:15,000');
  });

  it('handles unicode text', () => {
    const out = toSRT(UNICODE_SEGMENTS);
    expect(out).toContain('안녕하세요 여러분');
    expect(out).toContain('日本語のテスト');
    expect(out).toContain('Ärger über Möhrenkuchen');
  });

  it('handles long text without truncation', () => {
    const out = toSRT([LONG_SEGMENT]);
    expect(out).toContain(LONG_SEGMENT.text);
  });

  it('handles segments with zero duration', () => {
    const seg = [{ text: 'Instant', start: 3.0, duration: 0 }];
    const out = toSRT(seg);
    expect(out).toContain('00:00:03,000 --> 00:00:03,000');
  });

  it('handles hour-range timestamps in SRT', () => {
    const seg = [{ text: 'Late', start: 3665.0, duration: 2.0 }];
    const out = toSRT(seg);
    expect(out).toContain('01:01:05,000 --> 01:01:07,000');
  });
});

// ---------------------------------------------------------------------------
// toTXT
// ---------------------------------------------------------------------------

describe('toTXT', () => {
  it('returns empty string for empty segments', () => {
    expect(toTXT([])).toBe('');
  });

  it('returns one line per segment', () => {
    const out = toTXT(SAMPLE_SEGMENTS);
    const lines = out.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("We're no strangers to love");
    expect(lines[1]).toBe('You know the rules and so do I');
    expect(lines[2]).toBe("A full commitment is what I'm thinking of");
  });

  it('contains no timestamps', () => {
    const out = toTXT(SAMPLE_SEGMENTS);
    expect(out).not.toMatch(/\d+:\d{2}/); // no time codes
  });

  it('handles unicode segments', () => {
    const out = toTXT(UNICODE_SEGMENTS);
    expect(out).toContain('안녕하세요 여러분');
    expect(out).toContain('日本語のテスト');
  });

  it('handles long text without modification', () => {
    const out = toTXT([LONG_SEGMENT]);
    expect(out).toBe(LONG_SEGMENT.text);
  });

  it('handles single segment', () => {
    const out = toTXT([{ text: 'Hello', start: 0, duration: 1 }]);
    expect(out).toBe('Hello');
  });
});

// ---------------------------------------------------------------------------
// toMarkdownDoc
// ---------------------------------------------------------------------------

describe('toMarkdownDoc', () => {
  it('includes the title as an H1 heading', () => {
    const out = toMarkdownDoc('My Video', 'My Channel', SAMPLE_SEGMENTS);
    expect(out).toContain('# My Video');
  });

  it('includes the channel name in bold', () => {
    const out = toMarkdownDoc('Title', 'Awesome Channel', SAMPLE_SEGMENTS);
    expect(out).toContain('**Channel:** Awesome Channel');
  });

  it('includes a "## Transcript" section heading', () => {
    const out = toMarkdownDoc('Title', 'Channel', SAMPLE_SEGMENTS);
    expect(out).toContain('## Transcript');
  });

  it('includes timestamped segment text in bold bracket format', () => {
    const out = toMarkdownDoc('Title', 'Channel', SAMPLE_SEGMENTS);
    // First segment starts at 1.0 → "0:01"
    expect(out).toContain('**[0:01]**');
    expect(out).toContain("We're no strangers to love");
  });

  it('formats timestamps as M:SS for sub-hour segments', () => {
    const out = toMarkdownDoc('T', 'C', [{ text: 'Test', start: 125, duration: 1 }]);
    expect(out).toContain('**[2:05]**');
  });

  it('formats timestamps as H:MM:SS for hour+ segments', () => {
    const out = toMarkdownDoc('T', 'C', [{ text: 'Late', start: 3665, duration: 1 }]);
    expect(out).toContain('**[1:01:05]**');
  });

  it('handles empty segments array', () => {
    const out = toMarkdownDoc('Title', 'Channel', []);
    expect(out).toContain('# Title');
    expect(out).toContain('**Channel:** Channel');
    expect(out).toContain('## Transcript');
    // No lines with timestamps
    expect(out).not.toMatch(/\*\*\[\d/);
  });

  it('handles missing title gracefully', () => {
    const out = toMarkdownDoc('', 'Channel', SAMPLE_SEGMENTS);
    expect(out).toContain('# Transcript'); // fallback heading
  });

  it('handles missing channel gracefully', () => {
    const out = toMarkdownDoc('Title', '', SAMPLE_SEGMENTS);
    expect(out).not.toContain('**Channel:**');
  });

  it('handles unicode text', () => {
    const out = toMarkdownDoc('日本語動画', '테스트 채널', UNICODE_SEGMENTS);
    expect(out).toContain('# 日本語動画');
    expect(out).toContain('**Channel:** 테스트 채널');
    expect(out).toContain('안녕하세요 여러분');
  });
});

// ---------------------------------------------------------------------------
// toJSON
// ---------------------------------------------------------------------------

describe('toJSON', () => {
  const mockTranscript = {
    videoId: 'dQw4w9WgXcQ',
    title: 'Never Gonna Give You Up',
    channel: 'Rick Astley',
    duration: '3:33',
    language: 'en',
    segments: SAMPLE_SEGMENTS,
    fullText: "We're no strangers to love...",
    availableLanguages: ['en'],
    wordCount: 25,
  };

  it('returns valid JSON', () => {
    const out = toJSON(mockTranscript);
    expect(() => JSON.parse(out)).not.toThrow();
  });

  it('is pretty-printed with 2-space indentation', () => {
    const out = toJSON(mockTranscript);
    expect(out).toContain('\n  "');
  });

  it('preserves all transcript fields', () => {
    const out = toJSON(mockTranscript);
    const parsed = JSON.parse(out);
    expect(parsed.videoId).toBe('dQw4w9WgXcQ');
    expect(parsed.title).toBe('Never Gonna Give You Up');
    expect(parsed.channel).toBe('Rick Astley');
    expect(parsed.segments).toHaveLength(3);
    expect(parsed.wordCount).toBe(25);
  });

  it('preserves segments with start/duration/text', () => {
    const out = toJSON(mockTranscript);
    const parsed = JSON.parse(out);
    expect(parsed.segments[0]).toEqual(SAMPLE_SEGMENTS[0]);
  });

  it('handles empty segments array', () => {
    const out = toJSON({ ...mockTranscript, segments: [] });
    const parsed = JSON.parse(out);
    expect(parsed.segments).toEqual([]);
  });

  it('handles unicode values', () => {
    const transcript = { ...mockTranscript, title: '日本語タイトル', segments: UNICODE_SEGMENTS };
    const out = toJSON(transcript);
    const parsed = JSON.parse(out);
    expect(parsed.title).toBe('日本語タイトル');
    expect(parsed.segments[0].text).toBe('안녕하세요 여러분');
  });
});
