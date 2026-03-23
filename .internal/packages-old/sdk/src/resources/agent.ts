// ============================================================
// @webpeel/sdk — Agent Resource
// ============================================================

import type {
  AgentParams,
  AgentResult,
  AgentAsyncResult,
  AgentStreamEvent,
} from '../types.js';
import type { RequestCallOptions } from './base.js';

export class AgentResource {
  constructor(
    private readonly _request: <T>(path: string, opts?: RequestCallOptions) => Promise<T>,
    private readonly _rawFetch: (path: string, opts?: RequestCallOptions) => Promise<Response>,
  ) {}

  /**
   * Run the WebPeel agent synchronously and wait for the full result.
   *
   * The agent can search the web, fetch pages, extract structured data,
   * and summarize — all orchestrated in a single call.
   *
   * @example
   * const result = await client.agent.run({
   *   query: 'latest AI news',
   *   steps: ['search', 'fetch', 'summarize'],
   * });
   * console.log(result.output);
   */
  async run(params: AgentParams): Promise<AgentResult> {
    const { signal, timeout, ...body } = params;
    return this._request<AgentResult>('/v1/agent', {
      method: 'POST',
      body,
      signal,
      timeout,
    });
  }

  /**
   * Run the WebPeel agent asynchronously and return a job ID immediately.
   *
   * Poll the returned `jobId` via `client.jobs.waitForCompletion(jobId)`,
   * or supply a `webhookUrl` to receive the result as a POST notification.
   *
   * @example
   * const { jobId } = await client.agent.runAsync({
   *   url: 'https://example.com',
   *   steps: ['fetch', 'extract'],
   *   webhookUrl: 'https://my-server.example.com/webhook',
   * });
   * const result = await client.jobs.waitForCompletion(jobId);
   */
  async runAsync(params: AgentParams): Promise<AgentAsyncResult> {
    const { signal, timeout, ...body } = params;
    return this._request<AgentAsyncResult>('/v1/agent/async', {
      method: 'POST',
      body,
      signal,
      timeout,
    });
  }

  /**
   * Run the WebPeel agent and receive progress as a stream of Server-Sent Events.
   *
   * Yields `AgentStreamEvent` objects as the agent progresses through each step.
   * The final event will have `type: "done"` and include the complete result.
   *
   * @example
   * for await (const event of client.agent.runStream({ query: 'latest AI news', steps: ['search', 'summarize'] })) {
   *   if (event.type === 'step') console.log('Step:', event.step, event.message);
   *   if (event.type === 'done') console.log('Final:', event.result?.output);
   * }
   */
  async *runStream(params: AgentParams): AsyncIterable<AgentStreamEvent> {
    const { signal, timeout, ...body } = params;
    const response = await this._rawFetch('/v1/agent/stream', {
      method: 'POST',
      body,
      signal,
      timeout,
    });

    if (!response.body) {
      throw new Error('Agent stream response has no body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue; // SSE comment or empty
          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);
            if (data === '[DONE]') return;
            try {
              const event = JSON.parse(data) as AgentStreamEvent;
              yield event;
              if (event.type === 'done') return;
            } catch {
              // Malformed SSE data — skip
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
