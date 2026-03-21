export interface DomainExtractResult {
  /** Canonical domain name (e.g. 'twitter.com') */
  domain: string;
  /** Page type within the domain (e.g. 'tweet', 'thread', 'repo', 'issue') */
  type: string;
  /** Domain-specific structured data */
  structured: Record<string, any>;
  /** Clean markdown representation of the content */
  cleanContent: string;
  /** Raw HTML size in characters (from the actual HTML page fetched by the extractor) */
  rawHtmlSize?: number;
}

/** An extractor receives the raw HTML and original URL, may make API calls. */
export type DomainExtractor = (
  html: string,
  url: string
) => Promise<DomainExtractResult | null>;

