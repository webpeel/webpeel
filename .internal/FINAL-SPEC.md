# WebPeel Landing Page — FINAL Spec (v3)

## Design Philosophy
Anthropic's warmth + Stripe's confidence. Centered hero that commands. Each section makes ONE point with generous breathing room. Serif headlines for editorial quality, sans-serif body for readability. Warm cream background differentiates from cold SaaS.

---

## STRUCTURAL CHANGE: Centered Hero (not split)
The #1 issue is the 50/50 hero layout. The headline competes with the terminal.
Fix: Center everything. Headline → subhead → CTAs → terminal below.
The terminal becomes a wide showcase card, not a cramped sidebar element.

---

## Design Tokens (KEEP from current)

```css
:root {
  --bg: #F4F0E8;
  --bg-alt: #FDFBF8;
  --bg-dark: #0F172A;
  --text: #1A1A1A;
  --text-2: #6B6B6B;
  --text-3: #9B9B9B;
  --accent: #1E40AF;
  --accent-hover: #1E3A8A;
  --accent-light: #DBEAFE;
  --border: #E5E0D8;
  --card-bg: #FFFFFF;
  --font-display: 'Instrument Serif', Georgia, serif;
  --font-body: 'Inter', -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
}
```

## Typography Scale (BIGGER than before)
```css
--text-hero: clamp(64px, 9vw, 128px);   /* Was 56-112. Now massive. */
--text-h2: clamp(36px, 4.5vw, 56px);    /* Was 36-52. Slightly bigger. */
--text-h3: clamp(20px, 2.2vw, 28px);    /* Was 20-26. */
--text-body-lg: 19px;
--text-body: 16px;
--text-small: 14px;
--text-label: 12px;
```

## Spacing (GENEROUS — minimum 120px between sections)
```css
--space-section: clamp(120px, 14vw, 200px);  /* Was 100-160. Now 120-200. */
```

---

## Section-by-Section Spec

### 1. NAVIGATION (same as current — it's fine)
Sticky, 64px, backdrop-blur on scroll. Logo "◆ WebPeel" 18px. 
Links: Features, Docs, Pricing, GitHub↗. CTA: "Get Started →".
Mobile: hamburger at 768px.

### 2. HERO — Centered, Commanding

```
Layout: CENTERED. Single column. Everything stacked.
Padding: 160px top, 80px bottom (hero should feel like it owns the viewport)
Text-align: center
Max-width: 900px for text content, centered

Structure:
├── Eyebrow badge: "Open Source · 500 free fetches/week"
│   Larger than before: 14px weight 600, padding 8px 18px
│   bg: --accent-light, color: --accent, border-radius: 100px
│   margin-bottom: 28px
│
├── H1: "Give your AI" (line 1)
│       "the entire web." (line 2, color: --accent)
│   font: var(--font-display), var(--text-hero), weight 400
│   line-height: 0.95 (VERY tight — letters stack close)
│   letter-spacing: -0.04em
│   margin-bottom: 28px
│   THE HEADLINE MUST DOMINATE. At 1440px, this = 128px.
│   At 390px mobile, this = 64px. Still commanding.
│
├── Subhead: "One API call. Any page. Structured data back."
│   font: 20px, weight 400, color: --text-2, line-height: 1.6
│   max-width: 520px, margin: 0 auto 36px
│
├── CTA row: centered, flex, gap: 16px
│   [Get Started Free →] primary: bg --accent, white, 16px/500, 
│                         padding 14px 32px, radius 8px
│   [View Docs] secondary: color --text, 16px/500
│
├── Trust line: "Works with Claude, GPT, Cursor, LangChain & more"
│   14px, color: --text-3, margin-top: 32px
│
└── Terminal card: BELOW everything, full container width
    max-width: 860px, margin: 64px auto 0
    background: var(--bg-dark)
    border-radius: 16px
    box-shadow: 0 0 0 1px rgba(255,255,255,0.06),
                0 25px 50px -12px rgba(0,0,0,0.15),
                0 0 100px rgba(30,64,175,0.08)
    NO 3D rotation — clean, flat, confident
    
    Chrome bar: 48px, bg: #1E293B, three dots + "Terminal" tab
    Content: 24px padding, 14px mono, line-height 1.7
    
    Three commands with TYPING ANIMATION:
    $ webpeel "https://stripe.com" --readable
    → # Stripe | Financial Infrastructure for the Internet
    → 2,847 words · 12s read · 4 images
    
    $ webpeel search "best react frameworks 2026"
    → 1. Next.js 15 — The React Framework for Production
    → 2. Remix 3.0 — Full Stack Web Framework
    
    $ webpeel youtube https://youtu.be/dQw4 --transcript
    → Duration: 3:32 · Transcript: 847 words ✓
    
    TYPING ANIMATION (JavaScript):
    - On page load (500ms delay), type first command char by char (30ms/char)
    - After command typed, instantly show output
    - 800ms pause, type second command
    - After second output, 800ms pause, type third
    - Cursor: blinking | at end (800ms blink interval)
    - Animation runs ONCE, content stays visible after
    - If user has prefers-reduced-motion, skip animation, show all content

MOBILE (< 768px):
- Padding: 100px top, 60px bottom
- H1: 64px (clamp handles this)
- CTAs: stack vertically, full-width
- Terminal: full-width, no max-width constraint, smaller font (12px)
- max-height: 280px with overflow: hidden on terminal content

MOBILE (< 480px):
- Padding: 80px top, 48px bottom
- Terminal: max-height: 220px
```

### 3. "WORKS WITH" — Logo strip (NEW section, replaces trust line)
```
Background: var(--bg) (seamless from hero)
Padding: 0 0 var(--space-section) 0
Text-align: center

Structure:
├── Label: "WORKS WITH" — 12px uppercase, weight 600, color --text-3
│   margin-bottom: 24px
│
└── Logo row: flex, centered, gap: 40px, flex-wrap: wrap
    6 items: Claude, Cursor, GPT, LangChain, Windsurf, OpenClaw
    Each: text label only (no actual logos — we don't have them)
    Style: 15px, weight 500, color: var(--text-3), opacity: 0.6
    
    This is a MINIMAL social proof section. Just names, no graphics.
    On mobile: 3 per row, gap: 24px
```

### 4. HOW IT WORKS
```
Same structure as current but with more breathing room.
Background: var(--bg-alt)
Padding: var(--space-section)

Header: centered
├── Eyebrow: "HOW IT WORKS"
└── H2: "Three lines to any page."

Grid: 3 columns, gap: 64px (up from 48px)
Each step: number line, title, description, code block

IMPORTANT: On mobile (< 768px):
- grid-template-columns: 1fr (SINGLE column)
- gap: 40px
- mini-code font-size: 12px
- Each step gets FULL WIDTH

On mobile (< 480px):
- gap: 32px
```

### 5. SUPERPOWER (Dark section)
```
Background: var(--bg-dark)
Padding: clamp(140px, 16vw, 220px) 0
Text-align: left (not centered — Anthropic style)
max-width: var(--container-narrow)

Structure:
├── Eyebrow: "THE DIFFERENCE" — 12px uppercase, color: #60A5FA
├── H2: "Other tools fetch pages." (white)
│       "WebPeel reads them." (#60A5FA)
│   Tight line-height: 1.05
├── Body paragraph: 20px (up from 18), rgba(255,255,255,0.7)
│   max-width: 560px
│
└── Stats row: flex, gap: 80px, margin-top: 64px
    
    STATS MUST BE ENORMOUS:
    .stat-num: clamp(72px, 10vw, 128px), weight 700, color white
    letter-spacing: -0.04em, line-height: 1
    
    .stat-label: 16px (up from 14), rgba(255,255,255,0.5)
    margin-top: 8px
    
    Dividers: 1px vertical, rgba(255,255,255,0.1), height: 64px
    
    99.7% | 50ms | 18
    bypass rate | avg response | MCP tools

MOBILE:
- Stats: 2-column grid at 768px, single column at 480px
- stat-num: clamp(56px, 16vw, 80px) — still big
- gap: 48px
```

### 6. FEATURES (3 stacked blocks, alternating)
```
Same structure as current. Alternating text-left/right.
Padding: var(--space-section)
Gap between features: 120px (up from 96px)

Feature 1: "Raw HTML in. Clean markdown out." — text left, card right
Feature 2: "Gets through when others get blocked." — card left, text right  
Feature 3: "Plugs into every AI framework." — text left, grid right

Each feature:
- Number: "01" monospace blue
- H3: var(--text-h3)
- Body: 16px, --text-2, line-height 1.7
- Checklist: ✓ items

Visual cards: same as current but with min-width: 0 on all grid children
Feature-card-dark: overflow-x: auto, max-width: 100%

MOBILE: single column, text always first, gap: 32px between text and visual
```

### 7. PERFORMANCE
```
Same structure: bar charts left, stat cards right.
Background: var(--bg-alt)
Padding: var(--space-section)

Stat card numbers: clamp(36px, 5vw, 56px) — bigger than body text

MOBILE: single column, stat cards in a row (flex-wrap)
```

### 8. PRICING
```
Same structure. Three cards, Pro featured.
Padding: var(--space-section)
Max-width: 960px centered

Cards: 
- border-radius: 16px (up from 12)
- padding: 36px (up from 32)
- Featured card: 2px border --accent, subtle scale(1.02)
- Featured badge: "Most Popular"

MOBILE: single column, Pro card first (order: -1)
```

### 9. FAQ
```
Same accordion structure. 
Background: var(--bg-alt)
Padding: var(--space-section)
max-width: 800px centered

6 FAQ items with toggle. One open at a time.
```

### 10. FINAL CTA + FOOTER
```
CTA: dark bg, centered
├── H2: "Ready to give your AI the web?" — serif, 36px, white
├── Subhead: 16px, rgba(255,255,255,0.6)
├── Install card with copy button
└── Primary CTA button

Footer: dark bg (continuous from CTA)
4-column grid → 2-col at 768px → 1-col at 480px
```

---

## Animations

### Typing Effect (Hero Terminal)
```javascript
// Wait 500ms after load
// Type each command character by character (30ms per char)
// Show output instantly after command
// 800ms pause between commands
// Blinking cursor at end
// Skip animation if prefers-reduced-motion
// Content is ALWAYS in the HTML — animation just reveals it
```

### Scroll Reveal (IntersectionObserver)
```javascript
// Elements start at opacity: 1 (ALWAYS visible)
// When they enter viewport, add .animate class
// Animation: from opacity 0.4 + translateY(16px) to opacity 1 + translateY(0)
// Duration: 0.5s, ease-out
// Stagger: 0.08s delay per sibling
// Threshold: 0.15
// rootMargin: "0px 0px -40px 0px"
```

### Counter Animation (Stats)
```javascript
// Stat numbers count up from 0 when entering viewport
// Duration: 1.2s, ease-out
// requestAnimationFrame based
// Only runs once per element
```

---

## Mobile Breakpoints Summary

### 1024px (Tablet)
- --gutter: 32px
- Feature block gap: 40px
- How-grid: still 3 columns but tighter

### 768px (Mobile)
- --gutter: 20px
- Hero: stacked center, 100px top padding
- Hero CTAs: column, full-width, gap: 12px
- Secondary CTA gets border treatment on mobile
- How-grid: single column, gap: 40px
- Feature blocks: single column, text first
- Perf grid: single column
- Pricing: single column, Pro first
- Footer: 2-column
- Nav: hamburger menu
- Terminal: max-height 280px, font 12px
- Stats row: 2-column grid

### 480px (Small mobile)
- Hero: 80px top padding
- Terminal: max-height 220px, font 11px
- Stats: single column
- Footer: single column
- Install card: stacked vertically, word-break on code

---

## Critical Rules
1. CONTENT ALWAYS VISIBLE WITHOUT JS. No opacity:0 default states.
2. All code blocks: overflow-x: auto + max-width: 100%
3. All grid children: min-width: 0
4. body + html: overflow-x: hidden
5. No GSAP, no external libraries
6. Google Fonts: Inter (400/500/600) + Instrument Serif (400) + JetBrains Mono (400/600)
7. Everything in ONE index.html file (CSS + HTML + JS)
8. Smooth scroll for anchor links
9. All links must be real (not placeholder)
10. Terminal content uses REAL WebPeel CLI commands

---

## What This Spec Fixes (from the 7.5/6.5 review)
1. ✅ Hero headline now DOMINATES — centered, 128px, no competing terminal
2. ✅ Terminal is a showcase card below hero, not a cramped sidebar
3. ✅ Stats are enormous (128px max)
4. ✅ Section spacing is 120-200px (generous, consistent)
5. ✅ Mobile CTAs are full-width with border
6. ✅ All code blocks have overflow protection
7. ✅ All grid children have min-width: 0
8. ✅ Typing animation adds life to the terminal
9. ✅ Counter animation on stats
10. ✅ "Works with" logo strip for social proof
