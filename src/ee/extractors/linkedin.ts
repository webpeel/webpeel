import type { DomainExtractResult } from './types.js';
import { tryParseJson } from './shared.js';

// ---------------------------------------------------------------------------
// 17. LinkedIn extractor
// ---------------------------------------------------------------------------

export async function linkedinExtractor(html: string, url: string): Promise<DomainExtractResult | null> {
  try {
    const { load } = await import('cheerio');
    const $ = load(html);

    // Detect page type from URL first
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(Boolean);
    const pageType = pathParts[0] === 'company' ? 'company'
      : pathParts[0] === 'in' ? 'profile'
      : pathParts[0] === 'jobs' ? 'job'
      : 'page';

    // Detect if we're on the authwall (LinkedIn redirects unauthenticated requests)
    const isAuthwall = html.includes('authwall') || html.includes('Join LinkedIn') || html.includes('Sign in') && !html.includes('linkedin.com/in/');

    // --- Try parsing meta tags / JSON-LD from the HTML ---
    let jsonLd: any = null;
    $('script[type="application/ld+json"]').each((_: any, el: any) => {
      if (jsonLd) return;
      const raw = $(el).html() || '';
      const parsed = tryParseJson(raw);
      if (parsed?.['@type'] === 'Person' || parsed?.['@type'] === 'Organization') jsonLd = parsed;
    });

    const ogTitle = $('meta[property="og:title"]').attr('content') || '';
    const ogDescription = $('meta[property="og:description"]').attr('content') || '';
    const ogImage = $('meta[property="og:image"]').attr('content') || '';
    const metaDescription = $('meta[name="description"]').attr('content') || '';

    let name = jsonLd?.name || ogTitle.replace(/ \| LinkedIn$/, '').replace(/Sign Up \| LinkedIn$/, '').trim() || '';
    // When on authwall, discard authwall-specific meta data
    let headline = isAuthwall ? (jsonLd?.jobTitle || '') : (jsonLd?.jobTitle || metaDescription?.split('|')?.[0]?.trim() || ogDescription || '');
    let description = isAuthwall ? (jsonLd?.description || '') : (jsonLd?.description || ogDescription || '');
    let location = $('[class*="location"]').first().text().trim() || jsonLd?.address?.addressLocality || '';

    // --- If authwall or no useful data, try direct HTTPS fetch with minimal headers ---
    // LinkedIn returns rich og: meta tags when fetched with a plain browser UA (no Sec-Fetch-* noise)
    if (!name || isAuthwall || name.toLowerCase().includes('sign up') || name.toLowerCase().includes('linkedin')) {
      try {
        const { default: httpsLI } = await import('https');
        const { gunzip } = await import('zlib');
        const linkedInHtml = await new Promise<string>((resolve, reject) => {
          const req = httpsLI.request({
            hostname: 'www.linkedin.com',
            path: urlObj.pathname,
            method: 'GET',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml',
              'Accept-Language': 'en-US,en;q=0.9',
              'Accept-Encoding': 'gzip, deflate',
            },
          }, (res) => {
            if (res.statusCode && res.statusCode >= 400) { reject(new Error(`HTTP ${res.statusCode}`)); res.resume(); return; }
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => {
              const buf = Buffer.concat(chunks);
              const enc = res.headers['content-encoding'] || '';
              if (enc === 'gzip') {
                gunzip(buf, (err, decoded) => err ? reject(err) : resolve(decoded.toString('utf8')));
              } else {
                resolve(buf.toString('utf8'));
              }
            });
          });
          req.on('error', reject);
          setTimeout(() => req.destroy(new Error('timeout')), 10000);
          req.end();
        });
        if (linkedInHtml) {
          const $li = load(linkedInHtml);
          const liOgTitle = $li('meta[property="og:title"]').attr('content') || '';
          const liOgDesc = $li('meta[property="og:description"]').attr('content') || '';
          // Only use if it has real profile data (not authwall)
          if (liOgTitle && !liOgTitle.toLowerCase().includes('sign up') && !liOgTitle.toLowerCase().includes('join linkedin')) {
            // "Name - Headline | LinkedIn" or "Name | LinkedIn"
            const titleParts = liOgTitle.replace(/ \| LinkedIn$/, '').split(/\s*[-–]\s*/);
            if (titleParts[0]) name = titleParts[0].trim();
            if (titleParts[1]) headline = titleParts[1].trim();
            if (liOgDesc) description = liOgDesc;
          }
        }
      } catch { /* direct fetch optional */ }
    }

    if (!name) return null;

    const structured: Record<string, any> = {
      name, headline, description, location, pageType,
      image: ogImage, url,
    };

    const typeLine = pageType === 'company' ? '🏢' : pageType === 'profile' ? '👤' : '🔗';
    const locationLine = location ? `\n📍 ${location}` : '';
    const headlineLine = headline && headline !== name ? `\n*${headline}*` : '';
    const descriptionLine = description ? `\n\n${description}` : '';
    const authNote = '\n\n⚠️ Full LinkedIn profiles require authentication. Use /v1/session to log in first.';

    const cleanContent = `# ${typeLine} ${name} — LinkedIn${headlineLine}${locationLine}${descriptionLine}${authNote}`;

    return { domain: 'linkedin.com', type: pageType, structured, cleanContent };
  } catch {
    return null;
  }
}

