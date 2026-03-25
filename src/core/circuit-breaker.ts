/**
 * Circuit breaker for browser/Chromium operations.
 *
 * States:
 * - CLOSED (normal): requests pass through
 * - OPEN (tripped): requests immediately fail, no browser launch attempted
 * - HALF_OPEN (testing): allow 1 request through to test if browser works again
 *
 * Transitions:
 * - CLOSED → OPEN: after `failureThreshold` consecutive failures (default: 3)
 * - OPEN → HALF_OPEN: after `resetTimeoutMs` (default: 60s)
 * - HALF_OPEN → CLOSED: if test request succeeds
 * - HALF_OPEN → OPEN: if test request fails (reset timer)
 */

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerOptions {
  failureThreshold?: number; // consecutive failures before opening (default: 3)
  resetTimeoutMs?: number;   // ms to wait before trying again (default: 60000)
  name?: string;             // for logging
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly name: string;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 60000;
    this.name = options.name ?? 'browser';
  }

  /** Check if the circuit allows a request through */
  canExecute(): boolean {
    if (this.state === 'closed') return true;
    if (this.state === 'open') {
      // Check if enough time has passed to try again
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this.state = 'half_open';
        console.log(`[circuit-breaker:${this.name}] HALF_OPEN — testing browser availability`);
        return true;
      }
      return false;
    }
    // half_open: allow one request
    return true;
  }

  /** Record a successful operation */
  recordSuccess(): void {
    if (this.state === 'half_open') {
      console.log(`[circuit-breaker:${this.name}] CLOSED — browser recovered`);
    }
    this.failureCount = 0;
    this.state = 'closed';
  }

  /** Record a failed operation */
  recordFailure(error?: Error): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'half_open') {
      this.state = 'open';
      console.error(
        `[circuit-breaker:${this.name}] OPEN — test request failed, waiting ${this.resetTimeoutMs / 1000}s`,
      );
      return;
    }

    if (this.failureCount >= this.failureThreshold) {
      this.state = 'open';
      console.error(
        `[circuit-breaker:${this.name}] OPEN — ${this.failureCount} consecutive failures (${error?.message ?? 'unknown'}). Falling back to HTTP-only for ${this.resetTimeoutMs / 1000}s`,
      );
    }
  }

  /** Get current state for health checks */
  getState(): { state: CircuitState; failureCount: number; lastFailureTime: number } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
    };
  }

  /** Force reset (e.g., on manual intervention) */
  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    console.log(`[circuit-breaker:${this.name}] RESET — manually closed`);
  }
}

// Singleton browser circuit breaker
export const browserCircuitBreaker = new CircuitBreaker({
  name: 'browser',
  failureThreshold: 3,
  resetTimeoutMs: 60000, // 1 minute cooldown
});
