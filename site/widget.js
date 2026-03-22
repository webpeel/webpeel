(function() {
  'use strict';

  const API_URL = 'https://api.webpeel.dev';
  const SIGNUP_URL = 'https://app.webpeel.dev/signup';
  const MAX_FREE_SEARCHES = 5;
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

  // ─── Utility: HTML escape ───────────────────────────────────────────────────
  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ─── Utility: Clean and truncate snippet text ───────────────────────────────
  function cleanSnippet(text, maxLen) {
    if (!text) return '';
    // Add space after period before capital letter (e.g. "Value.Check" → "Value. Check")
    var cleaned = text.replace(/\.([A-Z])/g, '. $1');
    // Strip excessive whitespace
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    // Remove consecutive duplicate phrases (3+ word blocks)
    cleaned = cleaned.replace(/(\b(?:\w+\s){3,}\w+)\s+\1/gi, '$1');
    if (cleaned.length <= maxLen) return cleaned;
    // Truncate without splitting mid-word
    var truncated = cleaned.substring(0, maxLen);
    var lastSpace = truncated.lastIndexOf(' ');
    return (lastSpace > maxLen * 0.6 ? truncated.substring(0, lastSpace) : truncated) + '...';
  }

  // ─── Render: product / car listing cards ────────────────────────────────────
  function renderListingCards(listings) {
    return dedupeByName(listings).slice(0, 4).map(function(item) {
      var title = esc(item.title || item.name || 'Result');
      var url = esc(item.url || '#');
      var rawPrice = (item.price || '').replace(/^from\s+/i, '').trim();
      var price = rawPrice
        ? '<span style="color:#34d399;font-weight:600;font-size:13px;white-space:nowrap;">' + esc(rawPrice) + '</span>'
        : '';
      var source = item.source
        ? '<span style="background:rgba(255,255,255,0.06);color:#71717a;font-size:10px;padding:2px 8px;border-radius:20px;white-space:nowrap;">' + esc(item.source) + '</span>'
        : '';
      var meta = (price || source)
        ? '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;flex-shrink:0;">' + price + source + '</div>'
        : '';
      var snippet = cleanSnippet(item.snippet || '', 120);
      var snippetHtml = snippet
        ? '<div class="wp-snippet" style="font-size:13px;color:#a1a1aa;line-height:1.5;margin-top:6px;">' + esc(snippet) + '</div>'
        : '';
      return '<div style="padding:16px;border-radius:12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);margin-bottom:8px;transition:background 0.2s;text-align:center;" '
        + 'onmouseover="this.style.background=\'rgba(255,255,255,0.06)\'" '
        + 'onmouseout="this.style.background=\'rgba(255,255,255,0.03)\'">'
        + '<div style="display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;">'
        + '<a href="' + url + '" target="_blank" rel="noopener noreferrer" '
        + 'class="wp-title-link" style="font-size:14px;font-weight:500;color:#818CF8;text-decoration:none;line-height:1.4;">' + title + '</a>'
        + meta
        + '</div>'
        + snippetHtml
        + '</div>';
    }).join('');
  }

  // ─── Deduplicate by name (keep first occurrence) ─────────────────────────────
  function dedupeByName(items) {
    var seen = {};
    return items.filter(function(item) {
      var key = (item.name || item.title || '').toLowerCase().trim();
      if (!key || seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  // ─── Render: business / restaurant cards ────────────────────────────────────
  function renderBusinessCards(businesses, answerText) {
    // Parse price levels from AI summary (e.g. "Olio e Più ... $$$")
    var priceLevels = {};
    if (answerText) {
      // Strip markdown bold markers for parsing
      var cleanAnswer = answerText.replace(/\*\*/g, '');
      var priceRe = /\d+\.\s*([A-Za-zÀ-ÿ'''&\-. ]+?)\s+(?:\[\d+\]\s*)?[⭐★]\s*[\d.]+\s*[—–\-]\s*(\${1,4})/g;
      var pm;
      while ((pm = priceRe.exec(cleanAnswer)) !== null) {
        priceLevels[pm[1].trim().toLowerCase()] = pm[2];
      }
    }

    return dedupeByName(businesses).slice(0, 4).map(function(item) {
      var name = esc(item.name || 'Business');
      var url = esc(item.url || item.googleMapsUrl || '#');
      var ratingStars = item.rating !== undefined
        ? '<span style="color:#fbbf24;font-size:13px;">⭐</span><span style="color:#e4e4e7;font-size:13px;font-weight:500;margin-left:2px;">' + item.rating + '</span>'
        : '';
      var reviews = item.reviewCount
        ? '<span style="color:#71717a;font-size:12px;">(' + Number(item.reviewCount).toLocaleString() + ')</span>'
        : '';
      // Price level from AI summary (fuzzy match: "Da Andrea" matches "Da Andrea - Chelsea")
      var itemNameLower = (item.name || '').toLowerCase().trim();
      var pl = priceLevels[itemNameLower] || item.priceLevel || '';
      if (!pl) {
        for (var plKey in priceLevels) {
          if (itemNameLower.indexOf(plKey) === 0 || plKey.indexOf(itemNameLower) === 0) {
            pl = priceLevels[plKey];
            break;
          }
        }
      }
      var pricePill = pl
        ? '<span style="color:#34d399;font-weight:600;font-size:12px;">' + esc(pl) + '</span>'
        : '';
      var openStatus = item.isOpenNow !== undefined
        ? (item.isOpenNow
          ? '<span style="color:#34d399;font-size:12px;">● Open</span>'
          : '<span style="color:#f87171;font-size:12px;">● Closed</span>')
        : '';
      var address = item.address
        ? '<div style="font-size:12px;color:#71717a;margin-top:4px;">' + esc(item.address) + '</div>'
        : '';
      var metaRow = (ratingStars || reviews || pricePill)
        ? '<div style="display:flex;align-items:center;justify-content:center;gap:6px;margin-top:4px;flex-wrap:wrap;">' + ratingStars + reviews + pricePill + '</div>'
        : '';
      return '<div style="padding:16px;border-radius:12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);margin-bottom:8px;transition:background 0.2s;text-align:center;" '
        + 'onmouseover="this.style.background=\'rgba(255,255,255,0.06)\'" '
        + 'onmouseout="this.style.background=\'rgba(255,255,255,0.03)\'">'
        + '<div style="display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;">'
        + '<a href="' + url + '" target="_blank" rel="noopener noreferrer" '
        + 'class="wp-title-link" style="font-size:14px;font-weight:500;color:#818CF8;text-decoration:none;">' + name + '</a>'
        + openStatus
        + '</div>'
        + metaRow
        + address
        + '</div>';
    }).join('');
  }

  // ─── Render: source attribution row ─────────────────────────────────────────
  function renderSourceRow(sources) {
    if (!sources || !sources.length) return '';
    var domains = [];
    sources.forEach(function(s) {
      var addDomain = function(urlStr) {
        try {
          var h = new URL(urlStr).hostname.replace(/^www\./, '');
          if (h && domains.indexOf(h) === -1) domains.push(h);
        } catch (e) {}
      };
      if (s.url) addDomain(s.url);
      if (s.threads) {
        s.threads.forEach(function(t) { if (t.url) addDomain(t.url); });
      }
    });
    var uniq = domains.slice(0, 6);
    if (!uniq.length) return '';
    var pills = uniq.map(function(d) {
      return '<span style="display:inline-flex;align-items:center;gap:3px;white-space:nowrap;">'
        + '<img src="https://www.google.com/s2/favicons?domain=' + esc(d) + '&sz=12" width="12" height="12" '
        + 'style="border-radius:2px;opacity:0.55;vertical-align:middle;" onerror="this.style.display=\'none\'">'
        + '<span>' + esc(d) + '</span>'
        + '</span>';
    }).join('<span style="color:#3f3f46;margin:0 1px;"> · </span>');
    return '<div style="margin-top:10px;font-size:11px;color:#52525b;display:flex;flex-wrap:wrap;align-items:center;gap:4px;line-height:1.8;">'
      + '<span style="color:#3f3f46;">Sources:</span>'
      + pills
      + '</div>';
  }

  // ─── Create the widget HTML ──────────────────────────────────────────────────
  function createWidget(containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;

    var examples = [
      '🍕 best pizza in Manhattan',
      '⛽ cheapest gas near me',
      '🎧 best Sony headphones',
      '✈️ cheap flights to Miami',
      '🏨 hotel in Boston under $150'
    ];

    var exampleButtons = examples.map(function(q) {
      return '<button type="button" class="wp-example-btn" data-query="' + esc(q) + '"'
        + ' style="padding: 6px 14px; font-size: 12px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.08);'
        + ' background: rgba(255,255,255,0.03); color: #a1a1aa; cursor: pointer; white-space: nowrap;'
        + ' transition: all 0.2s; font-family: inherit;"'
        + ' onmouseover="this.style.borderColor=\'rgba(129,140,248,0.3)\';this.style.color=\'#e4e4e7\'"'
        + ' onmouseout="this.style.borderColor=\'rgba(255,255,255,0.08)\';this.style.color=\'#a1a1aa\'"'
        + '>' + q + '</button>';
    }).join('');

    container.innerHTML = '\
      <div id="wp-widget" style="max-width: 640px; margin: 0 auto; font-family: \'Inter\', -apple-system, BlinkMacSystemFont, \'Segoe UI\', sans-serif; box-sizing: border-box;">\
        <form id="wp-search-form" style="position: relative;">\
          <input id="wp-search-input" type="text"\
            placeholder="Search anything — restaurants, products, flights, gas prices..."\
            style="width: 100%; padding: 16px 52px 16px 20px; font-size: 16px; border-radius: 16px;\
                   border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05);\
                   color: #e4e4e7; outline: none; backdrop-filter: blur(8px);\
                   transition: border-color 0.2s, box-shadow 0.2s; box-sizing: border-box;\
                   font-family: inherit;"\
            onfocus="this.style.borderColor=\'#818CF8\';this.style.boxShadow=\'0 0 0 3px rgba(129,140,248,0.15)\'"\
            onblur="this.style.borderColor=\'rgba(255,255,255,0.1)\';this.style.boxShadow=\'none\'"\
          />\
          <button type="submit" id="wp-search-btn"\
            style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%);\
                   width: 36px; height: 36px; border-radius: 10px; border: none;\
                   background: #818CF8; color: white; cursor: pointer; display: flex;\
                   align-items: center; justify-content: center; font-size: 18px;\
                   transition: background 0.2s; flex-shrink: 0;"\
            onmouseover="this.style.background=\'#6366F1\'"\
            onmouseout="this.style.background=\'#818CF8\'"\
          >→</button>\
        </form>\
        <div id="wp-examples" style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; justify-content: center;">\
          ' + exampleButtons + '\
        </div>\
        <div id="wp-results" style="margin-top: 20px; display: none;"></div>\
        <div id="wp-signup-wall" style="display: none; text-align: center; padding: 40px 20px;\
             background: rgba(129,140,248,0.05); border: 1px solid rgba(129,140,248,0.2);\
             border-radius: 16px; margin-top: 20px;">\
          <h3 style="color: #e4e4e7; font-size: 20px; margin: 0 0 8px; font-family: inherit;">You\'ve used your 5 free searches</h3>\
          <p style="color: #a1a1aa; font-size: 14px; margin: 0 0 20px; font-family: inherit;">Sign up for free to get 500 searches/week + AI summaries</p>\
          <a href="' + SIGNUP_URL + '"\
            style="display: inline-block; padding: 12px 32px; background: #818CF8; color: white;\
                   border-radius: 12px; text-decoration: none; font-weight: 600; font-size: 14px;\
                   transition: background 0.2s; font-family: inherit;"\
            onmouseover="this.style.background=\'#6366F1\'"\
            onmouseout="this.style.background=\'#818CF8\'"\
          >Sign Up Free →</a>\
        </div>\
      </div>';

    // Mobile responsiveness: swap placeholder, adjust padding & gap on small screens
    function applyMobileStyles() {
      var isMobile = window.innerWidth <= 480;
      var input = document.getElementById('wp-search-input');
      var examples = document.getElementById('wp-examples');

      if (input) {
        input.placeholder = isMobile
          ? 'Search anything...'
          : 'Search anything — restaurants, products, flights, gas prices...';
        input.style.padding = isMobile
          ? '14px 48px 14px 16px'
          : '16px 52px 16px 20px';
      }

      if (examples) {
        examples.style.gap = isMobile ? '6px' : '8px';
      }
    }

    applyMobileStyles();
    window.addEventListener('resize', applyMobileStyles);

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
      var query = document.getElementById('wp-search-input').value.trim();
      if (!query) return;

      var count = getSearchCount();
      if (count >= MAX_FREE_SEARCHES) {
        document.getElementById('wp-results').style.display = 'none';
        document.getElementById('wp-signup-wall').style.display = 'block';
        document.getElementById('wp-examples').style.display = 'none';
        return;
      }

      incrementSearchCount();
      var resultsDiv = document.getElementById('wp-results');
      resultsDiv.style.display = 'block';
      resultsDiv.innerHTML = '\
        <div style="text-align: center; padding: 30px; color: #a1a1aa;">\
          <style>@keyframes wp-spin{to{transform:rotate(360deg)}}</style>\
          <div style="display: inline-block; width: 24px; height: 24px; border: 2px solid #52525b; border-top-color: #818CF8; border-radius: 50%; animation: wp-spin 0.6s linear infinite;"></div>\
          <p style="margin-top: 12px; font-size: 13px; font-family: inherit;">Searching...</p>\
        </div>';

      var startTime = Date.now();

      try {
        var res = await fetch(API_URL + '/v1/search/smart', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: query }),
        });

        if (!res.ok) {
          if (res.status === 429) {
            localStorage.setItem(SEARCH_COUNT_KEY, String(MAX_FREE_SEARCHES));
            document.getElementById('wp-results').style.display = 'none';
            document.getElementById('wp-signup-wall').style.display = 'block';
            document.getElementById('wp-examples').style.display = 'none';
            return;
          }
          throw new Error('HTTP ' + res.status);
        }

        var data = await res.json();
        var smart = data.data || data;
        var elapsed = Date.now() - startTime;
        var elapsedStr = elapsed < 10000 ? (elapsed / 1000).toFixed(1) + 's' : '~2s avg';

        // Mobile style toggle helper (for responsive card text)
        var isMobile = window.innerWidth <= 480;

        var html = '';

        // ── Mobile-responsive card styles (injected once) ──────────────────
        html += '<style>'
          + '@media(max-width:480px){'
          + '.wp-title-link{font-size:13px !important}'
          + '.wp-snippet{font-size:12px !important}'
          + '.wp-card{padding:12px !important}'
          + '}'
          + '</style>';

        // ── 1. AI Summary card ─────────────────────────────────────────────
        if (smart.answer) {
          var safeAnswer = smart.answer
            .replace(/Sources?:\s*\n(\[\d+\].*\n?)*/gi, '')
            .trim()
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\*\*(.*?)\*\*/g, '<strong style="color:#e4e4e7">$1</strong>')
            .replace(/\[(\d+)\]/g, '<sup style="color:#818CF8;font-size:10px;font-weight:600;cursor:default;">[$1]</sup>')
            .replace(/\n/g, '<br>');
          html += '<div style="padding:20px;border-radius:12px;background:rgba(129,140,248,0.08);border:1px solid rgba(129,140,248,0.18);margin-bottom:16px;">'
            + '<div style="font-size:11px;color:#818CF8;font-weight:600;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.06em;">✨ AI Summary</div>'
            + '<div style="font-size:14px;color:#d4d4d8;line-height:1.65;">' + safeAnswer + '</div>'
            + '</div>';
        }

        // ── 2. Structured listings or businesses ───────────────────────────
        var structured = smart.structured
          || (smart.domainData && smart.domainData.structured)
          || {};

        var listings = structured.listings || [];
        var businesses = structured.businesses || [];
        var hasStructured = listings.length > 0 || businesses.length > 0;

        if (businesses.length > 0) {
          html += renderBusinessCards(businesses, smart.answer || '');
        } else if (listings.length > 0) {
          html += renderListingCards(listings);
        } else if (!hasStructured) {
          // ── 4. Fallback: parse from content markdown ───────────────────
          var fallbackListings = [];
          if (smart.content) {
            var lines = smart.content.split('\n');
            lines.forEach(function(line) {
              var match = line.match(/^\d+\.\s+\*\*(.+?)\*\*\s*(?:—|–|-)\s*(.+)/);
              if (match && fallbackListings.length < 4) {
                var parts = match[2].split('·').map(function(s) { return s.trim(); });
                fallbackListings.push({
                  title: match[1].trim(),
                  snippet: cleanSnippet(parts.join(' · '), 120),
                  price: (parts.find(function(p) { return p.indexOf('$') !== -1; }) || '').trim(),
                  url: '#',
                });
              }
            });
          }
          if (fallbackListings.length > 0) {
            html += renderListingCards(fallbackListings);
          } else if (smart.results && smart.results.length > 0) {
            html += renderListingCards(smart.results);
          }
        }

        // ── 3. Source attribution row ──────────────────────────────────────
        if (smart.sources && smart.sources.length) {
          html += renderSourceRow(smart.sources);
        }

        if (!smart.answer && !hasStructured && !smart.content) {
          html += '<div style="text-align:center;padding:20px;color:#71717a;font-size:13px;">No results found. Try a different query.</div>';
        }

        // ── 5. Stats bar (simplified — no Google Maps claim) ───────────────
        html += '<div style="display:flex;flex-wrap:wrap;justify-content:center;gap:12px;margin-top:16px;padding:12px 0;border-top:1px solid rgba(255,255,255,0.06);">'
          + '<span style="font-size:11px;color:#52525b;">⚡ ' + elapsedStr + '</span>'
          + '<span style="font-size:11px;color:#52525b;">🛡️ Zero ads</span>'
          + '<span style="font-size:11px;color:#52525b;">🤖 AI-powered</span>'
          + '</div>';

        // Remaining searches counter
        var remaining = MAX_FREE_SEARCHES - getSearchCount();
        if (remaining > 0) {
          html += '<div style="text-align:center;margin-top:8px;font-size:11px;color:#52525b;">'
            + remaining + ' free search' + (remaining === 1 ? '' : 'es') + ' remaining &middot; '
            + '<a href="' + SIGNUP_URL + '" style="color:#818CF8;text-decoration:none;">Sign up for unlimited</a>'
            + '</div>';
        } else {
          // Last search used — show signup nudge after 3s
          setTimeout(function() {
            document.getElementById('wp-results').style.display = 'none';
            document.getElementById('wp-signup-wall').style.display = 'block';
            document.getElementById('wp-examples').style.display = 'none';
          }, 3000);
          html += '<div style="text-align:center;margin-top:12px;font-size:11px;color:#818CF8;">'
            + 'That was your last free search! '
            + '<a href="' + SIGNUP_URL + '" style="color:#818CF8;font-weight:600;text-decoration:underline;">Sign up free →</a>'
            + '</div>';
        }

        resultsDiv.innerHTML = html;
      } catch (err) {
        resultsDiv.innerHTML = '<div style="text-align:center;padding:20px;color:#f87171;font-size:13px;font-family:inherit;">'
          + 'Search failed. <a href="' + SIGNUP_URL + '" style="color:#818CF8;">Try the full app →</a>'
          + '</div>';
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
