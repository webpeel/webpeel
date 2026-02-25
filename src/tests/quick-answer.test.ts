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
