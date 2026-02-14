/**
 * Branding and design system extraction from web pages
 * Extracts colors, fonts, typography, spacing, components, and CSS variables
 */

import type { Page } from 'playwright-core';

// Suppress DOM type errors - evaluate() runs in browser context
declare const document: any;
declare const getComputedStyle: any;
declare const HTMLImageElement: any;
declare const HTMLLinkElement: any;

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
export async function extractBranding(page: Page): Promise<BrandingProfile> {
  try {
    // Run extraction in browser context to access computed styles
    const extracted = await page.evaluate(() => {
      const result: any = {
        colorScheme: 'light',
        colors: {},
        fonts: [],
        typography: {
          fontFamilies: {},
          fontSizes: {},
          fontWeights: {},
          lineHeights: {},
        },
        spacing: {},
        components: {},
        cssVariables: {},
      };

      // Helper to parse RGB/RGBA to hex
      function rgbToHex(rgb: string): string {
        const match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
        if (!match) return rgb;
        const [, r, g, b] = match;
        return '#' + [r, g, b].map(x => parseInt(x).toString(16).padStart(2, '0')).join('');
      }

      // Extract all CSS variables from :root
      const rootStyles = getComputedStyle(document.documentElement);
      for (let i = 0; i < rootStyles.length; i++) {
        const prop = rootStyles[i];
        if (prop.startsWith('--')) {
          const value = rootStyles.getPropertyValue(prop).trim();
          result.cssVariables[prop] = value;
          
          // Detect color variables
          if (value.match(/^#[0-9a-f]{3,8}$/i) || value.match(/^rgba?\(/i) || value.match(/^hsla?\(/i)) {
            const colorKey = prop.replace(/^--/, '').replace(/-/g, '_');
            result.colors[colorKey] = value.startsWith('rgb') ? rgbToHex(value) : value;
          }
        }
      }

      // Detect color scheme (light/dark)
      const bgColor = rootStyles.backgroundColor || getComputedStyle(document.body).backgroundColor;
      if (bgColor) {
        const rgb = bgColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (rgb) {
          const [, r, g, b] = rgb.map(Number);
          const brightness = (r * 299 + g * 587 + b * 114) / 1000;
          result.colorScheme = brightness < 128 ? 'dark' : 'light';
          result.colors.background = rgbToHex(bgColor);
        }
      }

      // Extract text colors
      const bodyStyles = getComputedStyle(document.body);
      result.colors.textPrimary = rgbToHex(bodyStyles.color);
      
      // Find headings for secondary text color
      const heading = document.querySelector('h1, h2, h3, h4, h5, h6');
      if (heading) {
        const headingColor = getComputedStyle(heading).color;
        if (headingColor !== bodyStyles.color) {
          result.colors.textSecondary = rgbToHex(headingColor);
        }
      }

      // Try to detect primary/accent colors from buttons, links, etc.
      const button = document.querySelector('button, .btn, [role="button"], a.button');
      if (button) {
        const btnStyles = getComputedStyle(button);
        const btnBg = btnStyles.backgroundColor;
        if (btnBg && !btnBg.includes('rgba(0, 0, 0, 0)')) {
          result.colors.primary = rgbToHex(btnBg);
        }
      }

      const link = document.querySelector('a');
      if (link) {
        const linkColor = getComputedStyle(link).color;
        if (!result.colors.primary && linkColor !== bodyStyles.color) {
          result.colors.accent = rgbToHex(linkColor);
        }
      }

      // Extract fonts
      const fontFamiliesSet = new Set<string>();
      const fontElements = [document.body, ...Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, button, input'))];
      
      for (const el of fontElements) {
        if (el) {
          const styles = getComputedStyle(el);
          const family = styles.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
          fontFamiliesSet.add(family);
          
          const tagName = el.tagName.toLowerCase();
          result.typography.fontFamilies[tagName] = family;
          result.typography.fontSizes[tagName] = styles.fontSize;
          result.typography.fontWeights[tagName] = parseInt(styles.fontWeight) || 400;
          result.typography.lineHeights[tagName] = styles.lineHeight;
        }
      }

      // Build fonts array with sources
      fontFamiliesSet.forEach(family => {
        const fontObj: any = { family };
        
        // Detect Google Fonts
        const links = document.querySelectorAll('link[href*="fonts.googleapis.com"]');
        for (const link of links) {
          const href = link.getAttribute('href') || '';
          if (href.includes(family.replace(/\s+/g, '+'))) {
            fontObj.source = 'Google Fonts';
            // Extract weights from URL
            const weightMatch = href.match(/wght@([0-9;]+)/);
            if (weightMatch) {
              fontObj.weights = weightMatch[1].split(';').map(Number);
            }
            break;
          }
        }
        
        if (!fontObj.source) {
          fontObj.source = 'system';
        }
        
        result.fonts.push(fontObj);
      });

      // Extract spacing values
      const container = document.querySelector('main, .container, .wrapper, #content, [class*="container"]');
      if (container) {
        const containerStyles = getComputedStyle(container);
        result.spacing.containerMaxWidth = containerStyles.maxWidth;
        result.spacing.borderRadius = containerStyles.borderRadius;
        
        // Try to detect base spacing unit
        const padding = containerStyles.padding;
        const paddingMatch = padding.match(/(\d+)px/);
        if (paddingMatch) {
          const px = parseInt(paddingMatch[1]);
          // Common spacing systems use multiples of 4 or 8
          if (px % 8 === 0) result.spacing.baseUnit = 8;
          else if (px % 4 === 0) result.spacing.baseUnit = 4;
        }
      }

      // Extract common component patterns
      const componentSelectors = {
        button: 'button, .btn, [role="button"]',
        input: 'input[type="text"], input[type="email"], textarea',
        card: '.card, [class*="card"]',
        nav: 'nav, .nav, .navigation',
        header: 'header, .header',
        footer: 'footer, .footer',
      };

      for (const [name, selector] of Object.entries(componentSelectors)) {
        const el = document.querySelector(selector);
        if (el) {
          const styles = getComputedStyle(el);
          result.components[name] = {
            backgroundColor: styles.backgroundColor.includes('rgba(0, 0, 0, 0)') ? 'transparent' : rgbToHex(styles.backgroundColor),
            color: rgbToHex(styles.color),
            borderRadius: styles.borderRadius,
            padding: styles.padding,
            fontSize: styles.fontSize,
            fontWeight: styles.fontWeight,
          };
        }
      }

      return result;
    });

    // Extract logo and favicon using Playwright
    const logo = await page.evaluate(() => {
      const logoSelectors = [
        'img[alt*="logo" i]',
        'img[class*="logo" i]',
        'img[id*="logo" i]',
        'a.logo img',
        'a[class*="logo"] img',
        'header img',
        '.header img',
        'nav img:first-of-type',
      ];
      
      for (const selector of logoSelectors) {
        const img = document.querySelector(selector) as any;
        if (img?.src) return img.src;
      }
      return undefined;
    });

    const favicon = await page.evaluate(() => {
      const faviconSelectors = [
        'link[rel="icon"]',
        'link[rel="shortcut icon"]',
        'link[rel="apple-touch-icon"]',
      ];
      
      for (const selector of faviconSelectors) {
        const link = document.querySelector(selector) as any;
        if (link?.href) return link.href;
      }
      return undefined;
    });

    return {
      ...extracted,
      logo,
      favicon,
    } as BrandingProfile;

  } catch (error) {
    // Return minimal branding profile on error
    console.error('Branding extraction failed:', error);
    return {
      colorScheme: 'light',
      colors: {},
      fonts: [],
      typography: {
        fontFamilies: {},
        fontSizes: {},
        fontWeights: {},
      },
      spacing: {},
      components: {},
      cssVariables: {},
    };
  }
}
