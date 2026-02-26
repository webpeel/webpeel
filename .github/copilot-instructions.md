# Copilot Instructions for WebPeel

## Project Overview

WebPeel is an open source web data platform — fetch, search, and extract structured data from any URL.

## Key Constraints

- DO NOT modify `src/core/bm25-filter.ts`
- All tests must pass: `npx vitest run`
- TypeScript must compile: `npx tsc --noEmit`
- Use domain-first extraction for new site support (see `src/core/domain-extractors.ts`)
- API errors follow standard envelope pattern

## Testing

Run `npx vitest run` before committing. Current: 1172+ tests, 0 failures.

## Architecture

See `AGENTS.md` for complete architecture guide.
