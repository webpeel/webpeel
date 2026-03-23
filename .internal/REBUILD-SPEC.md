# WebPeel Landing Page — Complete Rebuild Spec

## Design Philosophy
Build like Anthropic × Stripe. Each section makes ONE point. Show, don't tell.
Every pixel must feel intentional. Less content, more impact. Premium = restraint.

## Design Tokens

### Colors
```css
:root {
  --bg: #F4F0E8;           /* warm cream — primary bg */
  --bg-alt: #FDFBF8;       /* slightly lighter cream — alternate sections */
  --bg-dark: #0F172A;      /* slate-900 — dark sections (NOT pure black) */
  --text: #1A1A1A;         /* near-black */
  --text-2: #6B6B6B;       /* secondary gray */
  --text-3: #9B9B9B;       /* tertiary */
  --accent: #1E40AF;       /* deep blue — buttons, links, highlights */
  --accent-hover: #1E3A8A; /* darker blue — hover states */
  --accent-light: #DBEAFE; /* blue-100 — badges, tints */
  --border: #E5E0D8;       /* warm border */
  --card-bg: #FFFFFF;       /* white cards */
  --card-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.03);
  --card-shadow-hover: 0 2px 8px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.05);
}
```

### Typography
```css
/* Font stack: Inter for body, Instrument Serif for display headlines */
--font-display: 'Instrument Serif', Georgia, serif;
--font-body: 'Inter', -apple-system, sans-serif;

/* Scale */
--text-hero: clamp(48px, 5.5vw, 72px);  /* Hero H1 */
--text-h2: clamp(32px, 3.5vw, 48px);    /* Section headlines */
--text-h3: clamp(20px, 2vw, 24px);      /* Card/subsection titles */
--text-body-lg: 18px;                     /* Lead paragraphs */
--text-body: 16px;                        /* Body text */
--text-small: 14px;                       /* Secondary text */
--text-label: 12px;                       /* Eyebrow labels — uppercase, tracked */

/* Weights */
--weight-regular: 400;
--weight-medium: 500;
--weight-semibold: 600;
```

### Spacing System
```css
/* Consistent vertical rhythm */
--space-section: clamp(100px, 12vw, 160px);  /* Between sections */
--space-block: 64px;                           /* Between major blocks within a section */
--space-element: 24px;                         /* Between related elements */
--space-tight: 12px;                           /* Between label and title */

/* Container */
--container: 1200px;      /* max-width */
--container-narrow: 800px; /* for text-heavy sections */
--gutter: 24px;            /* side padding */
```

### Micro-interactions
```css
/* Transitions — subtle, not flashy */
--transition-fast: 150ms ease;
--transition-normal: 250ms ease;
--transition-slow: 400ms cubic-bezier(0.16, 1, 0.3, 1);

/* Button hover: opacity change ONLY (Anthropic style). No translateY, no box-shadow change */
button:hover { opacity: 0.85; }

/* Card hover: subtle shadow lift */
.card:hover { box-shadow: var(--card-shadow-hover); }

/* Link hover: underline opacity */
a:hover { text-decoration-color: currentColor; }
```

---

## Page Structure — 9 Sections (down from 14)

### 1. NAVIGATION
```
Layout: Sticky top, full-width
Height: 64px
Structure: [Logo] ————— [Features] [Docs] [Pricing] [GitHub ↗] ———— [Get Started →]

Logo: "◆ WebPeel" — 16px, weight 600, tracking -0.01em
     ◆ = deep blue accent. Wordmark = --text color.
Links: 14px, weight 400, --text color, 32px gap
CTA: "Get Started" — bg: --accent, color: white, border-radius: 6px, 
     padding: 8px 20px, 14px weight 500
Background: transparent (scrolls to --bg with blur on scroll)
Border: none (NO bottom border — Anthropic style)
Mobile: hamburger at 768px
```

### 2. HERO — "Give your AI the entire web."
```
Layout: Two columns, 55% / 45%, vertically centered
Padding: 140px top, 100px bottom
Max-width: var(--container)

LEFT COLUMN:
├── Eyebrow badge: "Open Source · 500 free fetches/week"
│   Style: inline-flex, bg: --accent-light, color: --accent, 
│   12px weight 500, padding: 4px 12px, border-radius: 100px
│   Gap: 24px below
│
├── H1: "Give your AI" (line 1)
│       "the entire web." (line 2, color: --accent)
│   Font: var(--font-display), var(--text-hero), weight 400
│   line-height: 1.08, letter-spacing: -0.03em
│   Gap: 24px below
│
├── Subhead: "One API call. Any page. Structured data back.
│            Built for agents that need to read the web."
│   Font: var(--text-body-lg), weight 400, color: --text-2
│   line-height: 1.6, max-width: 480px
│   Gap: 32px below
│
├── CTA row: [Get Started Free →] [View Docs]
│   Primary: bg --accent, color white, 16px weight 500, 
│            padding: 14px 28px, border-radius: 8px
│   Secondary: color --text, 16px weight 500, underline on hover
│   Gap between: 16px
│
└── Social proof: "Trusted by 200+ developers" + tiny logo row
    Style: 14px, color: --text-3, margin-top: 48px
    Logos: 5 grayscale tool logos (LangChain, OpenClaw, Cursor, etc.)
    Logo height: 20px, gap: 24px, opacity: 0.5

RIGHT COLUMN:
├── Terminal mockup card
│   Background: #0F172A (slate-900)
│   Border-radius: 16px
│   Box-shadow: 0 0 0 1px rgba(255,255,255,0.06),
│               0 8px 40px rgba(30,64,175,0.15),
│               0 32px 80px rgba(0,0,0,0.12)
│   Padding: 0 (chrome at top, content padded)
│   
│   ├── Chrome bar: 48px height, bg: #1E293B
│   │   Three dots (12px circles): #EF4444, #F59E0B, #22C55E
│   │   Tab: "Terminal" — 13px, color: rgba(255,255,255,0.6)
│   │   
│   └── Content: padding 24px
│       Font: 'JetBrains Mono', monospace, 14px, line-height 1.7
│       Three example commands with real output:
│       
│       $ webpeel "https://stripe.com" --readable
│       → # Stripe | Financial Infrastructure...
│       → 2,847 words · 12s read · 4 images
│       
│       $ webpeel search "best react frameworks 2026"  
│       → 1. Next.js 15 — The React Framework...
│       → 2. Remix 3.0 — Full Stack Web...
│       
│       Colors: prompt ($) = --accent (blue), 
│               command = #E2E8F0, 
│               output = #94A3B8,
│               highlight = #60A5FA
│   
│   Transform: perspective(1200px) rotateY(-2deg) rotateX(1deg)
│   /* Subtle 3D tilt — gives depth without being gimmicky */

MOBILE (< 768px):
- Stack vertically: headline → subhead → CTAs → terminal
- Terminal: full-width, no rotation
- H1: clamp handles sizing down to 48px
- Padding: 100px top, 60px bottom
```

### 3. HOW IT WORKS — Three Steps
```
Layout: Three columns, equal width
Padding: var(--space-section)
Background: var(--bg-alt)
Max-width: var(--container)

Section header:
├── Eyebrow: "HOW IT WORKS" — 12px, uppercase, weight 600, 
│   color: --text-3, letter-spacing: 0.08em
├── H2: "Three lines to any page."
│   Font: var(--font-display), var(--text-h2), weight 400
└── Gap: var(--space-block) below header

Three columns (gap: 48px):
Each column:
├── Step number: "01" / "02" / "03"
│   Font: 14px monospace, color: --accent, weight 600
│   Border-bottom: 2px solid --accent, width: 32px
│   Padding-bottom: 12px, margin-bottom: 24px
│
├── Title: "Install" / "Fetch" / "Integrate"
│   Font: var(--text-h3), weight 500, color: --text
│   Gap: 12px below
│
├── Description: 2-3 lines
│   Font: var(--text-body), color: --text-2, line-height: 1.6
│   Gap: 20px below
│
└── Code block: dark mini terminal
    Background: #0F172A, border-radius: 8px, padding: 16px
    Font: 13px monospace, color: #E2E8F0
    
    Step 1: npm install -g webpeel
    Step 2: webpeel "https://example.com" --readable
    Step 3: import { peel } from 'webpeel'
            const page = await peel('https://...')

MOBILE: Stack to single column. Full width each step.
```

### 4. THE SUPERPOWER — Why WebPeel (Dark section)
```
Layout: Full-bleed dark background
Background: var(--bg-dark) — #0F172A
Padding: var(--space-section)
Max-width: var(--container-narrow) for text, full for bg

Structure:
├── Eyebrow: "THE DIFFERENCE" — 12px, uppercase, color: #60A5FA
│
├── H2: "Other tools fetch pages." (line 1, color: white)
│       "WebPeel reads them." (line 2, color: #60A5FA)
│   Font: var(--font-display), var(--text-h2), weight 400
│   Max-width: 600px
│   Gap: 32px below
│
├── Body: "Cloudflare blocks? We bypass them. JavaScript renders?
│         We execute it. Anti-bot detection? We evade it. WebPeel
│         doesn't just request pages — it gets through."
│   Font: var(--text-body-lg), color: rgba(255,255,255,0.7)
│   Max-width: 560px, line-height: 1.7
│   Gap: 48px below
│
└── Stat row: Three inline stats
    Layout: flex, gap: 64px
    Each stat:
    ├── Number: "99.7%" / "50ms" / "18"
    │   Font: 36px, weight 600, color: white
    └── Label: "bypass rate" / "avg response" / "MCP tools"
        Font: 14px, color: rgba(255,255,255,0.5)
    
    Divider: 1px vertical line between stats, 
             color: rgba(255,255,255,0.1), height: 48px

MOBILE: Stats stack to 2-column grid, then single column.
```

### 5. FEATURES — Three hero features (NOT a grid)
```
Layout: Three stacked feature blocks, alternating alignment
Padding: var(--space-section)
Background: var(--bg)

IMPORTANT: Each feature gets its own TWO-COLUMN block.
NOT a card grid. Each feature is a full-width section.

Feature 1: "Content Extraction" — text left, visual right
├── Left (50%):
│   ├── Label: "01" — 14px monospace, color: --accent
│   ├── H3: "Raw HTML in. Clean markdown out."
│   │   Font: var(--text-h3), weight 500
│   ├── Body: "Readability extraction, noise removal, and
│   │         semantic structuring. Get the content your
│   │         agent needs, nothing it doesn't."
│   │   Font: var(--text-body), color: --text-2, line-height: 1.7
│   └── Detail list (optional): 
│       "✓ Readability + custom selectors"
│       "✓ Auto-removes nav, ads, sidebars"
│       "✓ Structured metadata extraction"
│       Font: 14px, color: --text-2
│
└── Right (50%): Before/After card
    Card: white bg, border-radius: 12px, var(--card-shadow)
    Shows raw HTML → clean markdown transformation
    Tabs at top: [HTML] [Markdown] with toggle

Feature 2: "Anti-Bot Bypass" — visual left, text right (FLIPPED)
├── Left (50%): Terminal showing Cloudflare bypass
│   Dark card showing:
│   $ webpeel "https://protected-site.com"
│   ⚡ Cloudflare detected → stealth mode
│   ✓ 2,847 words extracted
│
└── Right (50%):
    ├── Label: "02"
    ├── H3: "Gets through when others get blocked."
    └── Body: "CycleTLS fingerprinting, stealth browser,
              residential proxy rotation. Sites that return
              403 to everyone else return content to you."

Feature 3: "MCP + Integrations" — text left, visual right
├── Left (50%):
│   ├── Label: "03"
│   ├── H3: "Plugs into every AI framework."
│   └── Body: "Native MCP server, LangChain loader,
│             LlamaIndex integration, REST API. Works
│             with Claude, GPT, Cursor, and any agent."
│
└── Right (50%): Integration grid
    Small logos/icons: Claude, GPT, LangChain, Cursor, 
    OpenClaw, Windsurf — in a clean 3x2 mini grid
    Each: 40px icon, grayscale, subtle border card

Gap between features: var(--space-block) (64px)

MOBILE: Each feature stacks vertically (text → visual).
Always text-first on mobile regardless of desktop order.
```

### 6. PERFORMANCE — Benchmark comparison
```
Layout: Two columns — chart left, numbers right
Padding: var(--space-section)
Background: var(--bg-alt)
Max-width: var(--container)

LEFT (55%):
├── Eyebrow: "PERFORMANCE"
├── H2: "Fast where it counts."
│   Font: var(--font-display), var(--text-h2)
├── Body: "Speed matters for agents running thousands
│         of fetches. WebPeel optimizes every millisecond."
│   Font: var(--text-body), color: --text-2
│   Gap: 40px below
│
└── Horizontal bar chart (CSS only, no JS library):
    Three bars comparing WebPeel vs Firecrawl vs web_fetch
    
    "Content completeness"
    WebPeel  ████████████████████  98%  (blue bar)
    Firecrawl ████████████████     82%  (gray bar)
    web_fetch ███████████          56%  (gray bar)
    
    "Protected site success"
    WebPeel  ████████████████████  99.7%
    Firecrawl ████████████         65%
    web_fetch ███████              35%
    
    Bar style: height 28px, border-radius: 4px
    WebPeel bar: bg --accent
    Others: bg #E5E0D8
    Labels: 14px, color: --text-2

RIGHT (45%):
└── Three stat cards (stacked vertically, gap: 16px)
    Each card: white bg, border-radius: 8px, padding: 24px
    ├── Number: 36px, weight 600, color: --text
    ├── Label: 14px, color: --text-2
    └── Trend: small green/blue indicator

    Card 1: "1,322ms" / "avg extraction time"
    Card 2: "2-3×" / "more content than web_fetch"
    Card 3: "500+" / "sites tested"

MOBILE: Stack everything vertically.
```

### 7. PRICING — Three clean cards
```
Layout: Three columns, centered
Padding: var(--space-section)
Background: var(--bg)
Max-width: 960px (narrower than container)

Section header: centered
├── Eyebrow: "PRICING"
├── H2: "Start free. Scale when ready."
└── Subhead: "All features on every plan. No feature-gating."
    Gap: var(--space-block) below

Three cards (gap: 24px):
Each card:
├── Border: 1px solid var(--border)
├── Border-radius: 12px
├── Padding: 32px
├── Background: var(--card-bg)
│
├── Plan name: "Free" / "Pro" / "Max"
│   Font: 14px, weight 600, uppercase, letter-spacing: 0.04em
│   Color: --text-2
│
├── Price: "$0" / "$9" / "$29"
│   Font: 40px, weight 600, color: --text
│   "/month" — 16px, weight 400, color: --text-3
│
├── Description: one line
│   "500 fetches per week" / "1,250 per week" / "6,250 per week"
│   Font: 15px, color: --text-2
│   Gap: 24px below
│
├── Divider: 1px solid var(--border)
│   Gap: 24px below
│
├── Feature list: 5-6 items
│   Each: "✓ Feature name" — 14px, color: --text-2
│   Check mark: color --accent
│   Gap between items: 12px
│
└── CTA button: full-width at bottom
    Free: outlined (border: 1px --border, color: --text)
    Pro: filled (bg: --accent, color: white) — FEATURED
    Max: outlined

Featured card (Pro):
├── Border: 2px solid var(--accent)  (not 1px)
├── Badge: "Most Popular" — inline, bg: --accent, color: white,
│   12px weight 600, padding: 4px 12px, border-radius: 100px
│   Position: top-right of card, overlapping border slightly
└── Slight scale: transform: scale(1.02) — barely perceptible

MOBILE: Stack vertically, Pro card first (reorder with CSS order).
```

### 8. FAQ — Accordion
```
Layout: Single column, centered
Padding: var(--space-section)
Background: var(--bg-alt)
Max-width: var(--container-narrow) (800px)

Section header: centered
├── H2: "Questions & answers"
└── Gap: var(--space-block) below

6-8 FAQ items:
Each item:
├── Border-bottom: 1px solid var(--border)
├── Padding: 24px 0
├── Question: 16px, weight 500, color: --text
│   Clickable row: flex, justify-content: space-between
│   Right icon: + / − — 20px, color: --text-3, transition: rotate
├── Answer (collapsed by default):
│   16px, color: --text-2, line-height: 1.7
│   max-height: 0 → auto on open, transition: 300ms ease
│   padding-top: 16px (when open)

FAQ content:
1. "What is WebPeel?" — Web content extraction API for AI agents...
2. "How does it handle protected sites?" — CycleTLS, stealth browser...
3. "Is there a free tier?" — Yes, 500 fetches/week, no credit card...
4. "How does it compare to Firecrawl?" — More content, better bypass...
5. "Can I self-host?" — CLI runs locally, MCP server for agents...
6. "What formats does it return?" — Markdown, text, HTML, structured JSON...

ANIMATION: 
- Accordion: max-height transition + opacity
- Plus/minus: 180deg rotation
- Only ONE open at a time (collapse others)
```

### 9. FINAL CTA + FOOTER
```
CTA Section:
├── Full-bleed dark: var(--bg-dark)
├── Padding: 100px 0
├── Centered, max-width: 600px
│
├── H2: "Ready to give your AI the web?"
│   Font: var(--font-display), 36px, weight 400, color: white
├── Body: "Start with 500 free fetches. No credit card required."
│   Font: 16px, color: rgba(255,255,255,0.6)
│   Gap: 32px below
├── Install command: 
│   Dark card with: curl -fsSL https://webpeel.dev/install.sh | bash
│   Copy button on right
│   Gap: 16px below
└── CTA button: "Get Started Free →"
    bg: --accent, color: white, centered

Footer:
├── Background: var(--bg-dark) (continuous from CTA)
├── Border-top: 1px solid rgba(255,255,255,0.08)
├── Padding: 48px 0
├── Layout: 4 columns
│   Col 1: Logo + tagline "Web extraction for AI agents"
│   Col 2: Product — CLI, API, MCP, Dashboard
│   Col 3: Resources — Docs, Blog, Changelog, Status
│   Col 4: Company — GitHub, Discord, Contact
├── Links: 14px, color: rgba(255,255,255,0.5), hover: white
└── Bottom bar: "© 2026 WebPeel" + "Terms" + "Privacy"
    Font: 13px, color: rgba(255,255,255,0.3)
```

---

## Animation Strategy

### Scroll Reveal (IntersectionObserver — NO libraries)
```javascript
// Elements start visible (opacity: 1) — NEVER opacity: 0 as default
// Animation adds subtle entrance, but content is ALWAYS accessible

.reveal {
  opacity: 1; /* ALWAYS visible by default */
}

.reveal.animate {
  animation: fadeSlideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

@keyframes fadeSlideUp {
  from { opacity: 0.3; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

// Stagger children: delay: 0.1s per child
// Threshold: 0.15 (trigger when 15% visible)
// rootMargin: "0px 0px -60px 0px" (trigger slightly early)
```

### Counter Animation (Numbers in stats)
```javascript
// Only for stat numbers. Count up from 0 on scroll into view.
// Duration: 1.5s, easing: ease-out
// Use requestAnimationFrame, not setInterval
```

### Terminal Typing Effect (Hero only)
```javascript
// Optional enhancement: type out terminal commands one char at a time
// Speed: 40ms per char for commands, instant for output
// Cursor: blinking | character, 800ms blink interval
// Trigger: on page load, 500ms delay
```

---

## Mobile Breakpoints
```css
/* Tablet */
@media (max-width: 1024px) {
  /* Two-column features → stack */
  /* Reduce section padding to 80px */
  /* Container gutter: 32px */
}

/* Mobile */
@media (max-width: 768px) {
  /* Everything single column */
  /* H1: 48px (clamp handles this) */
  /* Section padding: 64px */
  /* Container gutter: 20px */
  /* Nav → hamburger menu */
  /* Pricing cards → vertical stack, Pro first */
  /* Stats row → 2-column grid */
  /* Terminal: no 3D rotation */
  /* Feature visuals: below text always */
}

/* Small mobile */
@media (max-width: 480px) {
  /* H1: 36px minimum */
  /* Section padding: 48px */
  /* Pricing cards: tighter padding (24px) */
  /* Stats: single column */
}
```

---

## Content Guidelines
- **Headlines**: Instrument Serif, weight 400 (light serif = editorial quality)
- **No exclamation marks** in headlines (calm confidence, not excitement)
- **Subheads max 2 lines** on desktop
- **Feature descriptions max 3 lines**
- **Zero marketing fluff**: "enterprise-grade", "cutting-edge", "revolutionary" = BANNED
- **Show real numbers**: actual benchmark data, real output
- **Terminal demos use REAL commands** that actually work

## Files To Reference
- Fonts: Google Fonts — Inter (400, 500, 600) + Instrument Serif (400)
- JetBrains Mono for code (400, 600)
- Icons: inline SVG only — no icon libraries
- Images: zero external images. Everything is CSS/SVG/code.

## What NOT To Include
- No video embeds or placeholders
- No testimonial section (we don't have real ones yet)
- No "trusted by" logos (we don't have permission yet)
- No AI-generated illustrations
- No ScrollTrigger or GSAP
- No horizontal scroll sections
- No particle effects or canvas animations
- No comparison table (removed — it's defensive)
