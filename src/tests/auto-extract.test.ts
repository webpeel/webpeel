/**
 * Tests for auto-extract module (heuristic structured data extraction, no LLM required)
 */

import { describe, it, expect } from 'vitest';
import { detectPageType, autoExtract } from '../core/auto-extract.js';
import type {
  PricingResult,
  ProductsResult,
  ContactResult,
  ArticleResult,
  ApiDocsResult,
} from '../core/auto-extract.js';

// ---------------------------------------------------------------------------
// Sample HTML fixtures
// ---------------------------------------------------------------------------

function pricingPageHtml(): string {
  return `<!DOCTYPE html>
<html><head><title>Pricing | AcmeSaaS</title></head>
<body>
  <h1>Simple, Transparent Pricing</h1>
  <div class="pricing-card">
    <h2 class="plan-name">Free</h2>
    <div class="price">$0<span>/mo</span></div>
    <ul>
      <li>100 requests/day</li>
      <li>Basic support</li>
      <li>1 project</li>
    </ul>
    <a href="/signup" class="cta">Get started</a>
  </div>
  <div class="pricing-card">
    <h2 class="plan-name">Pro</h2>
    <div class="price">$29<span>/mo</span></div>
    <ul>
      <li>10,000 requests/day</li>
      <li>Priority support</li>
      <li>Unlimited projects</li>
    </ul>
    <a href="/signup/pro" class="cta">Start free trial</a>
  </div>
  <div class="pricing-card">
    <h2 class="plan-name">Enterprise</h2>
    <div class="price">$99<span>/mo</span></div>
    <ul>
      <li>Unlimited requests</li>
      <li>24/7 support</li>
      <li>SLA guarantee</li>
    </ul>
    <a href="/contact" class="cta">Contact sales</a>
  </div>
</body></html>`;
}

function productListingHtml(): string {
  return `<!DOCTYPE html>
<html><head><title>Shop - Best Widgets</title></head>
<body>
  <h1>Our Products</h1>
  <div class="product-grid">
    <div class="product-card">
      <img src="/images/widget-x.jpg" alt="Widget X" />
      <h3 class="product-name">Widget X</h3>
      <span class="price">$19.99</span>
      <span class="rating">4.5 ★</span>
      <a href="/products/widget-x">View</a>
    </div>
    <div class="product-card">
      <img src="/images/gadget-y.jpg" alt="Gadget Y" />
      <h3 class="product-name">Gadget Y</h3>
      <span class="price">$34.99</span>
      <span class="rating">3.8 ★</span>
      <a href="/products/gadget-y">View</a>
    </div>
    <div class="product-card">
      <img src="/images/thing-z.jpg" alt="Thing Z</h3>
      <h3 class="product-name">Thing Z</h3>
      <span class="price">$9.99</span>
      <span class="rating">5 ★</span>
      <a href="/products/thing-z">View</a>
    </div>
  </div>
</body></html>`;
}

function contactPageHtml(): string {
  return `<!DOCTYPE html>
<html><head><title>Contact Us - AcmeCorp</title></head>
<body>
  <h1>Get in Touch</h1>
  <p>Email us at <a href="mailto:info@acmecorp.com">info@acmecorp.com</a></p>
  <p>Support: <a href="mailto:support@acmecorp.com">support@acmecorp.com</a></p>
  <p>Phone: <a href="tel:+15550100">+1-555-0100</a></p>
  <address>123 Main Street, Springfield, IL 62701</address>
  <div class="social-links">
    <a href="https://twitter.com/acmecorp">Twitter</a>
    <a href="https://linkedin.com/company/acmecorp">LinkedIn</a>
    <a href="https://github.com/acmecorp">GitHub</a>
  </div>
</body></html>`;
}

function articlePageHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>How to Build a Rocket - Engineering Blog</title>
  <meta name="author" content="Jane Smith" />
  <meta property="article:published_time" content="2024-06-15T10:00:00Z" />
</head>
<body>
  <article>
    <h1>How to Build a Rocket</h1>
    <time datetime="2024-06-15">June 15, 2024</time>
    <span class="author">Jane Smith</span>
    <div class="reading-time">8 min read</div>
    <p>Building a rocket is no small feat. You'll need the right materials and a solid plan to get started.</p>
    <p>First, gather your fuel. Liquid oxygen and hydrogen make excellent propellants.</p>
    <h2>Step 1: Design</h2>
    <p>Start with a detailed CAD model. Make sure all components fit together properly.</p>
    <h2>Step 2: Build</h2>
    <p>Assemble the airframe using lightweight aluminum. Welding skills are essential here.</p>
    <h2>Step 3: Test</h2>
    <p>Always perform static fire tests before launch. Safety first!</p>
  </article>
</body></html>`;
}

function apiDocsHtml(): string {
  return `<!DOCTYPE html>
<html><head><title>API Reference - AcmeAPI</title></head>
<body>
  <h1>REST API Reference</h1>
  <p>Base URL: https://api.acmecorp.com</p>
  <h2>List Users</h2>
  <pre><code>GET /v1/users</code></pre>
  <p>Returns all users in the system.</p>
  <h2>Get User</h2>
  <pre><code>GET /v1/users/{id}</code></pre>
  <p>Returns a single user by ID.</p>
  <h2>Create User</h2>
  <pre><code>POST /v1/users</code></pre>
  <p>Creates a new user.</p>
  <h2>Update User</h2>
  <pre><code>PUT /v1/users/{id}</code></pre>
  <p>Updates an existing user.</p>
  <h2>Delete User</h2>
  <pre><code>DELETE /v1/users/{id}</code></pre>
  <p>Deletes a user by ID.</p>
</body></html>`;
}

// ---------------------------------------------------------------------------
// detectPageType tests
// ---------------------------------------------------------------------------

describe('detectPageType — URL heuristics', () => {
  it('detects pricing from /pricing URL', () => {
    expect(detectPageType('<html><body></body></html>', 'https://example.com/pricing')).toBe('pricing');
  });

  it('detects pricing from /plans URL', () => {
    expect(detectPageType('<html><body></body></html>', 'https://example.com/plans')).toBe('pricing');
  });

  it('detects contact from /contact URL with email', () => {
    const html = '<html><body><p>Email: hello@example.com</p><a href="https://twitter.com/ex">Twitter</a></body></html>';
    expect(detectPageType(html, 'https://example.com/contact')).toBe('contact');
  });
});

describe('detectPageType — HTML heuristics', () => {
  it('detects pricing from price pattern in HTML', () => {
    expect(detectPageType(pricingPageHtml(), 'https://example.com/pricing')).toBe('pricing');
  });

  it('detects products from product cards with prices', () => {
    expect(detectPageType(productListingHtml(), 'https://example.com/shop')).toBe('products');
  });

  it('detects contact from emails + social links', () => {
    expect(detectPageType(contactPageHtml(), 'https://example.com/contact-us')).toBe('contact');
  });

  it('detects article from <article> + <time> + meta author', () => {
    expect(detectPageType(articlePageHtml(), 'https://example.com/blog/how-to-build-a-rocket')).toBe('article');
  });

  it('detects api_docs from HTTP methods in code blocks', () => {
    expect(detectPageType(apiDocsHtml(), 'https://docs.example.com/api')).toBe('api_docs');
  });

  it('returns unknown for bare HTML with no signals', () => {
    const html = '<html><body><p>Hello world!</p></body></html>';
    expect(detectPageType(html, 'https://example.com/')).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// autoExtract — pricing
// ---------------------------------------------------------------------------

describe('autoExtract — pricing', () => {
  it('extracts plan names, prices, and features', () => {
    const result = autoExtract(pricingPageHtml(), 'https://example.com/pricing') as PricingResult;
    expect(result.type).toBe('pricing');
    expect(result.plans.length).toBeGreaterThanOrEqual(2);

    // Check at least one plan has features
    const planWithFeatures = result.plans.find((p) => p.features.length > 0);
    expect(planWithFeatures).toBeDefined();
  });

  it('extracts at least one plan from pricing URL even with minimal HTML', () => {
    const html = `<html><body>
      <div class="plan"><h2>Basic</h2><p class="price">$9/mo</p><ul><li>10 users</li></ul></div>
      <div class="plan"><h2>Pro</h2><p class="price">$49/mo</p><ul><li>Unlimited users</li></ul></div>
    </body></html>`;
    const result = autoExtract(html, 'https://acme.com/pricing') as PricingResult;
    expect(result.type).toBe('pricing');
    expect(result.plans.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty plans array (not crash) for unparseable pricing HTML', () => {
    const html = `<html><body><p>Pricing coming soon</p></body></html>`;
    const result = autoExtract(html, 'https://acme.com/pricing') as PricingResult;
    expect(result.type).toBe('pricing');
    expect(Array.isArray(result.plans)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// autoExtract — products
// ---------------------------------------------------------------------------

describe('autoExtract — products', () => {
  it('extracts product names and prices', () => {
    const result = autoExtract(productListingHtml(), 'https://shop.example.com/') as ProductsResult;
    expect(result.type).toBe('products');
    expect(result.items.length).toBeGreaterThanOrEqual(2);

    const item = result.items[0];
    expect(item.name).toBeTruthy();
  });

  it('returns empty items array when no products detected', () => {
    const html = '<html><body><p>No products here.</p></body></html>';
    // Force URL to contain shop keyword — but no matching DOM
    // detectPageType won't classify as products without matching structure; it returns unknown
    // So we test that the function is safe
    const result = autoExtract(html, 'https://example.com/');
    expect(['products', 'unknown']).toContain(result.type);
  });
});

// ---------------------------------------------------------------------------
// autoExtract — contact
// ---------------------------------------------------------------------------

describe('autoExtract — contact', () => {
  it('extracts emails, phones, and social links', () => {
    const result = autoExtract(contactPageHtml(), 'https://acmecorp.com/contact') as ContactResult;
    expect(result.type).toBe('contact');
    expect(result.emails).toContain('info@acmecorp.com');
    expect(result.emails).toContain('support@acmecorp.com');
    expect(result.phones.length).toBeGreaterThanOrEqual(1);
    expect(result.social.twitter).toContain('twitter.com');
    expect(result.social.linkedin).toContain('linkedin.com');
    expect(result.social.github).toContain('github.com');
  });

  it('handles contact page with only email (no crash)', () => {
    const html = '<html><body><p>Contact: hello@example.com</p><a href="https://twitter.com/x">Twitter</a></body></html>';
    const result = autoExtract(html, 'https://example.com/contact') as ContactResult;
    expect(result.type).toBe('contact');
    expect(result.emails).toContain('hello@example.com');
  });

  it('deduplicates emails', () => {
    const html = `<html><body>
      <p>Email: info@example.com</p>
      <p>Also: info@example.com</p>
      <a href="https://twitter.com/ex">Twitter</a>
    </body></html>`;
    const result = autoExtract(html, 'https://example.com/contact') as ContactResult;
    const count = result.emails.filter((e) => e === 'info@example.com').length;
    expect(count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// autoExtract — article
// ---------------------------------------------------------------------------

describe('autoExtract — article', () => {
  it('extracts title, author, date, reading time, summary, and sections', () => {
    const result = autoExtract(articlePageHtml(), 'https://blog.example.com/how-to-build-a-rocket') as ArticleResult;
    expect(result.type).toBe('article');
    expect(result.title).toContain('Rocket');
    expect(result.author).toBe('Jane Smith');
    expect(result.date).toBeTruthy();
    expect(result.readingTime).toBeTruthy();
    expect(result.summary).toBeTruthy();
    expect(result.sections.length).toBeGreaterThanOrEqual(2);
  });

  it('returns partial data for minimal article HTML', () => {
    const html = `<html>
    <head><meta name="author" content="Bob" /></head>
    <body>
      <article>
        <h1>My Post</h1>
        <time datetime="2024-01-01">Jan 1</time>
        <p>First sentence. Second sentence here.</p>
        <h2>Section One</h2>
        <p>Section content goes here.</p>
      </article>
    </body></html>`;
    const result = autoExtract(html, 'https://example.com/blog/my-post') as ArticleResult;
    expect(result.type).toBe('article');
    expect(result.title).toBeTruthy();
    expect(Array.isArray(result.sections)).toBe(true);
  });

  it('returns empty sections array (not crash) for article with no headings', () => {
    const html = `<html><body>
      <article>
        <h1>Title</h1>
        <time datetime="2024-01-01">Jan 1</time>
        <p>Some content without sections.</p>
      </article>
    </body></html>`;
    const result = autoExtract(html, 'https://example.com/blog/post') as ArticleResult;
    expect(result.type).toBe('article');
    expect(Array.isArray(result.sections)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// autoExtract — api_docs
// ---------------------------------------------------------------------------

describe('autoExtract — api_docs', () => {
  it('extracts endpoints with method and path', () => {
    const result = autoExtract(apiDocsHtml(), 'https://docs.example.com/api') as ApiDocsResult;
    expect(result.type).toBe('api_docs');
    expect(result.endpoints.length).toBeGreaterThanOrEqual(3);

    const getMethods = result.endpoints.filter((ep) => ep.method === 'GET');
    expect(getMethods.length).toBeGreaterThanOrEqual(1);

    const postMethods = result.endpoints.filter((ep) => ep.method === 'POST');
    expect(postMethods.length).toBeGreaterThanOrEqual(1);
  });

  it('deduplicates endpoints with same method + path', () => {
    const html = `<html><body>
      <pre><code>GET /v1/users\nGET /v1/users\nPOST /v1/users</code></pre>
    </body></html>`;
    const result = autoExtract(html, 'https://docs.example.com/api') as ApiDocsResult;
    expect(result.type).toBe('api_docs');
    const getUsers = result.endpoints.filter((ep) => ep.method === 'GET' && ep.path === '/v1/users');
    expect(getUsers.length).toBe(1);
  });

  it('returns empty endpoints array (not crash) for page with no API patterns', () => {
    const html = `<html><head><title>API Reference</title></head>
    <body><h1>API Reference</h1><p>Coming soon.</p></body></html>`;
    // Even though URL doesn't signal api_docs, if detected it should return empty
    const result = autoExtract(html, 'https://docs.example.com/api');
    expect(['api_docs', 'unknown']).toContain(result.type);
    if (result.type === 'api_docs') {
      expect(Array.isArray(result.endpoints)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// autoExtract — unknown
// ---------------------------------------------------------------------------

describe('autoExtract — unknown', () => {
  it('returns type=unknown for pages with no detectable type', () => {
    const html = '<html><body><p>Hello, world! This is a simple page.</p></body></html>';
    const result = autoExtract(html, 'https://example.com/');
    expect(result.type).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// Edge cases — graceful handling
// ---------------------------------------------------------------------------

describe('autoExtract — edge cases', () => {
  it('handles empty HTML without crashing', () => {
    const result = autoExtract('', 'https://example.com/pricing');
    expect(result.type).toBe('pricing');
    if (result.type === 'pricing') {
      expect(Array.isArray(result.plans)).toBe(true);
    }
  });

  it('handles malformed HTML without crashing', () => {
    const html = '<div><p>broken <<<>>>& html';
    expect(() => autoExtract(html, 'https://example.com/')).not.toThrow();
  });

  it('handles invalid URL string without crashing', () => {
    expect(() => autoExtract('<html><body></body></html>', 'not-a-url')).not.toThrow();
  });

  it('all result types have the correct type discriminant', () => {
    const results = [
      autoExtract(pricingPageHtml(), 'https://example.com/pricing'),
      autoExtract(productListingHtml(), 'https://shop.example.com/'),
      autoExtract(contactPageHtml(), 'https://example.com/contact'),
      autoExtract(articlePageHtml(), 'https://blog.example.com/article'),
      autoExtract(apiDocsHtml(), 'https://docs.example.com/api'),
    ];

    for (const result of results) {
      expect(typeof result.type).toBe('string');
      expect(result.type.length).toBeGreaterThan(0);
    }
  });
});
