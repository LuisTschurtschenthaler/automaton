/**
 * Auto Model Selection
 *
 * Resolves the best inference, low-compute, and critical models from
 * the model registry at startup. No manual config required.
 */

import type { ModelEntry, ModelStrategyConfig } from "../types.js";
import type { ModelRegistry } from "./registry.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("auto-select");

/** Tier rank used for ordering: higher = more capable. */
const TIER_RANK: Record<string, number> = {
  high: 4,
  normal: 3,
  low_compute: 2,
  critical: 1,
  dead: 0,
};

export interface ResolvedModels {
  inferenceModel: string;
  lowComputeModel: string;
  criticalModel: string;
}

/**
 * Pick the best available model for a given minimum tier.
 *
 * Prefers: tools support → larger context window → lower cost.
 * Falls back to any enabled model if nothing matches the tier filter.
 */
function pickBest(
  models: ModelEntry[],
  maxTierMinimum: string,
): ModelEntry | undefined {
  const maxRank = TIER_RANK[maxTierMinimum] ?? 0;

  const eligible = models.filter(
    (m) => m.enabled && (TIER_RANK[m.tierMinimum] ?? 0) <= maxRank,
  );

  if (eligible.length === 0) return undefined;

  // Sort: tools support first, then largest context, then cheapest
  eligible.sort((a, b) => {
    if (a.supportsTools !== b.supportsTools) return a.supportsTools ? -1 : 1;
    if (a.contextWindow !== b.contextWindow) return b.contextWindow - a.contextWindow;
    const costA = a.costPer1kInput + a.costPer1kOutput;
    const costB = b.costPer1kInput + b.costPer1kOutput;
    return costA - costB;
  });

  return eligible[0];
}

/**
 * Auto-select the three model tiers from the registry.
 *
 * - **inferenceModel**: best `normal`-tier model (tools, large context)
 * - **lowComputeModel**: best `low_compute`-tier model
 * - **criticalModel**: best `critical`-tier model (cheapest fallback)
 *
 * Each tier falls back to the tier above if nothing is available at
 * the target level. If the registry is empty, hard-coded defaults
 * are returned so the agent can still attempt to start.
 */
export function autoSelectModels(registry: ModelRegistry): ResolvedModels {
  const all = registry.getAll();

  const inference = pickBest(all, "normal");
  const lowCompute = pickBest(all, "low_compute") ?? inference;
  const critical = pickBest(all, "critical") ?? lowCompute ?? inference;

  const result: ResolvedModels = {
    inferenceModel: inference?.modelId ?? "gpt-4.1",
    lowComputeModel: lowCompute?.modelId ?? "gpt-4.1-mini",
    criticalModel: critical?.modelId ?? "gpt-4.1-nano",
  };

  logger.info(
    `Auto-selected models — inference: ${result.inferenceModel}, ` +
      `lowCompute: ${result.lowComputeModel}, critical: ${result.criticalModel}`,
  );

  return result;
}

/**
 * Fill missing model fields in a ModelStrategyConfig from the registry.
 * Fields already set (non-empty) are preserved.
 */
export function resolveModelStrategy(
  strategy: ModelStrategyConfig,
  registry: ModelRegistry,
): ModelStrategyConfig {
  const resolved = autoSelectModels(registry);
  return {
    ...strategy,
    inferenceModel: strategy.inferenceModel || resolved.inferenceModel,
    lowComputeModel: strategy.lowComputeModel || resolved.lowComputeModel,
    criticalModel: strategy.criticalModel || resolved.criticalModel,
  };
}
