/**
 * Fetch endpoint with caching
 */
import { Router } from 'express';
import { peel } from '../../index.js';
import { normalizeActions } from '../../core/actions.js';
import { extractInlineJson } from '../../core/extract-inline.js';
import { LRUCache } from 'lru-cache';
import { validateUrlForSSRF, SSRFError } from '../middleware/url-validator.js';
const VALID_LLM_PROVIDERS = ['openai', 'anthropic', 'google'];
export function createFetchRouter(authStore) {
    const router = Router();
    // LRU cache: 5 minute TTL, max 1000 entries, 100MB total size
    const cache = new LRUCache({
        max: 1000,
        ttl: 5 * 60 * 1000, // 5 minutes
        maxSize: 100 * 1024 * 1024, // 100MB
        sizeCalculation: (entry) => {
            return JSON.stringify(entry).length;
        },
    });
    router.get('/v1/fetch', async (req, res) => {
        try {
            const { url, render, wait, format, includeTags, excludeTags, images, location, languages, onlyMainContent, actions, maxAge, storeInCache, stream, } = req.query;
            // Validate URL parameter
            if (!url || typeof url !== 'string') {
                res.status(400).json({
                    error: 'invalid_request',
                    message: 'Missing or invalid "url" parameter. Pass a URL as a query parameter: GET /v1/fetch?url=https://example.com',
                    example: 'curl "https://api.webpeel.dev/v1/fetch?url=https://example.com"',
                    docs: 'https://webpeel.dev/docs/api-reference#fetch',
                });
                return;
            }
            // SECURITY: Validate URL format and length
            if (url.length > 2048) {
                res.status(400).json({
                    error: 'invalid_url',
                    message: 'URL too long (max 2048 characters)',
                });
                return;
            }
            try {
                const parsed = new URL(url);
                // Normalize URL for consistent caching
                const normalizedUrl = parsed.href;
                // Use normalized URL for cache key
                if (normalizedUrl !== url) {
                    // URL was normalized, update for caching
                }
            }
            catch {
                res.status(400).json({
                    error: 'invalid_url',
                    message: 'Invalid URL format',
                });
                return;
            }
            // SECURITY: Validate URL to prevent SSRF attacks
            try {
                validateUrlForSSRF(url);
            }
            catch (error) {
                if (error instanceof SSRFError) {
                    res.status(400).json({
                        error: 'forbidden_url',
                        message: 'Cannot fetch localhost, private networks, or non-HTTP URLs',
                    });
                    return;
                }
                throw error;
            }
            // Parse actions query param (JSON-encoded array)
            let parsedActions;
            if (actions && typeof actions === 'string') {
                try {
                    const raw = JSON.parse(actions);
                    parsedActions = normalizeActions(raw);
                }
                catch (e) {
                    res.status(400).json({
                        error: 'invalid_request',
                        message: 'Invalid "actions" parameter: must be a valid JSON array',
                    });
                    return;
                }
            }
            // Build cache key (include new parameters)
            const actionsKey = parsedActions ? JSON.stringify(parsedActions) : '';
            const cacheKey = `fetch:${url}:${render}:${wait}:${format}:${includeTags}:${excludeTags}:${images}:${location}:${languages}:${onlyMainContent}:${stream}:${actionsKey}`;
            // Check cache (with maxAge support)
            const maxAgeMs = maxAge !== undefined ? parseInt(maxAge, 10) : 172800000; // Default 2 days
            const cached = cache.get(cacheKey);
            if (cached && maxAgeMs > 0) {
                const cacheAge = Date.now() - cached.timestamp;
                if (cacheAge < maxAgeMs) {
                    res.setHeader('X-Cache', 'HIT');
                    res.setHeader('X-Cache-Age', Math.floor(cacheAge / 1000).toString());
                    res.json(cached.result);
                    return;
                }
            }
            // Parse options
            const isSoftLimited = req.auth?.softLimited === true;
            const hasExtraUsage = req.auth?.extraUsageAvailable === true;
            // Parse tag arrays from comma-separated strings
            const includeTagsArray = includeTags
                ? includeTags.split(',').map(t => t.trim()).filter(Boolean)
                : undefined;
            const excludeTagsArray = excludeTags
                ? excludeTags.split(',').map(t => t.trim()).filter(Boolean)
                : undefined;
            const languagesArray = languages
                ? languages.split(',').map(l => l.trim()).filter(Boolean)
                : undefined;
            // onlyMainContent is a shortcut for common include tags
            const finalIncludeTags = onlyMainContent === 'true'
                ? ['main', 'article', '.content', '#content']
                : includeTagsArray;
            // When actions are present, force browser mode (skip HTTP fast path)
            const hasActions = parsedActions && parsedActions.length > 0;
            const shouldRender = hasActions || render === 'true';
            const options = {
                // SOFT LIMIT: When over quota AND no extra usage, force HTTP-only
                // If extra usage is available, allow full functionality
                // Exception: actions always require render
                render: (isSoftLimited && !hasExtraUsage && !hasActions) ? false : shouldRender,
                wait: (isSoftLimited && !hasExtraUsage) ? 0 : (wait ? parseInt(wait, 10) : undefined),
                format: format || 'markdown',
                stream: stream === 'true',
                includeTags: finalIncludeTags,
                excludeTags: excludeTagsArray,
                images: images === 'true',
                actions: parsedActions,
                location: location || languagesArray ? {
                    country: location,
                    languages: languagesArray,
                } : undefined,
            };
            // Inform the user if their request was degraded
            if (isSoftLimited && !hasExtraUsage && render === 'true' && !hasActions) {
                res.setHeader('X-Degraded', 'render=true downgraded to HTTP-only (quota exceeded)');
            }
            // Validate wait parameter
            if (options.wait !== undefined && (isNaN(options.wait) || options.wait < 0 || options.wait > 60000)) {
                res.status(400).json({
                    error: 'invalid_request',
                    message: 'Invalid "wait" parameter: must be between 0 and 60000ms',
                });
                return;
            }
            // Validate format parameter
            if (!['markdown', 'text', 'html'].includes(options.format || '')) {
                res.status(400).json({
                    error: 'invalid_request',
                    message: 'Invalid "format" parameter: must be "markdown", "text", or "html"',
                });
                return;
            }
            const shouldStream = options.stream === true;
            if (shouldStream) {
                res.setHeader('X-Stream', 'true');
                if (typeof res.flushHeaders === 'function') {
                    res.flushHeaders();
                }
            }
            // Fetch content
            const startTime = Date.now();
            const result = await peel(url, options);
            const elapsed = Date.now() - startTime;
            // Determine fetch type from the result method
            const fetchType = result.method === 'stealth' ? 'stealth' :
                result.method === 'browser' ? 'stealth' : 'basic';
            // Log request to database (PostgreSQL only)
            const pgStore = authStore;
            if (req.auth?.keyInfo?.accountId && typeof pgStore.pool !== 'undefined') {
                // Log to usage_logs table (user_id = accountId from keyInfo)
                pgStore.pool.query(`INSERT INTO usage_logs 
            (user_id, endpoint, url, method, processing_time_ms, status_code, ip_address, user_agent)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [
                    req.auth.keyInfo.accountId,
                    'fetch',
                    url,
                    fetchType,
                    elapsed,
                    200,
                    req.ip || req.socket.remoteAddress,
                    req.get('user-agent'),
                ]).catch((err) => {
                    console.error('Failed to log request to usage_logs:', err);
                });
            }
            // Track usage (check for trackBurstUsage method to detect PostgresAuthStore)
            if (req.auth?.keyInfo?.key && typeof pgStore.trackBurstUsage === 'function') {
                // Track burst usage (always)
                await pgStore.trackBurstUsage(req.auth.keyInfo.key);
                // If soft-limited with extra usage available, charge to extra usage
                if (isSoftLimited && hasExtraUsage) {
                    const extraResult = await pgStore.trackExtraUsage(req.auth.keyInfo.key, fetchType, url, elapsed, 200 // PeelResult doesn't include statusCode, assume success
                    );
                    if (extraResult.success) {
                        res.setHeader('X-Extra-Usage-Charged', `$${extraResult.cost.toFixed(4)}`);
                        res.setHeader('X-Extra-Usage-New-Balance', extraResult.newBalance.toFixed(2));
                    }
                    else {
                        // Extra usage failed - fall back to soft limit
                        res.setHeader('X-Degraded', 'Extra usage insufficient, degraded to soft limit');
                    }
                }
                else if (!isSoftLimited) {
                    // Normal weekly usage tracking
                    await pgStore.trackUsage(req.auth.keyInfo.key, fetchType);
                }
                // If soft-limited WITHOUT extra usage, don't track (already over quota)
            }
            // Cache result (unless storeInCache is explicitly false)
            if (storeInCache !== 'false') {
                cache.set(cacheKey, {
                    result,
                    timestamp: Date.now(),
                });
            }
            // Add usage headers
            res.setHeader('X-Cache', 'MISS');
            res.setHeader('X-Credits-Used', '1');
            res.setHeader('X-Processing-Time', elapsed.toString());
            res.setHeader('X-Fetch-Type', fetchType);
            res.json(result);
        }
        catch (error) {
            const err = error;
            // Log error to database (PostgreSQL only)
            const pgStore = authStore;
            if (req.auth?.keyInfo?.accountId && typeof pgStore.pool !== 'undefined') {
                const url = req.query.url;
                const render = req.query.render === 'true';
                const fetchType = render ? 'stealth' : 'basic';
                pgStore.pool.query(`INSERT INTO usage_logs 
            (user_id, endpoint, url, method, status_code, error, ip_address, user_agent)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [
                    req.auth.keyInfo.accountId,
                    'fetch',
                    url,
                    fetchType,
                    500,
                    err.message || 'Unknown error',
                    req.ip || req.socket.remoteAddress,
                    req.get('user-agent'),
                ]).catch((logErr) => {
                    console.error('Failed to log error to usage_logs:', logErr);
                });
            }
            // SECURITY: Sanitize error messages to prevent information disclosure
            if (err.code) {
                // WebPeelError from core library - safe to expose with helpful context
                const safeMessage = err.message.replace(/[<>"']/g, ''); // Remove HTML chars
                const statusCode = err.code === 'TIMEOUT' ? 504
                    : err.code === 'BLOCKED' ? 403
                        : err.code === 'NETWORK' ? 502
                            : 500;
                const hints = {
                    TIMEOUT: 'Try increasing timeout with ?wait=10000, or use render=true for JS-heavy sites.',
                    BLOCKED: 'This site blocks automated requests. Try adding render=true or use stealth mode (costs 5 credits).',
                    NETWORK: 'Could not reach the target URL. Verify the URL is correct and the site is online.',
                };
                res.status(statusCode).json({
                    error: err.code,
                    message: safeMessage,
                    hint: hints[err.code] || undefined,
                    docs: 'https://webpeel.dev/docs/api-reference#errors',
                });
            }
            else {
                // Unexpected error - generic message only
                console.error('Fetch error:', err); // Log full error server-side
                res.status(500).json({
                    error: 'internal_error',
                    message: 'An unexpected error occurred while fetching the URL. If this persists, check https://webpeel.dev/status',
                    docs: 'https://webpeel.dev/docs/api-reference#errors',
                });
            }
        }
    });
    // -----------------------------------------------------------------------
    // POST /v1/fetch — same as GET but accepts JSON body with extract param
    // POST /v2/scrape — alias with identical behaviour
    // -----------------------------------------------------------------------
    async function handlePostFetch(req, res) {
        try {
            const { url, render, wait, format, includeTags, excludeTags, images, location, languages, onlyMainContent, actions: rawActions, storeInCache: storeFlag, 
            // Inline extraction (BYOK)
            extract, llmProvider, llmApiKey, llmModel, 
            // Firecrawl-compatible formats array
            formats, stream, } = req.body;
            // --- Validate URL -------------------------------------------------------
            if (!url || typeof url !== 'string') {
                res.status(400).json({
                    error: 'invalid_request',
                    message: 'Missing or invalid "url" in request body. Send JSON: { "url": "https://example.com" }',
                    example: 'curl -X POST https://api.webpeel.dev/v1/fetch -H "Content-Type: application/json" -d \'{"url":"https://example.com"}\'',
                    docs: 'https://webpeel.dev/docs/api-reference#fetch',
                });
                return;
            }
            if (url.length > 2048) {
                res.status(400).json({
                    error: 'invalid_url',
                    message: 'URL too long (max 2048 characters)',
                });
                return;
            }
            try {
                new URL(url);
            }
            catch {
                res.status(400).json({
                    error: 'invalid_url',
                    message: 'Invalid URL format',
                });
                return;
            }
            try {
                validateUrlForSSRF(url);
            }
            catch (error) {
                if (error instanceof SSRFError) {
                    res.status(400).json({
                        error: 'forbidden_url',
                        message: 'Cannot fetch localhost, private networks, or non-HTTP URLs',
                    });
                    return;
                }
                throw error;
            }
            // --- Parse and normalize actions -----------------------------------------
            let postActions;
            if (rawActions !== undefined) {
                try {
                    postActions = normalizeActions(rawActions);
                }
                catch (e) {
                    res.status(400).json({
                        error: 'invalid_request',
                        message: `Invalid "actions" parameter: ${e.message}`,
                    });
                    return;
                }
            }
            // --- Resolve inline extract from body or Firecrawl-compatible formats ---
            let resolvedExtract = extract;
            if (!resolvedExtract && Array.isArray(formats)) {
                const jsonFormat = formats.find((f) => (typeof f === 'object' && f !== null && f.type === 'json') ||
                    (typeof f === 'string' && f === 'json'));
                if (jsonFormat && typeof jsonFormat === 'object' && (jsonFormat.schema || jsonFormat.prompt)) {
                    resolvedExtract = {
                        schema: jsonFormat.schema,
                        prompt: jsonFormat.prompt,
                    };
                }
            }
            // Validate LLM params if extraction is requested
            if (resolvedExtract && (resolvedExtract.schema || resolvedExtract.prompt)) {
                if (!llmProvider || !VALID_LLM_PROVIDERS.includes(llmProvider)) {
                    res.status(400).json({
                        error: 'invalid_request',
                        message: `"llmProvider" is required for inline extraction and must be one of: ${VALID_LLM_PROVIDERS.join(', ')}`,
                    });
                    return;
                }
                if (!llmApiKey || typeof llmApiKey !== 'string' || llmApiKey.trim().length === 0) {
                    res.status(400).json({
                        error: 'invalid_request',
                        message: 'Missing or invalid "llmApiKey" (BYOK required for inline extraction)',
                    });
                    return;
                }
            }
            // --- Build PeelOptions ---------------------------------------------------
            const isSoftLimited = req.auth?.softLimited === true;
            const hasExtraUsage = req.auth?.extraUsageAvailable === true;
            const includeTagsArray = Array.isArray(includeTags) ? includeTags : undefined;
            const excludeTagsArray = Array.isArray(excludeTags) ? excludeTags : undefined;
            const languagesArray = Array.isArray(languages) ? languages : undefined;
            const finalIncludeTags = onlyMainContent === true
                ? ['main', 'article', '.content', '#content']
                : includeTagsArray;
            const resolvedFormat = format || 'markdown';
            if (!['markdown', 'text', 'html'].includes(resolvedFormat)) {
                res.status(400).json({
                    error: 'invalid_request',
                    message: 'Invalid "format" parameter: must be "markdown", "text", or "html"',
                });
                return;
            }
            const resolvedWait = typeof wait === 'number' ? wait : undefined;
            if (resolvedWait !== undefined && (isNaN(resolvedWait) || resolvedWait < 0 || resolvedWait > 60000)) {
                res.status(400).json({
                    error: 'invalid_request',
                    message: 'Invalid "wait" parameter: must be between 0 and 60000ms',
                });
                return;
            }
            // When actions are present, force browser mode
            const postHasActions = postActions && postActions.length > 0;
            const postShouldRender = postHasActions || render === true;
            const options = {
                render: (isSoftLimited && !hasExtraUsage && !postHasActions) ? false : postShouldRender,
                wait: (isSoftLimited && !hasExtraUsage) ? 0 : resolvedWait,
                format: resolvedFormat,
                stream: stream === true,
                includeTags: finalIncludeTags,
                excludeTags: excludeTagsArray,
                images: images === true,
                actions: postActions,
                location: location || languagesArray ? {
                    country: location,
                    languages: languagesArray,
                } : undefined,
            };
            if (isSoftLimited && !hasExtraUsage && render === true && !postHasActions) {
                res.setHeader('X-Degraded', 'render=true downgraded to HTTP-only (quota exceeded)');
            }
            const shouldStream = options.stream === true;
            if (shouldStream) {
                res.setHeader('X-Stream', 'true');
                if (typeof res.flushHeaders === 'function') {
                    res.flushHeaders();
                }
            }
            // --- Fetch content -------------------------------------------------------
            const startTime = Date.now();
            const result = await peel(url, options);
            const elapsed = Date.now() - startTime;
            // --- Inline extraction (post-fetch) -------------------------------------
            let jsonData;
            let extractTokensUsed;
            if (resolvedExtract && (resolvedExtract.schema || resolvedExtract.prompt) && llmApiKey) {
                const extractResult = await extractInlineJson(result.content, {
                    schema: resolvedExtract.schema,
                    prompt: resolvedExtract.prompt,
                    llmProvider: llmProvider,
                    llmApiKey: llmApiKey.trim(),
                    llmModel,
                });
                jsonData = extractResult.data;
                extractTokensUsed = extractResult.tokensUsed;
            }
            // --- Usage tracking (same as GET) ----------------------------------------
            const fetchType = result.method === 'stealth' ? 'stealth' :
                result.method === 'browser' ? 'stealth' : 'basic';
            const pgStore = authStore;
            if (req.auth?.keyInfo?.accountId && typeof pgStore.pool !== 'undefined') {
                pgStore.pool.query(`INSERT INTO usage_logs
            (user_id, endpoint, url, method, processing_time_ms, status_code, ip_address, user_agent)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [
                    req.auth.keyInfo.accountId,
                    'fetch',
                    url,
                    fetchType,
                    elapsed,
                    200,
                    req.ip || req.socket.remoteAddress,
                    req.get('user-agent'),
                ]).catch((err) => {
                    console.error('Failed to log request to usage_logs:', err);
                });
            }
            if (req.auth?.keyInfo?.key && typeof pgStore.trackBurstUsage === 'function') {
                await pgStore.trackBurstUsage(req.auth.keyInfo.key);
                if (isSoftLimited && hasExtraUsage) {
                    const extraResult = await pgStore.trackExtraUsage(req.auth.keyInfo.key, fetchType, url, elapsed, 200);
                    if (extraResult.success) {
                        res.setHeader('X-Extra-Usage-Charged', `$${extraResult.cost.toFixed(4)}`);
                        res.setHeader('X-Extra-Usage-New-Balance', extraResult.newBalance.toFixed(2));
                    }
                    else {
                        res.setHeader('X-Degraded', 'Extra usage insufficient, degraded to soft limit');
                    }
                }
                else if (!isSoftLimited) {
                    await pgStore.trackUsage(req.auth.keyInfo.key, fetchType);
                }
            }
            // Cache result
            const cacheKey = `fetch:${url}:${render}:${wait}:${format}:${includeTags}:${excludeTags}:${images}:${location}:${languages}:${onlyMainContent}:${stream}`;
            if (storeFlag !== false) {
                cache.set(cacheKey, { result, timestamp: Date.now() });
            }
            // --- Build response ------------------------------------------------------
            res.setHeader('X-Cache', 'MISS');
            res.setHeader('X-Credits-Used', '1');
            res.setHeader('X-Processing-Time', elapsed.toString());
            res.setHeader('X-Fetch-Type', fetchType);
            const responseBody = { ...result };
            if (jsonData !== undefined) {
                responseBody.json = jsonData;
            }
            if (extractTokensUsed) {
                responseBody.extractTokensUsed = extractTokensUsed;
            }
            res.json(responseBody);
        }
        catch (error) {
            const err = error;
            console.error('POST fetch/scrape error:', err);
            if (err.code) {
                const safeMessage = err.message.replace(/[<>"']/g, '');
                const statusCode = err.code === 'TIMEOUT' ? 504
                    : err.code === 'BLOCKED' ? 403
                        : err.code === 'NETWORK' ? 502
                            : 500;
                const hints = {
                    TIMEOUT: 'Try increasing timeout, or set render:true for JS-heavy sites.',
                    BLOCKED: 'Site blocks automated requests. Try render:true or stealth mode.',
                    NETWORK: 'Could not reach the target URL. Verify it is correct and online.',
                };
                res.status(statusCode).json({
                    error: err.code,
                    message: safeMessage,
                    hint: hints[err.code] || undefined,
                    docs: 'https://webpeel.dev/docs/api-reference#errors',
                });
            }
            else {
                res.status(500).json({
                    error: 'internal_error',
                    message: 'An unexpected error occurred. If this persists, check https://webpeel.dev/status',
                    docs: 'https://webpeel.dev/docs/api-reference#errors',
                });
            }
        }
    }
    router.post('/v1/fetch', handlePostFetch);
    router.post('/v2/scrape', handlePostFetch);
    return router;
}
//# sourceMappingURL=fetch.js.map