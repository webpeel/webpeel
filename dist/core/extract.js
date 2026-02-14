/**
 * Structured data extraction using CSS selectors and heuristics
 */
import { load } from 'cheerio';
/**
 * Extract structured data using an LLM (OpenAI-compatible API)
 */
export async function extractWithLLM(content, options) {
    const { prompt, schema, llmApiKey, llmModel = 'gpt-4o-mini', llmBaseUrl = 'https://api.openai.com/v1' } = options;
    if (!llmApiKey)
        throw new Error('LLM extraction requires llmApiKey');
    if (!prompt && !schema)
        throw new Error('LLM extraction requires prompt or schema');
    // Truncate content to ~4000 tokens to keep costs low
    const maxChars = 16000;
    const truncatedContent = content.length > maxChars
        ? content.slice(0, maxChars) + '\n\n[Content truncated]'
        : content;
    const systemPrompt = schema
        ? `Extract structured data from the following web page content. Return a JSON object matching this schema:\n${JSON.stringify(schema, null, 2)}\n\nReturn ONLY valid JSON, no explanation.`
        : `Extract structured data from the following web page content based on this instruction: ${prompt}\n\nReturn ONLY valid JSON, no explanation.`;
    const { fetch: undiciFetch } = await import('undici');
    const response = await undiciFetch(`${llmBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${llmApiKey}`,
        },
        body: JSON.stringify({
            model: llmModel,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: truncatedContent },
            ],
            temperature: 0,
            response_format: { type: 'json_object' },
        }),
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LLM API error ${response.status}: ${errorText}`);
    }
    const result = await response.json();
    const responseContent = result.choices?.[0]?.message?.content;
    if (!responseContent) {
        throw new Error('LLM returned empty response');
    }
    try {
        return JSON.parse(responseContent);
    }
    catch {
        throw new Error(`LLM returned invalid JSON: ${responseContent.slice(0, 200)}`);
    }
}
export function extractStructured(html, options) {
    const $ = load(html);
    const result = {};
    if (options.selectors) {
        // Direct CSS selector extraction
        for (const [field, selector] of Object.entries(options.selectors)) {
            const elements = $(selector);
            if (elements.length === 0) {
                result[field] = null;
            }
            else if (elements.length === 1) {
                result[field] = elements.first().text().trim();
            }
            else {
                result[field] = elements.map((_, el) => $(el).text().trim()).get();
            }
        }
    }
    if (options.schema) {
        // Schema-based extraction using heuristics
        const properties = options.schema.properties || options.schema;
        for (const [field, spec] of Object.entries(properties)) {
            if (result[field] !== undefined)
                continue; // Already extracted by selector
            // Try common CSS patterns based on field name
            const fieldLower = field.toLowerCase();
            const candidates = [
                `[itemprop="${fieldLower}"]`,
                `[data-${fieldLower}]`,
                `.${fieldLower}`,
                `#${fieldLower}`,
                `[class*="${fieldLower}"]`,
                `meta[name="${fieldLower}"]`,
                `meta[property="og:${fieldLower}"]`,
            ];
            for (const sel of candidates) {
                const el = $(sel).first();
                if (el.length > 0) {
                    let value = el.attr('content') || el.text().trim();
                    if (value) {
                        // Type coercion based on schema
                        if (spec?.type === 'number') {
                            const num = parseFloat(value.replace(/[^0-9.-]/g, ''));
                            if (!isNaN(num)) {
                                result[field] = num;
                                break;
                            }
                        }
                        else if (spec?.type === 'boolean') {
                            result[field] = ['true', 'yes', '1'].includes(value.toLowerCase());
                            break;
                        }
                        else if (spec?.type === 'array') {
                            // For arrays, get all matches
                            const allValues = $(sel).map((_, e) => $(e).text().trim()).get();
                            result[field] = allValues;
                            break;
                        }
                        else {
                            result[field] = value;
                            break;
                        }
                    }
                }
            }
            if (result[field] === undefined) {
                result[field] = null;
            }
        }
    }
    return result;
}
//# sourceMappingURL=extract.js.map