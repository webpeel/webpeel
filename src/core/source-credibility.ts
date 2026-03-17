/**
 * Source credibility scoring — lightweight, zero dependencies.
 * 
 * Classifies URLs by trustworthiness:
 *   - Official (★★★): .gov, .edu, .mil, WHO, NIH, academic journals
 *   - Verified (★★):  Wikipedia, Reuters, BBC, GitHub, StackOverflow
 *   - General (★):    Everything else
 */

export interface SourceCredibility {
  tier: 'official' | 'verified' | 'general';
  stars: number;   // 3=official, 2=verified, 1=general
  label: string;   // 'OFFICIAL SOURCE' | 'VERIFIED' | 'UNVERIFIED'
}

/** Official TLDs and hostnames that indicate high-authority sources */
const OFFICIAL_TLDS = new Set(['.gov', '.edu', '.mil']);

const OFFICIAL_HOSTNAMES = new Set([
  // Academic / research
  'arxiv.org', 'scholar.google.com', 'pubmed.ncbi.nlm.nih.gov', 'ncbi.nlm.nih.gov',
  'jstor.org', 'nature.com', 'science.org', 'cell.com', 'nejm.org', 'bmj.com',
  'thelancet.com', 'plos.org', 'springer.com', 'elsevier.com',
  // International organisations
  'who.int', 'un.org', 'worldbank.org', 'imf.org', 'oecd.org', 'europa.eu',
  // Official tech documentation
  'docs.python.org', 'developer.mozilla.org', 'nodejs.org', 'rust-lang.org',
  'docs.microsoft.com', 'learn.microsoft.com', 'developer.apple.com',
  'developer.android.com', 'php.net', 'ruby-lang.org', 'golang.org', 'go.dev',
  // Health / medicine
  'cdc.gov', 'nih.gov', 'fda.gov', 'mayoclinic.org', 'clevelandclinic.org',
  'webmd.com', 'medlineplus.gov',
  // Standards / specs
  'w3.org', 'ietf.org', 'rfc-editor.org', 'iso.org',
]);

const VERIFIED_HOSTNAMES = new Set([
  // Encyclopaedia / reference
  'wikipedia.org', 'en.wikipedia.org', 'britannica.com',
  // Reputable news agencies
  'reuters.com', 'apnews.com', 'bbc.com', 'bbc.co.uk', 'nytimes.com',
  'washingtonpost.com', 'theguardian.com', 'economist.com', 'ft.com',
  'cnn.com', 'npr.org', 'pbs.org',
  // Developer resources
  'github.com', 'stackoverflow.com', 'npmjs.com', 'pypi.org',
  'crates.io', 'docs.rs', 'packagist.org', 'rubygems.org',
  // Official cloud / vendor docs
  'docs.aws.amazon.com', 'cloud.google.com', 'docs.github.com',
  'azure.microsoft.com', 'registry.terraform.io',
  // Reputable tech publications
  'arstechnica.com', 'wired.com', 'techcrunch.com', 'theverge.com',
  // National Geographic, Smithsonian
  'nationalgeographic.com', 'smithsonianmag.com',
]);

/**
 * Assess the credibility of a source URL.
 */
export function getSourceCredibility(url: string): SourceCredibility {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');

    // Check official TLDs
    for (const tld of OFFICIAL_TLDS) {
      if (hostname.endsWith(tld)) {
        return { tier: 'official', stars: 3, label: 'OFFICIAL SOURCE' };
      }
    }

    // Check known official hostnames  
    if (OFFICIAL_HOSTNAMES.has(hostname)) {
      return { tier: 'official', stars: 3, label: 'OFFICIAL SOURCE' };
    }

    // Check parent domain (e.g. en.wikipedia.org → wikipedia.org)
    const parts = hostname.split('.');
    if (parts.length > 2) {
      const parentDomain = parts.slice(-2).join('.');
      if (OFFICIAL_HOSTNAMES.has(parentDomain)) {
        return { tier: 'official', stars: 3, label: 'OFFICIAL SOURCE' };
      }
      if (VERIFIED_HOSTNAMES.has(parentDomain)) {
        return { tier: 'verified', stars: 2, label: 'VERIFIED' };
      }
    }

    // Check known verified hostnames
    if (VERIFIED_HOSTNAMES.has(hostname)) {
      return { tier: 'verified', stars: 2, label: 'VERIFIED' };
    }

    // Everything else
    return { tier: 'general', stars: 1, label: 'UNVERIFIED' };
  } catch {
    return { tier: 'general', stars: 1, label: 'UNVERIFIED' };
  }
}
