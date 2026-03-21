import { simpleFetch } from '../../core/fetcher.js';
import type { DomainExtractResult } from './types.js';
import { stripHtml, fetchJson } from './shared.js';

// ---------------------------------------------------------------------------
// PubMed extractor (NCBI E-utilities API — free, no key needed)
// ---------------------------------------------------------------------------

export async function pubmedExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  const urlObj = new URL(url);
  const path = urlObj.pathname;
  const domain = 'pubmed.ncbi.nlm.nih.gov';

  // --- Article page: /XXXXXX/ or /XXXXXX ---
  const pmidMatch = path.match(/^\/(\d+)\/?$/);
  if (pmidMatch) {
    const pmid = pmidMatch[1];
    try {
      // Fetch summary
      const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmid}&retmode=json`;
      const summaryData = await fetchJson(summaryUrl);
      if (!summaryData?.result) return null;

      const result = summaryData.result as Record<string, any>;
      const article = result[pmid];
      if (!article) return null;

      // Fetch abstract via efetch
      let abstract = '';
      try {
        const efetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${pmid}&retmode=xml&rettype=abstract`;
        const efetchResult = await simpleFetch(efetchUrl, 'WebPeel/0.21', 15000, { Accept: 'application/xml' });
        if (efetchResult?.html) {
          const abstractMatch = efetchResult.html.match(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g);
          if (abstractMatch) {
            abstract = abstractMatch.map((m: string) => {
              const labelMatch = m.match(/Label="([^"]+)"/);
              const textMatch = m.match(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/);
              const text = textMatch ? stripHtml(textMatch[1]).trim() : '';
              return labelMatch ? `**${labelMatch[1]}:** ${text}` : text;
            }).join('\n\n');
          }
        }
      } catch { /* abstract is optional */ }

      const authors: Array<{ name: string; authtype?: string }> = article.authors || [];
      const authorNames = authors.filter(a => a.authtype !== 'CollectiveName').map(a => a.name);
      const authorLine = authorNames.length <= 6
        ? authorNames.join(', ')
        : `${authorNames.slice(0, 6).join(', ')} et al.`;

      const doi = article.elocationid?.replace(/^doi:\s*/i, '') || null;
      const pubDate = article.pubdate || '?';
      const journal = article.source || '?';
      const volume = article.volume ? ` ${article.volume}` : '';
      const issue = article.issue ? `(${article.issue})` : '';
      const pages = article.pages ? `:${article.pages}` : '';

      const structured: Record<string, any> = {
        pmid,
        title: article.title,
        authors: authorNames,
        journal,
        pubDate,
        volume: article.volume,
        issue: article.issue,
        pages: article.pages,
        doi,
        abstract: abstract || undefined,
        url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      };

      const lines: string[] = [
        `# 🧬 ${article.title}`,
        '',
        `**Authors:** ${authorLine}`,
        `**Journal:** *${journal}*${volume}${issue}${pages} (${pubDate})`,
        `**PMID:** ${pmid}`,
      ];
      if (doi) lines.push(`**DOI:** [${doi}](https://doi.org/${doi})`);
      if (abstract) {
        lines.push('', '## Abstract', '', abstract);
      }
      lines.push('', `**Link:** [PubMed](https://pubmed.ncbi.nlm.nih.gov/${pmid}/)`);

      return {
        domain,
        type: 'article',
        structured,
        cleanContent: lines.join('\n'),
      };
    } catch (e) {
      if (process.env.DEBUG) console.debug('[webpeel]', 'PubMed article API failed:', e instanceof Error ? e.message : e);
      return null;
    }
  }

  // --- Search page: /?term=... or /?query=... ---
  const term = urlObj.searchParams.get('term') || urlObj.searchParams.get('query');
  if (term) {
    try {
      // Step 1: search for IDs
      const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(term)}&retmode=json&retmax=10`;
      const searchData = await fetchJson(searchUrl);
      if (!searchData?.esearchresult) return null;

      const esearch = searchData.esearchresult as Record<string, any>;
      const ids: string[] = esearch.idlist || [];
      const total: number = parseInt(esearch.count || '0', 10);

      if (ids.length === 0) {
        return {
          domain,
          type: 'search',
          structured: { query: term, total: 0, articles: [] },
          cleanContent: `# 🔍 PubMed — "${term}"\n\n*No results found.*`,
        };
      }

      // Step 2: fetch summaries
      const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`;
      const summaryData = await fetchJson(summaryUrl);
      if (!summaryData?.result) return null;

      const result = summaryData.result as Record<string, any>;
      const articles = (result.uids as string[] || ids).map((id) => {
        const a = result[id];
        if (!a) return null;
        const authors: Array<{ name: string }> = a.authors || [];
        return {
          pmid: id,
          title: a.title as string,
          journal: a.source as string,
          pubDate: a.pubdate as string,
          authors: authors.map(x => x.name),
          doi: (a.elocationid as string | undefined)?.replace(/^doi:\s*/i, '') || null,
        };
      }).filter(Boolean) as Array<{ pmid: string; title: string; journal: string; pubDate: string; authors: string[]; doi: string | null }>;

      const rows = articles.map((a, i) => {
        const authorLine = a.authors.length === 0 ? '—'
          : a.authors.length === 1 ? a.authors[0]
          : `${a.authors[0]} et al.`;
        const link = `https://pubmed.ncbi.nlm.nih.gov/${a.pmid}/`;
        return `| ${i + 1} | [${a.title}](${link}) | *${a.journal}* | ${a.pubDate} | ${authorLine} |`;
      }).join('\n');

      const cleanContent = [
        `# 🔍 PubMed — "${term}"`,
        '',
        '| # | Article | Journal | Date | Authors |',
        '|---|---------|---------|------|---------|',
        rows,
        '',
        `*Source: NCBI PubMed E-utilities · Total results: ${total.toLocaleString()}*`,
      ].join('\n');

      return {
        domain,
        type: 'search',
        structured: { query: term, total, articles },
        cleanContent,
      };
    } catch (e) {
      if (process.env.DEBUG) console.debug('[webpeel]', 'PubMed search API failed:', e instanceof Error ? e.message : e);
      return null;
    }
  }

  return null;
}

