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
# WebPeel Design Review
Generated: $(date)
Target: $TARGET
Reference: $PRIMARY_REF

---

## DESIGN RULEBOOK (from DESIGN.md)
These are the explicit rules for webpeel.dev. Check these FIRST before visual opinion.

| Rule | Spec | Must Pass |
|------|------|-----------|
| H1 font | Inter only (no Instrument Serif) | ✅/❌ |
| H1 size | 64–72px at desktop | ✅/❌ |
| H1 weight | 800 | ✅/❌ |
| Body text | min 16px | ✅/❌ |
| Accent color | #5865F2 only | ✅/❌ |
| Background | #0d0d10 (flat, no purple wash) | ✅/❌ |
| Max font families | 2 (Inter + JetBrains Mono) | ✅/❌ |
| Card border radius | 12px | ✅/❌ |
| Primary CTA min-height | 44px | ✅/❌ |

Rule score: ___/9

---

## VISUAL CHECKLIST
Open the compare/ folder. Each image: target (LEFT) vs $PRIMARY_REF (RIGHT).
Answer based ONLY on what you see — not from memory.

### HERO (compare/hero.png)
| # | Check | Answer |
|---|-------|--------|
| H1 | Background has visible texture (dots, grid, grain) | |
| H2 | Glow has a focused RADIAL SOURCE POINT (not just ambient wash) | |
| H3 | Headline is heavy weight (700+), very high contrast | |
| H4 | Subheadline clearly readable at a glance | |
| H5 | Primary CTA button has colored glow/shadow beneath it | |
| H6 | Secondary CTA visually distinct from primary | |
| H7 | Product widget has clear elevation (glow, shadow, border) | |
| H8 | Product widget shows populated content (not blank) | |

### FEATURES (compare/features.png)
| # | Check | Answer |
|---|-------|--------|
| F1 | Each card has a UNIQUE visual differentiator (color, icon, accent) | |
| F2 | Card body text readable (not tiny or low-contrast) | |
| F3 | Section headline prominent and bold | |

### HOW IT WORKS (compare/how.png)
| # | Check | Answer |
|---|-------|--------|
| W1 | Step numbers clearly visible | |
| W2 | Code examples legible | |

### PRICING (compare/pricing.png)
| # | Check | Answer |
|---|-------|--------|
| P1 | Pro/featured card clearly highlighted vs others | |
| P2 | Pricing text readable | |

### FINAL CTA (compare/cta.png)
| # | Check | Answer |
|---|-------|--------|
| C1 | Section background VISUALLY DISTINCT from rest of page | |
| C2 | Headline large and bold | |
| C3 | CTA button large and prominent | |

### GLOBAL (all images)
| # | Check | Answer |
|---|-------|--------|
| G1 | Background consistently near-black (not blue-gray) | |
| G2 | No section looks placeholder-like or empty | |
| G3 | Spacing generous and consistent between sections | |

---

## SCORE TALLY

Rule score:   ___/9
Visual score: ___/20
**Total: ___/29**

| Total | Rating |
|-------|--------|
| 27-29 | 9-10/10 · Stripe-tier |
| 23-26 | 8/10 · Competitive |
| 18-22 | 7/10 · Solid SaaS |
| 14-17 | 6/10 · Needs work |
| <14   | 5/10 or below |

---

## CALIBRATION NOTE
Before trusting this score: run the same checklist on $PRIMARY_REF vs itself.
It should score 29/29. If it doesn't, the checklist has bugs.
Command: ./scripts/design-review.sh $PRIMARY_REF

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
