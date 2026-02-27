# WebPeel Landing Page — Full Restructure Spec

## Narrative Arc (Anthropic-style)
```
HOOK → WHO IT'S FOR → HOW IT WORKS → SHOW IT → 
SOCIAL PROOF → FEATURES → PERFORMANCE → INTEGRATION → 
USE CASES → TRUST → PRICING → FAQ → FINAL CTA → FOOTER
```

## New Section Order (14 sections)

### 1. HERO (keep, refine)
- Headline: "Give your AI the entire web."
- Subhead: "Turn any URL into clean, structured content — ready for your AI agent in milliseconds."
- Install command tabs (keep — this is good, devs love curl|bash)
- ONE primary CTA: "Get Started Free" (coral)
- ONE text link: "View Docs →"
- Remove the trust checkmarks row — feels desperate. Badge is enough.
- Remove the video section after hero — it's a placeholder video, adds nothing.

### 2. WHO IT'S FOR (NEW — replace current demo-video section)
Light cream background. Centered, narrow width (640px max).
```html
<section style="padding: 100px 0; text-align: center;">
  <div class="container" style="max-width: 640px;">
    <p class="section-eyebrow">BUILT FOR</p>
    <h2 class="serif">Developers building with AI.<br>Teams who need web data.</h2>
    <p>Whether you're building an AI agent that needs real-time web access, or a team 
    that needs structured data from any URL — WebPeel handles the infrastructure so you 
    don't have to.</p>
  </div>
</section>
```

### 3. HOW IT WORKS — 3 Steps (refine existing "how" section)
White background. 3-column grid, clean numbered steps.
```
Step 1: Connect        Step 2: Fetch           Step 3: Build
One npm install or     Send any URL.           Clean markdown, metadata,
API key. Works with    WebPeel handles          structured data — ready
Claude, Cursor,        Cloudflare, JS           for your AI agent.
any MCP client.        rendering, anti-bot.
```
Keep it dead simple. 3 cards, each with a number, title, one sentence. No decorative icons.

### 4. TERMINAL DEMO (move from hero to here)
Dark full-bleed section. Move the animated terminal here — it makes more sense AFTER explaining what the product does. Keep the terminal animation exactly as-is.

### 5. SOCIAL PROOF (NEW — critical missing piece)
Light cream background. This is the "who else uses this" moment.
```html
<section style="padding: 100px 0;">
  <div class="container" style="max-width: 800px; text-align: center;">
    <p class="section-eyebrow">TRUSTED BY DEVELOPERS</p>
    <h2 class="serif">Open source. Battle-tested.</h2>
    <div class="stats-row">
      <!-- Keep existing stats: downloads, tools, tests, etc -->
    </div>
    <div class="trust-logos" style="margin-top: 48px;">
      <!-- Show MCP client logos in grayscale: Claude, Cursor, VS Code, Windsurf, etc -->
      <!-- These are "works with" but framed as trust signals -->
    </div>
  </div>
</section>
```
Move the existing stats row here. Add the MCP client logos (already exist in the integrations section) as grayscale trust signals.

### 6. FEATURES GRID (keep, move earlier)
White background. "Everything your agent needs" — the existing feature cards grid. Keep as-is but ensure it comes AFTER social proof. Already well-structured.

### 7. MCP TOOLS (keep, refine)
Dark full-bleed section. The existing MCP section showing 18 tools + client compatibility. This is great content — keep it but make sure it flows naturally after the features grid. It's the "deep dive into capabilities" section.

### 8. PERFORMANCE / BENCHMARKS (merge existing sections)
Light cream background. MERGE the current "benchmarks" section and the "how it works" code section into one performance story:
- Headline: "The fastest path to any page"
- Show the benchmark bars (WebPeel vs competitors)
- Then show the code snippet demonstrating the 3 escalation modes
- One cohesive performance narrative, not two separate sections

### 9. COMPARISON TABLE (keep, simplify)
White background. "Why WebPeel" — keep the feature comparison table but remove the redundancy with benchmarks. If benchmarks show speed, the comparison table shows features. No overlap.

### 10. USE CASES (NEW — replace "Two Ways" section)
Light cream background. 2-3 story-driven cards instead of the generic "For Agents / For Humans" split:
```html
<section style="padding: 120px 0;">
  <div class="container">
    <p class="section-eyebrow">USE CASES</p>
    <h2 class="serif" style="text-align: center;">Built for what you're building</h2>
    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 24px; margin-top: 48px;">
      <div class="card">
        <h3>AI Agents</h3>
        <p>Give your agent real-time web access. Fetch pages, extract data, search — 
        all through MCP or API. Claude, Cursor, and any MCP client supported.</p>
      </div>
      <div class="card">
        <h3>Research & Analysis</h3>
        <p>Deep research across multiple sources. YouTube transcripts, Reddit threads, 
        news articles — structured and ready for your pipeline.</p>
      </div>
      <div class="card">
        <h3>Data Pipelines</h3>
        <p>Automated web data at scale. Scheduled crawls, structured extraction, 
        clean markdown. No browser infrastructure to maintain.</p>
      </div>
    </div>
  </div>
</section>
```

### 11. INTEGRATION CODE BLOCK (refine existing)
White background. Keep the existing code section showing API/SDK usage. Clean, focused, one code block.

### 12. PRICING (keep, simplify)
Light cream background. Keep the 3-tier pricing cards. REMOVE the detailed pricing table below — it's redundant. The FAQ can handle edge case pricing questions.

### 13. FAQ (keep as-is)
White background. Accordion FAQ. Already well-structured.

### 14. FINAL CTA
Dark full-bleed section.
```html
<section style="background: var(--bg-dark); padding: 120px 0; text-align: center;">
  <div class="container" style="max-width: 640px;">
    <h2 class="serif" style="color: #F4F0E8; font-size: clamp(32px, 4vw, 48px);">
      Ready to give your AI the entire web?
    </h2>
    <p style="color: #A09B93; margin: 20px 0 36px;">
      500 free fetches per week. No credit card required.
    </p>
    <a href="https://app.webpeel.dev/signup" class="btn btn-primary" 
       style="background: var(--accent); color: #FAF9F7;">Get Started Free</a>
  </div>
</section>
```

### 15. FOOTER (keep as-is)

## Sections to REMOVE
- **Demo video section** (after hero) — placeholder video, adds nothing
- **Playground section** — keep the page but remove from landing page. Link to /playground from nav.
- **Integrations logo grid** — merge logos into Social Proof section
- **"Two Ways" section** — replaced by Use Cases
- **Detailed pricing table** (below pricing cards) — redundant, FAQ handles edge cases

## Sections to MOVE
- **Terminal demo** — from hero to Section 4 (after "how it works")
- **Stats row** — from after MCP section to Section 5 (social proof)
- **Benchmarks** — merge with code section into Performance section

## CSS Rules (already defined in DESIGN-SPEC.md)
- Warm cream `#F4F0E8` / white `#FDFBF8` alternating
- Serif headings weight 400
- 4px button radius, coral accent
- 100-120px section padding
- No GSAP, no JS-dependent visibility
- Section eyebrows: uppercase, letter-spacing 0.1em, font-size 12px, color var(--text-3)

## NEW CSS for section eyebrows
```css
.section-eyebrow {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-3);
  margin-bottom: 16px;
}
```

## Critical Rules for the Agent
1. ALL content must be visible without JavaScript (no opacity:0 that needs JS to reveal)
2. NO GSAP or ScrollTrigger — content is visible by default
3. Keep the CSS fade-up keyframe animation for hero elements only (they have `animation: fade-up ... forwards`)
4. The terminal demo JS animation (typing effect) is fine — it's content-dependent, not visibility-dependent
5. Maintain mobile responsiveness for all new sections
6. Test by viewing the raw HTML in a browser — every section should be visible
