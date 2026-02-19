/**
 * Site-Aware Search URL Builders
 *
 * Provides URL templates for popular websites so AI agents can search them
 * without needing to know site-specific URL structures.
 *
 * @module site-search
 */

export interface SiteSearchResult {
  url: string;
  site: string;
  query: string;
}

export interface SiteTemplate {
  name: string;
  searchUrl: (query: string) => string;
  category: 'shopping' | 'social' | 'jobs' | 'general' | 'tech' | 'real-estate' | 'food';
}

/**
 * URL templates for popular sites, keyed by site ID.
 * All query values are URL-encoded via encodeURIComponent.
 */
export const SITE_TEMPLATES: Record<string, SiteTemplate> = {
  // ── Shopping ──────────────────────────────────────────────────────────────
  ebay: {
    name: 'eBay',
    category: 'shopping',
    searchUrl: (q) => `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}`,
  },
  amazon: {
    name: 'Amazon',
    category: 'shopping',
    searchUrl: (q) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}`,
  },
  walmart: {
    name: 'Walmart',
    category: 'shopping',
    searchUrl: (q) => `https://www.walmart.com/search?q=${encodeURIComponent(q)}`,
  },
  target: {
    name: 'Target',
    category: 'shopping',
    searchUrl: (q) => `https://www.target.com/s?searchTerm=${encodeURIComponent(q)}`,
  },
  bestbuy: {
    name: 'Best Buy',
    category: 'shopping',
    searchUrl: (q) => `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(q)}`,
  },
  etsy: {
    name: 'Etsy',
    category: 'shopping',
    searchUrl: (q) => `https://www.etsy.com/search?q=${encodeURIComponent(q)}`,
  },
  aliexpress: {
    name: 'AliExpress',
    category: 'shopping',
    searchUrl: (q) => `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(q)}`,
  },
  newegg: {
    name: 'Newegg',
    category: 'shopping',
    searchUrl: (q) => `https://www.newegg.com/p/pl?d=${encodeURIComponent(q)}`,
  },

  // ── General ───────────────────────────────────────────────────────────────
  google: {
    name: 'Google',
    category: 'general',
    searchUrl: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  },
  bing: {
    name: 'Bing',
    category: 'general',
    searchUrl: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
  },
  duckduckgo: {
    name: 'DuckDuckGo',
    category: 'general',
    searchUrl: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
  },

  // ── Social / Content ──────────────────────────────────────────────────────
  reddit: {
    name: 'Reddit',
    category: 'social',
    searchUrl: (q) => `https://www.reddit.com/search/?q=${encodeURIComponent(q)}`,
  },
  youtube: {
    name: 'YouTube',
    category: 'social',
    searchUrl: (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
  },
  twitter: {
    name: 'X (Twitter)',
    category: 'social',
    searchUrl: (q) => `https://x.com/search?q=${encodeURIComponent(q)}`,
  },
  linkedin: {
    name: 'LinkedIn',
    category: 'social',
    searchUrl: (q) => `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(q)}`,
  },

  // ── Tech ──────────────────────────────────────────────────────────────────
  github: {
    name: 'GitHub',
    category: 'tech',
    searchUrl: (q) => `https://github.com/search?q=${encodeURIComponent(q)}`,
  },
  stackoverflow: {
    name: 'Stack Overflow',
    category: 'tech',
    searchUrl: (q) => `https://stackoverflow.com/search?q=${encodeURIComponent(q)}`,
  },
  npm: {
    name: 'npm',
    category: 'tech',
    searchUrl: (q) => `https://www.npmjs.com/search?q=${encodeURIComponent(q)}`,
  },
  pypi: {
    name: 'PyPI',
    category: 'tech',
    searchUrl: (q) => `https://pypi.org/search/?q=${encodeURIComponent(q)}`,
  },

  // ── Real Estate ───────────────────────────────────────────────────────────
  zillow: {
    name: 'Zillow',
    category: 'real-estate',
    searchUrl: (q) => `https://www.zillow.com/homes/${encodeURIComponent(q)}_rb/`,
  },
  realtor: {
    name: 'Realtor.com',
    category: 'real-estate',
    searchUrl: (q) => `https://www.realtor.com/realestateandhomes-search/${encodeURIComponent(q)}`,
  },

  // ── Jobs ──────────────────────────────────────────────────────────────────
  indeed: {
    name: 'Indeed',
    category: 'jobs',
    searchUrl: (q) => `https://www.indeed.com/jobs?q=${encodeURIComponent(q)}`,
  },
  glassdoor: {
    name: 'Glassdoor',
    category: 'jobs',
    searchUrl: (q) => `https://www.glassdoor.com/Job/jobs.htm?sc.keyword=${encodeURIComponent(q)}`,
  },
  'linkedin-jobs': {
    name: 'LinkedIn Jobs',
    category: 'jobs',
    searchUrl: (q) => `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(q)}`,
  },

  // ── Food ──────────────────────────────────────────────────────────────────
  yelp: {
    name: 'Yelp',
    category: 'food',
    searchUrl: (q) => `https://www.yelp.com/search?find_desc=${encodeURIComponent(q)}`,
  },
  doordash: {
    name: 'DoorDash',
    category: 'food',
    searchUrl: (q) => `https://www.doordash.com/search/store/${encodeURIComponent(q)}`,
  },
  ubereats: {
    name: 'Uber Eats',
    category: 'food',
    searchUrl: (q) => `https://www.ubereats.com/search?q=${encodeURIComponent(q)}`,
  },
};

/** Aliases that map to canonical site IDs */
const SITE_ALIASES: Record<string, string> = {
  x: 'twitter',
  'best-buy': 'bestbuy',
  'ali-express': 'aliexpress',
  'stack-overflow': 'stackoverflow',
  'duck-duck-go': 'duckduckgo',
};

/**
 * Resolve a site ID (or alias) to its canonical key.
 * Returns null if not found.
 */
function resolveSiteId(site: string): string | null {
  const lower = site.toLowerCase();
  if (lower in SITE_TEMPLATES) return lower;
  if (lower in SITE_ALIASES) return SITE_ALIASES[lower]!;
  return null;
}

/**
 * Build a search URL for a given site and query.
 *
 * @param site  Site ID (e.g. "ebay", "amazon") or alias (e.g. "x")
 * @param query Search query string
 * @throws Error if the site is not recognized
 */
export function buildSiteSearchUrl(site: string, query: string): SiteSearchResult {
  const canonical = resolveSiteId(site);
  if (!canonical) {
    const available = Object.keys(SITE_TEMPLATES).join(', ');
    throw new Error(
      `Unknown site: "${site}". Available sites: ${available}. ` +
      `Run "webpeel sites" to list all supported sites.`
    );
  }

  const template = SITE_TEMPLATES[canonical]!;
  return {
    url: template.searchUrl(query),
    site: canonical,
    query,
  };
}

/**
 * List all available site templates in a flat array.
 */
export function listSites(): Array<{ id: string; name: string; category: string }> {
  return Object.entries(SITE_TEMPLATES).map(([id, template]) => ({
    id,
    name: template.name,
    category: template.category,
  }));
}

/**
 * Find which site ID a given URL belongs to (reverse lookup).
 * Returns the canonical site ID, or null if the URL doesn't match any template.
 */
export function findSiteByUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, '');

    // Map of hostnames to site IDs
    const hostnameMap: Record<string, string> = {
      'ebay.com': 'ebay',
      'amazon.com': 'amazon',
      'walmart.com': 'walmart',
      'target.com': 'target',
      'bestbuy.com': 'bestbuy',
      'etsy.com': 'etsy',
      'aliexpress.com': 'aliexpress',
      'newegg.com': 'newegg',
      'google.com': 'google',
      'bing.com': 'bing',
      'html.duckduckgo.com': 'duckduckgo',
      'duckduckgo.com': 'duckduckgo',
      'reddit.com': 'reddit',
      'youtube.com': 'youtube',
      'x.com': 'twitter',
      'twitter.com': 'twitter',
      'linkedin.com': 'linkedin',
      'github.com': 'github',
      'stackoverflow.com': 'stackoverflow',
      'npmjs.com': 'npm',
      'pypi.org': 'pypi',
      'zillow.com': 'zillow',
      'realtor.com': 'realtor',
      'indeed.com': 'indeed',
      'glassdoor.com': 'glassdoor',
      'yelp.com': 'yelp',
      'doordash.com': 'doordash',
      'ubereats.com': 'ubereats',
    };

    return hostnameMap[hostname] ?? null;
  } catch {
    return null;
  }
}
