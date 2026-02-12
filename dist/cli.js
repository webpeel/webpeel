#!/usr/bin/env node
/**
 * WebPeel CLI
 *
 * Usage:
 *   npx webpeel <url>                  - Fetch and convert to markdown
 *   npx webpeel <url> --json           - Output as JSON
 *   npx webpeel <url> --html           - Output raw HTML
 *   npx webpeel <url> --render         - Force browser mode
 *   npx webpeel <url> --wait 5000      - Wait 5s for JS to load
 *   npx webpeel search "query"         - DuckDuckGo search
 *   npx webpeel serve                  - Start API server (future)
 *   npx webpeel mcp                    - Start MCP server (future)
 */
import { Command } from 'commander';
import ora from 'ora';
import { peel, cleanup } from './index.js';
const program = new Command();
program
    .name('webpeel')
    .description('Fast web fetcher for AI agents')
    .version('0.1.0');
program
    .argument('[url]', 'URL to fetch')
    .option('-r, --render', 'Use headless browser (for JS-heavy sites)')
    .option('-w, --wait <ms>', 'Wait time after page load (ms)', parseInt)
    .option('--html', 'Output raw HTML instead of markdown')
    .option('--text', 'Output plain text instead of markdown')
    .option('--json', 'Output as JSON')
    .option('-t, --timeout <ms>', 'Request timeout (ms)', parseInt, 30000)
    .option('--ua <agent>', 'Custom user agent')
    .option('-s, --silent', 'Silent mode (no spinner)')
    .action(async (url, options) => {
    if (!url) {
        console.error('Error: URL is required\n');
        program.help();
        process.exit(1);
    }
    // Validate URL
    try {
        new URL(url);
    }
    catch {
        console.error(`Error: Invalid URL: ${url}`);
        process.exit(1);
    }
    const spinner = options.silent ? null : ora('Fetching...').start();
    try {
        // Build peel options
        const peelOptions = {
            render: options.render || false,
            wait: options.wait || 0,
            timeout: options.timeout,
            userAgent: options.ua,
        };
        // Determine format
        if (options.html) {
            peelOptions.format = 'html';
        }
        else if (options.text) {
            peelOptions.format = 'text';
        }
        else {
            peelOptions.format = 'markdown';
        }
        // Fetch the page
        const result = await peel(url, peelOptions);
        if (spinner) {
            spinner.succeed(`Fetched in ${result.elapsed}ms using ${result.method} method`);
        }
        // Output results
        if (options.json) {
            console.log(JSON.stringify(result, null, 2));
        }
        else {
            console.log(result.content);
        }
        // Clean up and exit
        await cleanup();
        process.exit(0);
    }
    catch (error) {
        if (spinner) {
            spinner.fail('Failed to fetch');
        }
        if (error instanceof Error) {
            console.error(`\nError: ${error.message}`);
        }
        else {
            console.error('\nError: Unknown error occurred');
        }
        await cleanup();
        process.exit(1);
    }
});
// Future commands
program
    .command('search')
    .argument('<query>', 'Search query')
    .description('Search using DuckDuckGo (future)')
    .action(() => {
    console.log('Search command not yet implemented');
    console.log('Coming soon: DuckDuckGo search integration');
    process.exit(1);
});
program
    .command('serve')
    .description('Start API server')
    .option('-p, --port <port>', 'Port number', '3000')
    .action(async (options) => {
    const { startServer } = await import('./server/app.js');
    startServer({ port: parseInt(options.port, 10) });
});
program
    .command('mcp')
    .description('Start MCP server for Claude Desktop / Cursor')
    .action(async () => {
    await import('./mcp/server.js');
});
program.parse();
//# sourceMappingURL=cli.js.map