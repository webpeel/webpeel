export interface SearchIntent {
  type: 'cars' | 'flights' | 'hotels' | 'rental' | 'restaurants' | 'products' | 'general';
  query: string;
  params: Record<string, string>;
  /** Suggested domain sources for this intent — hints for result boosting, not filtering */
  suggestedDomains?: string[];
}

export interface SmartSearchResult {
  type: 'cars' | 'flights' | 'hotels' | 'rental' | 'restaurants' | 'products' | 'general';
  source: string;
  sourceUrl: string;
  content: string;
  title?: string;
  domainData?: any;
  structured?: any;
  results?: any[];
  tokens: number;
  fetchTimeMs: number;
  loadingMessage?: string;
  answer?: string;
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
  sources?: Array<{ title: string; url: string; domain: string }>;
  timing?: { searchMs: number; peelMs: number; llmMs: number };
  mapUrl?: string;
  safety?: {
    verified: boolean;
    promptInjectionsBlocked: number;
    maliciousPatternsStripped: number;
    sourcesChecked: number;
  };
  /** Suggested authoritative domains for this query (financial → reuters, etc.) */
  suggestedDomains?: string[];
}
