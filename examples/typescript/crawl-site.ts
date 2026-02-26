/**
 * WebPeel — Crawl Site Example (TypeScript)
 *
 * Crawls an entire website and saves each page as a markdown file.
 * Useful for building knowledge bases, documentation scrapers, or content archives.
 *
 * Setup:
 *   npm install webpeel
 *   export WEBPEEL_API_KEY=wp_your_key_here
 *
 * Run:
 *   npx ts-node examples/typescript/crawl-site.ts
 */

import { WebPeel } from 'webpeel';
import fs from 'fs';
import path from 'path';

const wp = new WebPeel({
  apiKey: process.env.WEBPEEL_API_KEY!,
});

const OUTPUT_DIR = './crawl-output';
const TARGET_URL = 'https://docs.example.com';

function urlToFilename(url: string): string {
  return url
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    + '.md';
}

async function main() {
  // Create output directory
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`🕷️  Crawling: ${TARGET_URL}`);
  console.log(`📁 Output:   ${OUTPUT_DIR}\n`);

  let pageCount = 0;
  let totalWords = 0;

  // wp.crawl() returns an async iterator — pages stream in as they're fetched
  const crawl = await wp.crawl(TARGET_URL, {
    maxPages: 100,      // Stop after 100 pages
    maxDepth: 3,        // Follow links up to 3 levels deep
    outputFormat: 'markdown',
    respectRobotsTxt: true,
    // Only crawl pages under this path
    include: ['/docs', '/api', '/guides'],
    exclude: ['/blog', '/changelog'],
  });

  for await (const page of crawl) {
    pageCount++;

    // Save to file
    const filename = urlToFilename(page.url);
    const filepath = path.join(OUTPUT_DIR, filename);

    const content = [
      `# ${page.title}`,
      ``,
      `> Source: ${page.url}`,
      ``,
      page.markdown,
    ].join('\n');

    fs.writeFileSync(filepath, content, 'utf8');

    totalWords += page.wordCount ?? 0;
    process.stdout.write(`  [${pageCount}] ${page.url} (${page.wordCount} words)\n`);
  }

  console.log(`\n✅ Done!`);
  console.log(`   Pages crawled: ${pageCount}`);
  console.log(`   Total words:   ${totalWords.toLocaleString()}`);
  console.log(`   Output saved:  ${OUTPUT_DIR}/`);
}

main().catch(console.error);

/*
Expected output:

🕷️  Crawling: https://docs.example.com
📁 Output:   ./crawl-output

  [1] https://docs.example.com/ (342 words)
  [2] https://docs.example.com/quickstart (891 words)
  [3] https://docs.example.com/api/fetch (1,204 words)
  [4] https://docs.example.com/api/search (978 words)
  [5] https://docs.example.com/guides/agents (2,103 words)
  ...

✅ Done!
   Pages crawled: 47
   Total words:   68,421
   Output saved:  ./crawl-output/
*/
