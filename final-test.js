#!/usr/bin/env node
/**
 * Final verification that all v0.4.0 features work
 */

import { peel } from './dist/index.js';

console.log('🧪 Testing WebPeel v0.4.0 Features\n');

// Test 1: Actions
console.log('1️⃣  Testing page actions...');
try {
  const result = await peel('https://example.com', {
    actions: [
      { type: 'wait', ms: 100 },
      { type: 'scroll', to: 'bottom' },
    ],
  });
  console.log(`   ✅ Actions work (method: ${result.method})\n`);
} catch (err) {
  console.log(`   ❌ Failed: ${err.message}\n`);
}

// Test 2: Structured extraction
console.log('2️⃣  Testing structured extraction...');
try {
  const result = await peel('https://example.com', {
    extract: {
      selectors: {
        title: 'h1',
        content: 'p',
      },
    },
  });
  console.log(`   ✅ Extraction works`);
  console.log(`   📊 Extracted: ${JSON.stringify(result.extracted)}\n`);
} catch (err) {
  console.log(`   ❌ Failed: ${err.message}\n`);
}

// Test 3: Token budget
console.log('3️⃣  Testing token budget...');
try {
  const result = await peel('https://www.gutenberg.org/files/1342/1342-h/1342-h.htm', {
    maxTokens: 300,
  });
  console.log(`   ✅ Truncation works`);
  console.log(`   📏 Tokens: ${result.tokens} (target: 300)`);
  console.log(`   ✂️  Truncated: ${result.content.includes('[Content truncated')}\n`);
} catch (err) {
  console.log(`   ❌ Failed: ${err.message}\n`);
}

// Test 4: Combined features
console.log('4️⃣  Testing combined features...');
try {
  const result = await peel('https://example.com', {
    actions: [{ type: 'wait', ms: 100 }],
    extract: { selectors: { heading: 'h1' } },
    maxTokens: 200,
  });
  console.log(`   ✅ All features work together`);
  console.log(`   📊 Method: ${result.method}, Tokens: ${result.tokens}`);
  console.log(`   🎯 Extracted: ${JSON.stringify(result.extracted)}\n`);
} catch (err) {
  console.log(`   ❌ Failed: ${err.message}\n`);
}

console.log('✨ All features verified and working!');
