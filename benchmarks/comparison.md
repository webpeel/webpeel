# WebPeel benchmark comparison

- Timestamp (first file): 2026-02-16T01:06:16.739Z
- URLs: 30

## Overall

| runner | success | success% | median latency (ms) | avg content quality | avg tokens/page |
| --- | --- | --- | --- | --- | --- |
| webpeel-local | 27/30 | 90.0% | 346 | 0.848 | 8437 |
| raw-fetch | 24/30 | 80.0% | 140 | 0.743 | 4902 |
| firecrawl | 28/30 | 93.3% | 663 | 0.727 | 11701 |
| tavily | 25/30 | 83.3% | 61 | 0.677 | 6369 |

## Per-tier success

| runner | static | dynamic | spa | protected | documents | edge |
| --- | --- | --- | --- | --- | --- | --- |
| webpeel-local | 5/5 (100.0%) | 5/5 (100.0%) | 5/5 (100.0%) | 3/5 (60.0%) | 4/5 (80.0%) | 5/5 (100.0%) |
| raw-fetch | 5/5 (100.0%) | 4/5 (80.0%) | 5/5 (100.0%) | 1/5 (20.0%) | 4/5 (80.0%) | 5/5 (100.0%) |
| firecrawl | 5/5 (100.0%) | 5/5 (100.0%) | 5/5 (100.0%) | 4/5 (80.0%) | 5/5 (100.0%) | 4/5 (80.0%) |
| tavily | 4/5 (80.0%) | 5/5 (100.0%) | 5/5 (100.0%) | 2/5 (40.0%) | 4/5 (80.0%) | 5/5 (100.0%) |

## Failures (URLs)

### webpeel-local — failed 3/30

- [protected] https://www.bloomberg.com/technology (status=403, latency=259ms)
- [protected] https://www.glassdoor.com/Overview/Working-at-Anthropic-EI_IE7601188.11.20.htm (status=403, latency=324ms)
- [documents] https://www.sec.gov/Archives/edgar/data/1018724/000101872424000004/amzn-20231231.htm (status=403, latency=1303ms)

### raw-fetch — failed 6/30

- [dynamic] https://www.npmjs.com/package/express (status=403, latency=51ms)
- [protected] https://www.cloudflare.com/learning/what-is-cloudflare/ (status=403, latency=51ms)
- [protected] https://medium.com/@anthropic/introducing-claude-3-5-sonnet-a53f88e9e9ae (status=403, latency=51ms)
- [protected] https://www.bloomberg.com/technology (status=403, latency=83ms)
- [protected] https://www.glassdoor.com/Overview/Working-at-Anthropic-EI_IE7601188.11.20.htm (status=403, latency=49ms)
- [documents] https://www.sec.gov/Archives/edgar/data/1018724/000101872424000004/amzn-20231231.htm (status=404, latency=283ms)

### firecrawl — failed 2/30

- [protected] https://linkedin.com/company/anthropic (status=—, latency=19ms) — We apologize for the inconvenience but we do not support this site. If you are part of an enterprise and want to have a further conversation about this, please fill out our intake form here: https://fk4bvu0n5qp.typeform.com/to/Ej6oydlg
- [edge] https://www.reddit.com/r/programming/top/?t=month (status=—, latency=16ms) — We apologize for the inconvenience but we do not support this site. If you are part of an enterprise and want to have a further conversation about this, please fill out our intake form here: https://fk4bvu0n5qp.typeform.com/to/Ej6oydlg

### tavily — failed 5/30

- [static] https://example.com (status=—, latency=501ms) — Tavily: missing results
- [protected] https://medium.com/@anthropic/introducing-claude-3-5-sonnet-a53f88e9e9ae (status=—, latency=221ms) — Tavily: missing results
- [protected] https://www.bloomberg.com/technology (status=—, latency=222ms) — Tavily: missing results
- [protected] https://www.glassdoor.com/Overview/Working-at-Anthropic-EI_IE7601188.11.20.htm (status=—, latency=222ms) — Tavily: missing results
- [documents] https://www.sec.gov/Archives/edgar/data/1018724/000101872424000004/amzn-20231231.htm (status=—, latency=6138ms) — Tavily: missing results

