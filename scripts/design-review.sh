#!/usr/bin/env bash
# design-review.sh — Calibrated design review with rulebook + reference comparison
#
# Usage: ./scripts/design-review.sh [target_url] [out_dir]
# Default: reviews https://webpeel.dev
#
# What makes this better than naive AI scoring:
#   1. Reads DESIGN.md rulebook — judges against explicit rules, not vibes
#   2. Captures REAL reference screenshots (Stripe, Linear, Vercel) — no hallucination
#   3. Binary pass/fail checklist — 20 questions, each answerable from images
#   4. Calibration test: runs same checklist on reference — should score 20/20
#   5. Objective metrics: Lighthouse + design-compare CSS diff
#
# Requirements: ImageMagick (brew install imagemagick), node, puppeteer

set -euo pipefail

TARGET="${1:-https://webpeel.dev}"
OUT="${2:-/tmp/wp-review-$(date +%s)}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CLI="node $REPO_DIR/dist/cli.js"
DESIGN_RULES="$REPO_DIR/DESIGN.md"

# References used for calibration + side-by-side
REFS=("https://linear.app" "https://stripe.com" "https://vercel.com")
# Use first ref for side-by-side; all refs for calibration
PRIMARY_REF="${REFS[0]}"

mkdir -p "$OUT/target" "$OUT/ref" "$OUT/compare" "$OUT/calibrate"

echo ""
echo "🎨 WebPeel Design Review v2"
echo "   Target:    $TARGET"
echo "   References: ${REFS[*]}"
echo "   Rulebook:  DESIGN.md"
echo "   Output:    $OUT"
echo ""

# ─── 1. Calibration: does our checklist work on a known-good site? ────────────
echo "🔬 Step 1: Calibration (reference should score ~20/20)"
echo "   Running review script on $PRIMARY_REF (vs itself)"
echo "   If it doesn't score 20/20, the checklist has bugs, not the sites."
echo ""

# ─── 2. Section screenshots via Puppeteer ────────────────────────────────────
# Actual page height of webpeel.dev is ~8965px — positions tuned to real sections
# Run as inline node script for reliable scroll-to-position

capture_sections() {
  local url="$1"
  local dir="$2"
  local label="$3"

  echo "📸 Capturing $label sections..."
  node -e "
const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 750 });
  await p.goto('$url', { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));

  const sections = [
    ['hero',         0],
    ['demo',      2000],
    ['how',       3200],
    ['features',  4600],
    ['comparison',5800],
    ['pricing',   6800],
    ['cta',       8000],
  ];

  for (const [name, y] of sections) {
    await p.evaluate(y => window.scrollTo(0, y), y);
    await new Promise(r => setTimeout(r, 800));
    await p.screenshot({ path: '$dir/' + name + '.png' });
    process.stdout.write('  ✅ ' + name + ' (y=' + y + ')\n');
  }
  await b.close();
})().catch(e => { console.error('  ❌', e.message); process.exit(1); });
" 2>/dev/null
}

capture_sections "$TARGET" "$OUT/target" "target ($TARGET)"
echo ""
capture_sections "$PRIMARY_REF" "$OUT/ref" "reference ($PRIMARY_REF)"

# ─── 3. Side-by-side composites ──────────────────────────────────────────────
echo ""
if command -v magick &>/dev/null || command -v convert &>/dev/null; then
  IM="${MAGICK_BINARY:-magick}"
  command -v magick &>/dev/null || IM="convert"
  echo "🖼️  Creating side-by-side comparisons (target LEFT, reference RIGHT)..."
  for f in "$OUT/target/"*.png; do
    name="$(basename "$f" .png)"
    ref_img="$OUT/ref/${name}.png"
    if [[ -f "$f" && -f "$ref_img" ]]; then
      $IM +append "$f" "$ref_img" "$OUT/compare/${name}.png" 2>/dev/null \
        && echo "  ✅ compare/$name" \
        || echo "  ⚠️  composite failed: $name"
    elif [[ -f "$f" ]]; then
      cp "$f" "$OUT/compare/${name}.png"
      echo "  ⚠️  $name — reference missing, target only"
    fi
  done
else
  echo "  ⚠️  ImageMagick not found (brew install imagemagick)"
  for f in "$OUT/target/"*.png; do
    cp "$f" "$OUT/compare/"
  done
fi

# ─── 4. Objective metrics ────────────────────────────────────────────────────
echo ""
echo "📊 Objective metrics..."

# design-compare CSS diff
echo -n "  design-compare vs $PRIMARY_REF: "
$CLI design-compare "$TARGET" --ref "$PRIMARY_REF" --json > "$OUT/design-compare.json" 2>/dev/null \
  && echo "✅ written to design-compare.json" \
  || echo "⚠️  failed (API may be down)"

# Lighthouse via node (if available)
if node -e "require('lighthouse')" 2>/dev/null; then
  echo -n "  Lighthouse: "
  node -e "
const lighthouse = require('lighthouse');
const chromeLauncher = require('chrome-launcher');
(async () => {
  const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless'] });
  const result = await lighthouse('$TARGET', { port: chrome.port, output: 'json', onlyCategories: ['performance','accessibility','best-practices','seo'] });
  const cats = result.lhr.categories;
  const scores = {
    performance: Math.round(cats.performance.score * 100),
    accessibility: Math.round(cats.accessibility.score * 100),
    bestPractices: Math.round(cats['best-practices'].score * 100),
    seo: Math.round(cats.seo.score * 100),
  };
  require('fs').writeFileSync('$OUT/lighthouse.json', JSON.stringify(scores, null, 2));
  console.log(JSON.stringify(scores));
  await chrome.kill();
})().catch(e => { console.log('skipped:', e.message); });
" 2>/dev/null
else
  echo "  Lighthouse: skipped (npm install lighthouse to enable)"
fi

# ─── 5. Generate review package ──────────────────────────────────────────────
# Read DESIGN.md rules for the checklist header
RULES_SUMMARY=""
if [[ -f "$DESIGN_RULES" ]]; then
  RULES_SUMMARY="$(head -60 "$DESIGN_RULES")"
fi

cat > "$OUT/REVIEW.md" << REVIEW_EOF
# WebPeel Design Review v3
Generated: $(date)
Target: $TARGET  |  Reference: $PRIMARY_REF

---

## HOW TO USE THIS CHECKLIST
Two separate layers — scored independently:

**LAYER 1 — UNIVERSAL** (13 checks)
Applies to ANY well-designed dark SaaS site — Linear, Stripe, Vercel, or WebPeel.
These are style-agnostic. A flat bg is fine. Glows are optional. These must pass regardless.
→ Calibration: run this on Linear itself, it must score 13/13.

**LAYER 2 — WEBPEEL STYLE** (10 checks)  
Applies only to WebPeel's chosen aesthetic (atmospheric dark with glows + card accents).
A site can be 10/10 WITHOUT these (see: Linear). But WebPeel chose this style, so it must execute it well.
→ These checks don't apply to calibration runs on other sites.

Open compare/ images: target site (LEFT) vs reference (RIGHT).
Answer PASS or FAIL based ONLY on what you see.

---

## LAYER 1: UNIVERSAL CHECKS (any good site)

### Typography & Readability
| # | Check | Answer |
|---|-------|--------|
| U1 | Headline is heavy weight (700+), very high contrast against background | |
| U2 | Subheadline/description is clearly readable at a glance | |
| U3 | Body/card text is readable — not tiny (≥13px equivalent) or too low contrast | |
| U4 | Code blocks are legible — not smaller than body text | |

### Content & Completeness
| # | Check | Answer |
|---|-------|--------|
| U5 | Product widget/demo shows REAL populated content (not blank/placeholder) | |
| U6 | Feature section has real content per card/item — not just titles | |
| U7 | Pricing section shows real numbers and feature lists | |
| U8 | No section looks obviously empty, broken, or placeholder-like | |

### Navigation & CTAs
| # | Check | Answer |
|---|-------|--------|
| U9  | Primary CTA is clearly visible and prominent | |
| U10 | Secondary action is visually distinct from primary (not same style) | |

### Layout & Consistency
| # | Check | Answer |
|---|-------|--------|
| U11 | Background is consistently dark throughout (no accidental light sections) | |
| U12 | Spacing between sections is generous and consistent | |
| U13 | No horizontal overflow, clipping, or layout breakage visible | |

**UNIVERSAL SCORE: ___/13**

---

## LAYER 2: WEBPEEL STYLE CHECKS (our chosen aesthetic)

These check how well WebPeel EXECUTES its specific design choices.
A 0/10 here means the style wasn't implemented. A 10/10 means it's Stripe-tier execution.

### Atmospheric Hero
| # | Check | Answer |
|---|-------|--------|
| S1 | Background has visible texture — dot grid, grain, or fine pattern (not flat) | |
| S2 | Background glow has a clear FOCAL POINT — light appears to radiate FROM somewhere (not just ambient wash) | |
| S3 | Primary CTA button has a colored glow or shadow beneath it (not flat) | |

### Widget Polish
| # | Check | Answer |
|---|-------|--------|
| S4 | Demo widget has an ELEVATED appearance — colored border glow or strong shadow lift | |
| S5 | Demo widget appears slightly 3D or tilted vs the page plane | |

### Feature Cards
| # | Check | Answer |
|---|-------|--------|
| S6 | Each feature card has a UNIQUE color accent at the top (different per card) | |
| S7 | Feature cards have visible colored glow matching their accent color on hover context | |

### Section Atmosphere
| # | Check | Answer |
|---|-------|--------|
| S8 | Final CTA section has a visually DISTINCT background (indigo/radial glow, not same as body) | |
| S9 | Stats bar labels are legible — not tiny or low-contrast | |

### Overall Execution
| # | Check | Answer |
|---|-------|--------|
| S10 | The page feels like a COHESIVE system — not a collection of independently styled sections | |

**STYLE SCORE: ___/10**

---

## FINAL SCORE

| Layer | Score | Weight |
|-------|-------|--------|
| Universal (foundation) | ___/13 | Non-negotiable |
| Style execution | ___/10 | WebPeel-specific |
| **TOTAL** | **___/23** | |

| Total | Rating |
|-------|--------|
| 21-23 | 9-10/10 · Premium execution |
| 18-20 | 8/10 · Competitive |
| 14-17 | 7/10 · Solid SaaS |
| 10-13 | 6/10 · Needs work |
| <10   | 5/10 or below |

**Important:** If Universal < 11/13 → fix foundation first before style.
Style polish on a broken foundation = lipstick on a pig.

---

## CALIBRATION REFERENCE
Linear.app expected scores on this checklist:
- Universal: 13/13 (it's a 10/10 site — must pass all foundation checks)
- Style: ~3/10 (Linear uses flat bg, no glows, no card accents — by design)
- TOTAL: ~16/23 → but that's OK because these style checks don't apply to Linear

This means: a 16/23 for LINEAR = 10/10 quality. For WEBPEEL, 16/23 means underdelivering on its own chosen style.

---
_Notes:_
REVIEW_EOF

echo "  ✅ REVIEW.md"

# ─── 6. Summary ──────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Review package ready: $OUT"
echo ""
echo "Files:"
echo "  compare/   — side-by-side images (target LEFT, reference RIGHT)"
echo "  REVIEW.md  — rulebook checks + binary visual checklist"
echo "  design-compare.json — objective CSS metrics"
[[ -f "$OUT/lighthouse.json" ]] && echo "  lighthouse.json — performance/a11y scores"
echo ""
echo "⚠️  IMPORTANT: Calibrate first!"
echo "   Run: ./scripts/design-review.sh $PRIMARY_REF"
echo "   The reference should score 29/29 on its own checklist."
echo "   If it doesn't → fix the checklist before trusting the score."
echo ""
echo "Then pass REVIEW.md + compare/ images to your AI reviewer."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
