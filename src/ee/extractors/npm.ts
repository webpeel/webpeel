import { simpleFetch } from '../../core/fetcher.js';
import type { DomainExtractResult } from './types.js';
import { fetchJson } from './shared.js';

// ---------------------------------------------------------------------------
// 9. NPM extractor (npm registry API)
// ---------------------------------------------------------------------------

export async function npmExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  const urlObj = new URL(url);
  const path = urlObj.pathname;

  // Match /package/name or /package/@scope/name
  const packageMatch = path.match(/\/package\/((?:@[^/]+\/)?[^/]+)/);
  if (!packageMatch) return null;

  const packageName = packageMatch[1];

  try {
    const apiUrl = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;
    const data = await fetchJson(apiUrl);

    if (!data?.name) return null;

    const latest = data['dist-tags']?.latest;
    const latestVersion = latest ? data.versions?.[latest] : null;

    // Get download counts
    let downloads: any = null;
    try {
      downloads = await fetchJson(`https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(packageName)}`);
    } catch { /* optional */ }

    const structured: Record<string, any> = {
      title: `${data.name}@${latest || 'unknown'}`,
      name: data.name,
      description: data.description || '',
      version: latest || 'unknown',
      license: latestVersion?.license || data.license || 'N/A',
      homepage: data.homepage || latestVersion?.homepage || null,
      repository: typeof data.repository === 'string' ? data.repository : data.repository?.url || null,
      author: typeof data.author === 'string' ? data.author : data.author?.name || '',
      keywords: data.keywords || [],
      weeklyDownloads: downloads?.downloads || 0,
      dependencies: Object.keys(latestVersion?.dependencies || {}),
      devDependencies: Object.keys(latestVersion?.devDependencies || {}),
      maintainers: (data.maintainers || []).map((m: any) => m.name || m).slice(0, 10),
      created: data.time?.created || undefined,
      modified: data.time?.modified || undefined,
    };

    // Include README if available (some packages have it, some don't)
    let readmeText = data.readme && data.readme.length > 10 ? data.readme.slice(0, 5000) : '';

    // If no README in registry, try fetching from unpkg.com
    if (!readmeText) {
      try {
        const unpkgUrl = `https://unpkg.com/${encodeURIComponent(packageName)}/README.md`;
        const readmeResult = await simpleFetch(unpkgUrl, undefined, 10000);
        if (readmeResult?.html && readmeResult.html.length > 10 && !readmeResult.html.trim().startsWith('<')) {
          readmeText = readmeResult.html.slice(0, 5000);
        }
      } catch { /* README from unpkg optional */ }
    }

    // Add to structured data
    structured.readme = readmeText;

    const keywordsLine = structured.keywords.length ? `\n**Keywords:** ${structured.keywords.join(', ')}` : '';
    // Show ALL dependencies (not capped at 15)
    const depsLine = structured.dependencies.length
      ? `\n**Dependencies (${structured.dependencies.length}):** ${structured.dependencies.join(', ')}`
      : '';
    const devDepsLine = structured.devDependencies.length
      ? `\n**Dev Dependencies (${structured.devDependencies.length}):** ${structured.devDependencies.slice(0, 10).join(', ')}${structured.devDependencies.length > 10 ? '...' : ''}`
      : '';
    const repoLine = structured.repository ? `\n**Repository:** ${structured.repository.replace('git+', '').replace('.git', '')}` : '';
    const homepageLine = structured.homepage ? `\n**Homepage:** ${structured.homepage}` : '';
    const datesLine = structured.created ? `\n**Created:** ${structured.created?.split('T')[0] || 'N/A'} | **Last modified:** ${structured.modified?.split('T')[0] || 'N/A'}` : '';

    const readmeSection = readmeText
      ? `\n\n### README\n\n${readmeText}`
      : '';

    const cleanContent = `# 📦 ${structured.name}@${structured.version}

${structured.description}

**License:** ${structured.license} | **Weekly Downloads:** ${structured.weeklyDownloads?.toLocaleString() || 'N/A'}
**Author:** ${structured.author || 'N/A'} | **Maintainers:** ${structured.maintainers.join(', ') || 'N/A'}${keywordsLine}${depsLine}${devDepsLine}${repoLine}${homepageLine}${datesLine}${readmeSection}`;

    return { domain: 'npmjs.com', type: 'package', structured, cleanContent };
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'NPM API failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

