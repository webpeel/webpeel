/**
 * Image alt-text enhancement module.
 *
 * Two strategies:
 * 1. Heuristic (no LLM) — generates captions from filename, URL path, and nearby text context
 * 2. LLM vision (with user's API key) — generates accurate descriptions via vision models
 */

// ---------------------------------------------------------------------------
// Heuristic helpers
// ---------------------------------------------------------------------------

const GENERIC_FILENAMES = new Set([
  'image', 'img', 'photo', 'picture', 'thumbnail', 'thumb',
  'icon', 'logo', 'banner', 'placeholder', 'default', 'hero',
  'bg', 'background', 'avatar', 'pic', 'graphic', 'figure', 'shot',
]);

const NOISE_PATH_SEGMENTS = new Set([
  'images', 'img', 'imgs', 'photos', 'assets', 'static', 'media',
  'public', 'uploads', 'files', 'resources', 'content', 'cdn',
  'dist', 'build', 'src', 'www', 'web', 'site',
]);

/**
 * Convert a URL slug / camelCase / underscored name into readable title-cased text.
 * Examples:
 *   "team-photo-2024" → "Team Photo 2024"
 *   "heroImage"       → "Hero Image"
 *   "my_product_shot" → "My Product Shot"
 */
function slugToTitle(slug: string): string {
  return slug
    .replace(/[-_]+/g, ' ')                     // hyphens/underscores → spaces
    .replace(/([a-z])([A-Z])/g, '$1 $2')        // camelCase split
    .replace(/([A-Z]{2,})([A-Z][a-z])/g, '$1 $2') // HTMLParser → HTML Parser
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());  // Title Case
}

/**
 * Derive a caption from the image src URL.
 * Tries (in order): filename, parent path segment.
 * Returns null if nothing useful can be derived.
 */
function captionFromUrl(src: string): string | null {
  try {
    const pathStr = src.startsWith('http') ? new URL(src).pathname : src;
    const parts = pathStr.split('/').filter(Boolean);

    // 1. Try the filename (without extension)
    const filename = parts[parts.length - 1] ?? '';
    const nameWithoutExt = filename.replace(/\.[^.]+$/, '');

    if (
      nameWithoutExt.length > 2 &&
      !GENERIC_FILENAMES.has(nameWithoutExt.toLowerCase())
    ) {
      const title = slugToTitle(nameWithoutExt);
      if (title.length > 2) return title;
    }

    // 2. Try meaningful parent path segments (walk up from the file)
    for (let i = parts.length - 2; i >= 0; i--) {
      const seg = parts[i];
      if (seg && seg.length > 2 && !NOISE_PATH_SEGMENTS.has(seg.toLowerCase())) {
        const title = slugToTitle(seg);
        return `${title} image`;
      }
    }
  } catch {
    // URL parse error — fall through
  }

  return null;
}

/**
 * Extract the nearest meaningful text context surrounding an img tag.
 * Searches up to 300 chars before and after the tag position.
 * Prefers headings, then figcaption, then raw surrounding text.
 */
function extractNearbyText(html: string, imgStart: number): string {
  const beforeHtml = html.slice(Math.max(0, imgStart - 300), imgStart);
  const afterHtml = html.slice(imgStart, Math.min(html.length, imgStart + 400));

  // Prefer the nearest heading before the image
  const headingMatches = beforeHtml.match(/<h[1-6][^>]*>([^<]{3,80})<\/h[1-6]>/gi);
  if (headingMatches) {
    const lastHeading = headingMatches[headingMatches.length - 1]!;
    const text = lastHeading.replace(/<[^>]+>/g, '').trim();
    if (text.length > 3) return text;
  }

  // Prefer figcaption near the image
  const figMatch = afterHtml.match(/<figcaption[^>]*>([^<]{3,120})<\/figcaption>/i);
  if (figMatch) {
    const text = (figMatch[1] ?? '').trim();
    if (text.length > 3) return text;
  }

  // Strip tags, return the richer side
  const stripTags = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const beforeText = stripTags(beforeHtml);
  const afterText = stripTags(afterHtml);

  return afterText.length > beforeText.length
    ? afterText.slice(0, 80)
    : beforeText.slice(-80);
}

// ---------------------------------------------------------------------------
// Public: heuristic alt-text enhancement
// ---------------------------------------------------------------------------

/**
 * Enhance images that lack alt text with heuristic-based descriptions.
 *
 * Processes <img> tags that have:
 * - No alt attribute at all
 * - An empty alt attribute (alt="")
 *
 * Caption priority:
 * 1. Filename analysis: `/images/team-photo-2024.jpg` → "Team Photo 2024"
 * 2. URL path segments: `/products/widget/hero.png` → "Widget image"
 * 3. Nearby heading/figcaption/paragraph text (within 300 chars)
 * 4. Generic fallback: "Image"
 *
 * Non-empty alt text is always preserved unchanged.
 *
 * @param html - Raw HTML string to process
 * @returns HTML with alt text added/replaced on qualifying img tags
 */
export function enhanceImageAltText(html: string): string {
  return html.replace(/<img(\s[^>]*)>/gi, (match: string, attrs: string, offset: number) => {
    const srcMatch = attrs.match(/\bsrc=["']([^"']*)["']/i);
    if (!srcMatch) return match; // No src — leave unchanged

    const src = srcMatch[1] ?? '';
    const altMatch = attrs.match(/\balt=["']([^"']*)["']/i);
    const altValue = altMatch ? altMatch[1] : null;

    // Already has meaningful alt text — preserve as-is
    if (altValue !== null && altValue.trim() !== '') return match;

    // Build caption: URL → nearby text → generic fallback
    let caption = captionFromUrl(src);
    if (!caption) {
      const nearbyText = extractNearbyText(html, offset).trim();
      if (nearbyText.length > 3) {
        caption = `Image: ${nearbyText.slice(0, 60)}`;
      } else {
        caption = 'Image';
      }
    }

    const escaped = caption.replace(/"/g, '&quot;');

    if (altMatch) {
      // Replace the empty alt value in-place
      const newAttrs = attrs.replace(/\balt=["'][^"']*["']/i, `alt="${escaped}"`);
      return `<img${newAttrs}>`;
    } else {
      // Prepend alt attribute (keeps src first is fine; alt first is valid too)
      return `<img alt="${escaped}"${attrs}>`;
    }
  });
}

// ---------------------------------------------------------------------------
// Public: LLM vision captioning (BYOK)
// ---------------------------------------------------------------------------

/**
 * Caption images using LLM vision models.
 *
 * Requires the user to supply their own API key. No key is stored server-side.
 * Processes images sequentially to avoid rate limiting.
 *
 * @param images - Array of {url, context} pairs. `context` is nearby text for better accuracy.
 * @param llmApiKey - API key for the chosen provider
 * @param llmProvider - Vision-capable model to use: 'openai' | 'anthropic' | 'google'
 * @returns Array of {url, caption} — same order as input
 */
export async function captionImagesWithLLM(
  images: { url: string; context: string }[],
  llmApiKey: string,
  llmProvider: 'openai' | 'anthropic' | 'google',
): Promise<{ url: string; caption: string }[]> {
  const results: { url: string; caption: string }[] = [];

  for (const image of images) {
    try {
      const prompt = `Write a concise, descriptive alt text (1–2 sentences) for this image. Context from the surrounding page: "${image.context || 'none'}". Be specific and informative.`;

      let caption = '';

      if (llmProvider === 'openai') {
        // GPT-4o-mini supports image_url with public URLs
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${llmApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            max_tokens: 120,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'image_url', image_url: { url: image.url, detail: 'low' } },
                  { type: 'text', text: prompt },
                ],
              },
            ],
          }),
        });
        const data = (await response.json()) as any;
        caption = (data?.choices?.[0]?.message?.content ?? '').trim();

      } else if (llmProvider === 'anthropic') {
        // claude-haiku-4-5 supports url-type image sources
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': llmApiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5',
            max_tokens: 120,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'image', source: { type: 'url', url: image.url } },
                  { type: 'text', text: prompt },
                ],
              },
            ],
          }),
        });
        const data = (await response.json()) as any;
        caption = (data?.content?.[0]?.text ?? '').trim();

      } else if (llmProvider === 'google') {
        // Gemini requires base64 inlineData — fetch the image first
        let imageData: string | null = null;
        let mimeType = 'image/jpeg';

        try {
          const imgResp = await fetch(image.url, {
            headers: { Accept: 'image/*,*/*;q=0.8' },
          });
          if (imgResp.ok) {
            const buffer = await imgResp.arrayBuffer();
            imageData = Buffer.from(buffer).toString('base64');
            const ct = imgResp.headers.get('content-type') ?? 'image/jpeg';
            mimeType = ct.split(';')[0]?.trim() ?? 'image/jpeg';
          }
        } catch {
          // Image download failed — skip this provider for this image
        }

        if (imageData) {
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${llmApiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [
                  {
                    parts: [
                      { inlineData: { mimeType, data: imageData } },
                      { text: prompt },
                    ],
                  },
                ],
              }),
            },
          );
          const data = (await response.json()) as any;
          caption = (data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
        }
      }

      results.push({ url: image.url, caption: caption || 'Image' });
    } catch {
      // Non-fatal — captioning failed for this image
      results.push({ url: image.url, caption: 'Image' });
    }
  }

  return results;
}
