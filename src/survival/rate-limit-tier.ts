/**
 * Rate-Limit Based Survival Tier
 *
 * Derives SurvivalTier from GitHub API rate limit headers
 * instead of Conway credit balance.
 */

import type { SurvivalTier } from "../types.js";
import { SURVIVAL_THRESHOLDS } from "../types.js";

export interface RateLimitInfo {
  remaining: number;
  limit: number;
}

/**
 * Determine the survival tier based on GitHub API rate limit ratio.
 *
 * Thresholds (remaining/limit):
 *   > 50%  → high
 *   > 20%  → normal
 *   > 5%   → low_compute
 *   > 0%   → critical
 *   = 0    → dead
 *
 * If limit is 0 or unknown, defaults to "normal" (safe fallback).
 */
export function getSurvivalTier(rateLimits: RateLimitInfo): SurvivalTier {
  if (rateLimits.limit <= 0) return "normal";

  const ratio = rateLimits.remaining / rateLimits.limit;

  if (ratio > SURVIVAL_THRESHOLDS.high) return "high";
  if (ratio > SURVIVAL_THRESHOLDS.normal) return "normal";
  if (ratio > SURVIVAL_THRESHOLDS.low_compute) return "low_compute";
  if (rateLimits.remaining > 0) return "critical";
  return "dead";
}

/**
 * Fetch GitHub API rate limit info.
 * Returns { remaining, limit } from the /rate_limit endpoint.
 */
export async function fetchGitHubRateLimits(token?: string): Promise<RateLimitInfo> {
  if (!token) {
    return { remaining: 5000, limit: 5000 }; // Default: assume healthy
  }

  try {
    const resp = await fetch("https://api.github.com/rate_limit", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    });

    if (!resp.ok) {
      return { remaining: 5000, limit: 5000 };
    }

    const data = await resp.json() as any;
    const core = data.resources?.core;
    if (core) {
      return { remaining: core.remaining, limit: core.limit };
    }
    return { remaining: 5000, limit: 5000 };
  } catch {
    return { remaining: 5000, limit: 5000 };
  }
}

/**
 * Format rate limit info for display.
 */
export function formatRateLimits(info: RateLimitInfo): string {
  const pct = info.limit > 0 ? ((info.remaining / info.limit) * 100).toFixed(1) : "N/A";
  return `${info.remaining}/${info.limit} (${pct}%)`;
}
