/**
 * Interact commands: ask, webask, watch, diff, track, summarize, agent, answer, research, schemas
 */

import type { Command } from 'commander';
import ora from 'ora';
import { peel, cleanup } from '../../index.js';
import { loadConfig } from '../../cli-auth.js';
import { writeStdout, formatRelativeTime } from '../utils.js';
import { runFetch } from './fetch.js';
import { SCHEMA_TEMPLATES, getSchemaTemplate, listSchemaTemplates } from '../../core/schema-templates.js';

export function registerInteractCommands(program: Command): void {

  // ── ask subcommand (question mode) ────────────────────────────────────────
  program
    .command('ask <url> <question>')
    .description('Ask a question about any page')
    .option('--json', 'Output as JSON')
    .option('-s, --silent', 'Silent mode')
    .action(async (url: string, question: string, opts: any) => {
      await runFetch(url, {
        ...opts,
        question,
        readable: true,
      });
    });

  // ── watch command ─────────────────────────────────────────────────────────
  program
    .command('watch <url>')
    .description('Monitor a URL for changes and assertion failures')
    .option('--interval <duration>', 'Check interval (e.g. 30s, 5m, 1h)', '5m')
    .option('--assert <condition...>', 'Assertion(s) to check (e.g. "status=200" "body.health=ok")')
    .option('--webhook <url>', 'POST this URL on assertion failure or content change')
    .option('-t, --timeout <ms>', 'Per-request timeout in ms', (v: string) => parseInt(v, 10), 10000)
    .option('--max-checks <n>', 'Stop after N checks (default: unlimited)', (v: string) => parseInt(v, 10))
    .option('--json', 'Output each check as NDJSON to stdout')
    .option('-s, --silent', 'Only output on failures/changes')
    .option('-r, --render', 'Use browser rendering for checks')
    .action(async (url: string, options) => {
      const { watch: runWatch, parseDuration, parseAssertion } = await import('../../core/watch.js');
      type WatchOptions = import('../../core/watch.js').WatchOptions;

      // Validate URL
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          console.error('Error: Only HTTP and HTTPS protocols are allowed');
          process.exit(1);
        }
      } catch {
        console.error(`Error: Invalid URL format: ${url}`);
        process.exit(1);
      }

      // Parse interval
      let intervalMs: number;
      try {
        intervalMs = parseDuration(options.interval);
      } catch (e) {
        console.error(`Error: ${(e as Error).message}`);
        process.exit(1);
      }

      // Parse assertions
      const assertions: import('../../core/watch.js').Assertion[] = [];
      if (options.assert && Array.isArray(options.assert)) {
        for (const expr of options.assert as string[]) {
          try {
            assertions.push(parseAssertion(expr));
          } catch (e) {
            console.error(`Error: ${(e as Error).message}`);
            process.exit(1);
          }
        }
      }

      if (!options.json && !options.silent) {
        const intervalLabel = options.interval;
        const assertLabel = assertions.length > 0
          ? ` with ${assertions.length} assertion(s)`
          : '';
        process.stderr.write(
          `Watching ${url} every ${intervalLabel}${assertLabel}. Press Ctrl+C to stop.\n`,
        );
      }

      const watchOptions: WatchOptions = {
        url,
        intervalMs,
        assertions,
        webhookUrl: options.webhook,
        timeout: options.timeout,
        maxChecks: options.maxChecks,
        render: options.render || false,
        json: options.json || false,
        silent: options.silent || false,
      };

      try {
        await runWatch(watchOptions);
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        process.exit(1);
      }

      process.exit(0);
    });

  // ── diff command ──────────────────────────────────────────────────────────
  program
    .command('diff <url>')
    .description('Show semantic diff between current content and the last tracked snapshot')
    .option('--last', 'Compare against last tracked snapshot (default)')
    .option('--against <snapshot-url>', 'Compare against the snapshot stored for a different URL')
    .option('--fields <fields>', 'For JSON responses: only diff these fields (comma-separated dot-notation)')
    .option('--json', 'Output diff as JSON')
    .option('-r, --render', 'Use browser rendering')
    .option('-t, --timeout <ms>', 'Request timeout in ms', (v: string) => parseInt(v, 10), 30000)
    .option('-s, --silent', 'Silent mode (no spinner)')
    .action(async (url: string, options) => {
      const isJson = options.json;

      // Validate URL
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          if (isJson) {
            await writeStdout(JSON.stringify({ success: false, error: { type: 'invalid_url', message: 'Only HTTP and HTTPS protocols are allowed' } }) + '\n');
          } else {
            console.error('Error: Only HTTP and HTTPS protocols are allowed');
          }
          process.exit(1);
        }
      } catch {
        if (isJson) {
          await writeStdout(JSON.stringify({ success: false, error: { type: 'invalid_url', message: `Invalid URL format: ${url}` } }) + '\n');
        } else {
          console.error(`Error: Invalid URL format: ${url}`);
        }
        process.exit(1);
      }

      const spinner = options.silent ? null : ora('Fetching and diffing...').start();

      try {
        const { diffUrl } = await import('../../core/diff.js');

        const fields = options.fields
          ? (options.fields as string).split(',').map((f: string) => f.trim()).filter(Boolean)
          : undefined;

        const result = await diffUrl(url, {
          render: options.render || false,
          timeout: options.timeout,
          fields,
        });

        if (spinner) {
          spinner.succeed(`Diff completed in ${result.changed ? 'CHANGED' : 'no change'}`);
        }

        if (isJson) {
          await writeStdout(JSON.stringify(result, null, 2) + '\n');
        } else {
          // Human-readable output
          const ago = result.previousTimestamp
            ? formatRelativeTime(new Date(result.previousTimestamp))
            : 'unknown';
          console.log(`\nComparing ${result.url} (now vs ${ago})\n`);

          if (!result.changed) {
            console.log('  No changes detected.');
          } else {
            for (const change of result.changes) {
              const label = change.field ?? change.path ?? '(unknown)';
              if (change.type === 'modified') {
                console.log(`  Modified: ${label}  ${change.before} → ${change.after}`);
              } else if (change.type === 'added') {
                console.log(`  Added:    ${label}  ${change.after}`);
              } else if (change.type === 'removed') {
                console.log(`  Removed:  ${label}  ${change.before}`);
              }
            }
          }

          console.log(`\nSummary: ${result.summary}`);
        }

        await cleanup();
        process.exit(0);
      } catch (error) {
        if (spinner) spinner.fail('Diff failed');
        if (isJson) {
          await writeStdout(JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error',
            code: 'FETCH_FAILED',
          }) + '\n');
        } else {
          console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
        await cleanup();
        process.exit(1);
      }
    });

  // ── track command ─────────────────────────────────────────────────────────
  program
    .command('track <url>')
    .description('Track changes on a URL (saves snapshot for use with `webpeel diff`)')
    .option('-s, --silent', 'Silent mode (no spinner)')
    .option('--json', 'Output as JSON')
    .option('-r, --render', 'Use browser rendering')
    .action(async (url: string, options) => {
      const spinner = options.silent ? null : ora('Fetching and tracking...').start();

      try {
        // changeTracking: true saves the snapshot to ~/.webpeel/snapshots/ so that
        // `webpeel diff` can compare against it later.
        const result = await peel(url, {
          render: options.render || false,
          changeTracking: true,
        });

        if (spinner) {
          spinner.succeed(`Tracked in ${result.elapsed}ms`);
        }

        const changeStatus = result.changeTracking?.changeStatus ?? 'new';
        const previousScrapeAt = result.changeTracking?.previousScrapeAt ?? null;

        if (options.json) {
          await writeStdout(JSON.stringify({
            url: result.url,
            title: result.title,
            fingerprint: result.fingerprint,
            tokens: result.tokens,
            contentType: result.contentType,
            changeStatus,
            previousScrapeAt,
            lastChecked: new Date().toISOString(),
          }, null, 2) + '\n');
        } else {
          console.log(`URL: ${result.url}`);
          console.log(`Title: ${result.title}`);
          console.log(`Fingerprint: ${result.fingerprint}`);
          console.log(`Tokens: ${result.tokens}`);
          console.log(`Status: ${changeStatus}`);
          if (previousScrapeAt) console.log(`Previous check: ${previousScrapeAt}`);
          console.log(`Last checked: ${new Date().toISOString()}`);
          console.log('\nSnapshot saved. Run `webpeel diff <url> --last` to compare future changes.');
        }

        await cleanup();
        process.exit(0);
      } catch (error) {
        if (spinner) spinner.fail('Tracking failed');
        console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        await cleanup();
        process.exit(1);
      }
    });

  // ── summarize command ─────────────────────────────────────────────────────
  program
    .command('summarize <url>')
    .description('Generate an AI-powered summary of a URL')
    .option('--llm-key <key>', 'LLM API key (or use OPENAI_API_KEY env var)')
    .option('--llm-model <model>', 'LLM model to use (default: gpt-4o-mini)')
    .option('--llm-base-url <url>', 'LLM API base URL (default: https://api.openai.com/v1)')
    .option('--prompt <prompt>', 'Custom summary prompt')
    .option('-s, --silent', 'Silent mode (no spinner)')
    .option('--json', 'Output as JSON')
    .action(async (url: string, options) => {
      const llmApiKey = options.llmKey || process.env.OPENAI_API_KEY;

      if (!llmApiKey) {
        console.error('Error: --llm-key or OPENAI_API_KEY environment variable is required');
        process.exit(1);
      }

      const spinner = options.silent ? null : ora('Fetching and summarizing...').start();

      try {
        const result = await peel(url, {
          extract: {
            prompt: options.prompt || 'Summarize this webpage in 2-3 sentences.',
            llmApiKey,
            llmModel: options.llmModel || 'gpt-4o-mini',
            llmBaseUrl: options.llmBaseUrl || 'https://api.openai.com/v1',
          },
        });

        if (spinner) {
          spinner.succeed(`Summarized in ${result.elapsed}ms`);
        }

        if (options.json) {
          console.log(JSON.stringify({
            url: result.url,
            title: result.title,
            summary: result.extracted,
          }, null, 2));
        } else {
          console.log(`\n${result.title}\n`);
          console.log(result.extracted);
        }

        await cleanup();
        process.exit(0);
      } catch (error) {
        if (spinner) spinner.fail('Summary generation failed');
        console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        await cleanup();
        process.exit(1);
      }
    });

  // ── agent command ─────────────────────────────────────────────────────────
  program
    .command('agent <prompt>')
    .description('Web research agent — LLM-free by default, add --llm-key for AI synthesis')
    .option('--llm-key <key>', 'LLM API key (or use OPENAI_API_KEY env var)')
    .option('--llm-model <model>', 'LLM model to use (default: gpt-4o-mini)')
    .option('--llm-base-url <url>', 'LLM API base URL')
    .option('--urls <urls>', 'Comma-separated starting URLs')
    .option('--max-pages <n>', 'Maximum pages to visit (default: 10)', '10')
    .option('--schema <json>', 'Schema template name (e.g. product, article) or JSON schema for structured output')
    .option('-s, --silent', 'Silent mode (no spinner)')
    .option('--json', 'Output as JSON')
    .action(async (prompt: string, options) => {
      const llmApiKey = options.llmKey || process.env.OPENAI_API_KEY;
      const urls = options.urls ? options.urls.split(',').map((u: string) => u.trim()) : undefined;

      // Parse schema (support templates)
      let schema: Record<string, string> | undefined;
      if (options.schema) {
        const template = getSchemaTemplate(options.schema);
        if (template) {
          schema = template.fields;
        } else {
          try {
            schema = JSON.parse(options.schema);
          } catch {
            console.error(`Error: --schema must be a template name (${listSchemaTemplates().join(', ')}) or valid JSON`);
            process.exit(1);
          }
        }
      }

      if (llmApiKey) {
        // Full LLM agent mode (existing code)
        const spinner = options.silent ? null : ora('Running agent research...').start();
        try {
          const { runAgent } = await import('../../core/agent.js');
          const result = await runAgent({
            prompt,
            urls,
            schema,
            llmApiKey,
            llmModel: options.llmModel,
            llmApiBase: options.llmBaseUrl,
            maxPages: parseInt(options.maxPages, 10),
            onProgress: (progress) => {
              if (spinner) spinner.text = progress.message;
            },
          });
          if (spinner) spinner.succeed(`Agent finished: ${result.pagesVisited} pages`);
          if (options.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.log(`\nSources (${result.sources.length}):`);
            result.sources.forEach(s => console.log(`  • ${s}`));
            console.log(`\nResults:`);
            console.log(JSON.stringify(result.data, null, 2));
          }
          await cleanup();
          process.exit(0);
        } catch (e) {
          if (spinner) spinner.fail('Agent failed');
          console.error(e instanceof Error ? e.message : e);
          await cleanup();
          process.exit(1);
        }
      } else {
        // LLM-free mode: search + fetch + BM25 extraction
        const spinner = options.silent ? null : ora('Running LLM-free research...').start();

        try {
          // Import needed modules
          const { quickAnswer } = await import('../../core/quick-answer.js');

          // Step 1: Get URLs to process
          let targetUrls: string[] = urls || [];

          // If no URLs, search the web
          if (targetUrls.length === 0) {
            if (spinner) spinner.text = 'Searching the web...';
            try {
              const { getBestSearchProvider } = await import('../../core/search-provider.js');
              const { provider, apiKey: searchApiKey } = getBestSearchProvider();
              const searchResults = await provider.searchWeb(prompt, {
                count: Math.min(parseInt(options.maxPages, 10) || 5, 10),
                apiKey: searchApiKey,
              });
              targetUrls = searchResults.map((r: { url: string }) => r.url);
            } catch {
              // Fallback: try DuckDuckGo HTML
              if (spinner) spinner.text = 'Searching via DuckDuckGo...';
              try {
                const duckUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(prompt)}`;
                const searchResult = await peel(duckUrl, { budget: 4000 });
                // Extract URLs from search results content
                const urlMatches = searchResult.content.match(/https?:\/\/[^\s\)]+/g) || [];
                targetUrls = urlMatches
                  .filter((u: string) => !u.includes('duckduckgo.com'))
                  .slice(0, parseInt(options.maxPages, 10) || 5);
              } catch {
                // No search results
              }
            }
          }

          if (targetUrls.length === 0) {
            if (spinner) spinner.fail('No URLs found. Provide --urls or a more specific prompt.');
            process.exit(1);
          }

          if (spinner) spinner.text = `Processing ${targetUrls.length} pages...`;

          // Step 2: Fetch and extract from each URL
          const results: Array<{
            url: string;
            title: string;
            extracted: Record<string, string> | null;
            content: string;
            confidence: number;
          }> = [];

          for (const url of targetUrls) {
            try {
              if (spinner) spinner.text = `Fetching: ${url.substring(0, 60)}...`;
              const pageResult = await peel(url, { budget: 4000 });

              let extracted: Record<string, string> | null = null;
              let confidence = 0;

              if (schema) {
                // Extract each schema field using smartExtractSchemaFields
                const { smartExtractSchemaFields: smartExtractResearch } = await import('../../core/schema-postprocess.js');
                extracted = smartExtractResearch(
                  pageResult.content,
                  schema as Record<string, string>,
                  quickAnswer,
                  {
                    pageTitle: (pageResult as any).title,
                    pageUrl: url,
                    metadata: (pageResult as any).metadata as Record<string, any>,
                  },
                );
                // Calculate confidence from quickAnswer for any field
                for (const question of Object.values(schema)) {
                  try {
                    const qa = quickAnswer({ content: pageResult.content, question: typeof question === 'string' ? question : '' });
                    confidence = Math.max(confidence, qa.confidence || 0);
                  } catch { /* ignore */ }
                  break; // just need one confidence estimate
                }
              } else {
                // Answer the prompt directly
                try {
                  const qa = quickAnswer({ content: pageResult.content, question: prompt });
                  extracted = { answer: qa.answer || '' };
                  confidence = qa.confidence || 0;
                } catch {
                  extracted = null;
                }
              }

              results.push({
                url,
                title: pageResult.metadata?.title || url,
                extracted,
                content: pageResult.content.substring(0, 500),
                confidence,
              });
            } catch (e) {
              // Skip failed URLs
              if (process.env.DEBUG) {
                console.debug('[webpeel]', `Failed to fetch ${url}:`, e instanceof Error ? e.message : e);
              }
            }
          }

          if (spinner) spinner.succeed(`Processed ${results.length}/${targetUrls.length} pages (LLM-free)`);

          if (options.json) {
            console.log(JSON.stringify({
              mode: 'llm-free',
              prompt,
              schema: schema || null,
              results,
              sources: results.map(r => r.url),
              pagesVisited: results.length,
            }, null, 2));
          } else {
            console.log(`\n📊 Results (${results.length} pages, LLM-free):\n`);
            for (const r of results) {
              console.log(`── ${r.title} ──`);
              console.log(`   ${r.url}`);
              if (r.extracted) {
                for (const [k, v] of Object.entries(r.extracted)) {
                  if (v) console.log(`   ${k}: ${v}`);
                }
              }
              console.log(`   Confidence: ${(r.confidence * 100).toFixed(0)}%\n`);
            }
          }

          await cleanup();
          process.exit(0);
        } catch (e) {
          if (spinner) spinner.fail('Research failed');
          console.error(e instanceof Error ? e.message : e);
          await cleanup();
          process.exit(1);
        }
      }
    });

  // ── webask command ────────────────────────────────────────────────────────
  program
    .command('webask <question>')
    .alias('ask-web')
    .description('Search the web and get a direct answer (no LLM key required)')
    .option('-n, --sources <n>', 'Number of sources to check (1-5, default 3)', '3')
    .option('--json', 'Output as JSON')
    .option('-s, --silent', 'Silent mode')
    .action(async (question: string, options) => {
      const isJson = !!options.json;
      const isSilent = !!options.silent;
      const numSources = Math.min(Math.max(parseInt(options.sources) || 3, 1), 5);

      const askCfg = loadConfig();
      const askApiKey = askCfg.apiKey || process.env.WEBPEEL_API_KEY;
      const askApiUrl = process.env.WEBPEEL_API_URL || 'https://api.webpeel.dev';

      if (!askApiKey) {
        console.error('No API key configured. Run: webpeel auth <your-key>');
        console.error('Get a free key at: https://app.webpeel.dev/keys');
        process.exit(2);
      }

      let spinner: any = null;
      if (!isSilent && !isJson) {
        const { default: oraModule } = await import('ora');
        spinner = oraModule(`Searching for: ${question}`).start();
      }

      try {
        const params = new URLSearchParams({ q: question, sources: String(numSources) });
        const res = await fetch(`${askApiUrl}/v1/ask?${params}`, {
          headers: { Authorization: `Bearer ${askApiKey}` },
          signal: AbortSignal.timeout(60000),
        });

        if (res.status === 401) {
          if (spinner) spinner.fail('API key invalid or expired. Run: webpeel auth <new-key>');
          process.exit(2);
        }
        if (res.status === 404) {
          if (spinner) spinner.fail('Ask endpoint not available on this server version');
          process.exit(1);
        }
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          if (spinner) spinner.fail(`API error ${res.status}: ${body.slice(0, 100)}`);
          process.exit(1);
        }

        const data = await res.json() as any;

        if (spinner) {
          if (data.answer) {
            spinner.succeed(`Found answer (confidence: ${Math.round((data.confidence || 0) * 100)}%)`);
          } else {
            spinner.warn('No confident answer found');
          }
        }

        if (isJson) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          if (data.answer) {
            console.log('\n' + data.answer);
            if (data.sources?.length && !isSilent) {
              console.log('\nSources:');
              data.sources.slice(0, 3).forEach((s: any) => console.log(`  • ${s.title || s.url} — ${s.url}`));
            }
          } else {
            console.log('\nNo confident answer found for:', question);
          }
          if (data.elapsed && !isSilent) console.log(`\n⚡ ${data.elapsed}ms`);
        }
      } catch (err: any) {
        if (spinner) spinner.fail(err.message);
        process.exit(1);
      }
    });

  // ── answer command ────────────────────────────────────────────────────────
  program
    .command('answer <question>')
    .description('Ask a question, search the web, and get an AI-generated answer with citations (BYOK)')
    .option('--provider <provider>', 'Search provider: duckduckgo (default) or brave')
    .option('--search-api-key <key>', 'Search provider API key (or env WEBPEEL_BRAVE_API_KEY)')
    .option('--llm <provider>', 'LLM provider: openai, anthropic, or google (required)')
    .option('--llm-api-key <key>', 'LLM API key (or env OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY)')
    .option('--llm-model <model>', 'LLM model name (optional, uses provider default)')
    .option('--max-sources <n>', 'Maximum sources to fetch (1-10, default 5)', '5')
    .option('--json', 'Output as JSON')
    .option('-s, --silent', 'Silent mode')
    .action(async (question: string, options) => {
      const spinner = options.silent ? null : ora('Thinking...').start();

      try {
        const { answerQuestion } = await import('../../core/answer.js');
        type LLMProviderId = import('../../core/answer.js').LLMProviderId;
        type SearchProviderId = import('../../core/search-provider.js').SearchProviderId;

        const config = loadConfig();

        const llmProvider = (options.llm as LLMProviderId | undefined);
        if (!llmProvider || !['openai', 'anthropic', 'google'].includes(llmProvider)) {
          console.error('Error: --llm is required (openai, anthropic, or google)');
          process.exit(1);
        }

        const llmApiKey = options.llmApiKey
          || process.env.OPENAI_API_KEY
          || process.env.ANTHROPIC_API_KEY
          || process.env.GOOGLE_API_KEY
          || '';

        if (!llmApiKey) {
          console.error('Error: --llm-api-key is required (or set OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY)');
          process.exit(1);
        }

        const searchProvider = (options.provider || 'duckduckgo') as SearchProviderId;
        const searchApiKey = options.searchApiKey
          || process.env.WEBPEEL_BRAVE_API_KEY
          || config.braveApiKey
          || undefined;

        const maxSources = Math.min(Math.max(parseInt(options.maxSources) || 5, 1), 10);

        if (spinner) spinner.text = 'Searching the web...';

        const result = await answerQuestion({
          question,
          searchProvider,
          searchApiKey,
          llmProvider,
          llmApiKey,
          llmModel: options.llmModel,
          maxSources,
          stream: false,
        });

        if (spinner) spinner.succeed('Done');

        if (options.json) {
          const jsonStr = JSON.stringify(result, null, 2);
          await new Promise<void>((resolve, reject) => {
            process.stdout.write(jsonStr + '\n', (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
        } else {
          console.log(`\n${result.answer}`);
          console.log(`\nSources:`);
          result.citations.forEach((c, i) => {
            console.log(`  [${i + 1}] ${c.title}`);
            console.log(`      ${c.url}`);
          });
          console.log(`\nModel: ${result.llmModel} (${result.llmProvider})`);
        }

        await cleanup();
        process.exit(0);
      } catch (error) {
        if (spinner) spinner.fail('Answer generation failed');
        console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        await cleanup();
        process.exit(1);
      }
    });

  // ── research command ──────────────────────────────────────────────────────
  program
    .command('research <query>')
    .description('Conduct autonomous multi-step web research on a topic and synthesize a report')
    .option('--max-sources <n>', 'Maximum sources to consult (default: 5)', '5')
    .option('--max-depth <n>', 'Link-following depth (default: 1)', '1')
    .option('--format <f>', 'Output format: report (default) or sources', 'report')
    .option('--llm-key <key>', 'LLM API key for synthesis (or env OPENAI_API_KEY)')
    .option('--llm-model <model>', 'LLM model for synthesis (default: gpt-4o-mini)')
    .option('--llm-base-url <url>', 'LLM API base URL (default: https://api.openai.com/v1)')
    .option('--timeout <ms>', 'Max research time in ms (default: 40000)', '60000')
    .option('--json', 'Output result as JSON')
    .option('-s, --silent', 'Suppress progress output')
    .action(async (query: string, options) => {
      const isSilent = !!options.silent;
      const isJson = !!options.json;
      const maxSources = parseInt(options.maxSources) || 5;
      const maxDepth = parseInt(options.maxDepth) || 1;
      const timeout = parseInt(options.timeout) || 60000;
      const outputFormat = options.format === 'sources' ? 'sources' : 'report';
      const apiKey = options.llmKey || process.env.OPENAI_API_KEY;
      const model = options.llmModel;
      const baseUrl = options.llmBaseUrl;

      const phaseIcons: Record<string, string> = {
        searching: '🔍',
        fetching: '📄',
        extracting: '🧠',
        following: '🔗',
        synthesizing: '✍️',
      };

      try {
        const { research } = await import('../../core/research.js');

        const result = await research({
          query,
          maxSources,
          maxDepth,
          timeout,
          outputFormat: outputFormat as 'report' | 'sources',
          apiKey,
          model,
          baseUrl,
          onProgress: (step) => {
            if (!isSilent && !isJson) {
              const icon = phaseIcons[step.phase] ?? '⚙️';
              const extra = step.sourcesFound !== undefined
                ? ` (found ${step.sourcesFound})`
                : step.sourcesFetched !== undefined
                  ? ` (${step.sourcesFetched} fetched)`
                  : '';
              process.stderr.write(`${icon} ${step.message}${extra}...\n`);
            }
          },
        });

        if (isJson) {
          await writeStdout(JSON.stringify(result, null, 2) + '\n');
        } else {
          await writeStdout(result.report + '\n');
          if (!isSilent) {
            const elapsed = (result.elapsed / 1000).toFixed(1);
            const cost = result.cost !== undefined ? ` | cost: $${result.cost.toFixed(4)}` : '';
            process.stderr.write(
              `\n📊 ${result.sourcesConsulted} sources consulted (${result.totalSourcesFound} found) | ${elapsed}s${cost}\n`,
            );
          }
        }

        await cleanup();
        process.exit(0);
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        if (isJson) {
          await writeStdout(JSON.stringify({ success: false, error: { type: 'fetch_failed', message: msg } }) + '\n');
        } else {
          console.error(`\nError: ${msg}`);
        }
        await cleanup();
        process.exit(1);
      }
    });

  // ── do command — natural language intent routing ──────────────────────────
  program
    .command('do <task...>')
    .description('Do anything — describe what you want in plain English')
    .option('-s, --silent', 'Silent mode')
    .option('--json', 'JSON output')
    .action(async (taskParts: string[], options: any) => {
      const task = taskParts.join(' ');
      const cfg = loadConfig();
      const apiKey = cfg.apiKey || process.env.WEBPEEL_API_KEY;
      const apiUrl = process.env.WEBPEEL_API_URL || 'https://api.webpeel.dev';

      if (!apiKey) {
        console.error('No API key. Run: webpeel auth <key>');
        process.exit(1);
      }

      let spinner: any = null;
      if (!options.silent && !options.json) {
        const { default: oraModule } = await import('ora');
        spinner = oraModule(`Doing: ${task}`).start();
      }

      try {
        const res = await fetch(`${apiUrl}/v1/do`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ task }),
          signal: AbortSignal.timeout(60000),
        });

        const data = await res.json() as any;

        if (spinner) {
          if (data.error) {
            spinner.fail(`Failed: ${data.message || data.error}`);
          } else {
            spinner.succeed(`Done (${data.elapsed}ms) — intent: ${data.intent}`);
          }
        }

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          if (data.error) {
            console.error(`Error: ${data.message || data.error}`);
            process.exit(1);
          }
          console.log(`Intent: ${data.intent}`);
          if (data.url) console.log(`URL: ${data.url}`);
          if (data.query) console.log(`Query: ${data.query}`);
          console.log(`Elapsed: ${data.elapsed}ms`);
          console.log('');
          // Pretty-print the result
          const result = data.result || {};
          if (result.content) console.log(result.content.slice(0, 2000));
          else if (result.answer) console.log(`Answer: ${result.answer}\nConfidence: ${Math.round((result.confidence || 0) * 100)}%`);
          else if (result.screenshot) console.log(`Screenshot: ${result.screenshot.length} bytes (base64)`);
          else console.log(JSON.stringify(result, null, 2).slice(0, 2000));
        }
      } catch (err: any) {
        if (spinner) spinner.fail(err.message);
        if (!options.silent) console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  // ── schemas command ───────────────────────────────────────────────────────
  program
    .command('schemas')
    .description('List available extraction schema templates')
    .action(() => {
      console.log('\nAvailable schema templates:\n');
      for (const [key, template] of Object.entries(SCHEMA_TEMPLATES)) {
        console.log(`  ${key.padEnd(12)} ${template.description}`);
        console.log(`  ${''.padEnd(12)} Fields: ${Object.keys(template.fields).join(', ')}`);
        console.log('');
      }
      console.log('Usage: webpeel "https://example.com" --schema product');
      console.log('       webpeel "https://example.com" --schema \'{"field":"description"}\'');
    });
}
