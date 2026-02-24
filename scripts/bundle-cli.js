import * as esbuild from 'esbuild';
import { readFile } from 'fs/promises';

// Plugin: strip the shebang from cli.js so it doesn't clash with our banner
const stripShebangPlugin = {
  name: 'strip-shebang',
  setup(build) {
    build.onLoad({ filter: /dist\/cli\.js$/ }, async (args) => {
      const contents = await readFile(args.path, 'utf8');
      // Remove shebang line if present (#!/usr/bin/env node)
      const stripped = contents.replace(/^#![^\n]*\n/, '');
      return { contents: stripped, loader: 'js' };
    });
  },
};

await esbuild.build({
  entryPoints: ['dist/cli.js'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  // CJS format avoids ESM/CJS interop issues with dependencies like commander.
  format: 'cjs',
  outfile: 'dist/cli.bundle.cjs',
  plugins: [stripShebangPlugin],
  banner: {
    // Shebang on line 1 so the OS can execute the file directly.
    // __importMetaUrl polyfills import.meta.url (used by cli.js to find package.json).
    js: '#!/usr/bin/env node\nconst __importMetaUrl = require("url").pathToFileURL(__filename).href;',
  },
  // Replace import.meta.url with our CJS polyfill variable
  define: {
    'import.meta.url': '__importMetaUrl',
  },
  // Don't bundle native/heavy modules — they're lazy-loaded, optional, or too large.
  // pdf-parse alone pulls in ~12MB of bundled PDF.js workers across 4 versions.
  // mammoth pulls in @mixmark-io/domino (~246KB). @sentry/node is optional.
  external: [
    'playwright',
    'playwright-extra',
    'playwright-core',
    'puppeteer-extra-plugin-stealth',
    'pdf-parse',
    'mammoth',
    '@sentry/node',
  ],
  // Silence warnings about dynamic requires (e.g. from pdf-parse)
  logLevel: 'warning',
});

console.log('✅ Bundled CLI → dist/cli.bundle.cjs');
