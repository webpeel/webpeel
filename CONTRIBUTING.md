# Contributing to WebPeel

Thanks for your interest in contributing to WebPeel! 🎉

## Quick Start

```bash
# Clone the repo
git clone https://github.com/webpeel/webpeel.git
cd webpeel

# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Start local API server
npx webpeel serve
```

## Project Structure

```
webpeel/
├── src/
│   ├── core/           # Core library (strategies, markdown, metadata, etc.)
│   ├── server/         # Express API server
│   │   ├── routes/     # API route handlers
│   │   └── middleware/  # Auth, rate limiting
│   ├── mcp/            # MCP server
│   ├── tests/          # Test suites
│   ├── cli.ts          # CLI entry point
│   ├── index.ts        # Library exports
│   └── types.ts        # TypeScript type definitions
├── site/               # Landing page (webpeel.dev)
├── dashboard/          # Dashboard app (app.webpeel.dev)
├── python-sdk/         # Python SDK
├── integrations/       # Framework integrations (LangChain, CrewAI, etc.)
├── skills/             # AI agent skills (Claude Code, etc.)
└── dist/               # Built output (tracked in git)
```

## Development

### Running Tests

```bash
# All tests
npm test

# Watch mode
npm run test:watch

# Specific test file
npx vitest run src/tests/peel.test.ts
```

### Building

```bash
# TypeScript compilation
npm run build

# Check types without building
npx tsc --noEmit
```

### Local API Server

```bash
# Start on default port 3000
npx webpeel serve

# Custom port
PORT=8080 npx webpeel serve
```

## Guidelines

### Code Style
- TypeScript with strict types
- ESLint for linting (`npm run lint`)
- Prefer simple, readable code over clever abstractions
- Keep functions small and focused

### Commits
- Use conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `chore:`
- Keep commits atomic (one feature/fix per commit)

### Tests
- Add tests for new features
- Don't break existing tests
- Use Vitest for testing

### Pull Requests
1. Fork the repo
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Write tests
4. Ensure all tests pass (`npm test`)
5. Ensure TypeScript compiles (`npx tsc --noEmit`)
6. Submit PR with clear description

## Areas for Contribution

- **New integrations**: CrewAI, Dify, n8n, Zapier, etc.
- **SDKs**: Go, Rust, Java, etc.
- **Tests**: More test coverage (especially integration tests)
- **Documentation**: Improve docs, add examples
- **Performance**: Faster fetching, better caching
- **Bug fixes**: Check [issues](https://github.com/webpeel/webpeel/issues)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
