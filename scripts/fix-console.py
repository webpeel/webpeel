#!/usr/bin/env python3
"""Replace console.log/debug/error with structured logger calls."""
import re
import sys

def process_search_provider(content):
    # Add logger import after browser-pool.js import
    content = content.replace(
        "import { getStealthBrowser, getRandomUserAgent, applyStealthScripts } from './browser-pool.js';",
        "import { getStealthBrowser, getRandomUserAgent, applyStealthScripts } from './browser-pool.js';\nimport { createLogger } from './logger.js';\n\nconst log = createLogger('search');"
    )
    
    # Replace all [webpeel:search] prefixed console.log calls
    # Multi-line: console.log(\n  `[webpeel:search] ...`,\n);
    content = re.sub(
        r"console\.log\(\s*\n\s*`\[webpeel:search\] (.*?)`,\s*\n\s*\);",
        lambda m: f"log.debug(`{m.group(1)}`);",
        content, flags=re.DOTALL
    )
    
    # Single-line console.log with [webpeel:search]
    content = re.sub(
        r"console\.log\(`\[webpeel:search\] (.*?)`\);",
        lambda m: f"log.debug(`{m.group(1)}`);",
        content
    )
    content = re.sub(
        r"console\.log\('\[webpeel:search\] (.*?)',",
        lambda m: f"log.debug('{m.group(1)}',",
        content
    )
    
    # console.debug with DEBUG guard
    content = re.sub(
        r"if \(process\.env\.DEBUG\) \{\s*\n\s*console\.debug\('\[webpeel\] (.*?)', \(e as Error\)\.message\);\s*\n\s*\}",
        lambda m: f"log.debug('{m.group(1)}', (e as Error).message);",
        content, flags=re.DOTALL
    )
    
    return content

def process_crawler(content):
    content = content.replace(
        "} from './crawl-checkpoint.js';",
        "} from './crawl-checkpoint.js';\nimport { createLogger } from './logger.js';\n\nconst log = createLogger('crawler');"
    )
    content = content.replace(
        "console.error(`[Crawler] Using Crawl-delay from robots.txt: ${robotsRules.crawlDelay}ms`);",
        "log.info(`Using Crawl-delay from robots.txt: ${robotsRules.crawlDelay}ms`);"
    )
    content = content.replace(
        "console.error(`[Crawler] Resuming crawl from checkpoint: ${checkpoint.completed.size} pages already crawled`);",
        "log.info(`Resuming crawl from checkpoint: ${checkpoint.completed.size} pages already crawled`);"
    )
    content = content.replace(
        "console.error(`[Crawler] Skipping ${url} (disallowed by robots.txt)`);",
        "log.debug(`Skipping ${url} (disallowed by robots.txt)`);"
    )
    content = content.replace(
        "console.error(`[Crawler] Failed to fetch ${url}: ${errorMessage}`);",
        "log.error(`Failed to fetch ${url}: ${errorMessage}`);"
    )
    return content

def process_browser_fetch(content):
    content = content.replace(
        "import { autoInteract, type AutoInteractResult } from './auto-interact.js';",
        "import { autoInteract, type AutoInteractResult } from './auto-interact.js';\nimport { createLogger } from './logger.js';\n\nconst log = createLogger('browser');"
    )
    # Replace all if (process.env.DEBUG) console.debug('[webpeel]', ...
    content = re.sub(
        r"if \(process\.env\.DEBUG\) console\.debug\('\[webpeel\]', (.*?)\);",
        lambda m: f"log.debug({m.group(1)});",
        content
    )
    return content

def process_pipeline(content):
    content = content.replace(
        "import type { DesignAnalysis } from './design-analysis.js';",
        "import type { DesignAnalysis } from './design-analysis.js';\nimport { createLogger } from './logger.js';\n\nconst log = createLogger('pipeline');"
    )
    # Replace if (process.env.DEBUG) console.debug('[webpeel]', ...
    content = re.sub(
        r"if \(process\.env\.DEBUG\) console\.debug\('\[webpeel\]', (.*?)\);",
        lambda m: f"log.debug({m.group(1)});",
        content
    )
    # Replace console.debug('[webpeel]', ... (without DEBUG guard)
    content = re.sub(
        r"console\.debug\('\[webpeel\]', (.*?)\);",
        lambda m: f"log.debug({m.group(1)});",
        content
    )
    # Replace console.error calls
    for old, new in [
        ("console.error('Branding extraction failed:', error);", "log.error('Branding extraction failed:', error);"),
        ("console.error('Design analysis extraction failed:', error);", "log.error('Design analysis extraction failed:', error);"),
        ("console.error('Change tracking failed:', error);", "log.error('Change tracking failed:', error);"),
        ("console.error('Summary generation failed:', error);", "log.error('Summary generation failed:', error);"),
    ]:
        content = content.replace(old, new)
    return content

def process_strategies(content):
    content = content.replace(
        "// Re-export StrategyResult so existing consumers don't break.\nexport type { StrategyResult } from './strategy-hooks.js';",
        "// Re-export StrategyResult so existing consumers don't break.\nexport type { StrategyResult } from './strategy-hooks.js';\nimport { createLogger } from './logger.js';\n\nconst log = createLogger('fetch');"
    )
    content = re.sub(
        r"if \(process\.env\.DEBUG\) console\.debug\('\[webpeel\]', (.*?)\);",
        lambda m: f"log.debug({m.group(1)});",
        content
    )
    return content

def process_http_fetch(content):
    content = content.replace(
        "import { detectChallenge } from './challenge-detection.js';",
        "import { detectChallenge } from './challenge-detection.js';\nimport { createLogger } from './logger.js';\n\nconst log = createLogger('http');"
    )
    content = re.sub(
        r"if \(process\.env\.DEBUG\) console\.debug\('\[webpeel\]', (.*?)\);",
        lambda m: f"log.debug({m.group(1)});",
        content
    )
    return content

def process_agent(content):
    content = content.replace(
        "import { peel } from '../index.js';",
        "import { peel } from '../index.js';\nimport { createLogger } from './logger.js';\n\nconst log = createLogger('agent');"
    )
    content = re.sub(
        r"if \(process\.env\.DEBUG\) console\.debug\('\[webpeel\]', (.*?)\);",
        lambda m: f"log.debug({m.group(1)});",
        content
    )
    content = content.replace(
        "console.error('Search failed:', error);",
        "log.error('Search failed:', error);"
    )
    content = content.replace(
        "console.error(`Failed to fetch ${url}:`, error.message);",
        "log.error(`Failed to fetch ${url}:`, error.message);"
    )
    content = content.replace(
        "console.error('Agent error:', error);",
        "log.error('Agent error:', error);"
    )
    return content

files = {
    'src/core/search-provider.ts': process_search_provider,
    'src/core/crawler.ts': process_crawler,
    'src/core/browser-fetch.ts': process_browser_fetch,
    'src/core/pipeline.ts': process_pipeline,
    'src/core/strategies.ts': process_strategies,
    'src/core/http-fetch.ts': process_http_fetch,
    'src/core/agent.ts': process_agent,
}

for filepath, processor in files.items():
    with open(filepath, 'r') as f:
        content = f.read()
    
    original = content
    content = processor(content)
    
    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        print(f"✅ Modified: {filepath}")
    else:
        print(f"⚠️  No changes: {filepath}")

print("Done!")
