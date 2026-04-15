/**
 * GitHub Provider Integration Tests
 *
 * Tests: GitHub models in ModelRegistry seeding, InferenceRouter
 * candidate selection with GitHub provider, STATIC_MODEL_BASELINE
 * GitHub entries, and conway/inference backend resolution.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import { MIGRATION_V6 } from "../state/schema.js";
import { ModelRegistry } from "../inference/registry.js";
import { InferenceRouter } from "../inference/router.js";
import { InferenceBudgetTracker } from "../inference/budget.js";
import { STATIC_MODEL_BASELINE, DEFAULT_MODEL_STRATEGY_CONFIG } from "../inference/types.js";

let db: BetterSqlite3.Database;

const savedEnv: Record<string, string | undefined> = {};

function setEnv(key: string, value: string): void {
  savedEnv[key] = process.env[key];
  process.env[key] = value;
}

function clearEnv(key: string): void {
  savedEnv[key] = process.env[key];
  delete process.env[key];
}

function createTestDb(): BetterSqlite3.Database {
  const testDb = new Database(":memory:");
  testDb.pragma("journal_mode = WAL");
  testDb.pragma("foreign_keys = ON");
  testDb.exec(MIGRATION_V6);
  return testDb;
}

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  db.close();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  Object.keys(savedEnv).forEach((k) => delete savedEnv[k]);
});

// ─── STATIC_MODEL_BASELINE ──────────────────────────────────────

describe("STATIC_MODEL_BASELINE — GitHub models", () => {
  it("includes gpt-4o model with github provider", () => {
    const gpt4o = STATIC_MODEL_BASELINE.find((m) => m.modelId === "gpt-4o");
    expect(gpt4o).toBeDefined();
    expect(gpt4o!.provider).toBe("github");
    expect(gpt4o!.displayName).toBe("GPT-4o (GitHub)");
    expect(gpt4o!.supportsTools).toBe(true);
    expect(gpt4o!.supportsVision).toBe(true);
    expect(gpt4o!.enabled).toBe(true);
  });

  it("includes gpt-4o-mini model with github provider", () => {
    const mini = STATIC_MODEL_BASELINE.find((m) => m.modelId === "gpt-4o-mini");
    expect(mini).toBeDefined();
    expect(mini!.provider).toBe("github");
    expect(mini!.tierMinimum).toBe("low_compute");
    expect(mini!.costPer1kInput).toBe(0);
    expect(mini!.costPer1kOutput).toBe(0);
  });

  it("github models use max_completion_tokens parameter style", () => {
    const githubModels = STATIC_MODEL_BASELINE.filter((m) => m.provider === "github");
    expect(githubModels.length).toBe(6);
    for (const model of githubModels) {
      expect(model.parameterStyle).toBe("max_completion_tokens");
    }
  });
});

// ─── ModelRegistry — GitHub seeding ──────────────────────────────

describe("ModelRegistry — GitHub model seeding", () => {
  it("seeds github models from static baseline", () => {
    const registry = new ModelRegistry(db);
    registry.initialize();

    const gpt4o = registry.get("gpt-4o");
    expect(gpt4o).toBeDefined();
    expect(gpt4o!.provider).toBe("github");
    expect(gpt4o!.modelId).toBe("gpt-4o");
  });

  it("seeds gpt-4o-mini from static baseline", () => {
    const registry = new ModelRegistry(db);
    registry.initialize();

    const mini = registry.get("gpt-4o-mini");
    expect(mini).toBeDefined();
    expect(mini!.provider).toBe("github");
  });

  it("github models are enabled by default", () => {
    const registry = new ModelRegistry(db);
    registry.initialize();

    const gpt4o = registry.get("gpt-4o");
    expect(gpt4o!.enabled).toBe(true);

    const mini = registry.get("gpt-4o-mini");
    expect(mini!.enabled).toBe(true);
  });

  it("github models appear in getAvailable", () => {
    const registry = new ModelRegistry(db);
    registry.initialize();

    const available = registry.getAvailable();
    const githubModels = available.filter((m) => m.provider === "github");
    expect(githubModels.length).toBeGreaterThan(0);
  });

  it("github models can be disabled", () => {
    const registry = new ModelRegistry(db);
    registry.initialize();

    registry.setEnabled("gpt-4o", false);
    const gpt4o = registry.get("gpt-4o");
    expect(gpt4o!.enabled).toBe(false);

    const available = registry.getAvailable();
    const ids = available.map((m) => m.modelId);
    expect(ids).not.toContain("gpt-4o");
  });
});

// ─── InferenceRouter — GitHub candidate selection ─────────────────

describe("InferenceRouter — GitHub provider routing", () => {
  it("selects github model when GITHUB_TOKEN is set and others are missing", () => {
    setEnv("GITHUB_TOKEN", "ghp_test");
    clearEnv("CONWAY_API_KEY");

    const registry = new ModelRegistry(db);
    registry.initialize();

    // Disable all non-github models to force github selection
    const allModels = registry.getAll();
    for (const model of allModels) {
      if (model.provider !== "github") {
        registry.setEnabled(model.modelId, false);
      }
    }

    // Use strategy config pointing at github models so they appear as fallbacks
    const strategy = {
      ...DEFAULT_MODEL_STRATEGY_CONFIG,
      inferenceModel: "gpt-4o",
      lowComputeModel: "gpt-4o-mini",
      criticalModel: "gpt-4o-mini",
    };

    const budget = new InferenceBudgetTracker(db, strategy);
    const router = new InferenceRouter(db, registry, budget);

    const candidates = router.selectCandidates("normal", "agent_turn");
    const githubCandidates = candidates.filter((c) => c.provider === "github");
    expect(githubCandidates.length).toBeGreaterThan(0);
  });

  it("github models are skipped when GITHUB_TOKEN is not set", () => {
    clearEnv("GITHUB_TOKEN");

    const registry = new ModelRegistry(db);
    registry.initialize();
    const budget = new InferenceBudgetTracker(db, DEFAULT_MODEL_STRATEGY_CONFIG);
    const router = new InferenceRouter(db, registry, budget);

    const candidates = router.selectCandidates("normal", "agent_turn");
    const githubCandidates = candidates.filter((c) => c.provider === "github");
    expect(githubCandidates.length).toBe(0);
  });

  it("github models appear when GITHUB_TOKEN is set", () => {
    setEnv("GITHUB_TOKEN", "ghp_test");

    const registry = new ModelRegistry(db);
    registry.initialize();
    const budget = new InferenceBudgetTracker(db, DEFAULT_MODEL_STRATEGY_CONFIG);
    const router = new InferenceRouter(db, registry, budget);

    // Use high tier agent_turn which has many candidates in the routing matrix
    const candidates = router.selectCandidates("high", "agent_turn");
    const providers = new Set(candidates.map((c) => c.provider));

    expect(providers.has("github")).toBe(true);
  });

  it("selectModel returns github model as fallback when others are disabled", () => {
    setEnv("GITHUB_TOKEN", "ghp_test");
    clearEnv("CONWAY_API_KEY");

    const registry = new ModelRegistry(db);
    registry.initialize();

    // Disable all non-github models
    for (const model of registry.getAll()) {
      if (model.provider !== "github") {
        registry.setEnabled(model.modelId, false);
      }
    }

    // Use a strategy config pointing at github models
    const strategy = {
      ...DEFAULT_MODEL_STRATEGY_CONFIG,
      inferenceModel: "gpt-4o",
      lowComputeModel: "gpt-4o-mini",
      criticalModel: "gpt-4o-mini",
    };

    const budget = new InferenceBudgetTracker(db, strategy);
    const router = new InferenceRouter(db, registry, budget);

    const model = router.selectModel("normal", "agent_turn");
    expect(model).not.toBeNull();
    expect(model!.provider).toBe("github");
  });
});

// ─── InferenceRouter — route() with GitHub ────────────────────────

describe("InferenceRouter — route() with GitHub model", () => {
  it("routes successfully through github model", async () => {
    setEnv("GITHUB_TOKEN", "ghp_test");
    clearEnv("CONWAY_API_KEY");

    const registry = new ModelRegistry(db);
    registry.initialize();

    // Disable non-github
    for (const model of registry.getAll()) {
      if (model.provider !== "github") {
        registry.setEnabled(model.modelId, false);
      }
    }

    const strategy = {
      ...DEFAULT_MODEL_STRATEGY_CONFIG,
      inferenceModel: "gpt-4o",
      lowComputeModel: "gpt-4o-mini",
      criticalModel: "gpt-4o-mini",
    };

    const budget = new InferenceBudgetTracker(db, strategy);
    const router = new InferenceRouter(db, registry, budget);

    const mockChat = async (_msgs: any[], opts: any) => ({
      message: { role: "assistant", content: "Hello from GitHub model" },
      usage: { promptTokens: 100, completionTokens: 50 },
      finishReason: "stop",
    });

    const result = await router.route(
      {
        messages: [{ role: "user", content: "test" }],
        taskType: "agent_turn",
        tier: "normal",
        sessionId: "test-session",
        turnId: "test-turn",
      },
      mockChat,
    );

    expect(result.content).toBe("Hello from GitHub model");
    expect(result.provider).toBe("github");
    expect(result.model).toBe("gpt-4.1");
  });

  it("records cost for github model calls", async () => {
    setEnv("GITHUB_TOKEN", "ghp_test");
    clearEnv("CONWAY_API_KEY");

    const registry = new ModelRegistry(db);
    registry.initialize();

    for (const model of registry.getAll()) {
      if (model.provider !== "github") {
        registry.setEnabled(model.modelId, false);
      }
    }

    const strategy = {
      ...DEFAULT_MODEL_STRATEGY_CONFIG,
      inferenceModel: "gpt-4o",
    };

    const budget = new InferenceBudgetTracker(db, strategy);
    const router = new InferenceRouter(db, registry, budget);

    const mockChat = async () => ({
      message: { role: "assistant", content: "response" },
      usage: { promptTokens: 500, completionTokens: 200 },
      finishReason: "stop",
    });

    const result = await router.route(
      {
        messages: [{ role: "user", content: "test" }],
        taskType: "agent_turn",
        tier: "normal",
        sessionId: "cost-session",
      },
      mockChat,
    );

    expect(result.costCents).toBeGreaterThanOrEqual(0);
    expect(result.inputTokens).toBe(500);
    expect(result.outputTokens).toBe(200);

    // Verify cost was recorded in budget tracker
    const sessionCost = budget.getSessionCost("cost-session");
    expect(sessionCost).toBeGreaterThanOrEqual(0);
  });
});
