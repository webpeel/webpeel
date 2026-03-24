/**
 * Screenshot commands: screenshot, brand, design-compare
 */

import type { Command } from 'commander';
import ora from 'ora';
import { writeFileSync } from 'fs';
import { cleanup } from '../../index.js';
import { checkUsage, showUsageFooter } from '../../cli-auth.js';
import { parseActions, extractColors, extractFonts } from '../utils.js';
import type { PageAction } from '../../types.js';
import { peel } from '../../index.js';

export function registerScreenshotCommands(program: Command): void {

  // ── screenshot command ────────────────────────────────────────────────────
  program
    .command('screenshot <url>')
    .alias('snap')
    .description('Take a screenshot of a URL and save as PNG/JPEG')
    .option('--full-page', 'Capture full page (not just viewport)')
    .option('--width <px>', 'Viewport width in pixels (default: 1280)', parseInt)
    .option('--height <px>', 'Viewport height in pixels (default: 720)', parseInt)
    .option('--format <fmt>', 'Image format: png (default) or jpeg', 'png')
    .option('--quality <n>', 'JPEG quality 1-100 (ignored for PNG)', parseInt)
    .option('-w, --wait <ms>', 'Wait time after page load (ms)', parseInt)
    .option('-t, --timeout <ms>', 'Request timeout (ms)', (v: string) => parseInt(v, 10), 30000)
    .option('--stealth', 'Use stealth mode to bypass bot detection')
    .option('--action <actions...>', 'Page actions before screenshot (e.g., "click:.btn" "wait:2000")')
    .option('--scroll-through', 'Auto-scroll page before screenshot (triggers lazy content + scroll animations)')
    .option('-o, --output <path>', 'Output file path (default: screenshot.png)')
    .option('-s, --silent', 'Silent mode (no spinner)')
    .option('--json', 'Output base64 JSON instead of binary file')
    .action(async (url: string, options) => {
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

      // Check usage quota
      const usageCheck = await checkUsage();
      if (!usageCheck.allowed) {
        console.error(usageCheck.message);
        process.exit(1);
      }

      const spinner = options.silent ? null : ora('Taking screenshot...').start();

      try {
        // Validate format
        const format = options.format?.toLowerCase();
        if (format && !['png', 'jpeg', 'jpg'].includes(format)) {
          console.error('Error: --format must be png, jpeg, or jpg');
          process.exit(1);
        }

        // Parse actions
        let actions: PageAction[] | undefined;
        if (options.action && options.action.length > 0) {
          try {
            actions = parseActions(options.action);
          } catch (e) {
            console.error(`Error: ${(e as Error).message}`);
            process.exit(1);
          }
        }

        const { takeScreenshot } = await import('../../core/screenshot.js');

        const result = await takeScreenshot(url, {
          fullPage: options.fullPage || false,
          width: options.width,
          height: options.height,
          format: format || 'png',
          quality: options.quality,
          waitFor: options.wait,
          timeout: options.timeout,
          stealth: options.stealth || false,
          actions,
          scrollThrough: options.scrollThrough || false,
        });

        if (spinner) {
          spinner.succeed(`Screenshot taken (${result.format})`);
        }

        // Show usage footer for free/anonymous users
        if (usageCheck.usageInfo && !options.silent) {
          showUsageFooter(usageCheck.usageInfo, usageCheck.isAnonymous || false, true);
        }

        if (options.json) {
          // Output JSON with base64
          const jsonStr = JSON.stringify({
            url: result.url,
            format: result.format,
            contentType: result.contentType,
            screenshot: result.screenshot,
          }, null, 2);
          await new Promise<void>((resolve, reject) => {
            process.stdout.write(jsonStr + '\n', (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
        } else {
          // Save to file
          const ext = result.format === 'jpeg' ? 'jpg' : 'png';
          const outputPath = options.output || `screenshot.${ext}`;
          const buffer = Buffer.from(result.screenshot, 'base64');
          writeFileSync(outputPath, buffer);

          if (!options.silent) {
            console.error(`Screenshot saved to: ${outputPath} (${(buffer.length / 1024).toFixed(1)} KB)`);
          }
        }

        await cleanup();
        process.exit(0);
      } catch (error) {
        if (spinner) {
          spinner.fail('Screenshot failed');
        }

        if (error instanceof Error) {
          const msg = error.message;
          // Detect missing browser binary and give an actionable error
          if (msg.includes("Executable doesn't exist") || msg.includes('browserType.launch') || msg.includes('Chromium is not installed')) {
            console.error('\n\x1b[31m❌  Browser not installed.\x1b[0m');
            console.error('\x1b[36m   Run: npx playwright install chromium\x1b[0m');
            console.error('\x1b[36m   Then retry your screenshot command.\x1b[0m');
          } else {
            console.error(`\nError: ${msg}`);
          }
        } else {
          console.error('\nError: Unknown error occurred');
        }

        await cleanup();
        process.exit(1);
      }
    });

  // ── brand command ─────────────────────────────────────────────────────────
  program
    .command('brand <url>')
    .description('Extract branding and design system from a URL')
    .option('-s, --silent', 'Silent mode (no spinner)')
    .option('--json', 'Output as JSON (default)')
    .action(async (url: string, options) => {
      const spinner = options.silent ? null : ora('Extracting branding...').start();

      try {
        const result = await peel(url, {
          extract: {
            selectors: {
              primaryColor: 'meta[name="theme-color"]',
              title: 'title',
              logo: 'img[class*="logo"], img[alt*="logo"]',
            },
          },
        });

        if (spinner) {
          spinner.succeed(`Extracted branding in ${result.elapsed}ms`);
        }

        // Extract branding data from metadata and page
        const branding = {
          url: result.url,
          title: result.title,
          colors: extractColors(result.content),
          fonts: extractFonts(result.content),
          extracted: result.extracted,
          metadata: result.metadata,
        };

        console.log(JSON.stringify(branding, null, 2));
        await cleanup();
        process.exit(0);
      } catch (error) {
        if (spinner) spinner.fail('Branding extraction failed');
        console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        await cleanup();
        process.exit(1);
      }
    });

  // ── design-compare command ────────────────────────────────────────────────
  program
    .command('design-compare <url>')
    .description('Compare the design of a subject URL against a reference URL')
    .option('--ref <url>', 'Reference URL to compare against (required)')
    .option('--width <px>', 'Viewport width in pixels (default: 1440)', parseInt)
    .option('--height <px>', 'Viewport height in pixels (default: 900)', parseInt)
    .option('-o, --output <path>', 'Save comparison report to a JSON file')
    .option('-s, --silent', 'Silent mode (no spinner)')
    .option('--json', 'Output comparison as JSON to stdout')
    .action(async (url: string, options) => {
      // Validate subject URL
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

      // Validate --ref
      if (!options.ref) {
        console.error('Error: --ref <url> is required');
        process.exit(1);
      }
      try {
        const parsedRef = new URL(options.ref as string);
        if (!['http:', 'https:'].includes(parsedRef.protocol)) {
          console.error('Error: --ref must be an HTTP or HTTPS URL');
          process.exit(1);
        }
      } catch {
        console.error(`Error: Invalid --ref URL format: ${options.ref}`);
        process.exit(1);
      }

      const spinner = options.silent ? null : ora(`Comparing designs: ${url} vs ${options.ref as string}...`).start();

      try {
        const { takeDesignComparison } = await import('../../core/screenshot.js');

        const result = await takeDesignComparison(url, options.ref as string, {
          width: options.width,
          height: options.height,
        });

        if (spinner) spinner.succeed('Design comparison complete');

        const { comparison } = result;
        const output = {
          subjectUrl: result.subjectUrl,
          referenceUrl: result.referenceUrl,
          score: comparison.score,
          summary: comparison.summary,
          gaps: comparison.gaps,
          subjectAnalysis: comparison.subjectAnalysis,
          referenceAnalysis: comparison.referenceAnalysis,
        };

        if (options.output) {
          writeFileSync(options.output as string, JSON.stringify(output, null, 2));
          if (!options.silent) console.error(`Report saved to: ${options.output}`);
        }

        if (options.json || !options.output) {
          const jsonStr = JSON.stringify(output, null, 2);
          await new Promise<void>((resolve, reject) => {
            process.stdout.write(jsonStr + '\n', (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
        } else if (!options.silent) {
          // Human-readable summary
          console.log(`\n🎨 Design Comparison`);
          console.log(`Subject:   ${result.subjectUrl}`);
          console.log(`Reference: ${result.referenceUrl}`);
          console.log(`Score:     ${comparison.score}/10`);
          console.log(`\n${comparison.summary}`);
          if (comparison.gaps.length > 0) {
            console.log(`\nGaps (${comparison.gaps.length}):`);
            for (const gap of comparison.gaps) {
              const sev = gap.severity === 'high' ? '🔴' : gap.severity === 'medium' ? '🟡' : '🟢';
              console.log(`  ${sev} ${gap.property}: ${gap.description}`);
              console.log(`     Subject:    ${gap.subject}`);
              console.log(`     Reference:  ${gap.reference}`);
              console.log(`     Suggestion: ${gap.suggestion}`);
            }
          }
        }
      } catch (error) {
        if (spinner) spinner.fail('Design comparison failed');
        console.error(`Error: ${(error as Error).message}`);
        process.exit(1);
      }
    });
}
