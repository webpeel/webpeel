import { peel } from './dist/index.js';

const urls = [
  ['Twitter', 'https://x.com/elonmusk'],
  ['Reddit', 'https://www.reddit.com/r/programming/top/?t=week'],
  ['GitHub', 'https://github.com/facebook/react'],
  ['HackerNews', 'https://news.ycombinator.com'],
  ['Wikipedia', 'https://en.wikipedia.org/wiki/JavaScript'],
  ['YouTube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
  ['arXiv', 'https://arxiv.org/abs/2501.00001'],
  ['StackOverflow', 'https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster-than-processing-an-unsorted-array'],
  ['npm', 'https://www.npmjs.com/package/express'],
  ['BestBuy', 'https://www.bestbuy.com/site/apple-airpods-4/6447382.p'],
  ['Amazon', 'https://www.amazon.com/dp/B0D1XD1ZV3'],
  ['Medium', 'https://medium.com/@ericjang/why-i-left-google-to-join-a-startup-5eb7f9001062'],
  ['Substack', 'https://open.substack.com/pub/platformer/p/youtube-finally-takes-aim-at-ai'],
  ['AllRecipes', 'https://www.allrecipes.com/recipe/22918/pop-cake/'],
  ['IMDB', 'https://www.imdb.com/title/tt0111161/'],
  ['PyPI', 'https://pypi.org/project/requests/'],
  ['DevTo', 'https://dev.to/'],
];

function countWords(text) {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(s => s.length > 0).length;
}

console.log('\n=== EXTRACTOR AUDIT ===\n');
console.log('EXTRACTOR       | WORDS  | METHOD           | TITLE                          | FIRST_100_CHARS');
console.log('----------------|--------|------------------|--------------------------------|----------------');

for (const [name, url] of urls) {
  try {
    const result = await peel(url, { timeout: 30000 });
    const words = countWords(result?.content);
    const method = result?.metadata?.method || result?.method || 'unknown';
    const title = (result?.metadata?.title || result?.title || '').slice(0, 30);
    const first100 = (result?.content || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    console.log(`${name.padEnd(15)} | ${String(words).padEnd(6)} | ${String(method).padEnd(16)} | ${title.padEnd(30)} | ${first100}`);
  } catch (err) {
    console.log(`${name.padEnd(15)} | ERROR  | -                | -                              | ${err.message?.slice(0, 100) || 'unknown error'}`);
  }
}
