/**
 * Resilient HTTP Client
 *
 * Shared HTTP client with timeouts, retries, jittered exponential backoff,
 * and circuit breaker for all outbound Conway API calls.
 *
 * Phase 1.3: Network Resilience (P1-8, P1-9)
 */

import type { HttpClientConfig } from "../types.js";
import { DEFAULT_HTTP_CLIENT_CONFIG } from "../types.js";

export class CircuitOpenError extends Error {
  constructor(public readonly resetAt: number) {
    super(
      `Circuit breaker is open until ${new Date(resetAt).toISOString()}`,
    );
    this.name = "CircuitOpenError";
  }
}

export class ResilientHttpClient {
  private readonly domainState = new Map<string, { failures: number; circuitOpenUntil: number }>();
  private readonly config: HttpClientConfig;

  constructor(config?: Partial<HttpClientConfig>) {
    this.config = { ...DEFAULT_HTTP_CLIENT_CONFIG, ...config };
  }

  private getDomainKey(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return "__default__";
    }
  }

  private getState(domain: string) {
    let state = this.domainState.get(domain);
    if (!state) {
      state = { failures: 0, circuitOpenUntil: 0 };
      this.domainState.set(domain, state);
    }
    return state;
  }

  async request(
    url: string,
    options?: RequestInit & {
      timeout?: number;
      idempotencyKey?: string;
      retries?: number;
    },
  ): Promise<Response> {
    const domain = this.getDomainKey(url);
    const state = this.getState(domain);

    if (Date.now() < state.circuitOpenUntil) {
      throw new CircuitOpenError(state.circuitOpenUntil);
    }

    const opts = options ?? {};
    const timeout = opts.timeout ?? this.config.baseTimeout;
    const maxRetries = opts.retries ?? this.config.maxRetries;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(url, {
          ...opts,
          signal: controller.signal,
          headers: {
            ...opts.headers,
            ...(opts.idempotencyKey
              ? { "Idempotency-Key": opts.idempotencyKey }
              : {}),
          },
        });
        clearTimeout(timer);

        // Count retryable HTTP errors toward circuit breaker, regardless of
        // whether we will actually retry. A server consistently returning 502
        // should eventually trip the circuit breaker.
        if (this.config.retryableStatuses.includes(response.status)) {
          // 429 with insufficient_quota is a billing issue, not transient.
          // Don't retry — return immediately so the router can try another provider.
          // We also skip incrementing circuit breaker failures since this isn't
          // a server health issue.
          if (response.status === 429) {
            const bodyText = await response.clone().text().catch(() => "");
            if (bodyText.includes("insufficient_quota") || bodyText.includes("billing")) {
              return response;
            }
          }

          state.failures++;
          if (state.failures >= this.config.circuitBreakerThreshold) {
            state.circuitOpenUntil = Date.now() + this.config.circuitBreakerResetMs;
          }
          if (attempt < maxRetries) {
            await this.backoff(attempt);
            continue;
          }
          return response;
        }

        // Only reset failure counter on truly successful responses
        state.failures = 0;
        return response;
      } catch (error) {
        clearTimeout(timer);
        state.failures++;
        if (state.failures >= this.config.circuitBreakerThreshold) {
          state.circuitOpenUntil = Date.now() + this.config.circuitBreakerResetMs;
        }
        if (attempt === maxRetries) throw error;
        await this.backoff(attempt);
      }
    }

    throw new Error("Unreachable");
  }

  private async backoff(attempt: number): Promise<void> {
    const delay = Math.min(
      this.config.backoffBase *
        Math.pow(2, attempt) *
        (0.5 + Math.random()),
      this.config.backoffMax,
    );
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  isCircuitOpen(domain?: string): boolean {
    if (domain) {
      const state = this.domainState.get(domain);
      return !!state && Date.now() < state.circuitOpenUntil;
    }
    // Any domain open = true (backward compat)
    for (const state of this.domainState.values()) {
      if (Date.now() < state.circuitOpenUntil) return true;
    }
    return false;
  }

  resetCircuit(domain?: string): void {
    if (domain) {
      this.domainState.delete(domain);
    } else {
      this.domainState.clear();
    }
  }

  getConsecutiveFailures(domain?: string): number {
    if (domain) {
      return this.domainState.get(domain)?.failures ?? 0;
    }
    // Max across all domains (backward compat)
    let max = 0;
    for (const state of this.domainState.values()) {
      if (state.failures > max) max = state.failures;
    }
    return max;
  }
}
