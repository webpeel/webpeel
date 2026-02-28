# WebPeel Browser Extension

> Extract clean, AI-ready content from any webpage — in one click.

Works in **Chrome, Edge, Brave, Arc, Zen** (Manifest V3) and **Firefox** (Manifest V2).

---

## What It Does

WebPeel's browser extension strips the noise (ads, navbars, sidebars, scripts) and gives you the clean article/page content — ready to paste into your AI tool, notes app, or research workflow.

**Two modes:**

| | Free Mode | API Mode |
|---|---|---|
| **Requires** | Nothing | WebPeel API key |
| **Works on** | Static pages, SSR content | Any page incl. SPAs, JS-heavy sites |
| **Extraction** | Client-side (your browser) | Server-side (WebPeel cloud) |
| **Output formats** | Markdown, Plain Text, JSON | Markdown, Plain Text, JSON |
| **Speed** | Instant | ~1-3 seconds |

**Output formats:**
- **Markdown** — headings, bold, links preserved (best for LLMs)
- **Plain Text** — raw clean text, no markup
- **JSON** — structured object with title, content, URL, word count

**Context menu:** Right-click any page → "Extract with WebPeel" → content copied to clipboard instantly.

---

## Install

### Chrome / Edge / Brave / Arc / Zen (Manifest V3)

1. Download or clone this repo
2. Open `chrome://extensions` (or your browser's extension page)
3. Enable **Developer mode** (toggle in top-right)
4. Click **Load unpacked**
5. Select the `extension/` directory (this folder)
6. WebPeel icon appears in the toolbar — pin it for easy access

### Firefox

Firefox requires the Manifest V2 version:

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Navigate to the `extension/` directory
4. Select `manifest-firefox.json`
5. Extension loads (temporary — reloads required after Firefox restart)

For permanent install, the extension must be signed via AMO (Firefox Add-ons). See **Build for Production** below.

---

## Set Up an API Key (Optional)

Without an API key, WebPeel runs in **Free Mode** — client-side extraction, no account needed.

To enable **API Mode** (enhanced extraction for SPAs, JS-heavy sites):

1. Visit [webpeel.dev](https://webpeel.dev) and create an account
2. Generate an API key from your dashboard
3. Click the **⚙️ settings gear** in the WebPeel popup
4. Paste your API key and click **Save**
5. The badge changes from `Free` → `API`

Your key is stored in `chrome.storage.sync` — synced across your signed-in browsers.

---

## Usage

1. Navigate to any webpage
2. Click the **WebPeel icon** in the toolbar
3. Choose your output format (Markdown / Plain Text / JSON)
4. Click **Extract Content**
5. Preview appears — click **Copy to Clipboard**

**Right-click shortcut:**  
Right-click anywhere on the page → **Extract with WebPeel** → content is extracted and copied to clipboard automatically.

---

## Free Mode vs API Mode

### Free Mode (no API key)

Uses a content script injected into the page. It:
1. Finds the main content area (`article`, `main`, `[role=main]`, or `body`)
2. Clones the DOM
3. Removes noise: `<script>`, `<style>`, `<nav>`, `<header>`, `<footer>`, `<aside>`, ads, sidebars, comments
4. Returns the clean `innerText`

**Works great on:** Wikipedia, news sites, blog posts, documentation, any server-rendered page.

**Limitations:** Won't work well on purely client-rendered SPAs (React/Vue/Angular apps) where content is injected after page load, or on pages with aggressive anti-scraping.

### API Mode (API key required)

Sends the URL to the WebPeel API, which:
1. Loads the page in a headless browser (full JS execution)
2. Waits for content to render
3. Applies smart extraction heuristics
4. Returns structured, clean Markdown

**Works on:** Everything — SPAs, dynamic content, JS-heavy pages, redirects.

---

## Build for Production

### Chrome Web Store (zip)

```bash
# From the extension/ directory
cd extension
zip -r ../webpeel-extension.zip . \
  --exclude "*.DS_Store" \
  --exclude "icons/generate-icons.*" \
  --exclude "manifest-firefox.json" \
  --exclude "README.md"
```

Upload `webpeel-extension.zip` to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

### Firefox Add-ons (xpi / AMO)

Firefox uses Manifest V2. Swap the manifest before zipping:

```bash
cd extension
cp manifest-firefox.json manifest.json
zip -r ../webpeel-firefox.xpi . \
  --exclude "*.DS_Store" \
  --exclude "icons/generate-icons.*" \
  --exclude "README.md"
# Restore Chrome manifest
git checkout manifest.json
```

Submit `webpeel-firefox.xpi` to [addons.mozilla.org](https://addons.mozilla.org/developers/).

**Note:** Firefox requires a `browser_specific_settings.gecko.id` in the manifest for signing. This is already set to `webpeel@webpeel.dev` in `manifest-firefox.json`.

---

## Regenerating Icons

Icons are pure-JS generated PNGs (no build tools or npm needed).

```bash
cd extension/icons
node generate-icons.cjs
# Outputs: icon-16.png, icon-32.png, icon-48.png, icon-128.png
```

The generator uses only Node.js built-ins (`zlib`, `fs`, `path`) — no canvas, no sharp, no dependencies.

---

## File Structure

```
extension/
├── manifest.json           Chrome/Edge/Brave/Arc (MV3)
├── manifest-firefox.json   Firefox (MV2)
├── popup/
│   ├── popup.html          Extension popup UI
│   ├── popup.css           Styles (system-ui, #5865F2 accent)
│   └── popup.js            Popup logic (extraction, settings, copy)
├── content/
│   └── content.js          Content script (free mode extraction)
├── background/
│   └── service-worker.js   Background worker (context menu, API relay)
├── icons/
│   ├── icon-16.png
│   ├── icon-32.png
│   ├── icon-48.png
│   ├── icon-128.png
│   └── generate-icons.cjs  Icon generator script
└── README.md               This file
```

---

## Privacy

- No data is collected or sent anywhere in Free Mode
- In API Mode, the URL is sent to `api.webpeel.dev` — content is not stored
- Your API key is stored locally in `chrome.storage.sync` (encrypted by the browser)

---

## License

Part of the WebPeel project. See root `LICENSE` for details.
