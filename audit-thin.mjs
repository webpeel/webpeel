import { peel } from './dist/index.js';

const thin = [
  ['npm', 'https://www.npmjs.com/package/express'],
  ['IMDB', 'https://www.imdb.com/title/tt0111161/'],
  ['PyPI', 'https://pypi.org/project/requests/'],
  ['DevTo', 'https://dev.to/'],
  ['Substack', 'https://open.substack.com/pub/platformer/p/youtube-finally-takes-aim-at-ai'],
];

for (const [name, url] of thin) {
  try {
    const result = await peel(url, { timeout: 30000 });
    const content = result?.content || '';
    const words = content.trim().split(/\s+/).filter(s => s.length > 0).length;
    console.log(`\n========== ${name} (${words} words) ==========`);
    console.log(content.slice(0, 800));
    console.log('--- END ---');
  } catch (err) {
    console.log(`\n========== ${name} ERROR ==========`);
    console.log(err.message);
  }
}
