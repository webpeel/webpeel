/**
 * WebPeel — Basic Fetch Example (TypeScript)
 *
 * Fetches a webpage and prints its content as clean markdown.
 *
 * Setup:
 *   npm install webpeel
 *   export WEBPEEL_API_KEY=wp_your_key_here
 *
 * Run:
 *   npx ts-node examples/typescript/basic-fetch.ts
 */

import { WebPeel } from 'webpeel';

const wp = new WebPeel({
  apiKey: process.env.WEBPEEL_API_KEY!,
});

async function main() {
  const url = 'https://news.ycombinator.com';

  console.log(`Fetching: ${url}\n`);

  const result = await wp.fetch(url, {
    format: 'markdown', // 'markdown' | 'html' | 'text' | 'json'
  });

  // Print the clean markdown content
  console.log(result.markdown);

  // Additional metadata
  console.log('\n---');
  console.log(`Title:        ${result.title}`);
  console.log(`Word count:   ${result.wordCount}`);
  console.log(`Fetched in:   ${result.responseTime}ms`);
}

main().catch(console.error);

/*
Expected output:

Fetching: https://news.ycombinator.com

# Hacker News

## Top Stories

1. **Show HN: I built a terminal emulator in pure CSS** (382 points, 94 comments)
   https://example.com/css-terminal

2. **The unreasonable effectiveness of just showing up every day** (279 points, 67 comments)
   https://blog.example.com/showing-up

...

---
Title:        Hacker News
Word count:   1,842
Fetched in:   312ms
*/
