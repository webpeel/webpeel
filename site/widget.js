(function() {
  'use strict';

  const API_URL = 'https://api.webpeel.dev';
  const SIGNUP_URL = 'https://app.webpeel.dev/signup';
  const MAX_FREE_SEARCHES = 20;
  const SEARCH_COUNT_KEY = 'wp_search_count';
  const HISTORY_KEY = 'wp_search_history';

  // Track searches in localStorage
  function getSearchCount() {
    return parseInt(localStorage.getItem(SEARCH_COUNT_KEY) || '0', 10);
  }
  function incrementSearchCount() {
    const count = getSearchCount() + 1;
    localStorage.setItem(SEARCH_COUNT_KEY, String(count));
    return count;
  }

  // Search history helpers
  function getSearchHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
  }
  function addToHistory(query) {
    var hist = getSearchHistory().filter(function(h) { return h.query !== query; });
    hist.unshift({ query: query, timestamp: Date.now() });
    localStorage.setItem(HISTORY_KEY, JSON.stringify(hist.slice(0, 5)));
  }
  function clearHistory() {
    localStorage.removeItem(HISTORY_KEY);
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
      var pl = priceLevels[itemNameLower] || item.priceLevel || item.price || '';
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
        <div id="wp-history" style="margin-top: 10px; display: none;"></div>\
        <div id="wp-results" style="margin-top: 20px; display: none;"></div>\
        <div id="wp-signup-wall" style="display: none; text-align: center; padding: 40px 20px;\
             background: rgba(129,140,248,0.05); border: 1px solid rgba(129,140,248,0.2);\
             border-radius: 16px; margin-top: 20px;">\
          <h3 style="color: #e4e4e7; font-size: 20px; margin: 0 0 8px; font-family: inherit;">You\'ve used your 20 free searches</h3>\
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

    // ─── Render search history pills ─────────────────────────────────────────
    function renderHistory() {
      var histDiv = document.getElementById('wp-history');
      if (!histDiv) return;
      var hist = getSearchHistory();
      if (!hist.length) {
        histDiv.style.display = 'none';
        histDiv.innerHTML = '';
        return;
      }
      var pills = hist.map(function(h) {
        return '<button type="button" class="wp-hist-btn" data-query="' + esc(h.query) + '"'
          + ' style="padding:4px 12px;font-size:11px;border-radius:20px;border:1px solid rgba(255,255,255,0.07);'
          + 'background:rgba(255,255,255,0.02);color:#a1a1aa;cursor:pointer;white-space:nowrap;'
          + 'transition:all 0.2s;font-family:inherit;"'
          + ' onmouseover="this.style.borderColor=\'rgba(129,140,248,0.25)\';this.style.color=\'#e4e4e7\'"'
          + ' onmouseout="this.style.borderColor=\'rgba(255,255,255,0.07)\';this.style.color=\'#a1a1aa\'"'
          + '>' + esc(h.query) + '</button>';
      }).join('');
      histDiv.innerHTML = '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;justify-content:center;">'
        + '<span style="font-size:11px;color:#52525b;white-space:nowrap;">Recent:</span>'
        + pills
        + '<button type="button" id="wp-hist-clear"'
        + ' style="font-size:11px;color:#52525b;background:none;border:none;cursor:pointer;padding:2px 4px;'
        + 'font-family:inherit;transition:color 0.2s;"'
        + ' onmouseover="this.style.color=\'#f87171\'"'
        + ' onmouseout="this.style.color=\'#52525b\'"'
        + '>×</button>'
        + '</div>';
      histDiv.style.display = 'block';

      // Attach click handlers
      histDiv.querySelectorAll('.wp-hist-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var query = btn.getAttribute('data-query');
          document.getElementById('wp-search-input').value = query;
          document.getElementById('wp-search-form').dispatchEvent(new Event('submit'));
        });
      });
      var clearBtn = document.getElementById('wp-hist-clear');
      if (clearBtn) {
        clearBtn.addEventListener('click', function() {
          clearHistory();
          renderHistory();
        });
      }
    }

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

    // Render history on page load
    renderHistory();

    var activeSearchId = 0;
    var activeSearchController = null;

    function isActiveSearch(searchId) {
      return searchId === activeSearchId;
    }

    function abortActiveSearch() {
      if (activeSearchController) {
        try { activeSearchController.abort(); } catch (e) {}
        activeSearchController = null;
      }
    }

    // Example button click handlers (safe, no inline onclick with data)
    container.querySelectorAll('.wp-example-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var query = btn.getAttribute('data-query');
        var input = document.getElementById('wp-search-input');
        if (input) input.value = query;
        submitSearch(query);
      });
    });

    // Search handler
    // ─── Render: final results HTML from a smart result object ──────────────────
    function renderFinalHTML(smart, answerText, elapsed) {
      var elapsedStr = elapsed < 10000 ? (elapsed / 1000).toFixed(1) + 's' : '~2s avg';
      var html = '<style>'
        + '@keyframes wp-spin{to{transform:rotate(360deg)}}'
        + '@media(max-width:480px){.wp-title-link{font-size:13px !important}.wp-snippet{font-size:12px !important}.wp-card{padding:12px !important}}'
        + '</style>';

      // ── AI Summary card ──────────────────────────────────────────────────
      var resolvedAnswer = answerText || smart.answer || '';
      if (resolvedAnswer) {
        var safeAnswer = resolvedAnswer
var rawAnswer = smart.answer;
        // Extract source URLs from Sources: section before stripping it
        var citationUrls = {};
        var sourcesMatch = rawAnswer.match(/Sources?:\s*\n([\s\S]*?)$/i);
        if (sourcesMatch) {
          var sourceLines = sourcesMatch[1].split('\n');
          sourceLines.forEach(function(line) {
            var m = line.match(/\[(\d+)\]\s*(https?:\/\/\S+)/);
            if (m) citationUrls[m[1]] = m[2];
          });
        }
        var safeAnswer = rawAnswer
          .replace(/Sources?:\s*\n[\s\S]*$/i, '')
          .trim()
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\*\*(.*?)\*\*/g, '<strong style="color:#e4e4e7">$1</strong>')
          .replace(/\[(\d+)\]/g, function(match, num) {
            var url = citationUrls[num];
            if (url) {
              return '<a href="' + url.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '" target="_blank" rel="noopener noreferrer" style="color:#818CF8;font-size:10px;font-weight:600;text-decoration:none;cursor:pointer;vertical-align:super;" title="' + url.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '">[' + num + ']</a>';
            }
            return '<sup style="color:#818CF8;font-size:10px;font-weight:600;">[' + num + ']</sup>';
          })
          .replace(/\n/g, '<br>');
        html += '<div style="padding:20px;border-radius:12px;background:rgba(129,140,248,0.08);border:1px solid rgba(129,140,248,0.18);margin-bottom:16px;">'
          + '<div style="font-size:11px;color:#818CF8;font-weight:600;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.06em;">✨ AI Summary</div>'
          + '<div style="font-size:14px;color:#d4d4d8;line-height:1.65;">' + safeAnswer + '</div>'
          + '</div>';
      }

      // ── Structured listings or businesses ────────────────────────────────
      var structured = smart.structured
        || (smart.domainData && smart.domainData.structured)
        || {};

      var listings = structured.listings || [];
      var businesses = structured.businesses || [];
      var hasStructured = listings.length > 0 || businesses.length > 0;

      if (businesses.length > 0) {
        html += renderBusinessCards(businesses, resolvedAnswer);
      } else if (listings.length > 0) {
        html += renderListingCards(listings);
      } else if (!hasStructured) {
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

      // ── Source attribution row ────────────────────────────────────────────
      if (smart.sources && smart.sources.length) {
        html += renderSourceRow(smart.sources);
      }

      if (!resolvedAnswer && !hasStructured && !smart.content) {
        html += '<div style="text-align:center;padding:20px;color:#71717a;font-size:13px;">No results found. Try a different query.</div>';
      }

      // ── Stats bar ────────────────────────────────────────────────────────
      html += '<div style="display:flex;flex-wrap:wrap;justify-content:center;gap:12px;margin-top:16px;padding:12px 0;border-top:1px solid rgba(255,255,255,0.06);">'
        + '<span style="font-size:11px;color:#52525b;">⚡ ' + elapsedStr + '</span>'
        + '<span style="font-size:11px;color:#52525b;">🛡️ Zero ads</span>'
        + '<span style="font-size:11px;color:#52525b;">🤖 AI-powered</span>'
        + '</div>';

      // ── Remaining searches counter ────────────────────────────────────────
      var remaining = MAX_FREE_SEARCHES - getSearchCount();
      if (remaining > 0) {
        html += '<div style="text-align:center;margin-top:8px;font-size:11px;color:#52525b;">'
          + remaining + ' free search' + (remaining === 1 ? '' : 'es') + ' remaining &middot; '
          + '<a href="' + SIGNUP_URL + '" style="color:#818CF8;text-decoration:none;">Sign up for unlimited</a>'
          + '</div>';
      } else {
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

      return html;
    }

    // ─── SSE streaming search ────────────────────────────────────────────────
    async function doSSESearch(query, resultsDiv, startTime) {
      // Show streaming skeleton immediately
      resultsDiv.innerHTML = '<style>'
        + '@keyframes wp-spin{to{transform:rotate(360deg)}}'
        + '@keyframes wp-blink{50%{opacity:0}}'
        + '#wp-stream-text::after{content:"▊";animation:wp-blink 0.7s infinite;color:#818CF8;}'
        + '#wp-stream-text.wp-done::after{content:"";animation:none;}'
        + '@media(max-width:480px){.wp-title-link{font-size:13px !important}.wp-snippet{font-size:12px !important}.wp-card{padding:12px !important}}'
        + '</style>'
        + '<div id="wp-stream-status" style="text-align:center;padding:20px 0;color:#a1a1aa;">'
        + '<div style="display:inline-block;width:20px;height:20px;border:2px solid #52525b;border-top-color:#818CF8;border-radius:50%;animation:wp-spin 0.6s linear infinite;vertical-align:middle;margin-right:8px;"></div>'
        + '<span id="wp-stream-msg" style="font-size:13px;font-family:inherit;">Searching...</span>'
        + '</div>'
        + '<div id="wp-stream-answer" style="display:none;padding:20px;border-radius:12px;background:rgba(129,140,248,0.08);border:1px solid rgba(129,140,248,0.18);margin-bottom:16px;">'
        + '<div style="font-size:11px;color:#818CF8;font-weight:600;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.06em;">✨ AI Summary</div>'
        + '<div id="wp-stream-text" style="font-size:14px;color:#d4d4d8;line-height:1.65;min-height:20px;"></div>'
        + '</div>'
        + '<div id="wp-stream-listings"></div>'
        + '<div id="wp-stream-footer"></div>';

      var res = await fetch(API_URL + '/v1/search/smart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
        body: JSON.stringify({ q: query, stream: true }),
      });

      if (!res.ok) {
        if (res.status === 429) return '429';
        throw new Error('HTTP ' + res.status);
      }

      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';

      // Accumulated state
      var smartResult = null;
      var collectedAnswer = '';
      var collectedSources = [];
      var collectedBusinesses = [];
      var pendingEventName = '';

      function setStatus(msg) {
        var el = document.getElementById('wp-stream-msg');
        if (el) el.textContent = msg;
      }

      function showAnswerWord(word) {
        var answerDiv = document.getElementById('wp-stream-answer');
        var textEl = document.getElementById('wp-stream-text');
        if (!textEl) return;
        if (answerDiv && answerDiv.style.display === 'none') answerDiv.style.display = 'block';
        // Hide status once answer starts showing
        var statusEl = document.getElementById('wp-stream-status');
        if (statusEl) statusEl.style.display = 'none';
        textEl.textContent += word;
      }

      // Typewriter: reveal text word-by-word with a small delay between words
      function typewriterReveal(text) {
        var answerDiv = document.getElementById('wp-stream-answer');
        var textEl = document.getElementById('wp-stream-text');
        if (!textEl) return Promise.resolve();
        if (answerDiv) answerDiv.style.display = 'block';
        var statusEl = document.getElementById('wp-stream-status');
        if (statusEl) statusEl.style.display = 'none';

        // Strip existing text (in case partial content was set)
        textEl.textContent = '';
        var words = text.split(' ');
        var i = 0;
        return new Promise(function(resolve) {
          function next() {
            if (!isActiveSearch(searchId)) { resolve(); return; }
            if (i >= words.length) { resolve(); return; }
            textEl.textContent += (i > 0 ? ' ' : '') + words[i];
            i++;
            setTimeout(next, 18);
          }
          next();
        });
      }

      function processEvent(evName, dataStr) {
        var event;
        try { event = JSON.parse(dataStr); } catch (e) { return; }

        if (evName === 'intent') {
          if (event.loadingMessage) setStatus(event.loadingMessage);
        } else if (evName === 'progress') {
          if (event.message) setStatus(event.message);
        } else if (evName === 'source') {
          // Restaurants: Yelp businesses arrive early — show them immediately
          if (event.source === 'yelp' && event.businesses && event.businesses.length > 0) {
            collectedBusinesses = event.businesses;
            var listingsDiv = document.getElementById('wp-stream-listings');
            if (listingsDiv) {
              listingsDiv.innerHTML = renderBusinessCards(event.businesses.slice(0, 4), '');
            }
          } else if (event.source === 'reddit' && event.thread) {
            collectedSources.push({ title: event.thread.title || 'Reddit', url: event.thread.url || 'https://reddit.com', domain: 'reddit.com' });
          } else if (event.source === 'youtube' && event.videos && event.videos[0]) {
            collectedSources.push({ title: event.videos[0].title || 'YouTube', url: event.videos[0].url || 'https://youtube.com', domain: 'youtube.com' });
          }
        } else if (evName === 'answer') {
          collectedAnswer = event.answer || '';
        } else if (evName === 'result') {
          // Non-restaurant full result
          smartResult = event;
          if (event.answer) collectedAnswer = event.answer;
        }
        // 'done' is handled after the read loop
      }

      // Read the SSE stream
      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        var lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete last line
        for (var li = 0; li < lines.length; li++) {
          var line = lines[li];
          if (line.startsWith('event: ')) {
            pendingEventName = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            processEvent(pendingEventName, line.slice(6));
            pendingEventName = '';
          } else if (line === '') {
            pendingEventName = '';
          }
        }
      }

      // Stream done — run typewriter on answer, then render final state
      var elapsed = Date.now() - startTime;

      if (collectedAnswer) {
        await typewriterReveal(collectedAnswer.replace(/Sources?:\s*\n(\[\d+\].*\n?)*/gi, '').trim());
        // Remove cursor when typewriter completes
        var textEl = document.getElementById('wp-stream-text');
        if (textEl) textEl.className = 'wp-done';
      }
      // Hide the status spinner when stream completes (even without AI answer)
      var statusFinal = document.getElementById('wp-stream-status');
      if (statusFinal) statusFinal.style.display = 'none';

      // Build final smart object for renderFinalHTML
      var finalSmart = smartResult || {};
      if (collectedBusinesses.length > 0) {
        finalSmart = finalSmart || {};
        if (!finalSmart.structured) finalSmart.structured = {};
        if (!finalSmart.structured.businesses) finalSmart.structured.businesses = collectedBusinesses;
      }
      if (collectedSources.length > 0) {
        // Prepend yelp source if we had businesses
        var allSources = [];
        if (collectedBusinesses.length > 0) {
          allSources.push({ title: 'Yelp', url: 'https://yelp.com', domain: 'yelp.com' });
        }
        allSources = allSources.concat(collectedSources);
        finalSmart.sources = finalSmart.sources || allSources;
      }

      // Render the full final HTML
      if (!isActiveSearch(searchId)) return 'stale';
      var finalHTML = renderFinalHTML(finalSmart, collectedAnswer, elapsed);
      resultsDiv.innerHTML = finalHTML;

      return 'ok';
    }

    async function submitSearch(rawQuery) {
      var query = String(rawQuery || '').trim();
      if (!query) return;

      var count = getSearchCount();
      if (count >= MAX_FREE_SEARCHES) {
        document.getElementById('wp-results').style.display = 'none';
        document.getElementById('wp-signup-wall').style.display = 'block';
        document.getElementById('wp-examples').style.display = 'none';
        return;
      }

      abortActiveSearch();
      activeSearchId += 1;
      var searchId = activeSearchId;
      activeSearchController = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var signal = activeSearchController ? activeSearchController.signal : undefined;

      incrementSearchCount();
      addToHistory(query);
      renderHistory();

      var resultsDiv = document.getElementById('wp-results');
      if (!resultsDiv) return;
      resultsDiv.style.display = 'block';
      document.getElementById('wp-signup-wall').style.display = 'none';
      document.getElementById('wp-examples').style.display = 'flex';

      var startTime = Date.now();

      // ── SSE streaming path (modern browsers) ────────────────────────────
      if (typeof ReadableStream !== 'undefined') {
        try {
          var streamStatus = await doSSESearch(query, resultsDiv, startTime, signal, searchId);
          if (streamStatus === 'stale') return;
          if (streamStatus === '429') {
            localStorage.setItem(SEARCH_COUNT_KEY, String(MAX_FREE_SEARCHES));
            document.getElementById('wp-results').style.display = 'none';
            document.getElementById('wp-signup-wall').style.display = 'block';
            document.getElementById('wp-examples').style.display = 'none';
          }
          return;
        } catch (streamErr) {
          if (streamErr && (streamErr.name === 'AbortError' || !isActiveSearch(searchId))) return;
          // SSE failed — fall through to non-streaming path
        }
      }

      if (!isActiveSearch(searchId)) return;

      // ── Non-streaming fallback ───────────────────────────────────────────
      resultsDiv.innerHTML = '\
        <div style="text-align: center; padding: 30px; color: #a1a1aa;">\
          <style>@keyframes wp-spin{to{transform:rotate(360deg)}}</style>\
          <div style="display: inline-block; width: 24px; height: 24px; border: 2px solid #52525b; border-top-color: #818CF8; border-radius: 50%; animation: wp-spin 0.6s linear infinite;"></div>\
          <p style="margin-top: 12px; font-size: 13px; font-family: inherit;">Searching...</p>\
        </div>';

      try {
        var res = await fetch(API_URL + '/v1/search/smart', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: query }),
          signal: signal,
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

        if (!isActiveSearch(searchId)) return;
        var data = await res.json();
        if (!isActiveSearch(searchId)) return;
        var smart = data.data || data;
        var elapsed = Date.now() - startTime;

        resultsDiv.innerHTML = renderFinalHTML(smart, smart.answer || '', elapsed);
      } catch (err) {
        if (err && (err.name === 'AbortError' || !isActiveSearch(searchId))) return;
        resultsDiv.innerHTML = '<div style="text-align:center;padding:20px;color:#f87171;font-size:13px;font-family:inherit;">'
          + 'Search failed. <a href="' + SIGNUP_URL + '" style="color:#818CF8;">Try the full app →</a>'
          + '</div>';
      } finally {
        if (isActiveSearch(searchId)) activeSearchController = null;
      }
    }

    document.getElementById('wp-search-form').addEventListener('submit', function(e) {
      e.preventDefault();
      var input = document.getElementById('wp-search-input');
      submitSearch(input ? input.value : '');
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
