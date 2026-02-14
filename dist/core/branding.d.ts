/**
 * Branding and design system extraction from web pages
 * Extracts colors, fonts, typography, spacing, components, and CSS variables
 */
import type { Page } from 'playwright-core';
export interface BrandingProfile {
    colorScheme: 'light' | 'dark' | 'both';
    logo?: string;
    favicon?: string;
    colors: {
        primary?: string;
        secondary?: string;
        accent?: string;
        background?: string;
        textPrimary?: string;
        textSecondary?: string;
        [key: string]: string | undefined;
    };
    fonts: Array<{
        family: string;
        weights?: number[];
        source?: string;
    }>;
    typography: {
        fontFamilies: Record<string, string>;
        fontSizes: Record<string, string>;
        fontWeights: Record<string, number>;
        lineHeights?: Record<string, string>;
    };
    spacing: {
        baseUnit?: number;
        borderRadius?: string;
        containerMaxWidth?: string;
    };
    components: Record<string, Record<string, string>>;
    cssVariables: Record<string, string>;
}
/**
 * Extract branding and design system from a webpage
 * This must run inside a Playwright browser context to access computed styles
 *
 * @param page - Playwright Page object
 * @returns Complete branding profile
 *
 * @example
 * ```typescript
 * const browser = await chromium.launch();
 * const page = await browser.newPage();
 * await page.goto('https://example.com');
 * const branding = await extractBranding(page);
 * console.log(branding.colors.primary);
 * ```
 */
export declare function extractBranding(page: Page): Promise<BrandingProfile>;
//# sourceMappingURL=branding.d.ts.map