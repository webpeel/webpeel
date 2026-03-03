/**
 * Design Compare — Structural diff between two pages' design tokens.
 *
 * Compares design quality of a subject URL against a reference URL,
 * returning a structured gap list with severity ratings and CSS suggestions.
 */

import type { Page } from 'playwright';
import { extractDesignAnalysis, type DesignAnalysis } from './design-analysis.js';

// ── Interfaces ─────────────────────────────────────────────────────────────────

export interface DesignGap {
  property: string;
  description: string;
  subject: string;
  reference: string;
  severity: 'high' | 'medium' | 'low';
  suggestion: string;
}

export interface DesignComparison {
  subjectUrl: string;
  referenceUrl: string;
  /** Design quality score relative to the reference (1–10, higher is closer). */
  score: number;
  gaps: DesignGap[];
  subjectAnalysis: DesignAnalysis;
  referenceAnalysis: DesignAnalysis;
  summary: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const SEVERITY_DEDUCTIONS: Record<DesignGap['severity'], number> = {
  high: 1.5,
  medium: 0.8,
  low: 0.3,
};

// ── Pure comparison logic ──────────────────────────────────────────────────────

/**
 * Build a DesignComparison from two pre-extracted DesignAnalysis objects.
 *
 * This is a pure synchronous function — straightforward to test and reuse
 * from both the HTTP route and the CLI command.
 */
export function buildDesignComparison(
  subjectUrl: string,
  referenceUrl: string,
  subjectAnalysis: DesignAnalysis,
  referenceAnalysis: DesignAnalysis,
): DesignComparison {
  const gaps: DesignGap[] = [];

  // ── 1. Color scheme ────────────────────────────────────────────────────────
  if (subjectAnalysis.palette.scheme !== referenceAnalysis.palette.scheme) {
    gaps.push({
      property: 'palette.scheme',
      description: 'Color scheme differs',
      subject: subjectAnalysis.palette.scheme,
      reference: referenceAnalysis.palette.scheme,
      severity: 'medium',
      suggestion: `Switch to a ${referenceAnalysis.palette.scheme} color scheme. Update background and text colors accordingly.`,
    });
  }

  // ── 2. Primary background color ────────────────────────────────────────────
  const subjectBg = subjectAnalysis.palette.dominant[0] ?? '';
  const referenceBg = referenceAnalysis.palette.dominant[0] ?? '';
  if (subjectBg && referenceBg && subjectBg.toLowerCase() !== referenceBg.toLowerCase()) {
    gaps.push({
      property: 'palette.dominant[0]',
      description: 'Primary background color differs',
      subject: subjectBg,
      reference: referenceBg,
      severity: 'low',
      suggestion: `Consider using ${referenceBg} as the primary background color.`,
    });
  }

  // ── 3. Layout system ───────────────────────────────────────────────────────
  if (subjectAnalysis.layout.gridSystem !== referenceAnalysis.layout.gridSystem) {
    gaps.push({
      property: 'layout.gridSystem',
      description: 'Layout system differs',
      subject: subjectAnalysis.layout.gridSystem,
      reference: referenceAnalysis.layout.gridSystem,
      severity: 'medium',
      suggestion: `Migrate to CSS ${referenceAnalysis.layout.gridSystem} to match the reference layout system.`,
    });
  }

  // ── 4. Container max-width ─────────────────────────────────────────────────
  if (
    subjectAnalysis.layout.maxWidth !== 'none' &&
    referenceAnalysis.layout.maxWidth !== 'none' &&
    subjectAnalysis.layout.maxWidth !== referenceAnalysis.layout.maxWidth
  ) {
    gaps.push({
      property: 'layout.maxWidth',
      description: 'Container max-width differs',
      subject: subjectAnalysis.layout.maxWidth,
      reference: referenceAnalysis.layout.maxWidth,
      severity: 'low',
      suggestion: `Set max-width to ${referenceAnalysis.layout.maxWidth} to match the reference layout.`,
    });
  }

  // ── 5. Base font size ──────────────────────────────────────────────────────
  const subjectBaseSize = parseFloat(subjectAnalysis.typeScale.baseSize);
  const referenceBaseSize = parseFloat(referenceAnalysis.typeScale.baseSize);
  if (
    !isNaN(subjectBaseSize) &&
    !isNaN(referenceBaseSize) &&
    Math.abs(subjectBaseSize - referenceBaseSize) >= 2
  ) {
    gaps.push({
      property: 'typeScale.baseSize',
      description: 'Base font size differs significantly',
      subject: subjectAnalysis.typeScale.baseSize,
      reference: referenceAnalysis.typeScale.baseSize,
      severity: 'medium',
      suggestion: `Set the root font-size to ${referenceAnalysis.typeScale.baseSize} (e.g., html { font-size: ${referenceAnalysis.typeScale.baseSize}; }).`,
    });
  }

  // ── 6. Heading font family ─────────────────────────────────────────────────
  const subjectHeadingFamily = subjectAnalysis.typeScale.headingStyle.family.toLowerCase();
  const referenceHeadingFamily = referenceAnalysis.typeScale.headingStyle.family.toLowerCase();
  if (subjectHeadingFamily && referenceHeadingFamily && subjectHeadingFamily !== referenceHeadingFamily) {
    gaps.push({
      property: 'typeScale.headingStyle.family',
      description: 'Heading font family differs',
      subject: subjectAnalysis.typeScale.headingStyle.family,
      reference: referenceAnalysis.typeScale.headingStyle.family,
      severity: 'high',
      suggestion: `Use "${referenceAnalysis.typeScale.headingStyle.family}" as the heading font family. Add it via Google Fonts or your font provider.`,
    });
  }

  // ── 7. Body font family ────────────────────────────────────────────────────
  const subjectBodyFamily = subjectAnalysis.typeScale.bodyStyle.family.toLowerCase();
  const referenceBodyFamily = referenceAnalysis.typeScale.bodyStyle.family.toLowerCase();
  if (subjectBodyFamily && referenceBodyFamily && subjectBodyFamily !== referenceBodyFamily) {
    gaps.push({
      property: 'typeScale.bodyStyle.family',
      description: 'Body font family differs',
      subject: subjectAnalysis.typeScale.bodyStyle.family,
      reference: referenceAnalysis.typeScale.bodyStyle.family,
      severity: 'high',
      suggestion: `Set body { font-family: "${referenceAnalysis.typeScale.bodyStyle.family}", sans-serif; }.`,
    });
  }

  // ── 8. Body font weight ────────────────────────────────────────────────────
  if (subjectAnalysis.typeScale.bodyStyle.weight !== referenceAnalysis.typeScale.bodyStyle.weight) {
    gaps.push({
      property: 'typeScale.bodyStyle.weight',
      description: 'Body font weight differs',
      subject: String(subjectAnalysis.typeScale.bodyStyle.weight),
      reference: String(referenceAnalysis.typeScale.bodyStyle.weight),
      severity: 'low',
      suggestion: `Set body { font-weight: ${referenceAnalysis.typeScale.bodyStyle.weight}; }.`,
    });
  }

  // ── 9. Modular type scale ──────────────────────────────────────────────────
  if (!subjectAnalysis.typeScale.isModular && referenceAnalysis.typeScale.isModular) {
    const referenceRatio = referenceAnalysis.typeScale.ratio;
    gaps.push({
      property: 'typeScale.isModular',
      description: 'Reference uses a modular type scale; subject does not',
      subject: 'non-modular',
      reference: referenceRatio !== undefined ? `modular (ratio: ${referenceRatio})` : 'modular',
      severity: 'medium',
      suggestion:
        referenceRatio !== undefined
          ? `Adopt a modular type scale with ratio ${referenceRatio}. Use a tool like https://type-scale.com to generate sizes.`
          : 'Adopt a modular type scale for consistent typography.',
    });
  }

  // ── 10. Box shadow presence ────────────────────────────────────────────────
  const subjectHasShadows = subjectAnalysis.visualEffects.shadows.length > 0;
  const referenceHasShadows = referenceAnalysis.visualEffects.shadows.length > 0;
  if (!subjectHasShadows && referenceHasShadows) {
    gaps.push({
      property: 'visualEffects.shadows',
      description: 'Reference uses box shadows; subject has none',
      subject: 'no shadows',
      reference: `${referenceAnalysis.visualEffects.shadows.length} shadow(s)`,
      severity: 'low',
      suggestion:
        'Add subtle box-shadow to cards and interactive elements (e.g., box-shadow: 0 2px 8px rgba(0,0,0,0.1)).',
    });
  }

  // ── 11. Gradient usage ─────────────────────────────────────────────────────
  const subjectHasGradients = subjectAnalysis.visualEffects.gradients.length > 0;
  const referenceHasGradients = referenceAnalysis.visualEffects.gradients.length > 0;
  if (!subjectHasGradients && referenceHasGradients) {
    gaps.push({
      property: 'visualEffects.gradients',
      description: 'Reference uses gradients; subject has none',
      subject: 'no gradients',
      reference: `${referenceAnalysis.visualEffects.gradients.length} gradient(s)`,
      severity: 'low',
      suggestion:
        'Add CSS gradients to hero sections or accent elements to add visual depth.',
    });
  }

  // ── 12. Spacing consistency quality signal ─────────────────────────────────
  const spacingDiff =
    referenceAnalysis.qualitySignals.spacingConsistency -
    subjectAnalysis.qualitySignals.spacingConsistency;
  if (spacingDiff >= 0.2) {
    gaps.push({
      property: 'qualitySignals.spacingConsistency',
      description: 'Spacing consistency is notably lower than the reference',
      subject: String(subjectAnalysis.qualitySignals.spacingConsistency),
      reference: String(referenceAnalysis.qualitySignals.spacingConsistency),
      severity: spacingDiff >= 0.4 ? 'high' : 'medium',
      suggestion:
        'Align margin and padding values to a 4px or 8px grid for consistent spacing.',
    });
  }

  // ── 13. Typography consistency quality signal ──────────────────────────────
  const typoDiff =
    referenceAnalysis.qualitySignals.typographyConsistency -
    subjectAnalysis.qualitySignals.typographyConsistency;
  if (typoDiff >= 0.2) {
    gaps.push({
      property: 'qualitySignals.typographyConsistency',
      description: 'Typography consistency is notably lower than the reference',
      subject: String(subjectAnalysis.qualitySignals.typographyConsistency),
      reference: String(referenceAnalysis.qualitySignals.typographyConsistency),
      severity: typoDiff >= 0.4 ? 'high' : 'medium',
      suggestion:
        'Reduce the number of distinct font sizes and establish a clear type hierarchy.',
    });
  }

  // ── 14. Color harmony quality signal ───────────────────────────────────────
  const colorDiff =
    referenceAnalysis.qualitySignals.colorHarmony -
    subjectAnalysis.qualitySignals.colorHarmony;
  if (colorDiff >= 0.2) {
    gaps.push({
      property: 'qualitySignals.colorHarmony',
      description: 'Color harmony is notably lower than the reference',
      subject: String(subjectAnalysis.qualitySignals.colorHarmony),
      reference: String(referenceAnalysis.qualitySignals.colorHarmony),
      severity: colorDiff >= 0.4 ? 'high' : 'medium',
      suggestion:
        'Reduce the color palette to 3–5 primary colors. Use tints/shades instead of completely different hues.',
    });
  }

  // ── 15. Visual hierarchy quality signal ───────────────────────────────────
  const hierarchyDiff =
    referenceAnalysis.qualitySignals.visualHierarchy -
    subjectAnalysis.qualitySignals.visualHierarchy;
  if (hierarchyDiff >= 0.2) {
    gaps.push({
      property: 'qualitySignals.visualHierarchy',
      description: 'Visual hierarchy is weaker than the reference',
      subject: String(subjectAnalysis.qualitySignals.visualHierarchy),
      reference: String(referenceAnalysis.qualitySignals.visualHierarchy),
      severity: hierarchyDiff >= 0.4 ? 'high' : 'medium',
      suggestion:
        'Increase the h1 font size relative to body text (aim for 2× or more) to strengthen visual hierarchy.',
    });
  }

  // ── Score calculation ──────────────────────────────────────────────────────
  let score = 10;
  for (const gap of gaps) {
    score -= SEVERITY_DEDUCTIONS[gap.severity];
  }
  score = Math.max(1, Math.round(score * 10) / 10);

  // ── Summary ───────────────────────────────────────────────────────────────
  const highCount = gaps.filter((g) => g.severity === 'high').length;
  const mediumCount = gaps.filter((g) => g.severity === 'medium').length;
  const lowCount = gaps.filter((g) => g.severity === 'low').length;

  let summary: string;
  if (gaps.length === 0) {
    summary = 'Subject closely matches the reference design. No significant gaps detected.';
  } else {
    const parts: string[] = [];
    if (highCount > 0) parts.push(`${highCount} high-severity`);
    if (mediumCount > 0) parts.push(`${mediumCount} medium-severity`);
    if (lowCount > 0) parts.push(`${lowCount} low-severity`);
    summary = `Found ${gaps.length} design gap${gaps.length === 1 ? '' : 's'} (${parts.join(', ')}) with a design score of ${score}/10.`;
    if (highCount > 0) {
      const highGaps = gaps.filter((g) => g.severity === 'high');
      summary += ` Priority: ${highGaps.map((g) => g.property).join(', ')}.`;
    }
  }

  return {
    subjectUrl,
    referenceUrl,
    score,
    gaps,
    subjectAnalysis,
    referenceAnalysis,
    summary,
  };
}

// ── Page-based wrapper ────────────────────────────────────────────────────────

/**
 * Compare the design of two Playwright pages by extracting design tokens from
 * both in parallel, then diffing the tokens into a structured DesignComparison.
 */
export async function compareDesigns(
  subjectPage: Page,
  referencePage: Page,
): Promise<DesignComparison> {
  const [subjectAnalysis, referenceAnalysis] = await Promise.all([
    extractDesignAnalysis(subjectPage),
    extractDesignAnalysis(referencePage),
  ]);

  return buildDesignComparison(
    subjectPage.url(),
    referencePage.url(),
    subjectAnalysis,
    referenceAnalysis,
  );
}
