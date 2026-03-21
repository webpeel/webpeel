import type { DomainExtractResult } from './types.js';
import { fetchJson } from './shared.js';

// ---------------------------------------------------------------------------
// 18. PyPI extractor
// ---------------------------------------------------------------------------

export async function pypiExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  const urlObj = new URL(url);
  const path = urlObj.pathname;

  // Match /project/name or /project/name/version/
  const packageMatch = path.match(/\/project\/([^/]+)/);
  if (!packageMatch) return null;

  const packageName = packageMatch[1];

  try {
    const apiUrl = `https://pypi.org/pypi/${encodeURIComponent(packageName)}/json`;
    const data = await fetchJson(apiUrl);

    if (!data?.info) return null;
    const info = data.info;

    const structured: Record<string, any> = {
      title: `${info.name} ${info.version}`,
      name: info.name,
      version: info.version,
      description: info.summary || '',
      author: info.author || '',
      authorEmail: info.author_email || '',
      license: info.license || 'N/A',
      homepage: info.home_page || info.project_url || null,
      projectUrls: info.project_urls || {},
      keywords: info.keywords ? info.keywords.split(/[,\s]+/).filter(Boolean) : [],
      requiresPython: info.requires_python || '',
      requiresDist: (info.requires_dist || []).slice(0, 20),
      classifiers: (info.classifiers || []).slice(0, 10),
    };

    // Full description/README from PyPI (info.description is the full README in markdown)
    const fullDescription = info.description && info.description.length > 100 &&
      info.description !== 'UNKNOWN' && info.description !== info.summary
      ? info.description.slice(0, 8000)
      : null;

    // Store full description in structured
    structured.fullDescription = fullDescription;

    const installCmd = `pip install ${info.name}`;
    const keywordsLine = structured.keywords.length ? `\n**Keywords:** ${structured.keywords.join(', ')}` : '';
    const pyVersionLine = structured.requiresPython ? `\n**Requires Python:** ${structured.requiresPython}` : '';
    // Show all dependencies
    const depsLine = structured.requiresDist.length
      ? `\n\n## Dependencies\n\n${structured.requiresDist.map((d: string) => `- ${d}`).join('\n')}`
      : '';

    // Classifiers — extract useful ones (license, status, Python versions)
    const usefulClassifiers = structured.classifiers.filter((c: string) =>
      c.startsWith('Programming Language') || c.startsWith('License') || c.startsWith('Development Status')
    );
    const classifiersSection = usefulClassifiers.length
      ? `\n\n## Classifiers\n\n${usefulClassifiers.map((c: string) => `- ${c}`).join('\n')}`
      : '';

    // Find project URLs
    const projectUrlLines: string[] = [];
    for (const [label, u] of Object.entries(structured.projectUrls)) {
      projectUrlLines.push(`- **${label}:** ${u}`);
    }

    // Full description section (package README from PyPI)
    const descSection = fullDescription
      ? `\n\n## Description\n\n${fullDescription}`
      : '';

    const cleanContent = `# 📦 ${info.name} ${info.version}

${info.summary || ''}

\`\`\`
${installCmd}
\`\`\`

**Author:** ${info.author || 'N/A'} | **License:** ${info.license || 'N/A'}${keywordsLine}${pyVersionLine}

${projectUrlLines.length ? `## Links\n\n${projectUrlLines.join('\n')}\n` : ''}${depsLine}${classifiersSection}${descSection}`;

    return { domain: 'pypi.org', type: 'package', structured, cleanContent };
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'PyPI API failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

