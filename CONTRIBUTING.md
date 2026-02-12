# Contributing to WebPeel

Thanks for considering contributing to WebPeel! We welcome contributions of all kinds: bug reports, feature requests, documentation improvements, and code contributions.

## Quick Links

- [Report a Bug](https://github.com/JakeLiuMe/webpeel/issues/new?labels=bug)
- [Request a Feature](https://github.com/JakeLiuMe/webpeel/issues/new?labels=enhancement)
- [Ask a Question](https://github.com/JakeLiuMe/webpeel/discussions)

---

## Code of Conduct

Be respectful and constructive. We're all here to build something useful together.

---

## Getting Started

### Prerequisites

- Node.js 20+ (check with `node --version`)
- npm or pnpm
- Git

### Setup

```bash
# Fork and clone the repo
git clone https://github.com/YOUR_USERNAME/webpeel.git
cd webpeel

# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test

# Test the CLI
node dist/cli.js https://example.com

# Test the MCP server
npm run mcp
```

---

## Making Changes

### Branch Naming

- `feat/your-feature-name` — New features
- `fix/bug-description` — Bug fixes
- `docs/what-you-changed` — Documentation
- `chore/maintenance-task` — Tooling, refactoring, etc.

### Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add screenshot capture support
fix: handle redirect loops correctly
docs: update API reference for new options
chore: upgrade playwright to 1.49
```

**Types:**
- `feat` — New feature
- `fix` — Bug fix
- `docs` — Documentation only
- `style` — Formatting, missing semicolons, etc.
- `refactor` — Code restructuring without behavior change
- `test` — Adding or updating tests
- `chore` — Tooling, dependencies, etc.

---

## Pull Request Process

1. **Create an issue first** (for non-trivial changes) to discuss your approach
2. **Fork the repo** and create your branch from `main`
3. **Write tests** for new features or bug fixes
4. **Update documentation** if you change APIs
5. **Run tests** locally: `npm test`
6. **Build successfully**: `npm run build`
7. **Submit the PR** with a clear description

### PR Template

```markdown
## What does this PR do?

Brief description of changes.

## Related Issue

Fixes #123

## Checklist

- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] Build passes (`npm run build`)
- [ ] Tests pass (`npm test`)
```

---

## Code Style

We use TypeScript with strict mode. Follow existing patterns:

### File Structure

```
src/
  core/          # Core extraction logic
  server/        # API server
  mcp/           # MCP server
  tests/         # Test files
  cli.ts         # CLI entry point
  index.ts       # Library entry point
  types.ts       # Shared types
```

### Naming Conventions

- **Files**: `kebab-case.ts`
- **Functions**: `camelCase`
- **Types/Interfaces**: `PascalCase`
- **Constants**: `UPPER_SNAKE_CASE`

### TypeScript Style

```typescript
// ✅ Good
export async function peel(url: string, options: PeelOptions = {}): Promise<PeelResult> {
  const { render = false } = options;
  // ...
}

// ❌ Bad
export async function peel(url, options) {  // Missing types
  if (!options) options = {};
  // ...
}
```

### Error Handling

```typescript
// ✅ Good - Specific error types
if (response.status === 403) {
  throw new BlockedError('Site blocked the request');
}

// ❌ Bad - Generic errors
if (response.status === 403) {
  throw new Error('Failed');
}
```

---

## Testing

We use [Vitest](https://vitest.dev/) for testing.

### Running Tests

```bash
# Run all tests
npm test

# Watch mode (auto-rerun on changes)
npm run test:watch

# Run a specific test file
npx vitest src/tests/markdown.test.ts
```

### Writing Tests

```typescript
import { describe, it, expect } from 'vitest';
import { peel } from '../index.js';

describe('peel()', () => {
  it('should extract title from HTML', async () => {
    const result = await peel('https://example.com');
    expect(result.title).toBe('Example Domain');
  });

  it('should handle 404 errors', async () => {
    await expect(peel('https://httpbin.org/status/404')).rejects.toThrow();
  });
});
```

### Test Coverage

We aim for >80% coverage on core modules. Run `npm test -- --coverage` to see coverage reports.

---

## Adding Features

### Example: Adding Screenshot Capture

1. **Update types** (`src/types.ts`):
   ```typescript
   export interface PeelOptions {
     // ... existing options
     screenshot?: boolean;  // NEW
   }

   export interface PeelResult {
     // ... existing fields
     screenshotBase64?: string;  // NEW
   }
   ```

2. **Implement the feature** (`src/core/strategies.ts`):
   ```typescript
   if (options.screenshot && page) {
     result.screenshotBase64 = await page.screenshot({ encoding: 'base64' });
   }
   ```

3. **Add tests** (`src/tests/integration.test.ts`):
   ```typescript
   it('should capture screenshot when requested', async () => {
     const result = await peel('https://example.com', { screenshot: true });
     expect(result.screenshotBase64).toBeDefined();
     expect(result.screenshotBase64).toMatch(/^[A-Za-z0-9+/=]+$/);
   });
   ```

4. **Update docs** (README.md):
   ```markdown
   ### Capture screenshots

   \`\`\`typescript
   const result = await peel('https://example.com', { screenshot: true });
   console.log(result.screenshotBase64);  // Base64 encoded PNG
   \`\`\`
   ```

5. **Submit the PR** with tests and documentation!

---

## Documentation

### README.md

- Keep examples realistic and working
- Show output, not just input
- Update the comparison table if adding features

### Inline Docs (JSDoc)

```typescript
/**
 * Extract metadata from HTML
 * 
 * @param html - Raw HTML content
 * @param url - Page URL for resolving relative URLs
 * @returns Extracted title and metadata
 * 
 * @example
 * ```typescript
 * const { title, metadata } = extractMetadata(html, 'https://example.com');
 * console.log(metadata.description);
 * ```
 */
export function extractMetadata(html: string, url: string): { title: string; metadata: PageMetadata } {
  // ...
}
```

---

## Release Process

(For maintainers only)

1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. Commit: `git commit -m "chore: release v0.2.0"`
4. Tag: `git tag v0.2.0`
5. Push: `git push && git push --tags`
6. Publish: `npm publish`
7. Create GitHub release with changelog

---

## Project Structure

```
webpeel/
├── src/
│   ├── core/              # Core extraction logic
│   │   ├── fetcher.ts     # HTTP fetcher with smart headers
│   │   ├── strategies.ts  # Smart escalation logic
│   │   ├── markdown.ts    # HTML → Markdown conversion
│   │   └── metadata.ts    # Metadata extraction
│   ├── server/            # API server (Hono)
│   │   ├── app.ts         # Server entry point
│   │   ├── routes/        # API routes
│   │   └── middleware/    # Auth, rate limiting
│   ├── mcp/               # MCP server
│   │   └── server.ts      # MCP tools (fetch, search)
│   ├── tests/             # Test files
│   ├── cli.ts             # CLI entry point
│   ├── index.ts           # Library entry point
│   └── types.ts           # Shared types
├── dist/                  # Built output (TypeScript compiled)
├── docs/                  # Documentation site
├── README.md              # Main documentation
├── CONTRIBUTING.md        # This file
├── CHANGELOG.md           # Version history
├── package.json           # Package manifest
└── tsconfig.json          # TypeScript config
```

---

## Community

- **GitHub Issues** — Bug reports, feature requests
- **GitHub Discussions** — Questions, ideas, showcases
- **Discord** (coming soon) — Real-time chat

---

## Recognition

All contributors are recognized in:
- The [README Contributors section](README.md#contributors)
- GitHub's automatic contributor tracking
- Release notes (for significant contributions)

---

## Questions?

- Open a [Discussion](https://github.com/JakeLiuMe/webpeel/discussions)
- DM [@jakeliu](https://twitter.com/jakeliu) on X/Twitter
- Email: jake@webpeel.dev

Thank you for contributing! 🎉
