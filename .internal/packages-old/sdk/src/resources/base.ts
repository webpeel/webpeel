// ============================================================
// @webpeel/sdk — Base Resource Interface
// ============================================================

export interface RequestCallOptions {
  signal?: AbortSignal;
  timeout?: number;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
}

export interface BaseResource {
  /** @internal */
  _request<T>(path: string, options?: RequestCallOptions): Promise<T>;
}
