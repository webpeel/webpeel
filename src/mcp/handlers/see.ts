/**
 * handleSee — take a screenshot, optionally with design analysis or comparison.
 */

import { textResult, safeStringify, timeout, type McpHandler } from './types.js';

export const handleSee: McpHandler = async (args, _ctx?) => {
  const url = args['url'] as string;
  if (!url || typeof url !== 'string') throw new Error('url is required');
  if (url.length > 2048) throw new Error('URL too long (max 2048 characters)');

  const mode = (args['mode'] as string | undefined) || 'screenshot';
  const compareUrl = args['compare_url'] as string | undefined;
  const fullPage = (args['full_page'] as boolean | undefined) || false;
  const viewportArg = args['viewport'];

  // Resolve viewport dimensions
  let width = 1280;
  let height = 720;
  if (viewportArg && typeof viewportArg === 'object' && !Array.isArray(viewportArg)) {
    const vp = viewportArg as { width?: number; height?: number };
    width = vp.width ?? 1280;
    height = vp.height ?? 720;
  } else if (viewportArg === 'mobile') {
    width = 390; height = 844;
  } else if (viewportArg === 'tablet') {
    width = 768; height = 1024;
  }
  // Secondary object check (handles smart router viewport object)
  if (args['viewport'] && typeof args['viewport'] === 'object') {
    const vp = args['viewport'] as { width?: number; height?: number };
    if (vp.width) width = vp.width;
    if (vp.height) height = vp.height;
  }

  if (mode === 'design') {
    const { browserDesignAnalysis } = await import('../../core/fetcher.js');
    const result = await Promise.race([
      browserDesignAnalysis(url, { width, height }),
      timeout<never>(90000, 'Design analysis'),
    ]) as { analysis: unknown; finalUrl: string };
    return textResult(safeStringify({ url: result.finalUrl, mode: 'design', analysis: result.analysis }));
  }

  if (mode === 'compare' && compareUrl) {
    const { browserDiff } = await import('../../core/fetcher.js');
    const diff = await Promise.race([
      browserDiff(url, compareUrl, { width, height, fullPage }),
      timeout<never>(90000, 'Design compare'),
    ]) as { diffBuffer: Buffer; diffPixels: number; totalPixels: number; diffPercent: number };
    return textResult(safeStringify({
      url,
      compare_url: compareUrl,
      mode: 'compare',
      diffPixels: diff.diffPixels,
      totalPixels: diff.totalPixels,
      diffPercent: diff.diffPercent,
      screenshot: diff.diffBuffer.toString('base64'),
    }));
  }

  // Default: screenshot
  const { takeScreenshot } = await import('../../core/screenshot.js');
  const result = await Promise.race([
    takeScreenshot(url, { fullPage, width, height, format: 'png' }),
    timeout<never>(60000, 'Screenshot'),
  ]) as { url: string; screenshot: string; format: string };

  return textResult(safeStringify({
    url: result.url,
    mode: 'screenshot',
    screenshot: result.screenshot,
    format: result.format,
  }));
};
