/**
 * WebPeel — Search and Extract Example (TypeScript)
 *
 * 1. Searches the web for a topic
 * 2. Fetches the top result
 * 3. Extracts structured data using a JSON Schema
 *
 * Setup:
 *   npm install webpeel
 *   export WEBPEEL_API_KEY=wp_your_key_here
 *
 * Run:
 *   npx ts-node examples/typescript/search-and-extract.ts
 */

import { WebPeel } from 'webpeel';

const wp = new WebPeel({
  apiKey: process.env.WEBPEEL_API_KEY!,
});

// The schema defines exactly what data you want back
const PRICING_SCHEMA = {
  type: 'object',
  properties: {
    company: { type: 'string', description: 'Name of the company' },
    plans: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Plan name (e.g. Free, Pro, Enterprise)' },
          price: { type: 'string', description: 'Monthly price (e.g. $29/mo)' },
          features: {
            type: 'array',
            items: { type: 'string' },
            description: 'Key features included in this plan',
          },
        },
        required: ['name', 'price'],
      },
    },
  },
  required: ['company', 'plans'],
};

async function main() {
  const topic = 'vector database pricing comparison 2025';
  console.log(`🔍 Searching for: "${topic}"\n`);

  // Step 1: Search the web
  const searchResults = await wp.search(topic, { limit: 5 });

  console.log('Top results:');
  searchResults.forEach((r, i) => console.log(`  ${i + 1}. ${r.title} — ${r.url}`));

  // Step 2: Use the top result URL
  const topUrl = searchResults[0].url;
  console.log(`\n📄 Fetching top result: ${topUrl}\n`);

  // Step 3: Extract structured data using the schema
  const extracted = await wp.extract(topUrl, { schema: PRICING_SCHEMA });

  console.log('Extracted pricing data:');
  console.log(JSON.stringify(extracted.data, null, 2));
}

main().catch(console.error);

/*
Expected output:

🔍 Searching for: "vector database pricing comparison 2025"

Top results:
  1. Vector Database Pricing Compared: Pinecone vs Weaviate vs Qdrant — benchmarks.io
  2. Best Vector Databases in 2025 — thesequence.substack.com
  3. Choosing a Vector DB: A Size-Based Guide — newsletter.pragmaticengineer.com
  4. Open-source vector databases compared — towardsdatascience.com
  5. Vector Database Market Map 2025 — a16z.com

📄 Fetching top result: https://benchmarks.io/vector-database-pricing

Extracted pricing data:
{
  "company": "Pinecone",
  "plans": [
    {
      "name": "Starter",
      "price": "$0/mo",
      "features": ["1 index", "100K vectors", "shared infrastructure"]
    },
    {
      "name": "Standard",
      "price": "$70/mo",
      "features": ["Unlimited indexes", "10M vectors", "dedicated infrastructure"]
    }
  ]
}
*/
