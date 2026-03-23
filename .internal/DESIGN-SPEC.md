# WebPeel Design Spec — Anthropic-Quality Redesign

## Design Philosophy
"How do I make them feel this is inevitable?" — Not conversion-optimized SaaS, but serious infrastructure that speaks for itself.

## Color Palette (derived from Anthropic study)

```css
:root {
  /* Backgrounds */
  --bg: #F5F2EC;              /* Warm cream (main page) */
  --bg-alt: #FFFFFF;           /* White (alternating sections) */
  --bg-dark: #1A1A18;         /* Near-black footer/dark sections */
  --bg-code: #1C1C1A;         /* Terminal/code blocks */
  
  /* Text */
  --text: #1A1A18;            /* Primary - warm near-black */
  --text-2: #5A5A55;          /* Secondary body */
  --text-3: #8A8A82;          /* Muted/caption */
  --text-inv: #F5F2EC;        /* On dark backgrounds */
  
  /* Accent — ONE color, used sparingly (3x per page max) */
  --accent: #D4623A;          /* Warm coral (CTAs only) */
  --accent-hover: #C05530;    /* Slightly darker coral */
  
  /* Borders */
  --border: rgba(0,0,0,0.08); /* Ultra-subtle */
  --border-card: #E0DDD8;     /* Card borders */
  
  /* Surfaces */
  --surface: #FFFFFF;          /* Card backgrounds */
  --surface-muted: #F5F3EF;   /* Subtle row alternating */
}
```

## Typography

```css
/* Headline serif — Instrument Serif (already have it) */
h1, .hero-headline {
  font-family: 'Instrument Serif', serif;
  font-weight: 400;          /* Light, NOT bold */
  font-size: clamp(48px, 6vw, 72px);
  line-height: 1.06;
  letter-spacing: -0.02em;
  color: var(--text);
}

h2, .section-title {
  font-family: 'Instrument Serif', serif;
  font-weight: 400;
  font-size: clamp(32px, 4vw, 48px);
  letter-spacing: -0.02em;
  line-height: 1.15;
}

h3, .card-title {
  font-family: 'Inter', sans-serif;
  font-weight: 500;          /* Medium, not bold */
  font-size: 20px;
  letter-spacing: -0.01em;
}

body, p {
  font-family: 'Inter', sans-serif;
  font-weight: 400;
  font-size: 17px;
  line-height: 1.65;
  color: var(--text-2);
}

.caption, .small {
  font-size: 13px;
  color: var(--text-3);
  letter-spacing: 0.01em;
}
```

## Spacing (generous — "the space IS the luxury signal")

```css
.section { padding: 140px 48px; }
.hero { padding-top: 180px; padding-bottom: 120px; }
.section-gap { margin-bottom: 120px; }
.card-padding { padding: 28px 32px; }
.grid-gap { gap: 24px; }
.container { max-width: 1200px; margin: 0 auto; }
.narrow { max-width: 760px; }
```

## Navigation

```css
nav {
  background: rgba(245, 242, 236, 0.85);
  backdrop-filter: blur(12px);
  border-bottom: none;          /* NO border */
  padding: 20px 48px;
  position: sticky; top: 0;
}

.nav-link {
  font-size: 14px;
  font-weight: 400;
  color: var(--text);
  /* No hover background — just color shift */
}

.nav-cta {
  background: var(--bg-dark);   /* Black, NOT accent coral */
  color: #FFFFFF;
  border-radius: 4px;           /* Nearly square */
  padding: 8px 18px;
  font-size: 14px;
  font-weight: 500;
}
```

## Buttons

```css
.btn-primary {
  background: var(--bg-dark);   /* Black buttons like Anthropic/Vercel */
  color: #FFFFFF;
  border-radius: 4px;           /* Nearly square, architectural */
  padding: 12px 28px;
  font-size: 15px;
  font-weight: 500;
  letter-spacing: 0.01em;
  border: none;
  transition: opacity 0.15s ease;
}
.btn-primary:hover { opacity: 0.85; }

.btn-secondary {
  background: transparent;
  color: var(--text);
  border: 1px solid var(--border-card);
  border-radius: 4px;
  padding: 12px 28px;
}

/* Coral accent button — ONLY for hero CTA, used once per page */
.btn-accent {
  background: var(--accent);
  color: #FAF9F7;
  border-radius: 4px;
  padding: 14px 32px;
  font-weight: 400;             /* NOT bold */
}
```

## Cards & Surfaces

```css
.card {
  background: var(--surface);
  border: 1px solid var(--border-card);
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
  padding: 28px;
}

.card-featured {
  background: var(--bg-dark);
  color: var(--text-inv);
  border-radius: 12px;
}

.terminal-card {
  background: var(--bg-code);
  border-radius: 12px;
  font-family: 'JetBrains Mono', monospace;
}
```

## Badges & Pills

```css
.badge {
  background: var(--surface-muted);
  color: var(--text-2);
  border: 1px solid var(--border-card);
  border-radius: 999px;
  padding: 4px 14px;
  font-size: 13px;
  font-weight: 500;
}

.badge-active {
  background: var(--bg-dark);
  color: #FFFFFF;
}
```

## Section Transitions
- NO gradient transitions between sections
- Alternate cream (#F5F2EC) and white (#FFFFFF) backgrounds
- ~120px whitespace between sections
- Consider small decorative SVG divider icons (thin line illustration style)

## Dark Sections
- Full-bleed only (no border-radius on full-width dark sections)
- Used sparingly: footer + ONE accent section max
- Text on dark uses cream tones, not pure white

## Animations
- Extremely restrained — functional, not decorative
- Section reveals: `opacity: 0→1, translateY(20px→0), 400ms ease`
- Button hover: `opacity: 0.85, 150ms`
- Nav on scroll: add subtle backdrop blur
- NO parallax, no looping animations, no dramatic entrances
- GSAP is fine for scroll triggers but keep it subtle

## Anti-Patterns (DO NOT)
- ❌ Multiple accent colors
- ❌ Colored CTA buttons in nav (use black)
- ❌ Bold weight on headlines (use 400)
- ❌ Border-radius on full-width sections
- ❌ Gray placeholder boxes
- ❌ Rainbow bar charts with 5+ colors
- ❌ Two competing CTAs side by side
- ❌ Italic on product name in hero
- ❌ Border on nav bar
- ❌ Pill-shaped primary buttons
- ❌ Feature lists with checkmark icons

## Reference
- Studied: claude.com/product/overview, /claude-code, /cowork, /pricing, /platform/api, /solutions/agents
- Screenshots saved in workspace root (anthropic-*.png)
