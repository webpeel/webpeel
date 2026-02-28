/**
 * WebPeel Extension — popup.js
 * Handles UI state, extraction dispatch, and settings.
 */

/* ── State ──────────────────────────────────────────── */
let currentTab   = null;
let currentFmt   = 'markdown';
let fullContent  = '';   // full extracted content (for copy)
let apiKey       = '';

/* ── DOM refs ───────────────────────────────────────── */
const $ = id => document.getElementById(id);

const modeBadge     = $('modeBadge');
const currentUrl    = $('currentUrl');
const extractBtn    = $('extractBtn');
const resultArea    = $('resultArea');
const errorArea     = $('errorArea');
const errorMsg      = $('errorMsg');
const resultTitle   = $('resultTitle');
const wordCount     = $('wordCount');
const tokenCount    = $('tokenCount');
const resultPreview = $('resultPreview');
const copyBtn       = $('copyBtn');
const copyBtnText   = $('copyBtnText');
const mainPanel     = $('mainPanel');
const settingsPanel = $('settingsPanel');
const settingsBtn   = $('settingsBtn');
const closeSettings = $('closeSettingsBtn');
const apiKeyInput   = $('apiKeyInput');
const saveApiKeyBtn = $('saveApiKey');
const clearApiKeyBtn= $('clearApiKey');
const settingsSaved = $('settingsSaved');
const fmtBtns       = document.querySelectorAll('.fmt-btn');

/* ── Init ───────────────────────────────────────────── */
async function init() {
  // Load API key from storage
  const stored = await storageGet('webpeel_api_key');
  apiKey = stored || '';
  updateModeBadge();

  // Get the active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;
  if (tab?.url) {
    currentUrl.textContent = tab.url;
    currentUrl.title = tab.url;
  } else {
    currentUrl.textContent = 'Unknown page';
    extractBtn.disabled = true;
  }
}

function updateModeBadge() {
  if (apiKey) {
    modeBadge.textContent = 'API';
    modeBadge.classList.add('api');
  } else {
    modeBadge.textContent = 'Free';
    modeBadge.classList.remove('api');
  }
}

/* ── Format toggle ──────────────────────────────────── */
fmtBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    fmtBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFmt = btn.dataset.fmt;

    // Re-render preview in new format if we already have content
    if (fullContent) {
      renderPreview(fullContent, currentFmt);
    }
  });
});

/* ── Extract ────────────────────────────────────────── */
extractBtn.addEventListener('click', async () => {
  if (!currentTab) return;
  setExtracting(true);
  hideResult();
  hideError();

  try {
    let result;
    if (apiKey) {
      result = await extractViaAPI(currentTab.url, currentFmt);
    } else {
      result = await extractViaContentScript(currentTab.id);
    }
    showResult(result);
  } catch (err) {
    showError(err.message || 'Extraction failed. Please try again.');
  } finally {
    setExtracting(false);
  }
});

/* ── Extract via content script (free mode) ─────────── */
async function extractViaContentScript(tabId) {
  const response = await chrome.tabs.sendMessage(tabId, { action: 'extractContent' });
  if (!response || response.error) {
    throw new Error(response?.error || 'Content script did not respond. Try refreshing the page.');
  }
  return response;
}

/* ── Extract via WebPeel API ────────────────────────── */
async function extractViaAPI(url, format) {
  const formatMap = { markdown: 'markdown', text: 'text', json: 'json' };
  const resp = await fetch('https://api.webpeel.dev/v1/fetch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({ url, format: formatMap[format] || 'markdown', render: true }),
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    const msg = body?.error || body?.message || `API error ${resp.status}`;
    throw new Error(msg);
  }

  const data = await resp.json();
  const content = data.content || data.markdown || data.text || '';
  const words = countWords(content);

  return {
    title:       data.title || currentTab?.title || 'Untitled',
    content,
    url,
    wordCount:   words,
    extractedAt: new Date().toISOString(),
  };
}

/* ── Render result ──────────────────────────────────── */
function showResult(data) {
  fullContent = formatContent(data.content, currentFmt);

  resultTitle.textContent = data.title || 'Untitled';

  const wc = data.wordCount ?? countWords(data.content);
  const tc = estimateTokens(data.content);
  wordCount.textContent  = `${wc.toLocaleString()} words`;
  tokenCount.textContent = `~${tc.toLocaleString()} tokens`;

  renderPreview(data.content, currentFmt);
  resultArea.hidden = false;
}

function renderPreview(rawContent, fmt) {
  const formatted = formatContent(rawContent, fmt);
  // Show first 500 chars
  const preview = formatted.length > 500
    ? formatted.slice(0, 500) + '\n\n…[truncated]'
    : formatted;
  resultPreview.textContent = preview;
  fullContent = formatted;
}

function formatContent(content, fmt) {
  if (fmt === 'json') {
    try {
      // If already JSON string, parse+re-stringify for pretty print
      const parsed = JSON.parse(content);
      return JSON.stringify(parsed, null, 2);
    } catch {
      // Wrap as plain content object
      return JSON.stringify({ content }, null, 2);
    }
  }
  if (fmt === 'text') {
    // Strip markdown-ish syntax: headings, bold, italic, links, etc.
    return content
      .replace(/#{1,6}\s+/g, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/`{1,3}[^`]*`{1,3}/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/^\s*[-*+]\s+/gm, '• ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  return content; // markdown (default)
}

/* ── Copy to clipboard ──────────────────────────────── */
copyBtn.addEventListener('click', async () => {
  if (!fullContent) return;
  try {
    await navigator.clipboard.writeText(fullContent);
    copyBtn.classList.add('copied');
    copyBtnText.textContent = 'Copied!';
    setTimeout(() => {
      copyBtn.classList.remove('copied');
      copyBtnText.textContent = 'Copy to Clipboard';
    }, 2000);
  } catch {
    // Fallback: execCommand
    const ta = document.createElement('textarea');
    ta.value = fullContent;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    copyBtnText.textContent = 'Copied!';
    setTimeout(() => { copyBtnText.textContent = 'Copy to Clipboard'; }, 2000);
  }
});

/* ── Settings panel ─────────────────────────────────── */
settingsBtn.addEventListener('click', () => {
  mainPanel.hidden = true;
  settingsPanel.hidden = false;
  apiKeyInput.value = apiKey ? '•'.repeat(Math.min(apiKey.length, 32)) : '';
  apiKeyInput.placeholder = apiKey ? 'Key saved — enter new key to replace' : 'wp_live_xxxxxxxxxxxx';
  settingsSaved.hidden = true;
});

closeSettings.addEventListener('click', () => {
  settingsPanel.hidden = true;
  mainPanel.hidden = false;
});

apiKeyInput.addEventListener('focus', () => {
  // Clear the masked display so user can type fresh
  if (apiKeyInput.value.includes('•')) {
    apiKeyInput.value = '';
    apiKeyInput.placeholder = 'Paste new API key…';
  }
});

saveApiKeyBtn.addEventListener('click', async () => {
  const raw = apiKeyInput.value.trim();
  if (raw && raw.includes('•')) return; // nothing changed

  if (raw) {
    apiKey = raw;
    await storageSet('webpeel_api_key', apiKey);
  } else if (!raw && apiKey) {
    // Saving empty clears the key
    apiKey = '';
    await storageSet('webpeel_api_key', '');
  }

  updateModeBadge();
  settingsSaved.hidden = false;
  setTimeout(() => { settingsSaved.hidden = true; }, 2000);
});

clearApiKeyBtn.addEventListener('click', async () => {
  apiKey = '';
  apiKeyInput.value = '';
  apiKeyInput.placeholder = 'wp_live_xxxxxxxxxxxx';
  await storageSet('webpeel_api_key', '');
  updateModeBadge();
  settingsSaved.hidden = true;
});

/* ── UI helpers ─────────────────────────────────────── */
function setExtracting(on) {
  extractBtn.disabled = on;
  extractBtn.classList.toggle('loading', on);
  if (on) {
    extractBtn.querySelector('span') && (extractBtn.querySelector('span').textContent = 'Extracting…');
    // Update button text inside
    const textNode = [...extractBtn.childNodes].find(n => n.nodeType === 3);
    if (textNode) textNode.textContent = on ? ' Extracting…' : ' Extract Content';
  }
}

function hideResult() { resultArea.hidden = true; }
function hideError()  { errorArea.hidden = true; }

function showError(msg) {
  errorMsg.textContent = msg;
  errorArea.hidden = false;
}

/* ── Utils ──────────────────────────────────────────── */
function countWords(text) {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function estimateTokens(text) {
  // Rough approximation: ~4 chars per token (GPT-style)
  if (!text) return 0;
  return Math.round(text.length / 4);
}

function storageGet(key) {
  return new Promise(resolve => {
    chrome.storage.sync.get([key], result => resolve(result[key]));
  });
}

function storageSet(key, value) {
  return new Promise(resolve => {
    chrome.storage.sync.set({ [key]: value }, resolve);
  });
}

/* ── Boot ───────────────────────────────────────────── */
init();
