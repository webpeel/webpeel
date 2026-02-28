/**
 * WebPeel Extension — service-worker.js
 * Manifest V3 background service worker.
 *
 * Responsibilities:
 *  1. Register context menu item on install
 *  2. Handle context menu click → extract + copy
 *  3. Handle messages from popup (optional API relay)
 */

'use strict';

const API_BASE = 'https://api.webpeel.dev/v1';
const STORAGE_KEY_API = 'webpeel_api_key';
const CTX_MENU_ID = 'webpeel-extract';

/* ── Install: register context menu ────────────────── */
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id:       CTX_MENU_ID,
    title:    'Extract with WebPeel',
    contexts: ['page', 'selection', 'link'],
  });
});

/* ── Context menu click handler ─────────────────────── */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CTX_MENU_ID) return;
  if (!tab?.id) return;

  try {
    // Try to send extract message to content script
    const result = await sendToContentScript(tab.id, { action: 'extractContent' });

    if (result && result.content) {
      // Write extracted content to clipboard via offscreen or content script trick
      await writeToClipboardViaContentScript(tab.id, result.content);

      // Notify user
      showNotification('WebPeel', `Extracted "${result.title || 'page'}" — copied to clipboard!`);
    } else {
      showNotification('WebPeel', 'Could not extract content from this page.');
    }
  } catch (err) {
    console.error('[WebPeel] Context menu extraction failed:', err);
    showNotification('WebPeel', `Extraction failed: ${err.message}`);
  }
});

/* ── Message handler (from popup) ──────────────────── */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'fetchViaAPI') {
    handleAPIFetch(message.url, message.format, message.apiKey)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true; // keep channel open for async response
  }

  if (message.action === 'ping') {
    sendResponse({ alive: true });
    return false;
  }
});

/* ── API fetch helper ───────────────────────────────── */
async function handleAPIFetch(url, format = 'markdown', apiKey) {
  if (!apiKey) {
    throw new Error('No API key configured.');
  }

  const resp = await fetch(`${API_BASE}/fetch`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key':    apiKey,
    },
    body: JSON.stringify({ url, format, render: true }),
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body?.error || body?.message || `API error ${resp.status}`);
  }

  return resp.json();
}

/* ── Content script messaging ───────────────────────── */
function sendToContentScript(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

/* ── Clipboard via injected script ──────────────────── */
async function writeToClipboardViaContentScript(tabId, text) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (textToWrite) => {
        return navigator.clipboard.writeText(textToWrite).then(() => true).catch(() => {
          // Fallback: execCommand
          const ta = document.createElement('textarea');
          ta.value = textToWrite;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          const ok = document.execCommand('copy');
          document.body.removeChild(ta);
          return ok;
        });
      },
      args: [text],
    });
  } catch (err) {
    console.warn('[WebPeel] Clipboard write failed:', err);
  }
}

/* ── Notification helper ────────────────────────────── */
function showNotification(title, message) {
  chrome.notifications?.create({
    type:    'basic',
    iconUrl: '../icons/icon-48.png',
    title,
    message,
  });
}

/* ── Storage helper ─────────────────────────────────── */
function getApiKey() {
  return new Promise(resolve => {
    chrome.storage.sync.get([STORAGE_KEY_API], result => {
      resolve(result[STORAGE_KEY_API] || '');
    });
  });
}
