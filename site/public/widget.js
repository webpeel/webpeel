(function() {
  'use strict';

  const API_URL = 'https://api.webpeel.dev';
  const SIGNUP_URL = 'https://app.webpeel.dev/signup';
  const MAX_FREE_SEARCHES = 3;
  const SEARCH_COUNT_KEY = 'wp_search_count';

  // Track searches in localStorage
  function getSearchCount() {
    return parseInt(localStorage.getItem(SEARCH_COUNT_KEY) || '0', 10);
  }
  function incrementSearchCount() {
    const count = getSearchCount() + 1;
    localStorage.setItem(SEARCH_COUNT_KEY, String(count));
    return count;
  }

  // Create the widget HTML
  function createWidget(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const examples = [
      '🍕 best pizza in Manhattan',
      '⛽ cheapest gas near me',
      '🎧 best Sony headphones',
      '✈️ cheap flights to Miami',
      '🏨 hotel in Boston under $150'
    ];

    const exampleButtons = examples.map(q =>
      `<button type="button" class="wp-example-btn" data-query="${q}"
        style="padding: 6px 14px; font-size: 12px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.08);
               background: rgba(255,255,255,0.03); color: #a1a1aa; cursor: pointer; white-space: nowrap;
               transition: all 0.2s; font-family: inherit;"
        onmouseover="this.style.borderColor='rgba(129,140,248,0.3)';this.style.color='#e4e4e7'"
        onmouseout="this.style.borderColor='rgba(255,255,255,0.08)';this.style.color='#a1a1aa'"
      >${q}</button>`
    ).join('');

    container.innerHTML = `
      <div id="wp-widget" style="max-width: 640px; margin: 0 auto; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; box-sizing: border-box;">
        <form id="wp-search-form" style="position: relative;">
          <input id="wp-search-input" type="text"
            placeholder="Search anything — restaurants, products, flights, gas prices..."
            style="width: 100%; padding: 16px 52px 16px 20px; font-size: 16px; border-radius: 16px;
                   border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05);
                   color: #e4e4e7; outline: none; backdrop-filter: blur(8px);
                   transition: border-color 0.2s, box-shadow 0.2s; box-sizing: border-box;
                   font-family: inherit;"
            onfocus="this.style.borderColor='#818CF8';this.style.boxShadow='0 0 0 3px rgba(129,140,248,0.15)'"
            onblur="this.style.borderColor='rgba(255,255,255,0.1)';this.style.boxShadow='none'"
          />
          <button type="submit" id="wp-search-btn"
            style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
                   width: 36px; height: 36px; border-radius: 10px; border: none;
                   background: #818CF8; color: white; cursor: pointer; display: flex;
                   align-items: center; justify-content: center; font-size: 18px;
                   transition: background 0.2s; flex-shrink: 0;"
            onmouseover="this.style.background='#6366F1'"
            onmouseout="this.style.background='#818CF8'"
          >→</button>
        </form>

        <div id="wp-examples" style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; justify-content: center;">
          ${exampleButtons}
        </div>

        <div id="wp-results" style="margin-top: 20px; display: none;"></div>

        <div id="wp-signup-wall" style="display: none; text-align: center; padding: 40px 20px;
             background: rgba(129,140,248,0.05); border: 1px solid rgba(129,140,248,0.2);
             border-radius: 16px; margin-top: 20px;">
          <h3 style="color: #e4e4e7; font-size: 20px; margin: 0 0 8px; font-family: inherit;">You've used your 3 free searches</h3>
          <p style="color: #a1a1aa; font-size: 14px; margin: 0 0 20px; font-family: inherit;">Sign up for free to get 500 searches/week + AI summaries</p>
          <a href="${SIGNUP_URL}"
            style="display: inline-block; padding: 12px 32px; background: #818CF8; color: white;
                   border-radius: 12px; text-decoration: none; font-weight: 600; font-size: 14px;
                   transition: background 0.2s; font-family: inherit;"
            onmouseover="this.style.background='#6366F1'"
            onmouseout="this.style.background='#818CF8'"
          >Sign Up Free →</a>
        </div>
      </div>
    `;

    // Example button click handlers (safe, no inline onclick with data)
    container.querySelectorAll('.wp-example-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var query = btn.getAttribute('data-query');
        document.getElementById('wp-search-input').value = query;
        document.getElementById('wp-search-form').dispatchEvent(new Event('submit'));
      });
    });

    // Search handler
    document.getElementById('wp-search-form').addEventListener('submit', async function(e) {
      e.preventDefault();
      const query = document.getElementById('wp-search-input').value.trim();
      if (!query) return;

      const count = getSearchCount();
      if (count >= MAX_FREE_SEARCHES) {
        document.getElementById('wp-results').style.display = 'none';
        document.getElementById('wp-signup-wall').style.display = 'block';
        document.getElementById('wp-examples').style.display = 'none';
        return;
      }

      incrementSearchCount();
      const resultsDiv = document.getElementById('wp-results');
      resultsDiv.style.display = 'block';
      resultsDiv.innerHTML = `
        <div style="text-align: center; padding: 30px; color: #a1a1aa;">
          <style>@keyframes wp-spin{to{transform:rotate(360deg)}}</style>
          <div style="display: inline-block; width: 24px; height: 24px; border: 2px solid #52525b; border-top-color: #818CF8; border-radius: 50%; animation: wp-spin 0.6s linear infinite;"></div>
          <p style="margin-top: 12px; font-size: 13px; font-family: inherit;">Searching...</p>
        </div>
      `;

      try {
        const res = await fetch(`${API_URL}/v1/search/smart`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: query }),
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();
        const smart = data.data || data;

        let html = '';

        // AI Answer
        if (smart.answer) {
          const safeAnswer = smart.answer
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\*\*(.*?)\*\*/g, '<strong style="color:#e4e4e7">$1</strong>')
            .replace(/\n/g, '<br>');
          html += `
            <div style="padding: 16px; border-radius: 12px; background: rgba(129,140,248,0.08); border: 1px solid rgba(129,140,248,0.15); margin-bottom: 16px;">
              <div style="font-size: 11px; color: #818CF8; font-weight: 600; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em;">✨ AI Summary</div>
              <div style="font-size: 14px; color: #d4d4d8; line-height: 1.6;">${safeAnswer}</div>
            </div>`;
        }

        // Results
        const listings = (smart.structured && (smart.structured.businesses || smart.structured.listings)) || smart.results || [];
        listings.slice(0, 5).forEach(function(item) {
          const name = (item.name || item.title || 'Result').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const url = item.url || item.googleMapsUrl || '#';
          const rating = item.rating ? `⭐ ${item.rating}` : '';
          const reviews = item.reviewCount ? `(${item.reviewCount} reviews)` : '';
          const openStatus = item.isOpenNow !== undefined
            ? (item.isOpenNow ? '<span style="color:#34d399">🟢 Open</span>' : '<span style="color:#f87171">🔴 Closed</span>')
            : '';
          const rawSnippet = item.snippet || item.address || '';
          const snippet = rawSnippet.substring(0, 150).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

          html += `
            <div style="padding: 14px; border-radius: 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); margin-bottom: 8px; transition: background 0.2s;"
              onmouseover="this.style.background='rgba(255,255,255,0.06)'"
              onmouseout="this.style.background='rgba(255,255,255,0.03)'"
            >
              <a href="${url}" target="_blank" rel="noopener noreferrer"
                style="font-size: 14px; font-weight: 500; color: #818CF8; text-decoration: none; font-family: inherit;">${name}</a>
              <div style="font-size: 12px; color: #71717a; margin-top: 4px;">${rating} ${reviews} ${openStatus}</div>
              ${snippet ? `<div style="font-size: 12px; color: #a1a1aa; margin-top: 4px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">${snippet}</div>` : ''}
            </div>`;
        });

        if (!html) {
          html = '<div style="text-align: center; padding: 20px; color: #71717a; font-size: 13px;">No results found. Try a different query.</div>';
        }

        // Remaining searches counter
        const remaining = MAX_FREE_SEARCHES - getSearchCount();
        if (remaining > 0) {
          html += `<div style="text-align: center; margin-top: 12px; font-size: 11px; color: #52525b;">
            ${remaining} free search${remaining === 1 ? '' : 'es'} remaining &middot;
            <a href="${SIGNUP_URL}" style="color: #818CF8; text-decoration: none;">Sign up for unlimited</a>
          </div>`;
        } else {
          // Last search used — show signup nudge
          setTimeout(function() {
            document.getElementById('wp-results').style.display = 'none';
            document.getElementById('wp-signup-wall').style.display = 'block';
            document.getElementById('wp-examples').style.display = 'none';
          }, 3000);
          html += `<div style="text-align: center; margin-top: 12px; font-size: 11px; color: #818CF8;">
            That was your last free search!
            <a href="${SIGNUP_URL}" style="color: #818CF8; font-weight: 600; text-decoration: underline;">Sign up free →</a>
          </div>`;
        }

        resultsDiv.innerHTML = html;
      } catch (err) {
        resultsDiv.innerHTML = `
          <div style="text-align: center; padding: 20px; color: #f87171; font-size: 13px; font-family: inherit;">
            Search failed. <a href="${SIGNUP_URL}" style="color: #818CF8;">Try the full app →</a>
          </div>`;
      }
    });
  }

  // Auto-init when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { createWidget('webpeel-search'); });
  } else {
    createWidget('webpeel-search');
  }

  // Expose for manual init
  window.WebPeelWidget = { init: createWidget };
})();
