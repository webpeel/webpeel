import type { DomainExtractResult } from './types.js';
import { tryParseJson } from './shared.js';

// ---------------------------------------------------------------------------
// 16. IMDB extractor
// ---------------------------------------------------------------------------

export async function imdbExtractor(html: string, url: string): Promise<DomainExtractResult | null> {
  try {
    const { load } = await import('cheerio');
    const $ = load(html);

    // IMDB uses JSON-LD richly
    let jsonLd: any = null;
    $('script[type="application/ld+json"]').each((_: any, el: any) => {
      if (jsonLd) return;
      const raw = $(el).html() || '';
      const parsed = tryParseJson(raw);
      if (parsed?.['@type'] === 'Movie' || parsed?.['@type'] === 'TVSeries' || parsed?.['@type'] === 'TVEpisode') {
        jsonLd = parsed;
      }
    });

    const title = jsonLd?.name ||
      $('meta[property="og:title"]').attr('content')?.replace(/ - IMDb$/, '') ||
      $('h1[data-testid="hero__pageTitle"] span').first().text().trim() || '';

    if (!title) return null;

    const description = jsonLd?.description ||
      $('meta[property="og:description"]').attr('content') ||
      $('p[data-testid="plot"]').text().trim() || '';

    const year = jsonLd?.datePublished?.substring(0, 4) ||
      $('a[href*="releaseinfo"]').first().text().trim() || '';

    const ratingValue = jsonLd?.aggregateRating?.ratingValue ||
      $('[data-testid="hero-rating-bar__aggregate-rating__score"] span').first().text().trim() || '';

    const ratingCount = jsonLd?.aggregateRating?.ratingCount || '';

    const contentType = jsonLd?.['@type'] || 'Movie';

    // Genres
    const genres: string[] = jsonLd?.genre
      ? (Array.isArray(jsonLd.genre) ? jsonLd.genre : [jsonLd.genre])
      : [];
    if (!genres.length) {
      $('[data-testid="genres"] a, a[href*="/search/title?genres"]').each((_: any, el: any) => {
        const g = $(el).text().trim();
        if (g && !genres.includes(g)) genres.push(g);
      });
    }

    // Director
    const director = jsonLd?.director
      ? (Array.isArray(jsonLd.director)
        ? jsonLd.director.map((d: any) => d.name || d).join(', ')
        : jsonLd.director?.name || String(jsonLd.director))
      : $('a[href*="/name/"][class*="ipc-metadata-list-item__list-content-item"]').first().text().trim() || '';

    // Cast — parse HTML first for actor+character pairs, then fall back to JSON-LD
    const castPairs: Array<{ actor: string; character: string }> = [];
    // IMDB new UI: each title-cast-item contains actor link + character link
    $('[data-testid="title-cast-item"]').each((_: any, el: any) => {
      const actorEl = $(el).find('a[href*="/name/nm"]').first();
      const charEl = $(el).find('[data-testid="title-cast-item__character"]').first();
      const actor = actorEl.text().trim();
      // Character name may span multiple elements; clean whitespace
      const character = charEl.text().trim().replace(/\s+/g, ' ').replace(/^\.\.\.$/, '');
      if (actor && actor.length > 1) {
        castPairs.push({ actor, character: character || '' });
      }
    });

    // Fall back to classic cast list (older IMDB page versions)
    const castFromHtml: string[] = [];
    if (!castPairs.length) {
      $('.cast_list td.itemprop a').each((_: any, el: any) => {
        const name = $(el).text().trim();
        if (name && name.length > 1 && !castFromHtml.includes(name)) castFromHtml.push(name);
      });
    }

    // JSON-LD actors as final fallback
    const castFromLd: string[] = jsonLd?.actor
      ? (Array.isArray(jsonLd.actor) ? jsonLd.actor : [jsonLd.actor])
          .map((a: any) => a.name || a)
      : [];

    // Build final cast list: with characters if available (top 10), otherwise names only
    const cast: string[] = castPairs.length > 0
      ? castPairs.slice(0, 10).map(({ actor, character }) =>
          character ? `${actor} as ${character}` : actor)
      : [...new Set([...castFromLd, ...castFromHtml])].slice(0, 10);

    // Runtime
    const runtime = jsonLd?.duration
      ? (() => {
          const m = String(jsonLd.duration).match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
          if (m) return [m[1] ? `${m[1]}h` : '', m[2] ? `${m[2]}m` : ''].filter(Boolean).join(' ');
          return String(jsonLd.duration);
        })()
      : '';

    // Full plot/storyline — try to get the longer version from HTML
    const fullPlot = $('[data-testid="storyline-plot-summary"] span, [data-testid="plot-xl"] span, span[data-testid="plot-l"], #titleStoryLine p, .plot_summary .summary_text').first().text().trim() || description;

    // Additional details: Writers, Keywords, Awards
    const writers: string[] = [];
    $('[data-testid="title-pc-wide-screen"] li[data-testid="title-pc-principal-credit"]:nth-child(2) a, .credit_summary_item:contains("Writer") a').each((_: any, el: any) => {
      const name = $(el).text().trim();
      if (name && !writers.includes(name)) writers.push(name);
    });

    // Keywords — try HTML first, fall back to JSON-LD keywords
    let keywords: string[] = [];
    $('[data-testid="storyline-plot-keywords"] a, .see-more.inline.canwrap span a, a[href*="keyword"]').each((_: any, el: any) => {
      const kw = $(el).text().trim();
      if (kw && kw.length < 30 && !keywords.includes(kw)) keywords.push(kw);
    });
    // Fall back to JSON-LD keywords if HTML didn't yield any
    if (!keywords.length && jsonLd?.keywords) {
      keywords = (typeof jsonLd.keywords === 'string'
        ? jsonLd.keywords.split(',')
        : Array.isArray(jsonLd.keywords) ? jsonLd.keywords : []
      ).map((k: string) => k.trim()).filter(Boolean);
    }

    // Writers — also try JSON-LD creator field
    if (!writers.length && jsonLd?.creator) {
      const creators = Array.isArray(jsonLd.creator) ? jsonLd.creator : [jsonLd.creator];
      for (const c of creators) {
        const name = c?.name || (typeof c === 'string' ? c : '');
        if (name && !writers.includes(name)) writers.push(name);
      }
    }

    // Awards / accolades — try hero accolades chip, then any awards-related link text
    let awardsSummary = '';
    // IMDB new UI: awards accolades chip in the hero section
    const accoladesEl = $('[data-testid="awards-accolades"]');
    if (accoladesEl.length) {
      awardsSummary = accoladesEl.text().trim().replace(/\s+/g, ' ');
    }
    // Fallback: look for per-title awards link (href contains the title ID /tt\d+/awards)
    if (!awardsSummary) {
      const titleMatch = url.match(/\/(tt\d+)/);
      const titleId = titleMatch ? titleMatch[1] : '';
      if (titleId) {
        $(`a[href*="${titleId}"][href*="awards"]`).each((_: any, el: any): false | void => {
          const text = $(el).text().trim().replace(/\s+/g, ' ');
          if (text && text.length > 3 && text.length < 200) {
            awardsSummary = text;
            return false; // break
          }
        });
      }
    }
    // Fallback: JSON-LD award field
    if (!awardsSummary && jsonLd?.award) {
      awardsSummary = typeof jsonLd.award === 'string' ? jsonLd.award : '';
    }

    // Content rating & release date from JSON-LD
    const contentRating = jsonLd?.contentRating || '';
    const datePublished = jsonLd?.datePublished || '';

    const structured: Record<string, any> = {
      title, year, contentType, description: fullPlot, ratingValue, ratingCount,
      genres, director, writers, cast, runtime, keywords, contentRating, datePublished, awardsSummary, url,
    };

    const ratingLine = ratingValue ? `⭐ ${ratingValue}/10${ratingCount ? ` (${Number(ratingCount).toLocaleString()} votes)` : ''}` : '';
    const genreLine = genres.length ? genres.join(', ') : '';
    const directorLine = director ? `**Director:** ${director}` : '';
    const writersLine = writers.length ? `**Writers:** ${writers.slice(0, 5).join(', ')}` : '';
    const castLine = cast.length ? `**Cast:** ${cast.join(', ')}` : '';
    const runtimeLine = runtime ? `**Runtime:** ${runtime}` : '';
    const ratedLine = contentRating ? `**Rated:** ${contentRating}` : '';
    const releaseLine = datePublished ? `**Released:** ${datePublished}` : '';
    const keywordsLine = keywords.length ? `\n**Keywords:** ${keywords.slice(0, 10).join(', ')}` : '';
    const awardsLine = awardsSummary ? `**Awards:** ${awardsSummary}` : '';

    const metaParts = [ratingLine, genreLine, runtimeLine, year ? `**Year:** ${year}` : ''].filter(Boolean).join(' | ');

    const detailParts = [directorLine, writersLine, castLine, ratedLine, releaseLine, awardsLine].filter(Boolean).join('\n');

    const cleanContent = `# 🎬 ${title}\n\n${metaParts}\n\n${detailParts}${keywordsLine}\n\n## Plot\n\n${fullPlot}`;

    return { domain: 'imdb.com', type: contentType === 'TVSeries' ? 'tv_show' : 'movie', structured, cleanContent };
  } catch {
    return null;
  }
}

