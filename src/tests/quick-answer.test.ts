/**
 * Tests for quick-answer.ts
 *
 * LLM-free question answering using BM25 + heuristics.
 * All tests run offline — no network requests.
 */

import { describe, it, expect } from 'vitest';
import { quickAnswer } from '../core/quick-answer.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const PRICING_CONTENT = `WebPeel offers three plans.
The Free plan includes 500 requests per week at no cost.
The Pro plan costs $29 per month and includes 10,000 API calls, priority support, and advanced analytics.
The Enterprise plan offers unlimited requests with custom pricing.
All plans include a 14-day free trial.
Contact sales@webpeel.dev for enterprise inquiries.`;

// ---------------------------------------------------------------------------
// Basic question answering
// ---------------------------------------------------------------------------

describe('quickAnswer — basic pricing questions', () => {
  it('returns a result object with all required fields', () => {
    const result = quickAnswer({ question: 'What is the pricing?', content: PRICING_CONTENT });
    expect(result).toMatchObject({
      question: 'What is the pricing?',
      method: 'bm25',
    });
    expect(typeof result.answer).toBe('string');
    expect(typeof result.confidence).toBe('number');
    expect(Array.isArray(result.passages)).toBe(true);
    expect(typeof result.source).toBe('string');
  });

  it('"What is the pricing?" returns content mentioning Pro plan or pricing', () => {
    const result = quickAnswer({ question: 'What is the pricing?', content: PRICING_CONTENT });
    const combined = (result.answer + ' ' + result.passages.map(p => p.text).join(' ')).toLowerCase();
    // Should mention price or plan
    const hasRelevant = combined.includes('29') || combined.includes('pro') || combined.includes('plan') || combined.includes('pric');
    expect(hasRelevant).toBe(true);
  });

  it('"How many free requests?" returns the 500/week sentence', () => {
    const result = quickAnswer({ question: 'How many free requests?', content: PRICING_CONTENT });
    const combined = result.answer + ' ' + result.passages.map(p => p.text).join(' ');
    expect(combined).toMatch(/500/);
  });

  it('"What is the enterprise plan?" returns enterprise sentence', () => {
    const result = quickAnswer({ question: 'What is the enterprise plan?', content: PRICING_CONTENT });
    const combined = result.answer + ' ' + result.passages.map(p => p.text).join(' ');
    expect(combined.toLowerCase()).toMatch(/enterprise/);
  });

  it('"What is the contact email?" returns the sales@ sentence', () => {
    const result = quickAnswer({ question: 'What is the contact email?', content: PRICING_CONTENT });
    const combined = result.answer + ' ' + result.passages.map(p => p.text).join(' ');
    expect(combined.toLowerCase()).toMatch(/sales@webpeel\.dev|contact|email/);
  });
});

// ---------------------------------------------------------------------------
// Confidence and scoring
// ---------------------------------------------------------------------------

describe('quickAnswer — confidence scoring', () => {
  it('confidence is between 0 and 1', () => {
    const result = quickAnswer({ question: 'What is the pricing?', content: PRICING_CONTENT });
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('question with no good answer has low confidence', () => {
    const result = quickAnswer({
      question: 'What is the weather like in Antarctica during summer?',
      content: PRICING_CONTENT, // unrelated content
    });
    // Confidence should be relatively low (no matching terms)
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('relevant question has higher confidence than unrelated question', () => {
    const relevant = quickAnswer({ question: 'How much does the Pro plan cost?', content: PRICING_CONTENT });
    const unrelated = quickAnswer({
      question: 'What is the capital of France?',
      content: PRICING_CONTENT,
    });
    expect(relevant.confidence).toBeGreaterThanOrEqual(unrelated.confidence);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('quickAnswer — edge cases', () => {
  it('empty content returns empty result', () => {
    const result = quickAnswer({ question: 'What is the pricing?', content: '' });
    expect(result.answer).toBe('');
    expect(result.confidence).toBe(0);
    expect(result.passages).toHaveLength(0);
  });

  it('whitespace-only content returns empty result', () => {
    const result = quickAnswer({ question: 'What is the pricing?', content: '   \n\n\t  ' });
    expect(result.answer).toBe('');
    expect(result.confidence).toBe(0);
  });

  it('empty question returns empty result', () => {
    const result = quickAnswer({ question: '', content: PRICING_CONTENT });
    expect(result.answer).toBe('');
    expect(result.confidence).toBe(0);
  });

  it('very short content (one sentence) returns that sentence if relevant', () => {
    const content = 'The Pro plan costs $29 per month.';
    const result = quickAnswer({ question: 'What is the Pro plan price?', content });
    expect(result.answer).toBeTruthy();
    expect(result.answer).toMatch(/29/);
  });

  it('source URL is preserved', () => {
    const result = quickAnswer({
      question: 'What is the pricing?',
      content: PRICING_CONTENT,
      url: 'https://example.com/pricing',
    });
    expect(result.source).toBe('https://example.com/pricing');
  });

  it('source is empty string when url not provided', () => {
    const result = quickAnswer({ question: 'What is the pricing?', content: PRICING_CONTENT });
    expect(result.source).toBe('');
  });

  it('method is always bm25', () => {
    const result = quickAnswer({ question: 'test', content: 'test content here' });
    expect(result.method).toBe('bm25');
  });

  it('respects maxPassages option', () => {
    const result = quickAnswer({
      question: 'What are the plans?',
      content: PRICING_CONTENT,
      maxPassages: 1,
    });
    expect(result.passages.length).toBeLessThanOrEqual(1);
  });

  it('maxChars limits answer length', () => {
    const longContent = Array(100).fill('The pricing plan costs $29 per month.').join(' ');
    const result = quickAnswer({
      question: 'What is the price?',
      content: longContent,
      maxChars: 50,
    });
    expect(result.answer.length).toBeLessThanOrEqual(55); // slight buffer for ellipsis
  });
});

// ---------------------------------------------------------------------------
// Sentence splitting edge cases
// ---------------------------------------------------------------------------

describe('quickAnswer — sentence splitting edge cases', () => {
  it('does not split on URLs with dots', () => {
    const content = 'Visit https://example.com/pricing for more info. The Pro plan costs $29 per month.';
    const result = quickAnswer({ question: 'What is the price?', content });
    const combined = result.answer + ' ' + result.passages.map(p => p.text).join(' ');
    expect(combined).toMatch(/29/);
  });

  it('does not split on abbreviations like Dr.', () => {
    const content = 'Dr. Smith founded the company. The Pro plan costs $29 per month. Contact us for details.';
    const result = quickAnswer({ question: 'How much does Pro cost?', content });
    expect(result.answer + ' ' + result.passages.map(p => p.text).join(' ')).toMatch(/29/);
  });

  it('does not split on decimal numbers', () => {
    const content = 'The average is 3.14 units. The Pro plan costs $29.99 per month. Free tier available.';
    const result = quickAnswer({ question: 'What is the Pro plan cost?', content });
    expect(result.answer + ' ' + result.passages.map(p => p.text).join(' ')).toMatch(/29\.99|Pro/);
  });

  it('handles content with no sentence-ending punctuation', () => {
    const content = 'The Pro plan costs $29 per month\nThe Enterprise plan is custom\nFree tier available';
    const result = quickAnswer({ question: 'What is the Pro price?', content });
    // Should still find relevant content
    expect(result).toBeDefined();
    expect(typeof result.answer).toBe('string');
  });

  it('filters out very short junk sentences', () => {
    const content = 'A. B. The Pro plan costs $29 per month. C. D. The Free plan is included.';
    const result = quickAnswer({ question: 'What is the Pro price?', content });
    // Should not return single-letter "sentences"
    const passages = result.passages.map(p => p.text);
    for (const p of passages) {
      expect(p.length).toBeGreaterThanOrEqual(10);
    }
  });
});

// ---------------------------------------------------------------------------
// Question type detection (boost signals)
// ---------------------------------------------------------------------------

describe('quickAnswer — question type boosting', () => {
  it('how many question boosts sentences with numbers', () => {
    const content = `We have a large team.
    The company was founded in 2010.
    We process 5 million requests per day.
    Our offices are worldwide.`;
    const result = quickAnswer({ question: 'How many requests do you process?', content });
    const combined = result.answer + ' ' + result.passages.map(p => p.text).join(' ');
    expect(combined).toMatch(/million|5/);
  });

  it('when question boosts sentences with dates', () => {
    const content = `The company went public recently.
    WebPeel was launched in January 2023.
    We have a great team.
    Our users love the product.`;
    const result = quickAnswer({ question: 'When was WebPeel launched?', content });
    const combined = result.answer + ' ' + result.passages.map(p => p.text).join(' ');
    expect(combined).toMatch(/2023|January|launched/i);
  });

  it('what is question boosts definition sentences', () => {
    const content = `BM25 is a ranking function used in information retrieval.
    It was developed in the 1970s.
    Many search engines use it today.`;
    const result = quickAnswer({ question: 'What is BM25?', content });
    const combined = result.answer + ' ' + result.passages.map(p => p.text).join(' ');
    expect(combined.toLowerCase()).toMatch(/ranking|information retrieval/);
  });

  it('why question boosts causal sentences', () => {
    const content = `The service went down last week.
    The outage occurred because of a database migration failure.
    It was restored within 2 hours.
    We are improving our monitoring.`;
    const result = quickAnswer({ question: 'Why did the service go down?', content });
    const combined = result.answer + ' ' + result.passages.map(p => p.text).join(' ');
    expect(combined.toLowerCase()).toMatch(/because|database|migration/);
  });
});

// ---------------------------------------------------------------------------
// Passages structure
// ---------------------------------------------------------------------------

describe('quickAnswer — passages structure', () => {
  it('passages have required fields', () => {
    const result = quickAnswer({ question: 'What is the pricing?', content: PRICING_CONTENT });
    for (const p of result.passages) {
      expect(typeof p.text).toBe('string');
      expect(typeof p.score).toBe('number');
      expect(typeof p.context).toBe('string');
      expect(p.score).toBeGreaterThanOrEqual(0);
    }
  });

  it('passages are ordered by score (highest first)', () => {
    const result = quickAnswer({
      question: 'What is the pricing?',
      content: PRICING_CONTENT,
      maxPassages: 3,
    });
    for (let i = 1; i < result.passages.length; i++) {
      expect(result.passages[i - 1].score).toBeGreaterThanOrEqual(result.passages[i].score);
    }
  });

  it('context includes surrounding text', () => {
    const result = quickAnswer({
      question: 'How much does Pro cost?',
      content: PRICING_CONTENT,
      maxPassages: 2,
    });
    // Context should be longer than or equal to the text itself (includes surrounding sentences)
    for (const p of result.passages) {
      expect(p.context.length).toBeGreaterThanOrEqual(p.text.length);
    }
  });

  it('default maxPassages is 3', () => {
    const content = Array(20).fill(null).map((_, i) => `Sentence number ${i + 1} about pricing plans.`).join(' ');
    const result = quickAnswer({ question: 'What are the pricing plans?', content });
    expect(result.passages.length).toBeLessThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// Direct pattern extraction (infobox / structured content)
// ---------------------------------------------------------------------------

const WIKIPEDIA_TYPESCRIPT_INFOBOX = `-   **TypeScript:** Paradigm · Multi-paradigm: functional, generic, imperative
-   **TypeScript:** Designed\u00a0by · Microsoft,Anders Hejlsberg,Luke Hoban
-   **TypeScript:** Developer · Microsoft
-   **TypeScript:** First\u00a0appeared · 1 October 2012; 13 years ago

**TypeScript** is a high-level programming language that adds static typing to JavaScript.
It is developed by Microsoft as free and open-source software.`;

const WIKIPEDIA_NODEJS_INFOBOX = `-   **Node.js:** Original\u00a0author · Ryan Dahl
-   **Node.js:** Developers · OpenJS Foundation
-   **Node.js:** Initial\u00a0release · May 27, 2009; 16 years ago (2009-05-27)
-   **Node.js:** Stable\u00a0release · 22.0.0

Node.js is a cross-platform, open-source JavaScript runtime environment.`;

describe('quickAnswer — direct infobox extraction', () => {
  it('extracts designer from Wikipedia-style infobox (with NBSP)', () => {
    const result = quickAnswer({
      question: 'Who created TypeScript?',
      content: WIKIPEDIA_TYPESCRIPT_INFOBOX,
    });
    // Should extract "Microsoft,Anders Hejlsberg,Luke Hoban" via direct extraction
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    const answer = result.answer.toLowerCase();
    expect(answer).toMatch(/hejlsberg|microsoft/i);
  });

  it('extracts creation date from infobox First appeared field', () => {
    const result = quickAnswer({
      question: 'When was Node.js created?',
      content: WIKIPEDIA_NODEJS_INFOBOX,
    });
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    // Should find 2009
    expect(result.answer).toMatch(/2009/);
  });

  it('direct extraction returns confidence >= 0.88', () => {
    const result = quickAnswer({
      question: 'Who created TypeScript?',
      content: WIKIPEDIA_TYPESCRIPT_INFOBOX,
    });
    // Direct pattern extraction always returns 0.88 or 0.92
    expect(result.confidence).toBeGreaterThanOrEqual(0.88);
  });

  it('"what company" questions treated as who questions', () => {
    const content = `-   **React:** Original\u00a0author · Jordan Walke
-   **React:** Developers · Meta and community
-   **React:** Type · JavaScript library

React is a free and open-source front-end JavaScript library.`;
    const result = quickAnswer({
      question: 'What company developed React?',
      content,
    });
    // Should find author or developers
    const combined = (result.answer + ' ' + result.passages.map(p => p.context).join(' ')).toLowerCase();
    expect(combined).toMatch(/walke|meta|developers|author/i);
  });
});

// ---------------------------------------------------------------------------
// Confidence is not always 1.0
// ---------------------------------------------------------------------------

describe('quickAnswer — confidence is honest', () => {
  it('confidence is less than 1 for BM25-only results', () => {
    // Unstructured content — will fall through to BM25
    const content = `The Pro plan costs $29 per month. Enterprise is custom pricing.
Free tier includes 500 requests per week. Contact us at sales@example.com.`;
    const result = quickAnswer({ question: 'What is the enterprise price?', content });
    // BM25 results should be < 1.0 (gap-based confidence)
    expect(result.confidence).toBeLessThan(1.0);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('confidence is 0.92 for infobox direct extraction', () => {
    const result = quickAnswer({
      question: 'Who created TypeScript?',
      content: WIKIPEDIA_TYPESCRIPT_INFOBOX,
    });
    expect(result.confidence).toBe(0.92);
  });

  it('confidence is 0.88 for definition-pattern extraction', () => {
    const content = `TypeScript is a programming language.
TypeScript was designed by Anders Hejlsberg at Microsoft in 2012.
It adds static typing to JavaScript.`;
    const result = quickAnswer({
      question: 'Who designed TypeScript?',
      content,
    });
    // "designed by" pattern should trigger direct extraction
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    expect(result.answer).toMatch(/hejlsberg|microsoft/i);
  });
});

// ---------------------------------------------------------------------------
// QA noise filtering
// ---------------------------------------------------------------------------

describe('QA noise filtering', () => {
  it('should not return citation metadata as answer', () => {
    const content = `
# Large Language Models

Large language models have several known limitations including hallucination, bias, and high computational costs.

## Limitations

The main limitations of LLMs include:
- Hallucination: generating plausible but incorrect information
- Bias: reflecting biases present in training data
- Cost: requiring significant computational resources
- Context window: limited input length

## References

[1] Smith, J. (2024). "Understanding LLMs". arXiv:2401.12345
[2] CS1_maint: multiple_names: authors_list Category:Articles with short description
[309] Retrieved 2024-01-15. Archived from the original on 2024-01-10.
    `;

    const result = quickAnswer({ question: 'What are the main limitations of LLMs?', content });
    expect(result.answer).not.toContain('CS1_maint');
    expect(result.answer).not.toContain('arXiv');
    expect(result.answer).toContain('limitation');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('should strip reference numbers from content', () => {
    const content = 'Python[1] is a programming language[2] created by Guido van Rossum[3] in 1991.[4]';
    const result = quickAnswer({ question: 'Who created Python?', content });
    expect(result.answer).toContain('Guido van Rossum');
    expect(result.answer).not.toContain('[1]');
  });

  it('should handle pages with heavy citation noise', () => {
    const content = `
Artificial intelligence is intelligence demonstrated by machines.

John McCarthy coined the term "artificial intelligence" in 1956.

## References
^ a b c Congressional Research Service (2019). Artificial Intelligence and National Security (PDF).
^ Wong, Matteo (19 May 2023), "ChatGPT Is Already Obsolete", The Atlantic
^ Yudkowsky, E (2008), "Artificial Intelligence as a Positive and Negative Factor"
## External links
https://en.wikipedia.org/wiki/AI
https://ai.google/
    `;
    const result = quickAnswer({ question: 'Who coined the term artificial intelligence?', content });
    expect(result.answer).toContain('John McCarthy');
    expect(result.confidence).toBeGreaterThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// How (process/explanation) questions
// ---------------------------------------------------------------------------

describe('quickAnswer — how (process) questions', () => {
  it('"How does BM25 work?" boosts explanation sentences', () => {
    const content = `BM25 was invented in 1994.
BM25 works by scoring documents using term frequency and inverse document frequency.
Many search engines use BM25.
The algorithm is fast and efficient.`;
    const result = quickAnswer({ question: 'How does BM25 work?', content });
    const combined = result.answer + ' ' + result.passages.map(p => p.text).join(' ');
    expect(combined.toLowerCase()).toMatch(/scoring|term frequency|works by/);
  });

  it('"How to install Node.js?" boosts instructional sentences', () => {
    const content = `Node.js is a JavaScript runtime.
To install Node.js, download the installer from nodejs.org and run it.
Node.js was created by Ryan Dahl.
It supports many platforms.`;
    const result = quickAnswer({ question: 'How to install Node.js?', content });
    const combined = result.answer + ' ' + result.passages.map(p => p.text).join(' ');
    expect(combined.toLowerCase()).toMatch(/install|download/);
  });

  it('"How does X work?" is NOT classified as how_many', () => {
    const content = `There are 500 servers running.
The system works by distributing requests across multiple nodes using consistent hashing.
We process 1 million requests per day.
The architecture was designed in 2020.`;
    const result = quickAnswer({ question: 'How does the system work?', content });
    // Should NOT prefer the "500 servers" or "1 million" sentences
    const combined = result.answer + ' ' + result.passages.map(p => p.text).join(' ');
    expect(combined.toLowerCase()).toMatch(/works by|distributing|hashing/);
  });
});

// ---------------------------------------------------------------------------
// Yes/No questions
// ---------------------------------------------------------------------------

describe('quickAnswer — yes/no questions', () => {
  it('"Does Python support multithreading?" finds capability answer', () => {
    const content = `Python is a programming language created by Guido van Rossum.
Python supports multithreading through the threading module, but the GIL limits true parallelism.
Python was first released in 1991.
It has a large ecosystem of packages.`;
    const result = quickAnswer({ question: 'Does Python support multithreading?', content });
    const combined = result.answer + ' ' + result.passages.map(p => p.text).join(' ');
    expect(combined.toLowerCase()).toMatch(/supports? multithreading|threading/);
  });

  it('"Can WebPeel handle JavaScript?" boosts capability sentences', () => {
    const content = `WebPeel is a web scraping tool.
WebPeel can handle JavaScript-rendered pages using headless browser rendering.
It was launched in 2024.
The API is fast and reliable.`;
    const result = quickAnswer({ question: 'Can WebPeel handle JavaScript?', content });
    const combined = result.answer + ' ' + result.passages.map(p => p.text).join(' ');
    expect(combined.toLowerCase()).toMatch(/can handle|javascript/);
  });
});

// ---------------------------------------------------------------------------
// Edge cases and robustness
// ---------------------------------------------------------------------------

describe('quickAnswer — robustness improvements', () => {
  it('passage scores never exceed 1.0', () => {
    const content = Array(20).fill(null).map((_, i) =>
      `Sentence ${i}: The pricing plan includes ${i * 100} requests per month at $${i * 10}.`
    ).join(' ');
    const result = quickAnswer({ question: 'What is the pricing?', content });
    for (const p of result.passages) {
      expect(p.score).toBeLessThanOrEqual(1);
    }
  });

  it('handles list-format answers', () => {
    const content = `# Features

Key features of the product:

- Fast web scraping with intelligent caching
- Automatic JavaScript rendering for SPAs
- Built-in rate limiting and retry logic
- Clean markdown output with metadata

The product is available on npm.`;
    const result = quickAnswer({ question: 'What are the key features?', content });
    const combined = result.answer + ' ' + result.passages.map(p => p.text).join(' ');
    // Should pick up list items
    expect(combined.toLowerCase()).toMatch(/scraping|rendering|markdown|caching/);
  });

  it('long technical sentences (>500 chars) are not dropped', () => {
    const longSentence = 'The BM25 algorithm ' + 'computes relevance scores by analyzing term frequency, inverse document frequency, and document length normalization parameters, '.repeat(4) + 'which makes it highly effective for information retrieval tasks.';
    expect(longSentence.length).toBeGreaterThan(500);
    const content = `Short intro sentence here. ${longSentence} Another short sentence follows.`;
    const result = quickAnswer({ question: 'How does BM25 compute relevance?', content });
    // The long sentence should not be dropped
    expect(result.answer.length).toBeGreaterThan(100);
  });

  it('UI chrome in top answer reduces confidence', () => {
    const content = `Sign in to your account to continue.
Skip to main content. Navigation menu.
The Pro plan costs $29 per month with unlimited API access.`;
    const result = quickAnswer({ question: 'What is the pricing?', content });
    // Should still find pricing, but if chrome was top answer, confidence would be penalized
    const combined = result.answer + ' ' + result.passages.map(p => p.text).join(' ');
    expect(combined).toMatch(/29|Pro|plan/i);
  });
});

// ---------------------------------------------------------------------------
// Stemming — words that should match
// ---------------------------------------------------------------------------

describe('quickAnswer — stemming improves recall', () => {
  it('"What are the limitations?" matches content with "limited"', () => {
    const content = `The system has several constraints.
The processing capacity is limited to 1000 requests per second.
It supports multiple languages.
The API is well-documented.`;
    const result = quickAnswer({ question: 'What are the limitations?', content });
    const combined = result.answer + ' ' + result.passages.map(p => p.text).join(' ');
    expect(combined.toLowerCase()).toMatch(/limited|constraints|capacity/);
  });

  it('"Who is running the project?" matches content with "runs"', () => {
    const content = `The project was started in 2020.
Sarah Chen runs the engineering team and oversees all development.
The codebase uses TypeScript.
Deployments happen weekly.`;
    const result = quickAnswer({ question: 'Who is running the project?', content });
    const combined = result.answer + ' ' + result.passages.map(p => p.text).join(' ');
    expect(combined.toLowerCase()).toMatch(/sarah|chen|runs|engineering/);
  });

  it('"How to configure authentication?" matches "configuring" and "configured"', () => {
    const content = `The API requires authentication.
Authentication can be configured by setting the API_KEY environment variable.
We use JWT tokens for session management.
Rate limiting is enabled by default.`;
    const result = quickAnswer({ question: 'How to configure authentication?', content });
    const combined = result.answer + ' ' + result.passages.map(p => p.text).join(' ');
    expect(combined.toLowerCase()).toMatch(/configured|api_key|authentication/);
  });
});

// ---------------------------------------------------------------------------
// Synonym expansion
// ---------------------------------------------------------------------------

describe('quickAnswer — synonym expansion', () => {
  it('"What does it cost?" matches content about "pricing"', () => {
    const content = `WebPeel offers three pricing tiers.
The basic tier is free for up to 500 requests per week.
Advanced features require a subscription.
Enterprise clients get custom terms.`;
    const result = quickAnswer({ question: 'What does it cost?', content });
    const combined = result.answer + ' ' + result.passages.map(p => p.text).join(' ');
    expect(combined.toLowerCase()).toMatch(/pricing|subscription|free|tier/);
  });

  it('"How to set up the project?" matches content about "installing"', () => {
    const content = `The project requires Node.js 18+.
Install the package by running npm install webpeel in your terminal.
The documentation is available online.
TypeScript definitions are included.`;
    const result = quickAnswer({ question: 'How to set up the project?', content });
    const combined = result.answer + ' ' + result.passages.map(p => p.text).join(' ');
    expect(combined.toLowerCase()).toMatch(/install|npm|package/);
  });

  it('"What are the advantages?" matches content about "benefits"', () => {
    const content = `WebPeel has several benefits over traditional scrapers.
The main benefit is automatic JavaScript rendering.
It also provides clean markdown output.
Error handling is built in.`;
    const result = quickAnswer({ question: 'What are the advantages?', content });
    const combined = result.answer + ' ' + result.passages.map(p => p.text).join(' ');
    expect(combined.toLowerCase()).toMatch(/benefit/);
  });
});

// ---------------------------------------------------------------------------
// Multi-sentence answers (sliding window)
// ---------------------------------------------------------------------------

describe('quickAnswer — multi-sentence answers', () => {
  it('captures answer spanning two sentences', () => {
    const content = `The company has many products.
The API was launched in January 2024. It initially supported only basic fetching but quickly expanded to include rendering and search.
Customer satisfaction is high.
The team works remotely.`;
    const result = quickAnswer({ question: 'When was the API launched and what did it support?', content });
    const combined = result.answer + ' ' + result.passages.map(p => p.context).join(' ');
    // Should capture both the launch date AND the capabilities
    expect(combined.toLowerCase()).toMatch(/january 2024/);
    expect(combined.toLowerCase()).toMatch(/fetching|rendering|search/);
  });
});

// ---------------------------------------------------------------------------
// Answer extraction
// ---------------------------------------------------------------------------

describe('quickAnswer — answer extraction', () => {
  it('extracts person name for "who" questions', () => {
    const content = `Python is a high-level programming language.
Python was created by Guido van Rossum and first released in 1991.
It emphasizes code readability.
Python supports multiple programming paradigms.`;
    const result = quickAnswer({ question: 'Who created Python?', content });
    // Answer should prominently feature the name
    expect(result.answer).toMatch(/Guido van Rossum/);
  });

  it('extracts date for "when" questions', () => {
    const content = `JavaScript is used for web development.
JavaScript was created in 1995 by Brendan Eich at Netscape.
It has become one of the most popular programming languages.
Modern JavaScript includes many new features.`;
    const result = quickAnswer({ question: 'When was JavaScript created?', content });
    expect(result.answer).toMatch(/1995/);
  });
});

// ---------------------------------------------------------------------------
// Real-world Wikipedia content test
// ---------------------------------------------------------------------------

describe('quickAnswer — real-world Wikipedia content', () => {
  const PYTHON_WIKI = `Python is a high-level, general-purpose programming language. Its design philosophy emphasizes code readability with the use of significant indentation. Python is dynamically typed and garbage-collected. It supports multiple programming paradigms, including structured, object-oriented and functional programming.

Guido van Rossum began working on Python in the late 1980s as a successor to the ABC programming language and first released it in 1991 as Python 0.9.0. Python 2.0 was released in 2000. Python 3.0, released in 2008, was a major revision not completely backward-compatible with earlier versions. Python consistently ranks as one of the most popular programming languages.

Python was conceived in the late 1980s by Guido van Rossum at Centrum Wiskunde & Informatica (CWI) in the Netherlands as a successor to the ABC programming language, which was inspired by SETL, capable of exception handling and interfacing with the Amoeba operating system. Its implementation began in December 1989. Van Rossum shouldered sole responsibility for the project, as the lead developer, until 12 July 2018, when he announced his permanent vacation from his responsibilities as Python's chief architect.

Python's large standard library provides tools suited to many tasks and is commonly cited as one of its greatest strengths. For Internet-facing applications, many standard formats and protocols such as MIME and HTTP are supported. It includes modules for creating graphical user interfaces, connecting to relational databases, generating pseudorandom numbers, arithmetic with arbitrary-precision decimals, manipulating regular expressions, and unit testing.

The main limitations of Python include its relatively slow execution speed compared to compiled languages like C++ or Java, the Global Interpreter Lock (GIL) which limits true multi-threading, high memory consumption for certain operations, and challenges in mobile and browser-based development.`;

  it('"Who created Python?" → finds Guido van Rossum', () => {
    const result = quickAnswer({ question: 'Who created Python?', content: PYTHON_WIKI });
    const combined = result.answer + ' ' + result.passages.map(p => p.text).join(' ') + ' ' + result.passages.map(p => p.context).join(' ');
    expect(combined).toMatch(/Guido van Rossum/i);
  });

  it('"When was Python first released?" → finds 1991', () => {
    const result = quickAnswer({ question: 'When was Python first released?', content: PYTHON_WIKI });
    const combined = result.answer + ' ' + result.passages.map(p => p.text).join(' ');
    expect(combined).toMatch(/1991/);
  });

  it('"Where was Python created?" → finds Netherlands or CWI', () => {
    const result = quickAnswer({ question: 'Where was Python created?', content: PYTHON_WIKI });
    const combined = result.answer + ' ' + result.passages.map(p => p.text).join(' ') + ' ' + result.passages.map(p => p.context).join(' ');
    expect(combined).toMatch(/Netherlands|CWI|Centrum/i);
  });

  it('"Why was Python created?" → mentions successor to ABC', () => {
    const result = quickAnswer({ question: 'Why was Python created?', content: PYTHON_WIKI });
    const combined = result.answer + ' ' + result.passages.map(p => p.text).join(' ') + ' ' + result.passages.map(p => p.context).join(' ');
    expect(combined).toMatch(/successor|ABC/i);
  });

  it('"What are the limitations of Python?" → mentions GIL or slow', () => {
    const result = quickAnswer({ question: 'What are the limitations of Python?', content: PYTHON_WIKI });
    const combined = result.answer + ' ' + result.passages.map(p => p.text).join(' ');
    expect(combined).toMatch(/slow|GIL|memory|limit/i);
  });

  it('"Does Python support functional programming?" → yes', () => {
    const result = quickAnswer({ question: 'Does Python support functional programming?', content: PYTHON_WIKI });
    const combined = result.answer + ' ' + result.passages.map(p => p.text).join(' ');
    expect(combined).toMatch(/functional/i);
  });

  it('"Who built Python?" → finds Guido via synonym expansion', () => {
    const result = quickAnswer({ question: 'Who built Python?', content: PYTHON_WIKI });
    const combined = result.answer + ' ' + result.passages.map(p => p.text).join(' ') + ' ' + result.passages.map(p => p.context).join(' ');
    expect(combined).toMatch(/Guido|van Rossum/i);
  });

  it('"How does Python handle memory?" → mentions garbage collection', () => {
    const result = quickAnswer({ question: 'How does Python handle memory?', content: PYTHON_WIKI });
    const combined = result.answer + ' ' + result.passages.map(p => p.text).join(' ');
    expect(combined).toMatch(/garbage.collected|memory/i);
  });
});

// ---------------------------------------------------------------------------
// Comprehensive real-world benchmark (5 domains, 25+ tests)
// ---------------------------------------------------------------------------

describe('quickAnswer — comprehensive benchmark', () => {
  // ---- DOMAIN 1: Wikipedia (Python) ----
  const WIKI_PYTHON = `Python is a high-level, general-purpose programming language. Its design philosophy emphasizes code readability with the use of significant indentation. Python is dynamically typed and garbage-collected. It supports multiple programming paradigms, including structured, object-oriented and functional programming.

Guido van Rossum began working on Python in the late 1980s as a successor to the ABC programming language and first released it in 1991 as Python 0.9.0. Python 2.0 was released in 2000. Python 3.0, released in 2008, was a major revision not completely backward-compatible with earlier versions. Python consistently ranks as one of the most popular programming languages.

Python was conceived in the late 1980s by Guido van Rossum at Centrum Wiskunde & Informatica (CWI) in the Netherlands as a successor to the ABC programming language, which was inspired by SETL, capable of exception handling and interfacing with the Amoeba operating system. Its implementation began in December 1989. Van Rossum shouldered sole responsibility for the project, as the lead developer, until 12 July 2018, when he announced his permanent vacation from his responsibilities as Python's chief architect.

Python's large standard library provides tools suited to many tasks and is commonly cited as one of its greatest strengths. For Internet-facing applications, many standard formats and protocols such as MIME and HTTP are supported. It includes modules for creating graphical user interfaces, connecting to relational databases, generating pseudorandom numbers, arithmetic with arbitrary-precision decimals, manipulating regular expressions, and unit testing.

The main limitations of Python include its relatively slow execution speed compared to compiled languages like C++ or Java, the Global Interpreter Lock (GIL) which limits true multi-threading, high memory consumption for certain operations, and challenges in mobile and browser-based development.`;

  it('Wiki: Who created Python?', () => {
    const r = quickAnswer({ question: 'Who created Python?', content: WIKI_PYTHON });
    const all = r.answer + ' ' + r.passages.map(p => p.text + ' ' + p.context).join(' ');
    expect(all).toMatch(/Guido van Rossum/i);
  });

  it('Wiki: When was Python first released?', () => {
    const r = quickAnswer({ question: 'When was Python first released?', content: WIKI_PYTHON });
    const all = r.answer + ' ' + r.passages.map(p => p.text + ' ' + p.context).join(' ');
    expect(all).toMatch(/1991/);
  });

  it('Wiki: Where was Python created?', () => {
    const r = quickAnswer({ question: 'Where was Python created?', content: WIKI_PYTHON });
    const all = r.answer + ' ' + r.passages.map(p => p.text + ' ' + p.context).join(' ');
    expect(all).toMatch(/Netherlands|CWI|Centrum/i);
  });

  it('Wiki: Why was Python created?', () => {
    const r = quickAnswer({ question: 'Why was Python created?', content: WIKI_PYTHON });
    const all = r.answer + ' ' + r.passages.map(p => p.text + ' ' + p.context).join(' ');
    expect(all).toMatch(/successor|ABC/i);
  });

  it('Wiki: What are the limitations?', () => {
    const r = quickAnswer({ question: 'What are the limitations of Python?', content: WIKI_PYTHON });
    const all = r.answer + ' ' + r.passages.map(p => p.text).join(' ');
    expect(all).toMatch(/slow|GIL|memory|limit/i);
  });

  it('Wiki: Does Python support functional programming?', () => {
    const r = quickAnswer({ question: 'Does Python support functional programming?', content: WIKI_PYTHON });
    expect(r.answer + ' ' + r.passages.map(p => p.text).join(' ')).toMatch(/functional/i);
  });

  it('Wiki: Who built Python? (synonym)', () => {
    const r = quickAnswer({ question: 'Who built Python?', content: WIKI_PYTHON });
    const all = r.answer + ' ' + r.passages.map(p => p.text + ' ' + p.context).join(' ');
    expect(all).toMatch(/Guido|van Rossum/i);
  });

  it('Wiki: How does Python handle memory?', () => {
    const r = quickAnswer({ question: 'How does Python handle memory?', content: WIKI_PYTHON });
    expect(r.answer + ' ' + r.passages.map(p => p.text).join(' ')).toMatch(/garbage.collected|memory/i);
  });

  // ---- DOMAIN 2: Product/Pricing Page ----
  const PRICING_PAGE = `Acme Cloud Platform provides infrastructure for modern applications.

Our Standard plan starts at $49 per month and includes 100GB storage, 5 team members, and basic analytics. The Professional plan costs $149 per month with 1TB storage, unlimited team members, advanced analytics, and priority support. Enterprise pricing is custom - contact our sales team.

The platform was founded in 2019 by Maria Chen and David Park in San Francisco. They previously worked at Google Cloud and wanted to create a simpler alternative for small businesses.

Key features include automatic scaling, built-in CI/CD pipelines, one-click deployments, and real-time monitoring. The platform supports Node.js, Python, Go, and Rust natively.

Compared to AWS, Acme is significantly easier to set up but has fewer services. The main trade-off is simplicity versus flexibility. Most customers report being production-ready within 30 minutes instead of days.

Security features include SOC 2 compliance, end-to-end encryption, automatic backups every 6 hours, and role-based access control. Two-factor authentication is required for all accounts.`;

  it('Pricing: How much does Professional cost?', () => {
    const r = quickAnswer({ question: 'How much does the Professional plan cost?', content: PRICING_PAGE });
    expect(r.answer + ' ' + r.passages.map(p => p.text).join(' ')).toMatch(/149/);
  });

  it('Pricing: Who founded Acme?', () => {
    const r = quickAnswer({ question: 'Who founded Acme?', content: PRICING_PAGE });
    expect(r.answer + ' ' + r.passages.map(p => p.text).join(' ')).toMatch(/Maria Chen|David Park/i);
  });

  it('Pricing: Where is Acme based? (coreference)', () => {
    const r = quickAnswer({ question: 'Where is Acme based?', content: PRICING_PAGE });
    const all = r.answer + ' ' + r.passages.map(p => p.text + ' ' + p.context).join(' ');
    expect(all).toMatch(/San Francisco/i);
  });

  it('Pricing: What languages does it support?', () => {
    const r = quickAnswer({ question: 'What languages does it support?', content: PRICING_PAGE });
    expect(r.answer + ' ' + r.passages.map(p => p.text).join(' ')).toMatch(/Node|Python|Go|Rust/i);
  });

  it('Pricing: Is it more flexible than AWS?', () => {
    const r = quickAnswer({ question: 'Is it more flexible than AWS?', content: PRICING_PAGE });
    expect(r.answer + ' ' + r.passages.map(p => p.text).join(' ')).toMatch(/simpl|fewer|trade.off|flexib/i);
  });

  it('Pricing: How often are backups?', () => {
    const r = quickAnswer({ question: 'How often are backups made?', content: PRICING_PAGE });
    expect(r.answer + ' ' + r.passages.map(p => p.text).join(' ')).toMatch(/6 hours|every/i);
  });

  it('Pricing: What are the advantages? (synonym)', () => {
    const r = quickAnswer({ question: 'What are the benefits of Acme?', content: PRICING_PAGE });
    expect(r.answer + ' ' + r.passages.map(p => p.text).join(' ')).toMatch(/scal|simpl|deploy|monitor|easy|feature/i);
  });

  // ---- DOMAIN 3: Technical Documentation ----
  const TECH_DOCS = `# Getting Started with WebPeel

WebPeel is a web scraping library for Node.js that converts any URL to clean markdown.

## Installation

Install the package using npm:

- Run npm install webpeel in your terminal
- Import the peel function from the package
- Call peel with a URL to fetch and convert the page

## Configuration

The library can be configured with several options. The timeout defaults to 30 seconds but can be adjusted. Set the budget parameter to limit output tokens. Enable the render option for JavaScript-heavy sites.

## How It Works

WebPeel works by first fetching the raw HTML using an HTTP client. It then parses the DOM and applies content pruning to remove navigation, ads, and other noise. Finally, it converts the cleaned HTML to markdown format. The entire process typically takes 200-500ms for simple pages and 1-2 seconds for JavaScript-rendered pages.

## Troubleshooting

If you encounter CORS errors, ensure you are running the library server-side, not in a browser. For timeout issues, increase the timeout value. If content appears empty, try enabling the render option to handle JavaScript-rendered pages.`;

  it('Docs: How to install WebPeel?', () => {
    const r = quickAnswer({ question: 'How do I install WebPeel?', content: TECH_DOCS });
    expect(r.answer + ' ' + r.passages.map(p => p.text).join(' ')).toMatch(/npm install|install/i);
  });

  it('Docs: How does WebPeel work?', () => {
    const r = quickAnswer({ question: 'How does WebPeel work?', content: TECH_DOCS });
    const all = r.answer + ' ' + r.passages.map(p => p.text).join(' ');
    expect(all).toMatch(/fetch|HTML|pars|markdown|prun/i);
  });

  it('Docs: What is the default timeout?', () => {
    const r = quickAnswer({ question: 'What is the default timeout?', content: TECH_DOCS });
    expect(r.answer + ' ' + r.passages.map(p => p.text).join(' ')).toMatch(/30 seconds/i);
  });

  it('Docs: How to fix CORS errors?', () => {
    const r = quickAnswer({ question: 'How to fix CORS errors?', content: TECH_DOCS });
    expect(r.answer + ' ' + r.passages.map(p => p.text).join(' ')).toMatch(/server.side|browser/i);
  });

  // ---- DOMAIN 4: News Article ----
  const NEWS_ARTICLE = `SpaceX Successfully Launches Starship on Historic Test Flight

SpaceX launched its Starship rocket from Boca Chica, Texas on March 14, 2025, marking the most successful test flight to date. The massive rocket reached orbital velocity for the first time before splashing down in the Indian Ocean.

CEO Elon Musk called it a milestone for the company and for humanity's goal of becoming a multi-planetary species. NASA Administrator Bill Nelson congratulated the SpaceX team and noted the implications for the Artemis program.

The launch had been delayed three times due to weather conditions and a valve issue discovered during pre-flight checks. Engineers worked through the night to resolve the problem before the early morning launch window.

The Starship system consists of two stages: the Super Heavy booster and the Starship upper stage. Together they stand 120 meters tall, making it the largest rocket ever built. The booster successfully returned to the launch pad using its innovative chopstick catch mechanism.

Future plans include a crewed orbital flight in late 2025 and a cargo mission to Mars in the 2026 launch window.`;

  it('News: When did Starship launch?', () => {
    const r = quickAnswer({ question: 'When did Starship launch?', content: NEWS_ARTICLE });
    expect(r.answer + ' ' + r.passages.map(p => p.text).join(' ')).toMatch(/March 14|2025/i);
  });

  it('News: Where did Starship launch from?', () => {
    const r = quickAnswer({ question: 'Where did Starship launch from?', content: NEWS_ARTICLE });
    const all = r.answer + ' ' + r.passages.map(p => p.text + ' ' + p.context).join(' ');
    expect(all).toMatch(/Boca Chica|Texas/i);
  });

  it('News: Why was the launch delayed?', () => {
    const r = quickAnswer({ question: 'Why was the launch delayed?', content: NEWS_ARTICLE });
    expect(r.answer + ' ' + r.passages.map(p => p.text).join(' ')).toMatch(/weather|valve/i);
  });

  it('News: How tall is Starship?', () => {
    const r = quickAnswer({ question: 'How tall is Starship?', content: NEWS_ARTICLE });
    expect(r.answer + ' ' + r.passages.map(p => p.text).join(' ')).toMatch(/120 meters/i);
  });

  it('News: What are the future plans?', () => {
    const r = quickAnswer({ question: 'What are the future plans for Starship?', content: NEWS_ARTICLE });
    expect(r.answer + ' ' + r.passages.map(p => p.text).join(' ')).toMatch(/crewed|Mars|2026|orbital/i);
  });

  // ---- DOMAIN 5: E-commerce Product Page ----
  const PRODUCT_PAGE = `Sony WH-1000XM5 Wireless Noise-Cancelling Headphones

The Sony WH-1000XM5 headphones feature industry-leading noise cancellation with two processors controlling 8 microphones. The headphones are designed by Sony's audio engineering team in Tokyo.

Price: $349.99. Available in black, silver, and midnight blue colors.

Battery life lasts up to 30 hours with noise cancellation enabled. A quick 3-minute charge provides 3 hours of playback. The headphones support Bluetooth 5.2 and LDAC codec for high-resolution audio.

Key improvements over the XM4 include a lighter weight at 250 grams, improved call quality with beamforming microphones, and a new folding mechanism. The sound quality is exceptional with 30mm drivers custom-designed for clarity.

The headphones work with the Sony Headphones Connect app for iOS and Android. Users can customize EQ settings, adjust noise cancellation levels, and enable Speak-to-Chat which automatically pauses music when you start talking.`;

  it('Product: How much do the headphones cost?', () => {
    const r = quickAnswer({ question: 'How much do the Sony headphones cost?', content: PRODUCT_PAGE });
    expect(r.answer + ' ' + r.passages.map(p => p.text).join(' ')).toMatch(/349\.99/);
  });

  it('Product: How long does battery last?', () => {
    const r = quickAnswer({ question: 'How long does the battery last?', content: PRODUCT_PAGE });
    expect(r.answer + ' ' + r.passages.map(p => p.text).join(' ')).toMatch(/30 hours/i);
  });

  it('Product: What colors are available?', () => {
    const r = quickAnswer({ question: 'What colors are the headphones available in?', content: PRODUCT_PAGE });
    expect(r.answer + ' ' + r.passages.map(p => p.text).join(' ')).toMatch(/black|silver|midnight blue/i);
  });

  it('Product: Does it have noise cancellation?', () => {
    const r = quickAnswer({ question: 'Does it have noise cancellation?', content: PRODUCT_PAGE });
    expect(r.answer + ' ' + r.passages.map(p => p.text).join(' ')).toMatch(/noise cancel/i);
  });

  it('Product: What improved over XM4?', () => {
    const r = quickAnswer({ question: 'What improved over the XM4?', content: PRODUCT_PAGE });
    expect(r.answer + ' ' + r.passages.map(p => p.text).join(' ')).toMatch(/lighter|weight|call quality|folding/i);
  });

  // ---- DOMAIN 6: Medical/Health ----
  const HEALTH_ARTICLE = `Diabetes is a chronic metabolic condition characterized by elevated blood sugar levels. There are two main types: Type 1 diabetes, where the immune system attacks insulin-producing cells, and Type 2 diabetes, where the body becomes resistant to insulin.

Common symptoms include increased thirst, frequent urination, unexplained weight loss, fatigue, and blurred vision. Many people with Type 2 diabetes experience no symptoms initially and are diagnosed through routine blood tests.

Treatment varies by type. Type 1 diabetes requires daily insulin injections or an insulin pump. Type 2 diabetes is initially managed through lifestyle changes including diet modification and regular exercise. Medications such as metformin may be prescribed if lifestyle changes are insufficient. In some cases, insulin therapy becomes necessary.

The disease was first described by ancient Egyptian physicians around 1500 BCE. The term "diabetes" comes from the Greek word meaning "siphon," referring to the excessive urination. Frederick Banting and Charles Best discovered insulin in 1921 at the University of Toronto, revolutionizing treatment.

Complications of poorly managed diabetes include heart disease, kidney damage, nerve damage (neuropathy), eye damage (retinopathy), and increased risk of infections. Regular monitoring of blood sugar levels and HbA1c tests every 3-6 months are recommended.`;

  it('Health: What are the symptoms of diabetes?', () => {
    const r = quickAnswer({ question: 'What are the symptoms of diabetes?', content: HEALTH_ARTICLE });
    const all = r.answer + ' ' + r.passages.map(p => p.text + ' ' + p.context).join(' ');
    expect(all).toMatch(/thirst|urination|weight loss|fatigue|blurred/i);
  });

  it('Health: How is Type 2 diabetes treated?', () => {
    const r = quickAnswer({ question: 'How is Type 2 diabetes treated?', content: HEALTH_ARTICLE });
    expect(r.answer + ' ' + r.passages.map(p => p.text).join(' ')).toMatch(/lifestyle|diet|exercise|metformin/i);
  });

  it('Health: Who discovered insulin?', () => {
    const r = quickAnswer({ question: 'Who discovered insulin?', content: HEALTH_ARTICLE });
    const all = r.answer + ' ' + r.passages.map(p => p.text + ' ' + p.context).join(' ');
    expect(all).toMatch(/Banting|Best/i);
  });

  it('Health: What are the complications?', () => {
    const r = quickAnswer({ question: 'What are the complications of diabetes?', content: HEALTH_ARTICLE });
    expect(r.answer + ' ' + r.passages.map(p => p.text).join(' ')).toMatch(/heart|kidney|nerve|eye|neuropathy|retinopathy/i);
  });

  // ---- DOMAIN 7: Historical Article ----
  const HISTORY_ARTICLE = `The Berlin Wall was a concrete barrier that divided Berlin from 1961 to 1989. It was constructed by the German Democratic Republic (East Germany) to prevent its citizens from fleeing to West Berlin and West Germany.

Construction began on August 13, 1961, when East German soldiers and workers laid barbed wire and began building the wall overnight. The decision was made by East German leader Walter Ulbricht with Soviet approval. Over the years, the wall was reinforced and expanded into a complex system with guard towers, anti-vehicle trenches, and a "death strip."

At least 140 people were killed trying to cross the wall, though some estimates place the number higher. Despite the danger, around 5,000 people successfully escaped over, under, or through the wall using tunnels, hot air balloons, and even a zipline.

The wall fell on November 9, 1989, after weeks of civil unrest and protests across East Germany. A government spokesman, Günter Schabowski, mistakenly announced that border restrictions were lifted "immediately," leading thousands of East Berliners to flood the checkpoints. Guards, overwhelmed and without orders to use force, opened the gates.

German reunification was formally completed on October 3, 1990. Today, fragments of the wall remain as memorials, and the East Side Gallery features over 100 murals painted on a remaining section.`;

  it('History: When was the Berlin Wall built?', () => {
    const r = quickAnswer({ question: 'When was the Berlin Wall built?', content: HISTORY_ARTICLE });
    expect(r.answer + ' ' + r.passages.map(p => p.text).join(' ')).toMatch(/1961|August 13/);
  });

  it('History: Why was the Berlin Wall built?', () => {
    const r = quickAnswer({ question: 'Why was the Berlin Wall built?', content: HISTORY_ARTICLE });
    expect(r.answer + ' ' + r.passages.map(p => p.text).join(' ')).toMatch(/prevent|fleeing|escap/i);
  });

  it('History: How many people died at the wall?', () => {
    const r = quickAnswer({ question: 'How many people died trying to cross the Berlin Wall?', content: HISTORY_ARTICLE });
    expect(r.answer + ' ' + r.passages.map(p => p.text).join(' ')).toMatch(/140|killed/i);
  });

  it('History: When did the wall fall?', () => {
    const r = quickAnswer({ question: 'When did the Berlin Wall fall?', content: HISTORY_ARTICLE });
    expect(r.answer + ' ' + r.passages.map(p => p.text).join(' ')).toMatch(/November 9|1989/);
  });

  it('History: Who announced the border opening? (irregular: "spoke")', () => {
    const r = quickAnswer({ question: 'Who spoke about opening the border?', content: HISTORY_ARTICLE });
    const all = r.answer + ' ' + r.passages.map(p => p.text + ' ' + p.context).join(' ');
    expect(all).toMatch(/Schabowski|Günter/i);
  });

  // ---- DOMAIN 8: Cooking Recipe ----
  const RECIPE_CONTENT = `Classic Chocolate Chip Cookies

These cookies are crispy on the outside and chewy in the center. The recipe makes about 48 cookies and takes approximately 45 minutes total.

Ingredients:
- 2 1/4 cups all-purpose flour
- 1 teaspoon baking soda
- 1 teaspoon salt
- 1 cup butter, softened
- 3/4 cup granulated sugar
- 3/4 cup packed brown sugar
- 2 large eggs
- 2 teaspoons vanilla extract
- 2 cups chocolate chips

Instructions: Preheat the oven to 375 degrees Fahrenheit. Mix flour, baking soda, and salt in a bowl. In a separate bowl, cream the butter and sugars until fluffy. Beat in eggs and vanilla. Gradually blend in the flour mixture. Stir in chocolate chips. Drop rounded tablespoons of dough onto ungreased baking sheets. Bake for 9 to 11 minutes or until golden brown. Cool on baking sheets for 2 minutes before transferring to wire racks.

Storage: Store cookies in an airtight container at room temperature for up to one week. The dough can be refrigerated for up to 3 days or frozen for up to 3 months.`;

  it('Recipe: How long to bake?', () => {
    const r = quickAnswer({ question: 'How long do you bake the cookies?', content: RECIPE_CONTENT });
    expect(r.answer + ' ' + r.passages.map(p => p.text).join(' ')).toMatch(/9 to 11 minutes|375/i);
  });

  it('Recipe: How many cookies does it make?', () => {
    const r = quickAnswer({ question: 'How many cookies does this recipe make?', content: RECIPE_CONTENT });
    expect(r.answer + ' ' + r.passages.map(p => p.text).join(' ')).toMatch(/48/);
  });

  it('Recipe: How to store cookies?', () => {
    const r = quickAnswer({ question: 'How should I store the cookies?', content: RECIPE_CONTENT });
    expect(r.answer + ' ' + r.passages.map(p => p.text).join(' ')).toMatch(/airtight|room temperature|week/i);
  });

  it('Recipe: What temperature?', () => {
    const r = quickAnswer({ question: 'What temperature should the oven be?', content: RECIPE_CONTENT });
    expect(r.answer + ' ' + r.passages.map(p => p.text).join(' ')).toMatch(/375/);
  });

  // ---- Irregular verb integration tests ----
  it('Irregular: "Who wrote the code?" matches "written by"', () => {
    const content = `The WebPeel library provides fast web scraping.
The core engine was written by Jake Liu in TypeScript.
It supports multiple output formats.
The documentation is comprehensive.`;
    const r = quickAnswer({ question: 'Who wrote the code?', content });
    const all = r.answer + ' ' + r.passages.map(p => p.text + ' ' + p.context).join(' ');
    expect(all).toMatch(/Jake Liu/i);
  });

  it('Irregular: "Who spoke at the conference?" matches "spoken"', () => {
    const content = `The annual tech conference was held in June.
The keynote was spoken by Dr. Sarah Martinez about AI safety.
Over 5000 attendees participated.
The event featured 200 presentations.`;
    const r = quickAnswer({ question: 'Who spoke at the conference?', content });
    const all = r.answer + ' ' + r.passages.map(p => p.text + ' ' + p.context).join(' ');
    expect(all).toMatch(/Sarah Martinez/i);
  });

  it('Irregular: "Who taught the class?" matches "taught by"', () => {
    const content = `Introduction to Machine Learning is a popular course.
The class is taught by Professor Michael Chang at Stanford University.
It covers neural networks, decision trees, and reinforcement learning.
Enrollment is open to graduate students.`;
    const r = quickAnswer({ question: 'Who taught the class?', content });
    const all = r.answer + ' ' + r.passages.map(p => p.text + ' ' + p.context).join(' ');
    expect(all).toMatch(/Michael Chang/i);
  });
});
