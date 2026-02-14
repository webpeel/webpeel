# WebPeel vs Firecrawl Benchmarks

## Test URLs for Benchmarking

### Simple pages (HTTP should work)
- https://example.com
- https://httpbin.org/html
- https://jsonplaceholder.typicode.com/posts

### JS-heavy (needs browser)
- https://news.ycombinator.com
- https://github.com/trending

### Protected (needs stealth)
- https://www.g2.com/products/firecrawl/reviews
- https://www.linkedin.com/company/firecrawl

## Metrics to Track
1. **Response time** (ms) — HTTP vs browser vs stealth
2. **Token count** — raw page vs smart extraction
3. **Quality score** — content relevance (0-1)
4. **Success rate** — % of pages successfully scraped

## Benchmark Commands
```bash
# Time a fetch
time npx webpeel https://example.com --silent > /dev/null

# Compare token savings
npx webpeel https://news.ycombinator.com --raw --json | jq '.tokens'
npx webpeel https://news.ycombinator.com --json | jq '.tokens'

# Test stealth
npx webpeel https://bot.sannysoft.com --stealth --json | jq '.quality'
```

## TODO
- [ ] Automated benchmark script
- [ ] Comparison against Firecrawl API (need API key)
- [ ] Results page on webpeel.dev
