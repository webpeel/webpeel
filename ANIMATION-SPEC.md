# WebPeel Site Animation Spec
## Based on Remotion tutorial principles: Scene-based prompts with timing + UI state

### Principle: Plan animations as SCENES with exact timing, state, and effects

---

## Scene 1: Hero Section (on page load)

### Timing: 0ms → 2500ms

**State 0 (0ms):** Page loads. All content is in the DOM and VISIBLE (opacity: 1).

**State 1 (0ms → 400ms):** Hero content fades in with subtle upward motion.
- Badge: opacity 0.3→1, translateY(12px→0). Duration: 400ms. Easing: cubic-bezier(0.16, 1, 0.3, 1).
- Delay: 0ms

**State 2 (100ms → 500ms):** Headline appears.
- H1 line 1 "Give your AI": opacity 0.3→1, translateY(16px→0). Duration: 400ms. Delay: 100ms.
- H1 line 2 "the entire web.": opacity 0.3→1, translateY(16px→0). Duration: 400ms. Delay: 200ms.

**State 3 (300ms → 700ms):** Subhead + CTAs appear.
- Subhead: opacity 0.3→1, translateY(12px→0). Duration: 350ms. Delay: 300ms.
- CTA buttons: opacity 0.3→1, translateY(8px→0). Duration: 300ms. Delay: 450ms.

**State 4 (600ms → 1000ms):** Terminal card slides up.
- Terminal: opacity 0→1, translateY(40px→0). Duration: 500ms. Delay: 600ms. 
- Shadow: starts at 0 opacity, fades to full.

**State 5 (1000ms → 2500ms):** Terminal typing animation.
- Cursor blinks at position 0.
- Types first command: "webpeel "https://stripe.com" --readable" at 30ms per char.
- Output appears instantly after command finishes.
- 600ms pause.
- Types second command at 30ms per char.
- Output appears instantly.
- 600ms pause.  
- Types third command.
- Final output + ✓ checkmark.
- Cursor keeps blinking at end.

**CRITICAL:** Content must be VISIBLE even if JS fails. The animation starts from opacity: 0.3 (barely visible but there) and goes to 1. If JS doesn't load, CSS has opacity: 1 as default.

---

## Scene 2: Scroll Reveals (on scroll, IntersectionObserver)

### Timing: Each section triggers independently when 15% visible

**Effect per section:**
- Content: opacity 0.4→1, translateY(20px→0). Duration: 600ms.
- Easing: cubic-bezier(0.16, 1, 0.3, 1)
- Children stagger: 80ms delay between siblings
- rootMargin: "0px 0px -40px 0px"

**Sections that get this treatment:**
1. "Works With" logos
2. "How It Works" steps (stagger: each step)
3. Superpower section (headline → body → stats stagger)
4. Each Feature block
5. Performance section
6. Pricing cards (stagger: each card)
7. FAQ section header

---

## Scene 3: Stats Counter (on scroll into view)

### Timing: 1200ms total, ease-out

**Effect:**
- Numbers count from 0 to target value
- requestAnimationFrame based
- Easing: decelerating (fast at start, slows down)
- Runs once per element

**Stats:**
- 99.7% → counts from 0.0 to 99.7
- 50ms → counts from 0 to 50
- 500+ → counts from 0 to 500, then "+" appears

---

## Scene 4: Bar Chart Animation (on scroll into view)

### Timing: 800ms per bar, 100ms stagger

**Effect:**
- Bar width starts at 0%, transitions to target width
- Easing: cubic-bezier(0.16, 1, 0.3, 1)
- WebPeel bar (blue) animates first, then competitors
- Each bar group staggers by 200ms

---

## Scene 5: Pricing Card Hover

### Timing: 200ms

**Effect on hover:**
- Card: translateY(-4px), box-shadow increases
- Featured card: glow effect intensifies
- CTA button: opacity 0.85
- Easing: cubic-bezier(0.16, 1, 0.3, 1)

---

## Scene 6: Nav Scroll

### Timing: 200ms

**Effect:**
- On scroll > 20px: nav gets background: rgba(244,240,232,0.9), backdrop-filter: blur(12px)
- Transition: 200ms ease

---

## Implementation Rules

1. **CSS animations for hover/transition states** — no JS needed
2. **IntersectionObserver for scroll triggers** — lightweight, no library
3. **requestAnimationFrame for counters** — smooth 60fps
4. **Typing effect with setTimeout chain** — simple, reliable
5. **prefers-reduced-motion:** Skip all animations, show final state
6. **NO external animation libraries** — no GSAP, no Framer Motion, no Lottie
7. **All content ALWAYS in the DOM** — animations are enhancement only
8. **Start from opacity 0.3, not 0** — content visible even mid-animation
