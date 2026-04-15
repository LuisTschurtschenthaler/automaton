/**
 * Inference & Model Strategy — Internal Types
 *
 * Re-exports shared types from types.ts and defines internal constants
 * for the inference routing subsystem.
 */

export type {
  SurvivalTier,
  ModelProvider,
  InferenceTaskType,
  ModelEntry,
  ModelPreference,
  RoutingMatrix,
  InferenceRequest,
  InferenceResult,
  InferenceCostRow,
  ModelRegistryRow,
  ModelStrategyConfig,
  ChatMessage,
} from "../types.js";

import type {
  RoutingMatrix,
  ModelEntry,
  ModelStrategyConfig,
} from "../types.js";

// === Default Retry Policy ===

export const DEFAULT_RETRY_POLICY = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
} as const;

// === Per-Task Timeout Overrides (ms) ===

export const TASK_TIMEOUTS: Record<string, number> = {
  heartbeat_triage: 15_000,
  safety_check: 30_000,
  summarization: 60_000,
  agent_turn: 120_000,
  planning: 120_000,
};

// === Static Model Baseline ===
// Known models with realistic pricing (hundredths of cents per 1k tokens)
// GitHub models are primary (Enterprise plan — no per-token billing, full context windows).
// Conway models are kept as fallbacks for models not yet available on GitHub.

export const STATIC_MODEL_BASELINE: Omit<ModelEntry, "lastSeen" | "createdAt" | "updatedAt">[] = [
  // ── GitHub Models (primary provider — Copilot Enterprise) ──
  // Enterprise plan: full context windows, no per-token billing, high RPM.
  {
    modelId: "gpt-4.1",
    provider: "github",
    displayName: "GPT-4.1 (GitHub)",
    tierMinimum: "normal",
    costPer1kInput: 0,
    costPer1kOutput: 0,
    maxTokens: 32768,
    contextWindow: 1047576,
    supportsTools: true,
    supportsVision: true,
    parameterStyle: "max_completion_tokens",
    enabled: true,
  },
  {
    modelId: "gpt-4.1-mini",
    provider: "github",
    displayName: "GPT-4.1 Mini (GitHub)",
    tierMinimum: "low_compute",
    costPer1kInput: 0,
    costPer1kOutput: 0,
    maxTokens: 16384,
    contextWindow: 1047576,
    supportsTools: true,
    supportsVision: true,
    parameterStyle: "max_completion_tokens",
    enabled: true,
  },
  {
    modelId: "gpt-4.1-nano",
    provider: "github",
    displayName: "GPT-4.1 Nano (GitHub)",
    tierMinimum: "critical",
    costPer1kInput: 0,
    costPer1kOutput: 0,
    maxTokens: 16384,
    contextWindow: 1047576,
    supportsTools: true,
    supportsVision: false,
    parameterStyle: "max_completion_tokens",
    enabled: true,
  },
  {
    modelId: "gpt-4o",
    provider: "github",
    displayName: "GPT-4o (GitHub)",
    tierMinimum: "normal",
    costPer1kInput: 0,
    costPer1kOutput: 0,
    maxTokens: 16384,
    contextWindow: 128000,
    supportsTools: true,
    supportsVision: true,
    parameterStyle: "max_completion_tokens",
    enabled: true,
  },
  {
    modelId: "gpt-4o-mini",
    provider: "github",
    displayName: "GPT-4o Mini (GitHub)",
    tierMinimum: "low_compute",
    costPer1kInput: 0,
    costPer1kOutput: 0,
    maxTokens: 16384,
    contextWindow: 128000,
    supportsTools: true,
    supportsVision: true,
    parameterStyle: "max_completion_tokens",
    enabled: true,
  },
  {
    modelId: "o4-mini",
    provider: "github",
    displayName: "o4-mini (GitHub)",
    tierMinimum: "normal",
    costPer1kInput: 0,
    costPer1kOutput: 0,
    maxTokens: 16384,
    contextWindow: 128000,
    supportsTools: true,
    supportsVision: true,
    parameterStyle: "max_completion_tokens",
    enabled: true,
  },
];

// === Default Routing Matrix ===
// Maps (tier, taskType) -> ModelPreference with candidate models
// All inference routes through GitHub Models (Copilot).

export const DEFAULT_ROUTING_MATRIX: RoutingMatrix = {
  high: {
    agent_turn: { candidates: ["gpt-4.1", "gpt-4o", "o4-mini"], maxTokens: 8192, ceilingCents: -1 },
    heartbeat_triage: { candidates: ["gpt-4.1-mini", "gpt-4o-mini", "gpt-4.1-nano"], maxTokens: 2048, ceilingCents: 5 },
    safety_check: { candidates: ["o4-mini", "gpt-4.1", "gpt-4o"], maxTokens: 4096, ceilingCents: 20 },
    summarization: { candidates: ["gpt-4.1-mini", "gpt-4o-mini", "gpt-4.1-nano"], maxTokens: 4096, ceilingCents: 15 },
    planning: { candidates: ["gpt-4.1", "o4-mini", "gpt-4o"], maxTokens: 8192, ceilingCents: -1 },
  },
  normal: {
    agent_turn: { candidates: ["gpt-4.1", "gpt-4o", "gpt-4.1-mini", "gpt-4o-mini"], maxTokens: 4096, ceilingCents: -1 },
    heartbeat_triage: { candidates: ["gpt-4.1-mini", "gpt-4o-mini", "gpt-4.1-nano"], maxTokens: 2048, ceilingCents: 5 },
    safety_check: { candidates: ["gpt-4.1", "gpt-4o", "gpt-4.1-mini", "gpt-4o-mini"], maxTokens: 4096, ceilingCents: 10 },
    summarization: { candidates: ["gpt-4.1-mini", "gpt-4o-mini", "gpt-4.1-nano"], maxTokens: 4096, ceilingCents: 10 },
    planning: { candidates: ["gpt-4.1", "gpt-4o", "gpt-4.1-mini", "gpt-4o-mini"], maxTokens: 4096, ceilingCents: -1 },
  },
  low_compute: {
    agent_turn: { candidates: ["gpt-4.1-mini", "gpt-4o-mini", "gpt-4.1-nano"], maxTokens: 4096, ceilingCents: 10 },
    heartbeat_triage: { candidates: ["gpt-4.1-nano", "gpt-4o-mini", "gpt-4.1-mini"], maxTokens: 1024, ceilingCents: 2 },
    safety_check: { candidates: ["gpt-4.1-mini", "gpt-4o-mini", "gpt-4.1-nano"], maxTokens: 2048, ceilingCents: 5 },
    summarization: { candidates: ["gpt-4.1-nano", "gpt-4o-mini", "gpt-4.1-mini"], maxTokens: 2048, ceilingCents: 5 },
    planning: { candidates: ["gpt-4.1-mini", "gpt-4o-mini", "gpt-4.1-nano"], maxTokens: 2048, ceilingCents: 5 },
  },
  critical: {
    agent_turn: { candidates: ["gpt-4.1-nano", "gpt-4o-mini", "gpt-4.1-mini"], maxTokens: 2048, ceilingCents: 3 },
    heartbeat_triage: { candidates: ["gpt-4.1-nano", "gpt-4o-mini", "gpt-4.1-mini"], maxTokens: 512, ceilingCents: 1 },
    safety_check: { candidates: ["gpt-4.1-nano", "gpt-4o-mini", "gpt-4.1-mini"], maxTokens: 1024, ceilingCents: 2 },
    summarization: { candidates: [], maxTokens: 0, ceilingCents: 0 },
    planning: { candidates: [], maxTokens: 0, ceilingCents: 0 },
  },
  dead: {
    agent_turn: { candidates: [], maxTokens: 0, ceilingCents: 0 },
    heartbeat_triage: { candidates: [], maxTokens: 0, ceilingCents: 0 },
    safety_check: { candidates: [], maxTokens: 0, ceilingCents: 0 },
    summarization: { candidates: [], maxTokens: 0, ceilingCents: 0 },
    planning: { candidates: [], maxTokens: 0, ceilingCents: 0 },
  },
};

// === Default Model Strategy Config ===

export const DEFAULT_MODEL_STRATEGY_CONFIG: ModelStrategyConfig = {
  inferenceModel: "gpt-4.1",
  lowComputeModel: "gpt-4.1-mini",
  criticalModel: "gpt-4.1-nano",
  maxTokensPerTurn: 4096,
  hourlyBudgetCents: 0,
  sessionBudgetCents: 0,
  perCallCeilingCents: 0,
  enableModelFallback: true,
};
