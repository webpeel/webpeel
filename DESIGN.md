# WebPeel Design System — The Rulebook

A measurable, checkable spec. No subjective scoring. Every rule is pass/fail.

## Evaluation Protocol
```bash
# Consistent measurement — always same reference:
node dist/cli.js design-compare "https://webpeel.dev" --ref "https://linear.app"
```
Run this after every design commit. Compare token deltas, not AI opinion scores.

---

## Typography Rules

| Rule | Value | Rationale |
|------|-------|-----------|
| Headline font | Inter only | No serif/sans split |
| H1 size | 64–72px | Linear is 64px |
| H1 weight | 800 | Maximum authority |
| H1 letter-spacing | -0.025em | Tight, professional |
| Body size | 16px | WCAG optimal |
| Body line-height | 1.6 | Readability |
| Body max-width | 65ch | Optimal line length |
| Font families max | 2 (Inter + JetBrains Mono) | No Instrument Serif in hero |
| CTA font-weight | 700 | Button weight |

## Color Rules

| Rule | Value |
|------|-------|
| Background | `#0d0d10` (not `#050507`, not `#0a0a0f`) |
| Text primary | `rgba(255,255,255,0.88)` |
| Text secondary | `rgba(255,255,255,0.55)` |
| Text muted | `rgba(255,255,255,0.38)` |
| Accent | `#5865F2` |
| Accent pale | `#A5B4FC` |
| Card bg | `rgba(255,255,255,0.04)` |
| Card border | `rgba(255,255,255,0.10)` |
| Hero radial glows | **Max 8% opacity** — no "bruised purple" |

## Spacing Rules (4px base unit)

```
4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96 / 128
```
No arbitrary pixel values. Every spacing value must be a multiple of 4.

## Border Radius Rules

| Element | Value |
|---------|-------|
| Buttons (primary) | `8px` |
| Buttons (pill/secondary) | `9999px` |
| Cards | `12px` |
| Inputs | `8px` |
| Badges/tags | `6px` |
| Code blocks | `8px` |

## CTA / Button Rules

| Rule | Spec |
|------|------|
| Primary CTA bg | `#ffffff` (white on dark — max contrast) |
| Primary CTA color | `#0d0d10` (near-black text) |
| Primary CTA contrast | Min 7:1 (white on #0d0d10 = 19:1) ✓ |
| Primary CTA font-weight | `700` |
| Primary CTA min-height | `44px` (touch target) |
| Secondary CTA | Ghost/outline, `rgba(255,255,255,0.08)` bg |

## Hero Rules

| Rule | Spec |
|------|------|
| Background | `#0d0d10` flat — zero glow blobs in hero |
| Headline style | Setup line at ~38% opacity → gradient payoff line |
| Gradient direction | Purple → blue → cyan → white (peaks bright at end) |
| Glow filter | `drop-shadow(0 0 32px rgba(96,165,250,0.65))` |
| Widget | Desktop: interactive demo; Mobile: static with same chrome |
| Trust bar | Above fold on mobile (order before widget) |
| CTA position | Above fold on both viewports |
| Social proof | Visible without scroll on mobile |

## Mobile Rules (390px baseline)

| Rule | Spec |
|------|------|
| H1 size | `min 40px` |
| CTA | Full-width, min 52px height |
| Trust bar | Order < widget (above fold) |
| Widget | Show simplified version with browser chrome |
| No horizontal overflow | Test at 375px and 390px |

## What 9/10 Requires (Human Designer Standard)

Things CSS alone cannot achieve — flagged here for future design sprints:

- [ ] **Animated widget** — live extraction demo running on page load
- [ ] **Custom illustrations** — unique assets vs generic stock
- [ ] **Real customer logos** — social proof you can't fake
- [ ] **Micro-animations** — scroll reveals, hover states, page transitions
- [ ] **"Works with" logos** — OpenAI, Anthropic, LangChain icons

## Evaluation Checklist (run after every deploy)

```bash
# 1. Token comparison vs reference
node dist/cli.js design-compare "https://webpeel.dev" --ref "https://linear.app"

# 2. Screenshot both viewports
node dist/cli.js screenshot "https://webpeel.dev" --width 1440 --height 900 --wait 8000 -o /tmp/desktop.png --silent
node dist/cli.js screenshot "https://webpeel.dev" --width 390 --height 844 --wait 8000 -o /tmp/mobile.png --silent

# 3. Check contrast (WCAG AA = 4.5:1 min)
# Primary text on hero bg: rgba(255,255,255,0.88) on #0d0d10 = ~14:1 ✓
# CTA white on #0d0d10 = 19:1 ✓
# Trust bar text: rgba(255,255,255,0.55) on #0d0d10 = ~8:1 ✓

# 4. Build check
npm run build && npm test -- --run
```

## Consistency Rule — How to Stay Consistent

**Never rely on AI vision scores with varying prompts.** They fluctuate ±2 points for identical screenshots.

Instead:
1. `/v1/design-compare` gives objective token deltas from a fixed reference
2. This DESIGN.md gives pass/fail rules — no interpretation needed
3. Human eyes (Jake's) are the final arbiter, not AI opinion scores
