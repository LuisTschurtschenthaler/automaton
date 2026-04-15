/**
 * Inference Router
 *
 * Routes inference requests through the model registry using
 * tier-based selection, budget enforcement, and provider-specific
 * message transformation.
 */

import type BetterSqlite3 from "better-sqlite3";
import { ulid } from "ulid";
import type {
  InferenceRequest,
  InferenceResult,
  ModelEntry,
  SurvivalTier,
  InferenceTaskType,
  ModelProvider,
  ChatMessage,
  ModelPreference,
} from "../types.js";
import { ModelRegistry } from "./registry.js";
import { InferenceBudgetTracker } from "./budget.js";
import { DEFAULT_ROUTING_MATRIX, TASK_TIMEOUTS } from "./types.js";

type Database = BetterSqlite3.Database;

/** Map provider names to the env var that holds their API key. */
const PROVIDER_KEY_ENV: Record<string, string> = {
  ollama: "", // always available when configured
  conway: "CONWAY_API_KEY",
  github: "GITHUB_TOKEN",
};

/**
 * Returns true when the given provider can actually be called,
 * i.e. its API key env var is set (or the provider doesn't need one).
 */
function isProviderAvailable(provider: string): boolean {
  const envVar = PROVIDER_KEY_ENV[provider];
  // Providers not in the map (e.g. "other") or without an env requirement are always available
  if (!envVar) return true;
  const value = process.env[envVar];
  return typeof value === "string" && value.length > 0;
}

export class InferenceRouter {
  private db: Database;
  private registry: ModelRegistry;
  private budget: InferenceBudgetTracker;

  constructor(db: Database, registry: ModelRegistry, budget: InferenceBudgetTracker) {
    this.db = db;
    this.registry = registry;
    this.budget = budget;
  }

  /**
   * Route an inference request: select model, check budget,
   * transform messages, call inference, record cost.
   */
  async route(
    request: InferenceRequest,
    inferenceChat: (messages: any[], options: any) => Promise<any>,
  ): Promise<InferenceResult> {
    const { messages, taskType, tier, sessionId, turnId, tools } = request;

    // 1. Gather all eligible model candidates (routing matrix + user-configured fallbacks)
    const candidates = this.selectCandidates(tier, taskType);
    if (candidates.length === 0) {
      return {
        content: "",
        model: "none",
        provider: "other",
        inputTokens: 0,
        outputTokens: 0,
        costCents: 0,
        latencyMs: 0,
        finishReason: "error",
        toolCalls: undefined,
      };
    }

    let lastError: Error | undefined;

    for (const model of candidates) {
      // 2. Estimate cost and check budget
      const estimatedTokens = messages.reduce((sum, m) => sum + (m.content?.length || 0) / 4, 0);
      const estimatedCostCents = Math.ceil(
        (estimatedTokens / 1000) * model.costPer1kInput / 100 +
        (request.maxTokens || 1000) / 1000 * model.costPer1kOutput / 100,
      );

      const budgetCheck = this.budget.checkBudget(estimatedCostCents, model.modelId);
      if (!budgetCheck.allowed) {
        // Budget exceeded is terminal — no point trying other models
        return {
          content: `Budget exceeded: ${budgetCheck.reason}`,
          model: model.modelId,
          provider: model.provider,
          inputTokens: 0,
          outputTokens: 0,
          costCents: 0,
          latencyMs: 0,
          finishReason: "budget_exceeded",
        };
      }

      // 3. Check session budget
      if (request.sessionId && this.budget.config.sessionBudgetCents > 0) {
        const sessionCost = this.budget.getSessionCost(request.sessionId);
        if (sessionCost + estimatedCostCents > this.budget.config.sessionBudgetCents) {
          return {
            content: `Session budget exceeded: ${sessionCost}c spent + ${estimatedCostCents}c estimated > ${this.budget.config.sessionBudgetCents}c limit`,
            model: model.modelId,
            provider: model.provider,
            inputTokens: 0,
            outputTokens: 0,
            costCents: 0,
            latencyMs: 0,
            finishReason: "budget_exceeded",
          };
        }
      }

      // 4. Pass messages through — the inference client handles
      //    provider-specific formatting (Anthropic tool_result blocks, etc.)
      const transformedMessages = messages;

      // 5. Build inference options
      const preference = this.getPreference(tier, taskType);
      const maxTokens = request.maxTokens || preference?.maxTokens || model.maxTokens;
      const timeout = TASK_TIMEOUTS[taskType] || 120_000;

      const inferenceOptions: any = {
        model: model.modelId,
        maxTokens,
        tools: tools,
      };

      // 6. Call inference with timeout
      const startTime = Date.now();
      let response: any;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
          inferenceOptions.signal = controller.signal;
          response = await inferenceChat(transformedMessages, inferenceOptions);
        } finally {
          clearTimeout(timer);
        }
      } catch (error: any) {
        const latencyMs = Date.now() - startTime;
        if (error.name === "AbortError") {
          // Timeout — try next candidate
          lastError = new Error(`Inference timeout after ${timeout}ms (model: ${model.modelId})`);
          continue;
        }
        // Retryable provider errors — try next candidate
        lastError = error;
        continue;
      }
      const latencyMs = Date.now() - startTime;

      // 7. Calculate actual cost
      const inputTokens = response.usage?.promptTokens || 0;
      const outputTokens = response.usage?.completionTokens || 0;
      const actualCostCents = Math.ceil(
      (inputTokens / 1000) * model.costPer1kInput / 100 +
      (outputTokens / 1000) * model.costPer1kOutput / 100,
    );

    // 8. Record cost
    this.budget.recordCost({
      sessionId,
      turnId: turnId || null,
      model: model.modelId,
      provider: model.provider,
      inputTokens,
      outputTokens,
      costCents: actualCostCents,
      latencyMs,
      tier,
      taskType,
      cacheHit: false,
    });

    // 9. Build result
    return {
      content: response.message?.content || "",
      model: model.modelId,
      provider: model.provider,
      inputTokens,
      outputTokens,
      costCents: actualCostCents,
      latencyMs,
      toolCalls: response.toolCalls,
      finishReason: response.finishReason || "stop",
    };
    } // end for-each candidate

    // All candidates failed — re-throw the last error
    throw lastError || new Error("All inference candidates failed");
  }

  /**
   * Return all eligible model candidates for a given tier and task type,
   * in priority order. Used by route() to try each candidate in sequence.
   */
  selectCandidates(tier: SurvivalTier, taskType: InferenceTaskType): ModelEntry[] {
    const TIER_ORDER: Record<string, number> = {
      dead: 0, critical: 1, low_compute: 2, normal: 3, high: 4,
    };
    const tierRank = TIER_ORDER[tier] ?? 0;
    const seen = new Set<string>();
    const result: ModelEntry[] = [];

    // 1. Routing-matrix candidates
    const preference = this.getPreference(tier, taskType);
    if (preference && preference.candidates.length > 0) {
      for (const candidateId of preference.candidates) {
        if (seen.has(candidateId)) continue;
        const entry = this.registry.get(candidateId);
        if (entry && entry.enabled && isProviderAvailable(entry.provider)) {
          result.push(entry);
          seen.add(candidateId);
        }
      }
    }

    // 2. User-configured fallback models
    const strategy = this.budget.config;
    const fallbackIds: (string | undefined)[] =
      tier === "critical" || tier === "dead"
        ? [strategy.criticalModel, strategy.inferenceModel, strategy.lowComputeModel]
        : [strategy.inferenceModel, strategy.lowComputeModel, strategy.criticalModel];

    for (const modelId of fallbackIds) {
      if (!modelId || seen.has(modelId)) continue;
      const entry = this.registry.get(modelId);
      if (!entry || !entry.enabled) continue;
      if (!isProviderAvailable(entry.provider)) continue;
      const isFree = entry.costPer1kInput === 0 && entry.costPer1kOutput === 0;
      const tierOk = tierRank >= (TIER_ORDER[entry.tierMinimum] ?? 0);
      if (isFree || tierOk) {
        result.push(entry);
        seen.add(modelId);
      }
    }

    return result;
  }

  /**
   * Select the best model for a given tier and task type.
   * Returns the first eligible candidate, or null if none available.
   */
  selectModel(tier: SurvivalTier, taskType: InferenceTaskType): ModelEntry | null {
    const candidates = this.selectCandidates(tier, taskType);
    return candidates[0] ?? null;
  }

  /**
   * Transform messages for a specific provider.
   * Merges consecutive same-role messages.
   */
  transformMessagesForProvider(messages: ChatMessage[], provider: ModelProvider): ChatMessage[] {
    if (messages.length === 0) {
      throw new Error("Cannot route inference with empty message array");
    }

    return this.mergeConsecutiveSameRole(messages);
  }

  /**
   * Merge consecutive messages with the same role.
   */
  private mergeConsecutiveSameRole(messages: ChatMessage[]): ChatMessage[] {
    const result: ChatMessage[] = [];

    for (const msg of messages) {
      const last = result[result.length - 1];
      if (last && last.role === msg.role && msg.role !== "system" && msg.role !== "tool") {
        last.content = (last.content || "") + "\n" + (msg.content || "");
        if (msg.tool_calls) {
          last.tool_calls = [...(last.tool_calls || []), ...msg.tool_calls];
        }
        continue;
      }
      result.push({ ...msg });
    }

    return result;
  }

  private getPreference(tier: SurvivalTier, taskType: InferenceTaskType): ModelPreference | undefined {
    return DEFAULT_ROUTING_MATRIX[tier]?.[taskType];
  }
}
