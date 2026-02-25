// ============================================================
// @webpeel/sdk — Error Classes
// ============================================================

export interface WebPeelErrorParams {
  message: string;
  type: string;
  status: number;
  hint?: string;
  requestId?: string;
}

/**
 * Base error class for all WebPeel API errors.
 */
export class WebPeelError extends Error {
  /** Machine-readable error type identifier */
  readonly type: string;
  /** HTTP status code */
  readonly status: number;
  /** Human-readable hint about how to fix the error */
  readonly hint?: string;
  /** Request ID for debugging — provide this to support */
  readonly requestId?: string;

  constructor({ message, type, status, hint, requestId }: WebPeelErrorParams) {
    super(message);
    this.name = 'WebPeelError';
    this.type = type;
    this.status = status;
    this.hint = hint;
    this.requestId = requestId;
    // Maintain proper prototype chain in transpiled code
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toString(): string {
    const parts = [`${this.name}: ${this.message} (status=${this.status}, type=${this.type})`];
    if (this.requestId) parts.push(`requestId=${this.requestId}`);
    if (this.hint) parts.push(`hint=${this.hint}`);
    return parts.join(' | ');
  }
}

/**
 * Thrown when the API key is missing, invalid, or revoked.
 * Fix: Check your API key at https://webpeel.dev/dashboard
 */
export class AuthenticationError extends WebPeelError {
  constructor(params: Omit<WebPeelErrorParams, 'type' | 'status'> & Partial<Pick<WebPeelErrorParams, 'type' | 'status'>>) {
    super({
      type: 'authentication_error',
      status: 401,
      ...params,
    });
    this.name = 'AuthenticationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the API rate limit is exceeded.
 * Respect the `retryAfter` value (seconds) before retrying.
 */
export class RateLimitError extends WebPeelError {
  /** Number of seconds to wait before retrying */
  readonly retryAfter?: number;

  constructor(params: Omit<WebPeelErrorParams, 'type' | 'status'> & Partial<Pick<WebPeelErrorParams, 'type' | 'status'>> & { retryAfter?: number }) {
    const { retryAfter, ...rest } = params;
    super({
      type: 'rate_limit_error',
      status: 429,
      ...rest,
    });
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a request exceeds the configured timeout.
 */
export class TimeoutError extends WebPeelError {
  constructor(params: Omit<WebPeelErrorParams, 'type' | 'status'> & Partial<Pick<WebPeelErrorParams, 'type' | 'status'>>) {
    super({
      type: 'timeout_error',
      status: 408,
      ...params,
    });
    this.name = 'TimeoutError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a target URL is blocked or returns an error that cannot be bypassed.
 */
export class BlockedError extends WebPeelError {
  constructor(params: Omit<WebPeelErrorParams, 'type' | 'status'> & Partial<Pick<WebPeelErrorParams, 'type' | 'status'>>) {
    super({
      type: 'blocked_error',
      status: 403,
      ...params,
    });
    this.name = 'BlockedError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when request parameters fail validation.
 */
export class ValidationError extends WebPeelError {
  /** Field that failed validation (if applicable) */
  readonly field?: string;

  constructor(params: Omit<WebPeelErrorParams, 'type' | 'status'> & Partial<Pick<WebPeelErrorParams, 'type' | 'status'>> & { field?: string }) {
    const { field, ...rest } = params;
    super({
      type: 'validation_error',
      status: 422,
      ...rest,
    });
    this.name = 'ValidationError';
    this.field = field;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the API returns an unexpected server error (5xx).
 */
export class ServerError extends WebPeelError {
  constructor(params: Omit<WebPeelErrorParams, 'type'> & Partial<Pick<WebPeelErrorParams, 'type'>>) {
    super({
      type: 'server_error',
      ...params,
    });
    this.name = 'ServerError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a network-level error occurs (no response received).
 */
export class NetworkError extends WebPeelError {
  constructor(message: string, requestId?: string) {
    super({
      message,
      type: 'network_error',
      status: 0,
      requestId,
    });
    this.name = 'NetworkError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// --------------- Error factory ---------------

interface ApiErrorBody {
  error?: string;
  message?: string;
  type?: string;
  hint?: string;
  code?: string;
}

/**
 * Creates the appropriate typed error from an API response.
 * @internal
 */
export function createApiError(
  status: number,
  body: ApiErrorBody,
  requestId?: string,
): WebPeelError {
  const message = body.error ?? body.message ?? `HTTP ${status}`;
  const type = body.type ?? body.code ?? 'api_error';
  const hint = body.hint;

  const params = { message, type, status, hint, requestId };

  if (status === 401 || type === 'authentication_error') {
    return new AuthenticationError(params);
  }
  if (status === 429 || type === 'rate_limit_error') {
    return new RateLimitError(params);
  }
  if (status === 403 || type === 'blocked_error') {
    return new BlockedError(params);
  }
  if (status === 408 || type === 'timeout_error') {
    return new TimeoutError(params);
  }
  if (status === 422 || status === 400 || type === 'validation_error') {
    return new ValidationError(params);
  }
  if (status >= 500) {
    return new ServerError(params);
  }
  return new WebPeelError(params);
}
