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
// GitHub Models is the sole inference provider (Enterprise plan — no per-token billing).

export const STATIC_MODEL_BASELINE: Omit<ModelEntry, "lastSeen" | "createdAt" | "updatedAt">[] = [
  // ── GitHub Models (primary provider) ──
  // Context windows reflect GitHub Models enforced limits (from catalog).
  // The router self-corrects via 413 responses if these drift.

  // ── GPT-5 family (400K context) ──
  {
    modelId: "gpt-5.4",
    provider: "github",
    displayName: "GPT-5.4 (GitHub)",
    tierMinimum: "high",
    costPer1kInput: 0,
    costPer1kOutput: 0,
    maxTokens: 16384,
    contextWindow: 400000,
    supportsTools: true,
    supportsVision: true,
    parameterStyle: "max_completion_tokens",
    enabled: true,
  },
  {
    modelId: "gpt-5.2",
    provider: "github",
    displayName: "GPT-5.2 (GitHub)",
    tierMinimum: "normal",
    costPer1kInput: 0,
    costPer1kOutput: 0,
    maxTokens: 16384,
    contextWindow: 400000,
    supportsTools: true,
    supportsVision: true,
    parameterStyle: "max_completion_tokens",
    enabled: true,
  },
  {
    modelId: "gpt-5.3-codex",
    provider: "github",
    displayName: "GPT-5.3 Codex (GitHub)",
    tierMinimum: "normal",
    costPer1kInput: 0,
    costPer1kOutput: 0,
    maxTokens: 16384,
    contextWindow: 400000,
    supportsTools: true,
    supportsVision: true,
    parameterStyle: "max_completion_tokens",
    enabled: true,
  },

  // ── Claude family (200K context) ──
  {
    modelId: "claude-opus-4.6",
    provider: "github",
    displayName: "Claude Opus 4.6 (GitHub)",
    tierMinimum: "high",
    costPer1kInput: 0,
    costPer1kOutput: 0,
    maxTokens: 16384,
    contextWindow: 200000,
    supportsTools: true,
    supportsVision: true,
    parameterStyle: "max_tokens",
    enabled: true,
  },
  {
    modelId: "claude-sonnet-4.6",
    provider: "github",
    displayName: "Claude Sonnet 4.6 (GitHub)",
    tierMinimum: "low_compute",
    costPer1kInput: 0,
    costPer1kOutput: 0,
    maxTokens: 16384,
    contextWindow: 200000,
    supportsTools: true,
    supportsVision: true,
    parameterStyle: "max_tokens",
    enabled: true,
  },

  // ── Gemini family ──
  {
    modelId: "gemini-3.1-pro",
    provider: "github",
    displayName: "Gemini 3.1 Pro (GitHub)",
    tierMinimum: "normal",
    costPer1kInput: 0,
    costPer1kOutput: 0,
    maxTokens: 16384,
    contextWindow: 200000,
    supportsTools: true,
    supportsVision: true,
    parameterStyle: "max_completion_tokens",
    enabled: true,
  },
  {
    modelId: "gemini-3-flash",
    provider: "github",
    displayName: "Gemini 3 Flash (GitHub)",
    tierMinimum: "low_compute",
    costPer1kInput: 0,
    costPer1kOutput: 0,
    maxTokens: 16384,
    contextWindow: 173000,
    supportsTools: true,
    supportsVision: true,
    parameterStyle: "max_completion_tokens",
    enabled: true,
  },

  // ── GPT-4 family (legacy, smaller context) ──
  {
    modelId: "gpt-4.1",
    provider: "github",
    displayName: "GPT-4.1 (GitHub)",
    tierMinimum: "low_compute",
    costPer1kInput: 0,
    costPer1kOutput: 0,
    maxTokens: 4096,
    contextWindow: 128000,
    supportsTools: true,
    supportsVision: true,
    parameterStyle: "max_completion_tokens",
    enabled: true,
  },
  {
    modelId: "gpt-4o",
    provider: "github",
    displayName: "GPT-4o (GitHub)",
    tierMinimum: "critical",
    costPer1kInput: 0,
    costPer1kOutput: 0,
    maxTokens: 4096,
    contextWindow: 68000,
    supportsTools: true,
    supportsVision: true,
    parameterStyle: "max_completion_tokens",
    enabled: true,
  },
];

// === Default Routing Matrix ===
// Maps (tier, taskType) -> ModelPreference with candidate models
// All inference routes through GitHub Models (Copilot).
// For tool-heavy tasks (agent_turn, planning, safety_check), prefer models with
// large context windows (128k) since tool definitions alone can consume 10k+ tokens.

export const DEFAULT_ROUTING_MATRIX: RoutingMatrix = {
  high: {
    agent_turn: { candidates: ["gpt-5.4", "gpt-5.2", "claude-opus-4.6", "gemini-3.1-pro"], maxTokens: 16384, ceilingCents: -1 },
    heartbeat_triage: { candidates: ["gemini-3-flash", "claude-sonnet-4.6", "gpt-4o"], maxTokens: 2048, ceilingCents: 5 },
    safety_check: { candidates: ["claude-opus-4.6", "gpt-5.4", "gpt-5.2", "gemini-3.1-pro"], maxTokens: 8192, ceilingCents: 20 },
    summarization: { candidates: ["claude-sonnet-4.6", "gemini-3-flash", "gpt-4.1"], maxTokens: 4096, ceilingCents: 15 },
    planning: { candidates: ["gpt-5.4", "gpt-5.2", "claude-opus-4.6", "gemini-3.1-pro"], maxTokens: 16384, ceilingCents: -1 },
  },
  normal: {
    agent_turn: { candidates: ["gpt-5.2", "claude-sonnet-4.6", "gemini-3.1-pro", "gpt-5.3-codex", "gpt-4.1"], maxTokens: 8192, ceilingCents: -1 },
    heartbeat_triage: { candidates: ["gemini-3-flash", "claude-sonnet-4.6", "gpt-4o"], maxTokens: 2048, ceilingCents: 5 },
    safety_check: { candidates: ["gpt-5.2", "claude-sonnet-4.6", "gemini-3.1-pro", "gpt-4.1"], maxTokens: 4096, ceilingCents: 10 },
    summarization: { candidates: ["gemini-3-flash", "claude-sonnet-4.6", "gpt-4.1", "gpt-4o"], maxTokens: 4096, ceilingCents: 10 },
    planning: { candidates: ["gpt-5.2", "claude-sonnet-4.6", "gemini-3.1-pro", "gpt-5.3-codex"], maxTokens: 8192, ceilingCents: -1 },
  },
  low_compute: {
    agent_turn: { candidates: ["claude-sonnet-4.6", "gemini-3-flash", "gpt-4.1", "gpt-4o"], maxTokens: 4096, ceilingCents: 10 },
    heartbeat_triage: { candidates: ["gpt-4o", "gemini-3-flash", "gpt-4.1"], maxTokens: 1024, ceilingCents: 2 },
    safety_check: { candidates: ["claude-sonnet-4.6", "gemini-3-flash", "gpt-4.1", "gpt-4o"], maxTokens: 2048, ceilingCents: 5 },
    summarization: { candidates: ["gpt-4o", "gemini-3-flash", "gpt-4.1"], maxTokens: 2048, ceilingCents: 5 },
    planning: { candidates: ["claude-sonnet-4.6", "gemini-3-flash", "gpt-4.1"], maxTokens: 2048, ceilingCents: 5 },
  },
  critical: {
    agent_turn: { candidates: ["gpt-4o", "gemini-3-flash", "gpt-4.1"], maxTokens: 2048, ceilingCents: 3 },
    heartbeat_triage: { candidates: ["gpt-4o", "gemini-3-flash", "gpt-4.1"], maxTokens: 512, ceilingCents: 1 },
    safety_check: { candidates: ["gpt-4o", "gemini-3-flash", "gpt-4.1"], maxTokens: 1024, ceilingCents: 2 },
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
  maxTokensPerTurn: 4096,
  hourlyBudgetCents: 0,
  sessionBudgetCents: 0,
  perCallCeilingCents: 0,
  enableModelFallback: true,
};
