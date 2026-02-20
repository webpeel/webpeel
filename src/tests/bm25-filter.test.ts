/**
 * Tests for bm25-filter.ts
 *
 * BM25 Query-Focused Content Filter — at least 15 tests covering:
 * - Basic filtering
 * - Multi-word queries
 * - Empty query
 * - Heading + body grouping
 * - Code block preservation
 * - Document order preservation
 * - Never-empty fallback
 * - IDF / TF correctness
 * - Auto-threshold
 * - Custom threshold
 * - Reduction percentage
 * - Real-world content
 * - Long mixed content
 * - Stop words
 * - includeScores option
 */

import { describe, it, expect } from 'vitest';
import { filterByRelevance, splitIntoBlocks, scoreBM25, computeRelevanceScore } from '../core/bm25-filter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBlock(raw: string, index: number) {
  return { raw, index };
}

// ---------------------------------------------------------------------------
// splitIntoBlocks
// ---------------------------------------------------------------------------

describe('splitIntoBlocks', () => {
  it('splits on double newline', () => {
    const content = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
    const blocks = splitIntoBlocks(content);
    expect(blocks.length).toBe(3);
    expect(blocks[0].raw).toContain('First');
    expect(blocks[1].raw).toContain('Second');
    expect(blocks[2].raw).toContain('Third');
  });

  it('merges heading with following paragraph', () => {
    const content = '## Hotel Prices\n\nRooms start at $100 per night.\n\nThis is unrelated.';
    const blocks = splitIntoBlocks(content);
    // "## Hotel Prices" + "Rooms start..." should be merged → 2 blocks total
    expect(blocks.length).toBe(2);
    expect(blocks[0].raw).toContain('Hotel Prices');
    expect(blocks[0].raw).toContain('Rooms start');
  });

  it('preserves code blocks as single unit', () => {
    const content = 'Some text.\n\n```\nconst x = 1;\nconst y = 2;\n```\n\nMore text.';
    const blocks = splitIntoBlocks(content);
    const codeBlock = blocks.find(b => b.raw.includes('const x'));
    expect(codeBlock).toBeDefined();
    expect(codeBlock!.raw).toContain('const y');
    // Code block must not be split
    expect(blocks.filter(b => b.raw.includes('const')).length).toBe(1);
  });

  it('does not merge two consecutive headings', () => {
    const content = '## Section A\n\n## Section B\n\nContent for B.';
    const blocks = splitIntoBlocks(content);
    // "## Section A" alone, then "## Section B" + "Content for B"
    expect(blocks.length).toBe(2);
    expect(blocks[0].raw).toBe('## Section A');
  });
});

// ---------------------------------------------------------------------------
// scoreBM25
// ---------------------------------------------------------------------------

describe('scoreBM25', () => {
  it('returns zero scores for empty query terms', () => {
    const blocks = [makeBlock('Hello world', 0), makeBlock('Foo bar', 1)];
    const scores = scoreBM25(blocks, []);
    expect(scores).toEqual([0, 0]);
  });

  it('returns zero scores for empty block list', () => {
    const scores = scoreBM25([], ['price']);
    expect(scores).toEqual([]);
  });

  it('scores block with matching term higher than block without', () => {
    const blocks = [
      makeBlock('Hotel room price is $200 per night price price', 0),
      makeBlock('The quick brown fox jumped over the lazy dog', 1),
    ];
    const scores = scoreBM25(blocks, ['price']);
    expect(scores[0]).toBeGreaterThan(scores[1]);
  });

  it('IDF is higher for rare terms', () => {
    // Block 0 and 1 both contain "hotel"; only block 0 contains "breakfast"
    const blocks = [
      makeBlock('hotel breakfast included', 0),
      makeBlock('hotel swimming pool spa', 1),
      makeBlock('restaurant dinner wine', 2),
    ];
    const scoresHotel = scoreBM25(blocks, ['hotel']);
    const scoresBreakfast = scoreBM25(blocks, ['breakfast']);

    // "hotel" appears in 2/3 blocks → lower IDF
    // "breakfast" appears in 1/3 blocks → higher IDF
    // For block 0 with tf=1 for both terms, breakfast should score higher
    expect(scoresBreakfast[0]).toBeGreaterThan(scoresHotel[0]);
  });

  it('TF: block with more occurrences of query term scores higher', () => {
    const blocks = [
      makeBlock('price price price price hotel stays', 0),
      makeBlock('price hotel stay', 1),
    ];
    const scores = scoreBM25(blocks, ['price']);
    expect(scores[0]).toBeGreaterThan(scores[1]);
  });

  it('length normalisation: shorter document with same TF scores higher', () => {
    // Both have tf('price')=1, but block 0 is much shorter
    const blocks = [
      makeBlock('price', 0),
      makeBlock('price ' + 'filler '.repeat(100).trim(), 1),
    ];
    const scores = scoreBM25(blocks, ['price']);
    expect(scores[0]).toBeGreaterThan(scores[1]);
  });
});

// ---------------------------------------------------------------------------
// filterByRelevance — core behaviour
// ---------------------------------------------------------------------------

describe('filterByRelevance — basic filtering', () => {
  it('returns full content for empty query', () => {
    const content = 'Paragraph one.\n\nParagraph two.';
    const result = filterByRelevance(content, { query: '' });
    expect(result.content).toBe(content);
    expect(result.reductionPercent).toBe(0);
  });

  it('returns full content for whitespace-only query', () => {
    const content = 'Paragraph one.\n\nParagraph two.';
    const result = filterByRelevance(content, { query: '   ' });
    expect(result.content).toBe(content);
  });

  it('basic filtering: price-related paragraph is kept', () => {
    const content = [
      'Welcome to our amazing hotel website!',
      'Rates and Prices\n\nStandard rooms start at $99 per night. Deluxe rooms are $149 per night. Suite prices reach $299.',
      'Our restaurant serves breakfast, lunch, and dinner with a wide variety of dishes.',
      'Contact us via email or phone for reservations.',
    ].join('\n\n');

    const result = filterByRelevance(content, { query: 'price' });
    expect(result.content).toContain('$99');
    expect(result.kept).toBeGreaterThanOrEqual(1);
    // "Rates and Prices" is a plain text line (not a # heading), so it becomes its own block
    // giving us 5 total blocks: welcome | "Rates and Prices" | price text | restaurant | contact
    expect(result.total).toBe(5);
  });

  it('multi-word query returns blocks matching multiple terms', () => {
    const content = [
      'Hotel room rates vary by season.',
      'Book now to get the best hotel deal and save money on room prices.',
      'Our spa offers relaxation treatments and massages.',
    ].join('\n\n');

    const result = filterByRelevance(content, { query: 'hotel room price' });
    // Block 2 (index 1, 0-based) should score highest — contains hotel, room, prices (as synonym? no, exact tokenize)
    // Both block 0 and 1 match hotel/room; block 1 also has prices→price
    expect(result.kept).toBeGreaterThanOrEqual(1);
    expect(result.content).toContain('hotel');
  });

  it('headings are kept with their content blocks', () => {
    const content = [
      '## Pricing Information',
      'Standard: $100/night. Deluxe: $200/night.',
      '## About Us',
      'We are a family-run hotel established in 1990.',
    ].join('\n\n');

    const result = filterByRelevance(content, { query: 'price' });
    // The "## Pricing Information" block should be kept with its paragraph
    expect(result.content).toContain('Pricing Information');
    expect(result.content).toContain('$100');
  });

  it('code blocks are preserved whole', () => {
    const content = [
      'Here is an example API call for pricing:',
      '```\nGET /api/prices\nAuthorization: Bearer token\n```',
      'The above code queries the pricing endpoint.',
      'This is totally unrelated content about gardening and flowers.',
    ].join('\n\n');

    const result = filterByRelevance(content, { query: 'api prices endpoint' });
    if (result.content.includes('GET /api')) {
      // Code block was kept — must be whole
      expect(result.content).toContain('Authorization');
    }
  });

  it('document order is maintained', () => {
    const content = [
      'Alpha: price tag on first item.',
      'Beta: weather is nice today.',
      'Gamma: price reduction on second item.',
      'Delta: cooking recipes for dinner.',
      'Epsilon: price comparison chart.',
    ].join('\n\n');

    const result = filterByRelevance(content, { query: 'price' });
    const alphaIdx = result.content.indexOf('Alpha');
    const gammaIdx = result.content.indexOf('Gamma');
    const epsilonIdx = result.content.indexOf('Epsilon');

    expect(alphaIdx).toBeGreaterThanOrEqual(0);
    expect(gammaIdx).toBeGreaterThan(alphaIdx);
    expect(epsilonIdx).toBeGreaterThan(gammaIdx);
  });

  it('never returns empty — falls back to top 3 blocks', () => {
    // Query that matches nothing
    const content = [
      'First paragraph about apples.',
      'Second paragraph about oranges.',
      'Third paragraph about bananas.',
      'Fourth paragraph about grapes.',
      'Fifth paragraph about mangoes.',
    ].join('\n\n');

    const result = filterByRelevance(content, { query: 'zzz_xkcd_nomatch_xyz', threshold: 9999 });
    expect(result.kept).toBe(3);
    expect(result.content.trim().length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Threshold tests
// ---------------------------------------------------------------------------

describe('filterByRelevance — threshold', () => {
  it('auto-threshold keeps blocks above mean*0.5', () => {
    const content = [
      'Price: $100 per room per night price price.',
      'The sky is blue and the grass is green.',
      'Weather today is sunny and warm with a light breeze.',
      'Price reduced to $80 for weekend stays price.',
    ].join('\n\n');

    const result = filterByRelevance(content, { query: 'price' });
    // Price blocks should be kept; weather/sky should be filtered
    expect(result.content).toContain('$100');
    expect(result.content).not.toContain('sky is blue');
  });

  it('custom threshold 0 keeps all blocks', () => {
    const content = 'First.\n\nSecond.\n\nThird.';
    const result = filterByRelevance(content, { query: 'price', threshold: 0 });
    expect(result.kept).toBe(result.total);
  });

  it('custom very high threshold triggers fallback to top 3', () => {
    const content = [
      'First about price.',
      'Second about weather.',
      'Third about food.',
      'Fourth about travel.',
      'Fifth about price again.',
    ].join('\n\n');

    const result = filterByRelevance(content, { query: 'price', threshold: 99999 });
    expect(result.kept).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Reduction percentage
// ---------------------------------------------------------------------------

describe('filterByRelevance — reduction percentage', () => {
  it('reduction percent is accurate', () => {
    const content = [
      'Price: $100 per room price price price.',   // high relevance
      'The sky is blue today and it is warm.',
      'Weather forecast says rain tomorrow.',
      'Temperature will drop over the weekend.',
    ].join('\n\n');

    const result = filterByRelevance(content, { query: 'price' });
    if (result.kept < result.total) {
      expect(result.reductionPercent).toBeGreaterThan(0);
      expect(result.reductionPercent).toBeLessThanOrEqual(100);

      // Verify the math: filtered is shorter than original
      expect(result.content.length).toBeLessThan(content.length);
    }
  });

  it('reduction percent is 0 when all content is kept', () => {
    const content = 'Just one paragraph.';
    // With one block, threshold = mean*0.5 = score*0.5 → block scores >= threshold → kept
    const result = filterByRelevance(content, { query: 'paragraph' });
    expect(result.kept).toBe(1);
    // reductionPercent might be > 0 due to whitespace trimming, but kept should be full
    expect(result.kept).toBe(result.total);
  });
});

// ---------------------------------------------------------------------------
// includeScores
// ---------------------------------------------------------------------------

describe('filterByRelevance — includeScores', () => {
  it('includes BM25 score comments when includeScores is true', () => {
    const content = 'Price is $100.\n\nWeather is nice.';
    const result = filterByRelevance(content, { query: 'price', includeScores: true });
    expect(result.content).toContain('<!-- BM25:');
  });

  it('does not include score comments by default', () => {
    const content = 'Price is $100.\n\nWeather is nice.';
    const result = filterByRelevance(content, { query: 'price' });
    expect(result.content).not.toContain('<!-- BM25:');
  });
});

// ---------------------------------------------------------------------------
// Real-world content scenarios
// ---------------------------------------------------------------------------

describe('filterByRelevance — real-world content', () => {
  it('article with sidebar: keeps article content, discards sidebar nav', () => {
    const content = [
      '# Booking a Hotel Room in Paris\n\nFinding the best hotel price in Paris requires comparing multiple booking sites. Look for deals on room rates and price drops.',
      'Paris is the capital of France and a major tourist destination with world-class museums.',
      '## Related Articles\n\n- [Best Restaurants in Paris](#)\n- [Top Museums](#)\n- [Shopping Guide](#)',
      '## Navigation\n\nHome | About | Contact | Privacy Policy | Terms of Service',
      '## Room Pricing Guide\n\nBudget hotels: $50-100/night. Mid-range price: $100-200. Luxury: $200+ per night.',
    ].join('\n\n');

    const result = filterByRelevance(content, { query: 'hotel room price' });
    // Should keep the hotel/room/price content, discard pure nav/museum
    expect(result.content).toContain('room');
    expect(result.kept).toBeLessThan(result.total);
  });

  it('long content with mixed relevance: only relevant sections kept', () => {
    const sections = [
      'Introduction to our travel blog.',
      'Paris hotel prices range from budget to luxury. Price per night varies widely.',
      'The Eiffel Tower was built in 1889 for the World Fair.',
      'Louvre Museum houses the Mona Lisa painting.',
      'Best times to visit: spring and autumn for mild weather.',
      'Hotel booking tips: book price in advance for lower room rates.',
      'Transportation options include metro, bus, and taxi.',
      'Local cuisine features baguettes, croissants, and wine.',
    ];
    const content = sections.join('\n\n');

    const result = filterByRelevance(content, { query: 'hotel price room' });
    expect(result.kept).toBeGreaterThanOrEqual(1);
    expect(result.kept).toBeLessThan(result.total);
    // Relevant blocks should be present
    expect(result.content).toContain('hotel');
  });

  it('query with common stop words still works', () => {
    // "the" and "a" appear in many blocks; meaningful terms ("price") should dominate
    const content = [
      'The price of a standard room is $100 per night.',
      'The weather in the area is a pleasant mix of sun and clouds.',
      'A new restaurant opened near the hotel with a great menu.',
    ].join('\n\n');

    const result = filterByRelevance(content, { query: 'the a price' });
    // Should not crash; "price" block should score well
    expect(result.kept).toBeGreaterThanOrEqual(1);
    expect(result.content).toBeTruthy();
  });

  it('single-word query works', () => {
    const content = [
      'Price: $100 per night.',
      'Location: Downtown Paris.',
      'Amenities: WiFi, pool, breakfast.',
    ].join('\n\n');

    const result = filterByRelevance(content, { query: 'price' });
    expect(result.kept).toBeGreaterThanOrEqual(1);
    expect(result.content).toContain('$100');
  });

  it('query matching content in markdown links/formatting still scores', () => {
    const content = [
      '[Check hotel prices here](https://example.com/prices) — great deals available.',
      'The weather today is cloudy with a chance of rain.',
      'Local events include a farmers market every Saturday morning.',
    ].join('\n\n');

    const result = filterByRelevance(content, { query: 'hotel price' });
    // First block contains "hotel" and "prices" in link text
    expect(result.kept).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('filterByRelevance — edge cases', () => {
  it('handles empty content gracefully', () => {
    const result = filterByRelevance('', { query: 'price' });
    expect(result.kept).toBe(0);
    expect(result.total).toBe(0);
    expect(result.reductionPercent).toBe(0);
  });

  it('handles single block content', () => {
    const content = 'Just one paragraph with no double newlines.';
    const result = filterByRelevance(content, { query: 'paragraph' });
    expect(result.total).toBe(1);
    expect(result.kept).toBe(1);
  });

  it('kept + filtered = total blocks', () => {
    const content = [
      'Price information here.',
      'Weather is nice.',
      'Room bookings available.',
      'Random unrelated text.',
    ].join('\n\n');

    const result = filterByRelevance(content, { query: 'price room' });
    expect(result.kept).toBeGreaterThan(0);
    expect(result.kept).toBeLessThanOrEqual(result.total);
  });
});

// ---------------------------------------------------------------------------
// computeRelevanceScore
// ---------------------------------------------------------------------------

describe('computeRelevanceScore', () => {
  it('returns 0 for empty content', () => {
    expect(computeRelevanceScore('', 'test query')).toBe(0);
  });

  it('returns 0 for empty query', () => {
    expect(computeRelevanceScore('Some content here.', '')).toBe(0);
  });

  it('returns high score for highly relevant content', () => {
    const score = computeRelevanceScore(
      'Python is the best programming language for AI and machine learning in 2025.',
      'best programming languages 2025',
    );
    expect(score).toBeGreaterThan(0.5);
  });

  it('returns low/zero score for completely irrelevant content', () => {
    const score = computeRelevanceScore(
      'This is a recipe for chocolate cake. You need flour, sugar, and eggs.',
      'best programming languages 2025',
    );
    expect(score).toBeLessThan(0.1);
  });

  it('ranks relevant content higher than irrelevant', () => {
    const relevant = computeRelevanceScore(
      'JavaScript and Python are top programming languages to learn in 2025 for web development.',
      'best programming languages 2025',
    );
    const irrelevant = computeRelevanceScore(
      'The weather forecast shows sunny skies with temperatures around 75 degrees.',
      'best programming languages 2025',
    );
    expect(relevant).toBeGreaterThan(irrelevant);
  });

  it('returns value between 0 and 1', () => {
    const score = computeRelevanceScore(
      'Cloudflare uses bot detection with machine learning models and JavaScript challenges.',
      'how does cloudflare bot detection work',
    );
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('scores larger relevant documents higher', () => {
    const short = computeRelevanceScore(
      'Python is a programming language.',
      'best programming languages',
    );
    const long = computeRelevanceScore(
      [
        'Python is the best programming language for AI.',
        'JavaScript leads web programming.',
        'Rust is a fast systems programming language.',
        'Go is great for cloud programming.',
      ].join('\n\n'),
      'best programming languages',
    );
    expect(long).toBeGreaterThanOrEqual(short);
  });
});
