/**
 * HTML to Markdown conversion with smart cleanup
 */
/**
 * Extract content matching a CSS selector
 * Returns filtered HTML or full HTML if selector matches nothing
 */
export declare function selectContent(html: string, selector: string, exclude?: string[]): string;
/**
 * Try to detect the main content area of a page.
 * Returns the main content HTML, or the full cleaned HTML if no main content detected.
 */
export declare function detectMainContent(html: string): {
    html: string;
    detected: boolean;
};
/**
 * Calculate content quality score (0-1)
 * Measures how clean and useful the extracted content is
 */
export declare function calculateQuality(content: string, originalHtml: string): number;
/**
 * Convert HTML to clean, readable Markdown
 * @param html - HTML to convert
 */
export declare function htmlToMarkdown(html: string, _options?: {
    raw?: boolean;
}): string;
/**
 * Convert HTML to plain text (strip all formatting)
 */
export declare function htmlToText(html: string): string;
/**
 * Estimate token count (very rough approximation)
 * Rule of thumb: 1 token ≈ 4 characters for English text
 */
export declare function estimateTokens(text: string): number;
//# sourceMappingURL=markdown.d.ts.map