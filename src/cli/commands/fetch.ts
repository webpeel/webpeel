/**
 * Fetch commands: default URL handler, read, pipe
 */

import type { Command } from 'commander';
import ora from 'ora';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { getProfilePath, loadStorageState, touchProfile } from '../../core/profiles.js';
import { peel, cleanup } from '../../index.js';
import type { PeelOptions, PeelResult, PageAction } from '../../types.js';
import { checkUsage, showUsageFooter, loadConfig } from '../../cli-auth.js';
import { getCache, setCache, parseTTL } from '../../cache.js';
import { estimateTokens, htmlToMarkdown } from '../../core/markdown.js';
import { distillToBudget, budgetListings } from '../../core/budget.js';
import {
  parseActions,
  formatError,
  fetchViaApi,
  outputResult,
  writeStdout,
  buildEnvelope,
  classifyErrorCode,
  formatListingsCsv,
  normaliseExtractedToRows,
} from '../utils.js';

// ─── readStdin ────────────────────────────────────────────────────────────────

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

// ─── runStdin ─────────────────────────────────────────────────────────────────

// Read HTML from stdin, convert to markdown, and output
async function runStdin(options: any): Promise<void> {
  try {
    const html = await readStdin();
    if (!html.trim()) {
      process.stderr.write('Error: No input received on stdin\n');
      process.exit(1);
    }
    const markdown = htmlToMarkdown(html, { raw: false, prune: true });
    if (options.json) {
      const tokens = estimateTokens(markdown);
      process.stdout.write(JSON.stringify({ success: true, content: markdown, tokens }) + '\n');
    } else {
      process.stdout.write(markdown + '\n');
    }
  } catch (err: any) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

// ─── runFetch ─────────────────────────────────────────────────────────────────

// Main fetch handler — shared with the `pipe` and `ask` subcommands
export async function runFetch(url: string | undefined, options: any): Promise<void> {
    // --silent: suppress all log output (set env var before any logger fires)
    if (options.silent && !process.env.WEBPEEL_LOG_LEVEL) {
      process.env.WEBPEEL_LOG_LEVEL = 'silent';
    }

    // --content-only: override all output flags — we just want raw content
    if (options.contentOnly) {
      options.silent = true;
      // Disable json/text/html — we output content directly
      options.json = false;
      options.html = false;
      options.text = false;
    }

    // Handle --format flag: maps to existing boolean flags
    if (options.format) {
      const fmt = options.format.toLowerCase();
      if (fmt === 'text') options.text = true;
      else if (fmt === 'html') options.html = true;
      else if (fmt === 'json') options.json = true;
      else if (fmt === 'markdown' || fmt === 'md') { /* default, do nothing */ }
      else {
        console.error(`Unknown format: ${options.format}. Use: text, markdown, html, or json`);
        process.exit(1);
      }
    }

    // Smart defaults: when piped (not a TTY), default to silent JSON + budget
    // BUT respect explicit --format flag (user chose the output format)
    // AND respect --content-only (raw content output, no JSON wrapper)
    const isPiped = !process.stdout.isTTY;
    const hasExplicitFormat = options.format && ['text', 'html', 'markdown', 'md'].includes(options.format.toLowerCase());
    if (isPiped && !options.html && !options.text && !hasExplicitFormat && !options.contentOnly) {
      if (!options.json) options.json = true;
      if (!options.silent) options.silent = true;
      // Auto-enable readability for AI consumers — clean content by default
      if (!options.readable && !options.fullNav) {
        options.readable = true;
      }
      // Auto token budget for piped mode (AI consumers want concise content)
      if (options.budget === undefined && !options.fullContent && !options.raw && !options.full) {
        options.budget = 4000;
      }
    }

    // --full alias: sets raw + fullContent
    if (options.full) {
      options.raw = true;
      options.fullContent = true;
    }

    // Smart defaults for terminal (interactive) mode
    const isTerminal = process.stdout.isTTY && !isPiped;
    if (isTerminal && !options.raw && !options.html && !options.text) {
      // Auto-readable: clean content by default (like browser Reader Mode)
      if (!options.readable && !options.fullNav && !options.selector) {
        options.readable = true;
      }
      // Default token budget: don't flood the terminal with 20K tokens
      if (options.budget === undefined && !options.fullContent && !options.raw) {
        options.budget = 4000;
      }
    }

    // --agent sets sensible defaults for AI agents; explicit flags override
    if (options.agent) {
      if (!options.json) options.json = true;
      if (!options.silent) options.silent = true;
      if (!options.extractAll) options.extractAll = true;
      if (options.budget === undefined) options.budget = 4000;
      // Agent mode = clean content by default
      if (!options.readable && !options.fullNav) {
        options.readable = true;
      }
    }

    const isJson = options.json;

    // --- --list-schemas: print all available schemas and exit ---
    if (options.listSchemas) {
      const { loadBundledSchemas } = await import('../../core/schema-extraction.js');
      const schemas = loadBundledSchemas();
      if (isJson) {
        await writeStdout(JSON.stringify(schemas.map(s => ({
          name: s.name,
          version: s.version,
          domains: s.domains,
          urlPatterns: s.urlPatterns,
        })), null, 2) + '\n');
      } else {
        console.log(`\nAvailable extraction schemas (${schemas.length}):\n`);
        for (const s of schemas) {
          console.log(`  ${s.name} (v${s.version})`);
          console.log(`    Domains: ${s.domains.join(', ')}`);
          if (s.urlPatterns && s.urlPatterns.length > 0) {
            console.log(`    URL patterns: ${s.urlPatterns.join(', ')}`);
          }
          console.log('');
        }
      }
      process.exit(0);
    }

    // --- #5: Concise error for missing URL (no help dump) ---
    if (!url || url.trim() === '') {
      if (isJson) {
        await writeStdout(JSON.stringify({ success: false, error: { type: 'invalid_request', message: 'URL is required' } }) + '\n');
      } else {
        console.error('Error: URL is required');
        console.error('Usage: webpeel <url> [options]');
        console.error('Run "webpeel --help" for full usage.');
      }
      process.exit(1);
    }

    // --- #6: Helper to output JSON errors and exit ---
    function exitWithJsonError(message: string, code: string): never {
      if (isJson) {
        process.stdout.write(JSON.stringify({
          success: false,
          error: { type: code.toLowerCase(), message },
        }) + '\n');
      } else {
        console.error(`Error: ${message}`);
      }
      process.exit(1);
    }

    // SECURITY: Enhanced URL validation
    if (url.length > 2048) {
      exitWithJsonError('URL too long (max 2048 characters)', 'INVALID_URL');
    }

    // Check for control characters
    if (/[\x00-\x1F\x7F]/.test(url)) {
      exitWithJsonError('URL contains invalid control characters', 'INVALID_URL');
    }

    // Validate URL format
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        exitWithJsonError('Only HTTP and HTTPS protocols are allowed', 'INVALID_URL');
      }
    } catch {
      // Check if it looks like a command/verb the user typed by mistake
      const commonVerbs = ['fetch', 'get', 'scrape', 'read', 'download', 'curl', 'wget', 'peel'];
      if (commonVerbs.includes(url.toLowerCase())) {
        exitWithJsonError(
          `Did you mean: webpeel "${process.argv[3] || '<url>'}"?\nThe URL goes directly after webpeel — no verb needed.\nExample: webpeel "https://example.com" --json`,
          'INVALID_URL'
        );
      } else {
        exitWithJsonError(
          `Invalid URL: "${url}"\nMake sure to include the protocol (https://)\nExample: webpeel "https://${url}" --json`,
          'INVALID_URL'
        );
      }
    }

    const useStealth = options.stealth || false;

    // Check usage quota
    const usageCheck = await checkUsage();
    if (!usageCheck.allowed) {
      if (isJson) {
        await writeStdout(JSON.stringify({ success: false, error: { type: 'rate_limited', message: usageCheck.message } }) + '\n');
        process.exit(1);
      }
      console.error(usageCheck.message);
      process.exit(1);
    }

    // ── --export: YouTube transcript download (early exit) ────────────────
    if (options.export) {
      const exportFmt = (options.export as string).toLowerCase();
      const validExportFmts = ['srt', 'txt', 'md', 'json'];
      if (!validExportFmts.includes(exportFmt)) {
        console.error(`Error: --export format must be one of: ${validExportFmts.join(', ')}`);
        process.exit(1);
      }

      const exportCfg = loadConfig();
      const exportApiKey = exportCfg.apiKey || process.env.WEBPEEL_API_KEY;
      const exportApiUrl = process.env.WEBPEEL_API_URL || 'https://api.webpeel.dev';

      if (!exportApiKey) {
        console.error('No API key configured. Run: webpeel auth <your-key>');
        console.error('Get a free key at: https://app.webpeel.dev/keys');
        process.exit(2);
      }

      const lang = options.language || 'en';
      const exportUrl = `${exportApiUrl}/v1/transcript/export?url=${encodeURIComponent(url)}&format=${exportFmt}&language=${lang}`;

      const exportRes = await fetch(exportUrl, {
        headers: { 'Authorization': `Bearer ${exportApiKey}` },
        signal: AbortSignal.timeout(options.timeout ?? 90000),
      });

      if (!exportRes.ok) {
        const errBody = await exportRes.text().catch(() => '');
        try {
          const errJson = JSON.parse(errBody);
          const msg = errJson?.error?.message || errJson?.message || exportRes.statusText;
          console.error(`Export failed (${exportRes.status}): ${msg}`);
        } catch {
          console.error(`Export failed (${exportRes.status}): ${exportRes.statusText}`);
        }
        process.exit(1);
      }

      const exportContent = await exportRes.text();

      if (options.output) {
        writeFileSync(options.output as string, exportContent, 'utf-8');
        if (!options.silent) {
          console.error(`Transcript saved to: ${options.output}`);
        }
      } else {
        process.stdout.write(exportContent);
        if (!exportContent.endsWith('\n')) process.stdout.write('\n');
      }

      await cleanup();
      process.exit(0);
    }

    // Check cache first (before spinner/network)
    // Default: 5m TTL for all CLI fetches unless --no-cache is set
    let cacheTtlMs: number | undefined;
    const cacheDisabled = options.cache === false; // --no-cache sets options.cache to false
    const explicitTtl: string | undefined = typeof options.cache === 'string' ? options.cache : undefined;

    if (!cacheDisabled) {
      const ttlStr = explicitTtl || '5m';
      try {
        cacheTtlMs = parseTTL(ttlStr);
      } catch (e) {
        exitWithJsonError((e as Error).message, 'FETCH_FAILED');
      }

      const cacheOptions = {
        render: options.render,
        stealth: options.stealth,
        selector: options.selector,
        format: options.html ? 'html' : options.text ? 'text' : options.clean ? 'clean' : 'markdown',
        budget: null,  // Budget excluded from cache key — cache stores full content
        readable: options.readable || false,
      };

      const cachedResult = getCache(url, cacheOptions);
      if (cachedResult) {
        if (!options.silent) {
          console.error(`\x1b[36m⚡ Cache hit\x1b[0m (TTL: ${ttlStr})`);
        }
        // Apply budget to cached content (cache stores full, budget is post-process)
        if (options.budget && options.budget > 0 && cachedResult.content) {
          const fmt: 'markdown' | 'text' | 'json' =
            options.text ? 'text' : 'markdown';
          (cachedResult as any).content = distillToBudget(cachedResult.content, options.budget, fmt);
          (cachedResult as any).tokens = Math.ceil(cachedResult.content.length / 4);
        }
        // LLM extraction from cached content
        if (options.llmExtract || options.extractSchema) {
          const { extractWithLLM } = await import('../../core/llm-extract.js');
          const llmCfgCached = loadConfig();
          const llmApiKeyCached = options.llmKey || llmCfgCached.llm?.apiKey || process.env.OPENAI_API_KEY;
          if (!llmApiKeyCached) {
            console.error('Error: LLM extraction requires an API key.\nSet OPENAI_API_KEY environment variable or use --llm-key <key>');
            process.exit(1);
          }
          const llmModelCached = options.llmModel || llmCfgCached.llm?.model || process.env.WEBPEEL_LLM_MODEL || 'gpt-4o-mini';
          const llmBaseUrlCached = options.llmBaseUrl || llmCfgCached.llm?.baseUrl || process.env.WEBPEEL_LLM_BASE_URL || 'https://api.openai.com/v1';
          const llmInstructionCached = typeof options.llmExtract === 'string' ? options.llmExtract : undefined;
          // Parse schema if provided
          let llmSchemaCached: object | undefined;
          if (options.extractSchema) {
            let schemaStr: string = options.extractSchema;
            if (schemaStr.startsWith('@')) {
              schemaStr = readFileSync(schemaStr.slice(1), 'utf-8');
            }
            try {
              llmSchemaCached = JSON.parse(schemaStr);
            } catch {
              console.error('Error: --extract-schema must be valid JSON or a valid @file.json path');
              process.exit(1);
            }
          }
          const llmResultCached = await extractWithLLM({
            content: cachedResult.content,
            instruction: llmInstructionCached,
            schema: llmSchemaCached,
            apiKey: llmApiKeyCached,
            model: llmModelCached,
            baseUrl: llmBaseUrlCached,
          });
          await writeStdout(JSON.stringify(llmResultCached.items, null, 2) + '\n');
          if (!options.silent) {
            const { input, output } = llmResultCached.tokensUsed;
            const costStr = llmResultCached.cost !== undefined ? ` | Est. cost: $${llmResultCached.cost.toFixed(6)}` : '';
            console.error(`\n🤖 LLM extraction: ${llmResultCached.items.length} items | ${input} input + ${output} output tokens${costStr} | model: ${llmResultCached.model}`);
          }
          process.exit(0);
        }
        // --- LLM-free Quick Answer (also on cached content) ---
        if (options.question && cachedResult.content) {
          const { quickAnswer } = await import('../../core/quick-answer.js');
          const qa = quickAnswer({
            question: options.question as string,
            content: cachedResult.content,
            url: cachedResult.url,
          });
          (cachedResult as any).quickAnswer = qa;

          if (!isJson) {
            const conf = (qa.confidence * 100).toFixed(0);
            await writeStdout(`\n\x1b[36m📋 ${qa.question}\x1b[0m\n\n`);
            if (qa.answer) {
              await writeStdout(`\x1b[32m💡 Answer (${conf}% confidence):\x1b[0m\n${qa.answer}\n`);
            } else {
              await writeStdout(`\x1b[33m💡 No relevant answer found (${conf}% confidence)\x1b[0m\n`);
            }
            if (qa.passages && qa.passages.length > 1) {
              await writeStdout(`\n\x1b[33m📝 Supporting evidence:\x1b[0m\n`);
              for (const p of qa.passages.slice(1, 4)) {
                await writeStdout(`  • [${(p.score * 100).toFixed(0)}%] ${p.text.substring(0, 200)}${p.text.length > 200 ? '...' : ''}\n`);
              }
            }
            await writeStdout('\n');
            await cleanup();
            process.exit(0);
          }
        }

        // --- BM25 Schema Template Extraction (cached path) ---
        if (options.schema && cachedResult.content) {
          const { getSchemaTemplate: getSchTmplCached } = await import('../../core/schema-templates.js');
          const schTemplateCached = getSchTmplCached(options.schema as string);
          if (schTemplateCached) {
            const { quickAnswer: qaCached } = await import('../../core/quick-answer.js');
            const { smartExtractSchemaFields: smartExtractCached } = await import('../../core/schema-postprocess.js');
            const extractedCached = smartExtractCached(
              cachedResult.content,
              schTemplateCached.fields,
              qaCached,
              {
                pageTitle: (cachedResult as any).title,
                pageUrl: (cachedResult as any).url,
                metadata: (cachedResult as any).metadata as Record<string, any>,
              },
            );
            (cachedResult as any).extracted = extractedCached;
          }
        }

        if (options.contentOnly) {
          await writeStdout((cachedResult as PeelResult).content + '\n');
        } else {
          await outputResult(cachedResult as PeelResult, options, { cached: true });
        }
        process.exit(0);
      }
    }

    // --progress: show escalation steps on stderr (overrides spinner)
    let progressInterval: ReturnType<typeof setInterval> | undefined;
    const progressStart = Date.now();
    if (options.progress) {
      process.stderr.write(`[simple] Fetching ${url}...\n`);
      // Show escalation hints based on elapsed time (best-effort approximations)
      const progressSteps = [
        { afterMs: 2500,  message: '[simple] Waiting for response...' },
        { afterMs: 6000,  message: '[browser] Simple too slow — escalating to browser render...' },
        { afterMs: 12000, message: '[browser] Rendering with Chromium...' },
        { afterMs: 20000, message: '[stealth] Escalating to stealth mode...' },
      ];
      let stepIdx = 0;
      progressInterval = setInterval(() => {
        const elapsed = Date.now() - progressStart;
        while (stepIdx < progressSteps.length && elapsed >= progressSteps[stepIdx].afterMs) {
          process.stderr.write(`${progressSteps[stepIdx].message}\n`);
          stepIdx++;
        }
      }, 500);
    }

    // Suppress spinner when --progress is active (progress lines replace it)
    const spinner = (options.silent || options.progress) ? null : ora('Fetching...').start();

    // Auto progress: after 3 s, update spinner text with elapsed time + method hints
    // Updated every 2 s so the user knows we're still working.
    const autoProgressStart = Date.now();
    const autoProgressSteps = [
      { afterMs: 3000,  text: '⏳ Fetching... (slow response)' },
      { afterMs: 6000,  text: '⏳ Fetching with browser... ({s}s)' },
      { afterMs: 12000, text: '⏳ Fetching with browser... ({s}s — stealth may be needed)' },
      { afterMs: 20000, text: '⏳ Fetching with stealth browser + proxy... ({s}s)' },
    ];
    let autoProgressStepIdx = 0;
    const autoProgressInterval = spinner ? setInterval(() => {
      const elapsed = Date.now() - autoProgressStart;
      const secs = Math.round(elapsed / 1000);
      while (
        autoProgressStepIdx < autoProgressSteps.length &&
        elapsed >= autoProgressSteps[autoProgressStepIdx].afterMs
      ) {
        autoProgressStepIdx++;
      }
      if (autoProgressStepIdx > 0 && spinner) {
        const tmpl = autoProgressSteps[autoProgressStepIdx - 1].text;
        spinner.text = tmpl.replace('{s}', String(secs));
      }
    }, 2000) : null;

    try {
      // Validate options
      if (options.wait && (options.wait < 0 || options.wait > 60000)) {
        throw Object.assign(new Error('Wait time must be between 0 and 60000ms'), { _code: 'FETCH_FAILED' });
      }

      // Parse custom headers
      let headers: Record<string, string> | undefined;
      if (options.header && options.header.length > 0) {
        headers = {};
        for (const header of options.header) {
          const colonIndex = header.indexOf(':');
          if (colonIndex === -1) {
            throw Object.assign(new Error(`Invalid header format: ${header}. Expected "Key: Value"`), { _code: 'FETCH_FAILED' });
          }
          const key = header.slice(0, colonIndex).trim();
          const value = header.slice(colonIndex + 1).trim();
          headers[key] = value;
        }
      }

      // Parse actions
      let actions: PageAction[] | undefined;
      if (options.action && options.action.length > 0) {
        try {
          actions = parseActions(options.action);
        } catch (e) {
          throw Object.assign(new Error((e as Error).message), { _code: 'FETCH_FAILED' });
        }
      }

      // --extract-schema auto-enables JSON output
      if (options.extractSchema) {
        options.json = true;
      }

      // Parse extract
      let extract: any;
      if (options.llmExtract || options.extractSchema) {
        // LLM-based extraction is handled post-fetch (after peel returns markdown).
        // Early-validate that an API key is available so we fail fast.
        const llmCfg = loadConfig();
        const llmApiKey = options.llmKey || llmCfg.llm?.apiKey || process.env.OPENAI_API_KEY;
        if (!llmApiKey) {
          throw Object.assign(new Error(
            'LLM extraction requires an API key.\n' +
            'Set OPENAI_API_KEY environment variable or use --llm-key <key>'
          ), { _code: 'FETCH_FAILED' });
        }
        // Do NOT set extract here — peel runs normally, LLM extraction happens below.
      } else if (options.extract) {
        // Smart extract: detect schema format vs CSS selectors
        let extractJson: Record<string, unknown>;
        try {
          extractJson = JSON.parse(options.extract);
        } catch {
          throw Object.assign(new Error('--extract must be valid JSON (e.g., \'{"title": "h1", "price": ".price"}\' or \'{"company": "string"}\')'), { _code: 'FETCH_FAILED' });
        }

        // If all values are type names (string/boolean/number/array/object),
        // treat as structured schema extraction (routed to extractStructured after fetch).
        // Otherwise treat as CSS selector map.
        const { isTypeSchema } = await import('../../core/structured-extract.js');
        if (isTypeSchema(extractJson as Record<string, unknown>)) {
          // Mark for post-fetch structured extraction (handled below)
          (options as any)._structuredSchema = extractJson;
        } else {
          // CSS-based extraction
          extract = { selectors: extractJson };
        }
      }

      // Validate maxTokens
      if (options.maxTokens !== undefined) {
        if (isNaN(options.maxTokens) || options.maxTokens < 100) {
          throw Object.assign(new Error('--max-tokens must be at least 100'), { _code: 'FETCH_FAILED' });
        }
      }

      // Parse include-tags and exclude-tags
      let includeTags: string[] | undefined;
      let excludeTags: string[] | undefined;

      if (options.onlyMainContent) {
        includeTags = ['main', 'article'];
      } else if (options.includeTags) {
        includeTags = options.includeTags.split(',').map((t: string) => t.trim());
      }

      if (options.excludeTags) {
        excludeTags = options.excludeTags.split(',').map((t: string) => t.trim());
      }

      // Build location options
      let locationOptions: { country?: string; languages?: string[] } | undefined;
      if (options.location || options.language) {
        locationOptions = {};
        if (options.location) {
          locationOptions.country = options.location;
        }
        if (options.language) {
          locationOptions.languages = [options.language];
        }
      }

      // ── Resolve --profile: name → path + storage state ─────────────────
      let resolvedProfileDir: string | undefined;
      let resolvedStorageState: any | undefined;
      let resolvedProfileName: string | undefined;

      if (options.profile) {
        const profilePath = getProfilePath(options.profile);
        if (profilePath) {
          // It's a named profile in ~/.webpeel/profiles/
          resolvedProfileDir = profilePath;
          resolvedStorageState = loadStorageState(options.profile) ?? undefined;
          resolvedProfileName = options.profile;
        } else if (existsSync(options.profile)) {
          // It's a raw directory path (backward compat)
          resolvedProfileDir = options.profile;
        } else {
          exitWithJsonError(
            `Profile "${options.profile}" not found. Run "webpeel profile list" to see available profiles.`,
            'PROFILE_NOT_FOUND',
          );
        }
      }

      // Build peel options
      // --stealth auto-enables --render (stealth requires browser)
      // --action auto-enables --render (actions require browser)
      // --scroll-extract implies --render (needs browser)
      //
      // Bare --scroll-extract (no number) → smart autoScroll (detects stable height)
      // --scroll-extract N (with number) → legacy fixed N scrolls via actions
      const scrollExtractRaw = options.scrollExtract;
      const isAutoScroll = scrollExtractRaw !== undefined && typeof scrollExtractRaw !== 'number';
      const scrollExtractCount = isAutoScroll
        ? 0
        : (scrollExtractRaw !== undefined ? scrollExtractRaw : 0);

      const useRender = options.render || options.stealth || (actions && actions.length > 0) || scrollExtractCount > 0 || isAutoScroll
        || (options.device && options.device !== 'desktop')
        || !!options.viewport
        || !!options.waitUntil
        || !!options.waitSelector
        || !!options.blockResources
        || !!options.screenshot  // Auto-enable render for screenshot (needs browser)
        || false;

      // Inject scroll actions when --scroll-extract N (fixed count) is used
      if (scrollExtractCount > 0) {
        const scrollActions: PageAction[] = [];
        for (let i = 0; i < scrollExtractCount; i++) {
          scrollActions.push({ type: 'scroll', to: 'bottom' });
          scrollActions.push({ type: 'wait', ms: 1500 });
        }
        actions = actions ? [...actions, ...scrollActions] : scrollActions;
      }

      const peelOptions: PeelOptions = {
        render: useRender,
        stealth: options.stealth || false,
        wait: options.wait || 0,
        timeout: options.timeout,
        userAgent: options.ua,
        screenshot: options.screenshot !== undefined,
        screenshotFullPage: options.fullPage || false,
        selector: options.selector,
        exclude: options.exclude,
        includeTags,
        excludeTags,
        headers,
        cookies: options.cookie,
        raw: options.raw || false,
        lite: options.lite || false,
        actions,
        maxTokens: options.maxTokens,
        // Note: budget is applied AFTER caching (so cache stores full content)
        // We pass it to peel() for programmatic API compatibility, but the CLI
        // also applies it post-fetch (see below) to ensure cache stores full result.
        extract,
        images: options.images || false,
        location: locationOptions,
        profileDir: resolvedProfileDir,
        headed: options.headed || false,
        storageState: resolvedStorageState,
        proxy: options.proxy as string | undefined,
        proxies: options.proxies as string[] | undefined,
        fullPage: options.fullContent || false,
        readable: options.readable || false,
        // Smart auto-scroll (bare --scroll-extract flag)
        autoScroll: isAutoScroll
          ? { timeout: options.scrollExtractTimeout }
          : undefined,
        device: options.device as 'desktop' | 'mobile' | 'tablet' | undefined,
        viewportWidth: options.viewport ? (options.viewport as { width: number; height: number }).width : undefined,
        viewportHeight: options.viewport ? (options.viewport as { width: number; height: number }).height : undefined,
        waitUntil: options.waitUntil as 'domcontentloaded' | 'networkidle' | 'load' | 'commit' | undefined,
        waitSelector: options.waitSelector as string | undefined,
        blockResources: options.blockResources ? (options.blockResources as string).split(',').map((s: string) => s.trim()) : undefined,
        cloaked: options.cloaked ? true : undefined,
        cycle: options.cycle ? true : undefined,
        tls: (options.tls || options.cycle) ? true : undefined,
      };

      if (options.cloaked) {
        peelOptions.render = true; // CloakBrowser is a browser
      }

      // Add chunk option if requested
      if (options.chunk) {
        peelOptions.chunk = {
          maxTokens: options.chunkSize || 512,
          overlap: options.chunkOverlap || 50,
          strategy: (options.chunkStrategy as 'section' | 'paragraph' | 'fixed') || 'section',
        };
      }

      // Add summary option if requested
      if (options.summary) {
        const llmApiKey = options.llmKey || process.env.OPENAI_API_KEY;
        if (!llmApiKey) {
          throw Object.assign(new Error('--summary requires --llm-key or OPENAI_API_KEY environment variable'), { _code: 'FETCH_FAILED' });
        }
        peelOptions.summary = true;
        peelOptions.llm = {
          apiKey: llmApiKey,
          model: process.env.WEBPEEL_LLM_MODEL || 'gpt-4o-mini',
          baseUrl: process.env.WEBPEEL_LLM_BASE_URL || 'https://api.openai.com/v1',
        };
      }

      // Determine format
      if (options.html) {
        peelOptions.format = 'html';
      } else if (options.text) {
        peelOptions.format = 'text';
      } else if (options.clean) {
        peelOptions.format = 'clean';
        // --clean implies readable mode (article content only, no navs/footers)
        peelOptions.readable = true;
      } else {
        peelOptions.format = 'markdown';
      }

      // Fetch the page — route through API if key is configured, otherwise require auth
      const fetchCfg = loadConfig();
      const fetchApiKey = fetchCfg.apiKey || process.env.WEBPEEL_API_KEY;
      const fetchApiUrl = process.env.WEBPEEL_API_URL || 'https://api.webpeel.dev';

      let result: any;
      if (fetchApiKey) {
        // Use the WebPeel API — no local Playwright needed
        result = await fetchViaApi(url, peelOptions, fetchApiKey, fetchApiUrl);
      } else {
        // No API key — show helpful message instead of trying local mode
        if (spinner) spinner.fail('Authentication required');
        console.error('No API key configured. Run: webpeel auth <your-key>');
        console.error('Get a free key at: https://app.webpeel.dev/keys');
        await cleanup();
        process.exit(2);
      }

      // Update lastUsed timestamp for named profiles
      if (resolvedProfileName) {
        touchProfile(resolvedProfileName);
      }

      // Stop progress intervals and show final result
      if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = undefined;
      }
      if (autoProgressInterval) clearInterval(autoProgressInterval);

      if (options.progress) {
        const method = result.method || 'simple';
        const elapsedSec = ((result.elapsed || (Date.now() - progressStart)) / 1000).toFixed(1);
        const tokenCount = (result.tokens || 0).toLocaleString();
        // Show escalation arrow if browser/stealth was needed
        if (method !== 'simple') {
          process.stderr.write(`[simple] → [${method}] escalated\n`);
        }
        process.stderr.write(`[${method}] Done — ${tokenCount} tokens in ${elapsedSec}s\n`);
      } else if (spinner) {
        const domainTag = (result as any).domainData
          ? ` [${(result as any).domainData.domain}:${(result as any).domainData.type}]`
          : '';
        spinner.succeed(`Fetched in ${result.elapsed}ms using ${result.method} method${domainTag}`);
      }

      // Show metadata header
      const pageTitle = result.metadata?.title || result.title;
      if (!options.silent && !options.json && pageTitle) {
        const parts: string[] = [];
        if (result.metadata?.author) parts.push(`by ${result.metadata.author}`);
        if ((result as any).readability?.readingTime) parts.push((result as any).readability.readingTime);
        if (result.tokens) parts.push(`${result.tokens.toLocaleString()} tokens`);
        const subtitle = parts.length ? ` · ${parts.join(' · ')}` : '';
        console.error(`\x1b[36m📄 ${pageTitle}${subtitle}\x1b[0m`);
      }

      // Show usage footer for free/anonymous users
      if (usageCheck.usageInfo && !options.silent) {
        showUsageFooter(usageCheck.usageInfo, usageCheck.isAnonymous || false, useStealth);
      }

      // Handle screenshot saving
      if (options.screenshot && result.screenshot) {
        const screenshotPath = typeof options.screenshot === 'string'
          ? options.screenshot
          : 'screenshot.png';

        const screenshotBuffer = Buffer.from(result.screenshot, 'base64');
        writeFileSync(screenshotPath, screenshotBuffer);

        if (!options.silent) {
          console.error(`Screenshot saved to: ${screenshotPath}`);
        }

        // Remove screenshot from JSON output if saving to file
        if (typeof options.screenshot === 'string') {
          delete result.screenshot;
        }
      }

      // Store full result in cache (before budget distillation so cache is reusable)
      if (cacheTtlMs && !cacheDisabled) {
        setCache(url, result, cacheTtlMs, {
          render: options.render,
          stealth: useStealth,
          selector: options.selector,
          format: peelOptions.format,
          budget: null,  // Budget excluded — cache stores full content, budget applied post-cache
          readable: options.readable || false,
        });
      }

      // Apply smart budget distillation AFTER caching (cache always stores full content)
      // When --agent is set, always apply budget even with --extract-all (listings will be budgeted
      // separately, but if no listings are found the content itself still needs trimming).
      const skipBudgetForExtract = (options.extractAll || options.scrollExtract !== undefined) && !options.agent;
      let contentTruncated = false;
      if (options.budget && options.budget > 0 && !skipBudgetForExtract) {
        const budgetFormat: 'markdown' | 'text' | 'json' =
          peelOptions.format === 'text' ? 'text' : 'markdown';
        const distilled = distillToBudget(result.content, options.budget, budgetFormat);
        if (distilled !== result.content) {
          contentTruncated = true;
          (result as any).content = distilled;
          (result as any).tokens = estimateTokens(distilled);
        }
      }

      // --- BM25 Query-Focused Filtering ---
      if (options.focus && result.content) {
        const { filterByRelevance } = await import('../../core/bm25-filter.js');
        const focusResult = filterByRelevance(result.content, { query: options.focus as string });
        (result as any).content = focusResult.content;
        (result as any).tokens = estimateTokens(focusResult.content);
        if (isJson) {
          (result as any).focusQuery = options.focus;
          (result as any).focusReduction = focusResult.reductionPercent;
        }
      }

      // --- LLM-free Quick Answer ---
      if (options.question && result.content) {
        const { quickAnswer } = await import('../../core/quick-answer.js');
        const qa = quickAnswer({
          question: options.question as string,
          content: result.content,
          url: result.url,
        });
        (result as any).quickAnswer = qa;

        if (!isJson) {
          // Display answer prominently in human-readable mode
          const conf = (qa.confidence * 100).toFixed(0);
          await writeStdout(`\n\x1b[36m📋 ${qa.question}\x1b[0m\n\n`);
          if (qa.answer) {
            await writeStdout(`\x1b[32m💡 Answer (${conf}% confidence):\x1b[0m\n${qa.answer}\n`);
          } else {
            await writeStdout(`\x1b[33m💡 No relevant answer found (${conf}% confidence)\x1b[0m\n`);
          }
          if (qa.passages && qa.passages.length > 1) {
            await writeStdout(`\n\x1b[33m📝 Supporting evidence:\x1b[0m\n`);
            for (const p of qa.passages.slice(1, 4)) {
              await writeStdout(`  • [${(p.score * 100).toFixed(0)}%] ${p.text.substring(0, 200)}${p.text.length > 200 ? '...' : ''}\n`);
            }
          }
          await writeStdout('\n');
          await cleanup();
          process.exit(0);
        }
      }

      // --- RAG Chunking output (chunks come from pipeline via peelOptions.chunk) ---
      if (result.chunks && result.chunks.length > 0 && !isJson) {
        console.log(`\n${'─'.repeat(60)}`);
        console.log(`📦 ${result.chunks.length} chunks (${options.chunkStrategy || 'section'} strategy)\n`);
        for (const chunk of result.chunks) {
          const sectionLabel = chunk.section ? ` [${chunk.section}]` : '';
          console.log(`── Chunk ${chunk.index + 1}${sectionLabel} (${chunk.tokenCount} tokens, ${chunk.wordCount} words) ──`);
          console.log(chunk.text.substring(0, 200) + (chunk.text.length > 200 ? '...' : ''));
          console.log('');
        }
      }

      // --- #4: Content quality warning ---
      const isHtmlContent = result.contentType ? result.contentType.toLowerCase().includes('html') : true;
      const isRedirect = false; // peel() follows redirects — final result is always 200
      if (result.tokens < 20 && !useRender && isHtmlContent && !isRedirect) {
        const warningMsg = `Low content detected (${result.tokens} tokens). Try: webpeel ${url} --render`;
        if (isJson) {
          (result as any).warning = warningMsg;
        } else {
          console.error(`⚠ ${warningMsg}`);
        }
      }

      // --- Structured schema extraction (--extract with type schema or --extract-prompt) ---
      if ((options as any)._structuredSchema || options.extractPrompt) {
        const { extractStructured, simpleToExtractionSchema } = await import('../../core/structured-extract.js');

        const rawSchema = (options as any)._structuredSchema;

        const schema = rawSchema
          ? simpleToExtractionSchema(rawSchema as Record<string, string>)
          : { type: 'object' as const, properties: { result: { type: 'string', description: options.extractPrompt as string } } };

        const strResult = await extractStructured(
          result.content,
          schema,
          undefined, // No LLM config — use heuristic (no key needed)
          options.extractPrompt as string | undefined,
        );

        if (isJson) {
          await writeStdout(JSON.stringify({
            success: true,
            data: strResult.data,
            confidence: strResult.confidence,
            method: 'heuristic',
          }, null, 2) + '\n');
        } else {
          await writeStdout(JSON.stringify(strResult.data, null, 2) + '\n');
          if (!options.silent) {
            console.error(`\n📊 Structured extraction: confidence=${(strResult.confidence * 100).toFixed(0)}% (heuristic)`);
          }
        }
        await cleanup();
        process.exit(0);
      }

      // --- LLM-based extraction (post-peel) ---
      if (options.llmExtract || options.extractSchema) {
        const { extractWithLLM } = await import('../../core/llm-extract.js');
        const llmCfg = loadConfig();
        const llmApiKey = options.llmKey || llmCfg.llm?.apiKey || process.env.OPENAI_API_KEY;
        const llmModel = options.llmModel || llmCfg.llm?.model || process.env.WEBPEEL_LLM_MODEL || 'gpt-4o-mini';
        const llmBaseUrl = options.llmBaseUrl || llmCfg.llm?.baseUrl || process.env.WEBPEEL_LLM_BASE_URL || 'https://api.openai.com/v1';

        const llmInstruction = typeof options.llmExtract === 'string' ? options.llmExtract : undefined;

        // Parse --extract-schema if provided
        let llmSchema: object | undefined;
        if (options.extractSchema) {
          let schemaStr: string = options.extractSchema;
          if (schemaStr.startsWith('@')) {
            schemaStr = readFileSync(schemaStr.slice(1), 'utf-8');
          }
          try {
            llmSchema = JSON.parse(schemaStr);
          } catch {
            exitWithJsonError('--extract-schema must be valid JSON or a valid @file.json path', 'FETCH_FAILED');
          }
        }

        const llmResult = await extractWithLLM({
          content: result.content,
          instruction: llmInstruction,
          schema: llmSchema,
          apiKey: llmApiKey,
          model: llmModel,
          baseUrl: llmBaseUrl,
        });

        // Output structured items as JSON
        await writeStdout(JSON.stringify(llmResult.items, null, 2) + '\n');

        // Show token usage and estimated cost
        if (!options.silent) {
          const { input, output } = llmResult.tokensUsed;
          const costStr = llmResult.cost !== undefined
            ? ` | Est. cost: $${llmResult.cost.toFixed(6)}`
            : '';
          console.error(`\n🤖 LLM extraction: ${llmResult.items.length} items | ${input} input + ${output} output tokens${costStr} | model: ${llmResult.model}`);
        }

        await cleanup();
        process.exit(0);
      }

      // --- Extract-all / pagination / output formatting ---
      const wantsExtractAll = options.extractAll || options.scrollExtract !== undefined;
      const pagesCount = Math.min(Math.max(options.pages || 1, 1), 10);

      if (wantsExtractAll) {
        const { extractListings } = await import('../../core/extract-listings.js');
        const { findNextPageUrl } = await import('../../core/paginate.js');
        const { findSchemaForUrl, extractWithSchema, loadBundledSchemas } = await import('../../core/schema-extraction.js');

        // Resolve which schema to use (explicit --schema flag or auto-detect)
        let activeSchema = null;
        if (options.schema) {
          // Find schema by name or domain match
          const schemaQuery = options.schema.toLowerCase();
          const allSchemas = loadBundledSchemas();
          activeSchema = allSchemas.find(s =>
            s.name.toLowerCase().includes(schemaQuery) ||
            s.domains.some(d => d.toLowerCase().includes(schemaQuery))
          ) ?? null;
          if (!activeSchema && !options.silent) {
            console.error(`Warning: No schema found for "${options.schema}", falling back to auto-detection`);
          }
        } else {
          // Auto-detect from URL
          activeSchema = findSchemaForUrl(result.url || url);
        }

        // We need the raw HTML for extraction. Re-fetch with format=html if needed.
        let allListings: import('../../core/extract-listings.js').ListingItem[] = [];

        // Fetch HTML for extraction
        const htmlResult = peelOptions.format === 'html'
          ? result
          : await peel(url, { ...peelOptions, format: 'html', maxTokens: undefined });

        // Try schema extraction first, fall back to generic
        if (activeSchema) {
          const schemaListings = extractWithSchema(htmlResult.content, activeSchema, result.url);
          if (schemaListings.length > 0) {
            allListings.push(...(schemaListings as import('../../core/extract-listings.js').ListingItem[]));
          } else {
            // Schema returned nothing — fall back to generic
            allListings.push(...extractListings(htmlResult.content, result.url));
          }
        } else {
          allListings.push(...extractListings(htmlResult.content, result.url));
        }

        // Pagination: follow "Next" links
        if (pagesCount > 1) {
          let currentHtml = htmlResult.content;
          let currentUrl = result.url;
          for (let page = 1; page < pagesCount; page++) {
            const nextUrl = findNextPageUrl(currentHtml, currentUrl);
            if (!nextUrl) break;
            try {
              const nextResult = await peel(nextUrl, { ...peelOptions, format: 'html', maxTokens: undefined });
              let pageListings: import('../../core/extract-listings.js').ListingItem[];
              if (activeSchema) {
                const schemaPage = extractWithSchema(nextResult.content, activeSchema, nextResult.url);
                pageListings = schemaPage.length > 0
                  ? (schemaPage as import('../../core/extract-listings.js').ListingItem[])
                  : extractListings(nextResult.content, nextResult.url);
              } else {
                pageListings = extractListings(nextResult.content, nextResult.url);
              }
              allListings.push(...pageListings);
              currentHtml = nextResult.content;
              currentUrl = nextResult.url;
            } catch {
              break; // Stop paginating on error
            }
          }
        }

        // Apply budget to listings if requested
        let listingsTruncated = false;
        let totalAvailableListings: number | undefined;
        if (options.budget && options.budget > 0 && allListings.length > 0) {
          const { maxItems, truncated, totalAvailable } = budgetListings(allListings.length, options.budget);
          if (truncated) {
            listingsTruncated = true;
            totalAvailableListings = totalAvailable;
            allListings = allListings.slice(0, maxItems);
          }
        }

        // Output based on format flags
        if (options.csv) {
          const csvOutput = formatListingsCsv(allListings);
          await writeStdout(csvOutput);
        } else if (options.table) {
          const { formatTable } = await import('../../core/table-format.js');
          const tableRows = allListings.map(item => {
            const row: Record<string, string | undefined> = {};
            for (const [k, v] of Object.entries(item)) {
              if (v !== undefined) row[k] = v;
            }
            return row;
          });
          await writeStdout(formatTable(tableRows) + '\n');
        } else if (isJson) {
          // Use unified envelope for JSON output
          const structured = allListings as unknown as Record<string, unknown>[];
          const envelope = buildEnvelope(result, {
            cached: false,
            structured,
            truncated: listingsTruncated || undefined,
            totalAvailable: totalAvailableListings,
          });
          // Also include legacy fields for backward compat
          (envelope as any).listings = allListings;
          (envelope as any).count = allListings.length;
          await writeStdout(JSON.stringify(envelope, null, 2) + '\n');
        } else {
          // Formatted text output
          if (allListings.length === 0) {
            await writeStdout('No listings found.\n');
          } else {
            const truncNote = listingsTruncated && totalAvailableListings
              ? ` (${totalAvailableListings} total — budget limited to ${allListings.length})`
              : '';
            await writeStdout(`Found ${allListings.length} listings${truncNote}:\n\n`);
            allListings.forEach((item, i) => {
              const pricePart = item.price ? ` — ${item.price}` : '';
              const line = `${i + 1}. ${item.title}${pricePart}\n`;
              process.stdout.write(line);
              if (item.link) {
                process.stdout.write(`   ${item.link}\n`);
              }
              process.stdout.write('\n');
            });
          }
        }
      } else if (options.csv || options.table) {
        // CSV / table output for --extract (CSS selector extraction)
        if (result.extracted) {
          const rows = normaliseExtractedToRows(result.extracted);
          if (options.csv) {
            await writeStdout(formatListingsCsv(rows));
          } else {
            const { formatTable } = await import('../../core/table-format.js');
            await writeStdout(formatTable(rows) + '\n');
          }
        } else {
          console.error('--csv / --table require --extract-all or --extract to produce structured data.');
        }
      } else {
        // --- BM25 Schema Template Extraction (no LLM needed) ---
        if (options.schema && result.content) {
          const { getSchemaTemplate: getSchTmpl } = await import('../../core/schema-templates.js');
          const schTemplate = getSchTmpl(options.schema as string);
          if (schTemplate) {
            const { quickAnswer: qa } = await import('../../core/quick-answer.js');
            const { smartExtractSchemaFields } = await import('../../core/schema-postprocess.js');
            const extracted = smartExtractSchemaFields(
              result.content,
              schTemplate.fields,
              qa,
              {
                pageTitle: result.title,
                pageUrl: result.url,
                metadata: result.metadata as Record<string, any>,
              },
            );
            (result as any).extracted = extracted;
          }
        }

        // --content-only: output raw content only, no wrapper
        if (options.contentOnly) {
          await writeStdout(result.content + '\n');
        } else {
          // Output results (default path)
          await outputResult(result, options, {
            cached: false,
            truncated: contentTruncated || undefined,
          });

          // Token savings display (our unique selling point)
          if (!options.json && !options.silent && (result as any).tokenSavingsPercent) {
            const savings = (result as any).tokenSavingsPercent as number;
            const raw = (result as any).rawTokenEstimate as number | undefined;
            const optimized = result.tokens || 0;
            if (savings > 0) {
              const rawStr = raw ? `${raw.toLocaleString()}→${optimized.toLocaleString()} tokens` : `${optimized.toLocaleString()} tokens`;
              process.stderr.write(`\x1b[32m💰 Token savings: ${savings}% smaller than raw HTML (${rawStr})\x1b[0m\n`);
            }
          }
        }
      }

      // Clean up and exit
      await cleanup();
      process.exit(0);
    } catch (error) {
      if (autoProgressInterval) clearInterval(autoProgressInterval);
      if (spinner) {
        spinner.fail('Failed to fetch');
      }

      // --- #6: Consistent JSON error output ---
      if (isJson) {
        const errMsg = error instanceof Error ? error.message : 'Unknown error';
        const errCode = classifyErrorCode(error);
        await writeStdout(JSON.stringify({ success: false, error: { type: errCode.toLowerCase(), message: errMsg } }) + '\n');
        await cleanup();
        process.exit(1);
      }

      if (error instanceof Error) {
        console.error('\n' + formatError(error, url || '', options));
      } else {
        console.error('\x1b[31m✖ Unknown error occurred\x1b[0m');
      }

      await cleanup();
      process.exit(1);
    }
}

// ─── registerFetchCommands ───────────────────────────────────────────────────

export function registerFetchCommands(program: Command): void {
  // ── Default command: fetch a URL ─────────────────────────────────────────
  program
    .argument('[url]', 'URL to fetch')
    .option('-r, --render', 'Use headless browser (for JS-heavy sites)')
    .option('--stealth', 'Use stealth mode to bypass bot detection (auto-enables --render)')
    .option('--cloaked', 'Use CloakBrowser stealth (requires: npm install cloakbrowser)')
    .option('--tls', 'Use PeelTLS TLS fingerprint spoofing (built-in, no install needed)')
    .option('--cycle', 'Use PeelTLS TLS fingerprint spoofing (alias for --tls)', false)
    .option('--proxy <url>', 'Proxy URL for requests (http://host:port, socks5://user:pass@host:port)')
    .option('--proxies <urls>', 'Comma-separated list of proxy URLs for rotation (tried in order on failure)', (val: string) => val.split(',').map((s: string) => s.trim()).filter(Boolean))
    .option('-w, --wait <ms>', 'Wait time after page load (ms)', parseInt)
    .option('--html', 'Output raw HTML instead of markdown')
    .option('--text', 'Output plain text instead of markdown')
    .option('--clean', 'Clean output — article content only, no links or metadata (alias for --readable with URL-stripped markdown)')
    .option('--json', 'Output as JSON')
    .option('-t, --timeout <ms>', 'Request timeout (ms)', (v: string) => parseInt(v, 10), 30000)
    .option('--ua <agent>', 'Custom user agent')
    .option('-s, --silent', 'Silent mode (no spinner)')
    .option('--screenshot [path]', 'Take a screenshot (optionally save to file path)')
    .option('--full-page', 'Full-page screenshot (use with --screenshot)')
    .option('--selector <css>', 'CSS selector to extract (e.g., "article", ".content")')
    .option('--exclude <selectors...>', 'CSS selectors to exclude (e.g., ".sidebar" ".ads")')
    .option('--include-tags <tags>', 'Comma-separated HTML tags/selectors to include (e.g., "main,article,.content")')
    .option('--exclude-tags <tags>', 'Comma-separated HTML tags/selectors to exclude (e.g., "nav,footer,aside")')
    .option('--only-main-content', 'Shortcut for --include-tags main,article')
    .option('--full-content', 'Return full page content (disable automatic content density pruning)')
    .option('--readable', 'Reader mode — extract only the main article content, strip all noise (like browser Reader Mode)')
    .option('--full-nav', 'Keep full navigation/content (disable auto-readability when piped or in agent mode)')
    .option('--focus <query>', 'Query-focused filtering — only return content relevant to this query (BM25 ranking)')
    .option('--chunk', 'Split content into RAG-ready chunks')
    .option('--chunk-size <tokens>', 'Max tokens per chunk (default: 512)', parseInt)
    .option('--chunk-overlap <tokens>', 'Overlap tokens between chunks (default: 50)', parseInt)
    .option('--chunk-strategy <strategy>', 'Chunking strategy: section (default), paragraph, fixed')
    .option('-H, --header <header...>', 'Custom headers (e.g., "Authorization: Bearer token")')
    .option('--cookie <cookie...>', 'Cookies to set (e.g., "session=abc123")')
    .option('--cache <ttl>', 'Cache results locally (e.g., "5m", "1h", "1d") — default: 5m')
    .option('--no-cache', 'Disable automatic caching for this request')
    .option('--links', 'Output only the links found on the page')
    .option('--images', 'Output image URLs from the page')
    .option('--meta', 'Output only the page metadata (title, description, author, etc.)')
    .option('--raw', 'Return full page without smart content extraction')
    .option('--full', 'Alias for --raw — full page content, no budget')
    .option('--lite', 'Lite mode — minimal processing, maximum speed (skip pruning, budget, metadata)')
    .option('--action <actions...>', 'Page actions before scraping (e.g., "click:.btn" "wait:2000" "scroll:bottom")')
    .option('--extract <json>', 'Extract structured data using CSS selectors or type schema (e.g., \'{"title": "h1"}\' for CSS, \'{"name": "string"}\' for schema)')
    .option('--extract-prompt <prompt>', 'Natural language prompt for structured extraction (no LLM key needed — uses heuristics)')
    .option('--llm-extract [instruction]', 'Extract structured data using LLM (optional instruction, e.g. "extract hotel names and prices")')
    .option('--extract-schema <schema>', 'JSON schema for structured extraction (requires LLM key). Pass inline JSON or @file.json')
    .option('--llm-key <key>', 'LLM API key for AI features (or use OPENAI_API_KEY env var)')
    .option('--llm-model <model>', 'LLM model to use (default: gpt-4o-mini)')
    .option('--llm-base-url <url>', 'LLM API base URL (default: https://api.openai.com/v1)')
    .option('--summary', 'Generate AI summary of content (requires --llm-key or OPENAI_API_KEY)')
    .option('--location <country>', 'ISO country code for geo-targeting (e.g., "US", "DE", "JP")')
    .option('--language <lang>', 'Language preference (e.g., "en", "de", "ja")')
    .option('--max-tokens <n>', 'Maximum token count for output (truncate if exceeded)', parseInt)
    .option('--budget <n>', 'Smart token budget — distill content to fit within N tokens (heuristic, no LLM key needed)', parseInt)
    .option('--extract-all', 'Auto-detect and extract repeated listing items (e.g., search results)')
    .option('--schema <name>', 'Force a specific extraction schema by name or domain (e.g., "booking.com", "amazon")')
    .option('--list-schemas', 'List all available extraction schemas and their supported domains')
    .option('--scroll-extract [count]', 'Scroll page N times to load lazy content (bare flag = smart auto-scroll until stable), then extract (implies --render)', (v: string) => parseInt(v, 10))
    .option('--scroll-extract-timeout <ms>', 'Total timeout in ms for auto-scroll (default: 30000, only used with bare --scroll-extract)', parseInt)
    .option('--csv', 'Output extraction results as CSV')
    .option('--table', 'Output extraction results as a formatted table')
    .option('--pages <n>', 'Follow pagination "Next" links for N pages (max 10)', (v: string) => parseInt(v, 10))
    .option('--profile <path>', 'Use a persistent browser profile directory (cookies/sessions survive between calls)')
    .option('--headed', 'Run browser in headed (visible) mode — useful for profile setup and debugging')
    .option('-q, --question <q>', 'Ask a question about the page content (BM25-powered, no LLM key needed)')
    .option('--agent', 'Agent mode: sets --json, --silent, --extract-all, and --budget 4000 (override with --budget N)')
    .option('--device <type>', 'Device emulation: desktop (default), mobile, tablet (auto-enables --render)')
    .option('--viewport <WxH>', 'Browser viewport size (e.g., "1920x1080") (auto-enables --render)', (val: string) => {
      const [w, h] = val.split('x').map(Number);
      return { width: w, height: h };
    })
    .option('--wait-until <event>', 'Page load event: domcontentloaded, networkidle, load, commit (auto-enables --render)')
    .option('--wait-selector <css>', 'Wait for CSS selector before extracting (auto-enables --render)')
    .option('--block-resources <types>', 'Block resource types, comma-separated: image,stylesheet,font,media,script (auto-enables --render)')
    .option('--format <type>', 'Output format: markdown (default), text, html, json')
    .option('--content-only', 'Output only the raw content field (no metadata, no JSON wrapper) — ideal for piping to LLMs')
    .option('--progress', 'Show engine escalation steps (simple → browser → stealth) with timing')
    .option('--stdin', 'Read HTML from stdin instead of fetching a URL — converts to markdown')
    .option('--export <format>', 'Export YouTube transcript in the given format: srt, txt, md, json')
    .option('--output <file>', 'Write output to a file instead of stdout')
    .action(async (url: string | undefined, options) => {
      if (options.stdin) {
        await runStdin(options);
        return;
      }
      await runFetch(url, options);
    });

  // ── read subcommand (explicit readable mode) ─────────────────────────────
  program
    .command('read <url>')
    .description('Read a page in clean reader mode (like browser Reader View)')
    .option('--json', 'Output as JSON')
    .option('-s, --silent', 'Silent mode')
    .option('--budget <n>', 'Token budget (default: 4000)', parseInt)
    .option('--focus <query>', 'Focus on content relevant to this query')
    .action(async (url: string, opts: any) => {
      await runFetch(url, {
        ...opts,
        readable: true,
        budget: 4000,
      });
    });

  // ── pipe subcommand — always JSON, no UI (agent-friendly) ────────────────
  program
    .command('pipe <url>')
    .description('Pipe-friendly fetch (always JSON, no UI). Alias for: webpeel <url> --json --silent')
    .option('-r, --render', 'Use headless browser')
    .option('--stealth', 'Stealth mode')
    .option('--budget <n>', 'Token budget', parseInt)
    .option('--clean', 'Clean format for AI')
    .option('-q, --question <q>', 'Quick answer')
    .option('--proxy <url>', 'Proxy URL')
    .option('--timeout <ms>', 'Timeout in ms', parseInt)
    .option('-s, --silent', 'Silent mode (always on for pipe, accepted for compatibility)')
    .action(async (url: string, opts) => {
      // Force JSON + silent — always, unconditionally
      opts.json = true;
      opts.silent = true;
      await runFetch(url, opts);
    });
}
