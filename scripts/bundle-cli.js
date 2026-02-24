import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['dist/cli.js'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  // CJS format avoids ESM/CJS interop issues with dependencies like commander.
  // The source is ESM but esbuild converts it cleanly to CJS for bundling.
  format: 'cjs',
  outfile: 'dist/cli.bundle.cjs',
  // No banner needed — esbuild preserves the #!/usr/bin/env node shebang from dist/cli.js
  // Don't bundle native/heavy modules — they're lazy-loaded or too large
  external: [
    'playwright',
    'playwright-extra',
    'playwright-core',
    'puppeteer-extra-plugin-stealth',
  ],
  // Silence warnings about dynamic requires (e.g. from pdf-parse)
  logLevel: 'warning',
});

console.log('✅ Bundled CLI → dist/cli.bundle.cjs');
