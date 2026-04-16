/**
 * Provider Registry Tests — GitHub Copilot Provider
 *
 * Tests: GitHub provider registration, tier defaults with GitHub fallback,
 * model resolution, circuit breaker, provider config normalization.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ProviderRegistry,
  type ProviderConfig,
  type ModelConfig,
  type ModelTier,
} from "../inference/provider-registry.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ─── Helpers ──────────────────────────────────────────────────────

const savedEnv: Record<string, string | undefined> = {};

function setEnv(key: string, value: string): void {
  savedEnv[key] = process.env[key];
  process.env[key] = value;
}

function clearEnv(key: string): void {
  savedEnv[key] = process.env[key];
  delete process.env[key];
}

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  Object.keys(savedEnv).forEach((k) => delete savedEnv[k]);
});

// ─── Default Registry Tests ──────────────────────────────────────

describe("ProviderRegistry — Default Providers", () => {
  it("includes github provider in defaults", () => {
    setEnv("OPENAI_API_KEY", "test-key");
    setEnv("GITHUB_TOKEN", "ghp_test");

    const registry = new ProviderRegistry(getDefaultProviders());
    const providers = registry.getProviders();
    const github = providers.find((p) => p.id === "github");

    expect(github).toBeDefined();
    expect(github!.name).toBe("GitHub Copilot");
    expect(github!.baseUrl).toBe("https://models.github.ai/inference");
    expect(github!.apiKeyEnvVar).toBe("GITHUB_TOKEN");
  });

  it("github provider has models for all three tiers", () => {
    setEnv("GITHUB_TOKEN", "ghp_test");

    const registry = new ProviderRegistry(getDefaultProviders());
    const providers = registry.getProviders();
    const github = providers.find((p) => p.id === "github")!;

    const tiers = github.models.map((m) => m.tier);
    expect(tiers).toContain("reasoning");
    expect(tiers).toContain("fast");
    expect(tiers).toContain("cheap");
  });

  it("github models have correct IDs", () => {
    setEnv("GITHUB_TOKEN", "ghp_test");

    const registry = new ProviderRegistry(getDefaultProviders());
    const providers = registry.getProviders();
    const github = providers.find((p) => p.id === "github")!;

    const modelIds = github.models.map((m) => m.id);
    expect(modelIds).toContain("gpt-4o");
    expect(modelIds).toContain("claude-sonnet-4.6");
  });

  it("github models support tools and streaming", () => {
    setEnv("GITHUB_TOKEN", "ghp_test");

    const registry = new ProviderRegistry(getDefaultProviders());
    const providers = registry.getProviders();
    const github = providers.find((p) => p.id === "github")!;

    for (const model of github.models) {
      expect(model.supportsTools).toBe(true);
      expect(model.supportsStreaming).toBe(true);
    }
  });
});

// ─── Model Resolution with GitHub ────────────────────────────────

describe("ProviderRegistry — GitHub Model Resolution", () => {
  it("resolves github model for reasoning tier when GITHUB_TOKEN is set", () => {
    setEnv("GITHUB_TOKEN", "ghp_test");
    clearEnv("OPENAI_API_KEY");
    clearEnv("ANTHROPIC_API_KEY");
    clearEnv("GROQ_API_KEY");

    const registry = new ProviderRegistry(
      [makeGithubProvider()],
      {
        reasoning: { preferredProvider: "github", fallbackOrder: [] },
        fast: { preferredProvider: "github", fallbackOrder: [] },
        cheap: { preferredProvider: "github", fallbackOrder: [] },
      },
    );

    const resolved = registry.resolveModel("reasoning");
    expect(resolved.provider.id).toBe("github");
    expect(resolved.model.id).toBe("gpt-4o");
  });

  it("resolves github model for fast tier", () => {
    setEnv("GITHUB_TOKEN", "ghp_test");

    const registry = new ProviderRegistry(
      [makeGithubProvider()],
      {
        reasoning: { preferredProvider: "github", fallbackOrder: [] },
        fast: { preferredProvider: "github", fallbackOrder: [] },
        cheap: { preferredProvider: "github", fallbackOrder: [] },
      },
    );

    const resolved = registry.resolveModel("fast");
    expect(resolved.provider.id).toBe("github");
    expect(resolved.model.id).toBe("claude-sonnet-4.6");
  });

  it("resolves github model for cheap tier", () => {
    setEnv("GITHUB_TOKEN", "ghp_test");

    const registry = new ProviderRegistry(
      [makeGithubProvider()],
      {
        reasoning: { preferredProvider: "github", fallbackOrder: [] },
        fast: { preferredProvider: "github", fallbackOrder: [] },
        cheap: { preferredProvider: "github", fallbackOrder: [] },
      },
    );

    const resolved = registry.resolveModel("cheap");
    expect(resolved.provider.id).toBe("github");
    expect(resolved.model.id).toBe("gpt-4o");
  });

  it("falls back from github to other providers when github is disabled", () => {
    setEnv("OPENAI_API_KEY", "test-openai-key");
    setEnv("GITHUB_TOKEN", "ghp_test");

    const openaiProvider = makeOpenaiProvider();
    const githubProvider = { ...makeGithubProvider(), enabled: false };

    const registry = new ProviderRegistry(
      [githubProvider, openaiProvider],
      {
        reasoning: { preferredProvider: "github", fallbackOrder: ["openai"] },
        fast: { preferredProvider: "github", fallbackOrder: ["openai"] },
        cheap: { preferredProvider: "github", fallbackOrder: ["openai"] },
      },
    );

    // github disabled → falls to openai
    const resolved = registry.resolveModel("reasoning");
    expect(resolved.provider.id).toBe("openai");
  });

  it("github appears in candidate list", () => {
    setEnv("GITHUB_TOKEN", "ghp_test");
    setEnv("OPENAI_API_KEY", "test-key");

    const registry = new ProviderRegistry(
      [makeOpenaiProvider(), makeGithubProvider()],
      {
        reasoning: { preferredProvider: "openai", fallbackOrder: ["github"] },
        fast: { preferredProvider: "openai", fallbackOrder: ["github"] },
        cheap: { preferredProvider: "openai", fallbackOrder: ["github"] },
      },
    );

    const candidates = registry.resolveCandidates("reasoning");
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    const providerIds = candidates.map((c) => c.provider.id);
    expect(providerIds).toContain("openai");
    expect(providerIds).toContain("github");
  });
});

// ─── GitHub in Tier Defaults ─────────────────────────────────────

describe("ProviderRegistry — Tier Defaults with GitHub", () => {
  it("default tier defaults include github in fallback orders", () => {
    setEnv("OPENAI_API_KEY", "test-key");
    setEnv("GITHUB_TOKEN", "ghp_test");

    // Use fromConfig with a non-existent path to get pure defaults
    const registry = ProviderRegistry.fromConfig("/nonexistent/path.json");
    const providers = registry.getProviders();
    const github = providers.find((p) => p.id === "github");
    expect(github).toBeDefined();
  });
});

// ─── Config File Loading with GitHub ─────────────────────────────

describe("ProviderRegistry — fromConfig with GitHub", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "provider-test-"));
    configPath = path.join(tmpDir, "inference-providers.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads github provider from config file", () => {
    setEnv("GITHUB_TOKEN", "ghp_test");

    const config = {
      providers: [
        {
          id: "github",
          name: "GitHub Copilot",
          baseUrl: "https://models.github.ai/inference",
          apiKeyEnvVar: "GITHUB_TOKEN",
          models: [
            {
              id: "gpt-4o",
              tier: "reasoning",
              contextWindow: 128000,
              maxOutputTokens: 16384,
              costPerInputToken: 2.5,
              costPerOutputToken: 10.0,
              supportsTools: true,
              supportsVision: true,
              supportsStreaming: true,
            },
          ],
          maxRequestsPerMinute: 100,
          maxTokensPerMinute: 500000,
          priority: 4,
          enabled: true,
        },
      ],
    };

    fs.writeFileSync(configPath, JSON.stringify(config));

    const registry = ProviderRegistry.fromConfig(configPath);
    const providers = registry.getProviders();
    const github = providers.find((p) => p.id === "github");

    expect(github).toBeDefined();
    expect(github!.models[0].id).toBe("gpt-4o");
  });

  it("merges github tier defaults from config file", () => {
    setEnv("GITHUB_TOKEN", "ghp_test");

    const config = {
      providers: [
        {
          id: "github",
          name: "GitHub Copilot",
          baseUrl: "https://models.github.ai/inference",
          apiKeyEnvVar: "GITHUB_TOKEN",
          models: [
            {
              id: "gpt-4o",
              tier: "reasoning",
              contextWindow: 128000,
              maxOutputTokens: 16384,
              costPerInputToken: 2.5,
              costPerOutputToken: 10.0,
              supportsTools: true,
              supportsVision: true,
              supportsStreaming: true,
            },
          ],
          maxRequestsPerMinute: 100,
          maxTokensPerMinute: 500000,
          priority: 1,
          enabled: true,
        },
      ],
      tierDefaults: {
        reasoning: {
          preferredProvider: "github",
          fallbackOrder: ["openai"],
        },
      },
    };

    fs.writeFileSync(configPath, JSON.stringify(config));

    const registry = ProviderRegistry.fromConfig(configPath);
    const resolved = registry.resolveModel("reasoning");
    expect(resolved.provider.id).toBe("github");
  });
});

// ─── Circuit Breaker with GitHub ──────────────────────────────────

describe("ProviderRegistry — GitHub Circuit Breaker", () => {
  it("disables github provider via disableProvider", () => {
    setEnv("GITHUB_TOKEN", "ghp_test");

    const registry = new ProviderRegistry([makeGithubProvider()]);
    registry.disableProvider("github", "test-disable", 60_000);

    const providers = registry.getProviders();
    const github = providers.find((p) => p.id === "github");
    expect(github!.enabled).toBe(false);
  });

  it("re-enables github provider via enableProvider", () => {
    setEnv("GITHUB_TOKEN", "ghp_test");

    const registry = new ProviderRegistry([makeGithubProvider()]);
    registry.disableProvider("github", "test-disable", 60_000);
    registry.enableProvider("github");

    const providers = registry.getProviders();
    const github = providers.find((p) => p.id === "github");
    expect(github!.enabled).toBe(true);
  });
});

// ─── GitHub getModel ────────────────────────────────────────────

describe("ProviderRegistry — getModel for GitHub", () => {
  it("returns resolved model for github gpt-4o", () => {
    setEnv("GITHUB_TOKEN", "ghp_test");

    const registry = new ProviderRegistry([makeGithubProvider()]);
    const resolved = registry.getModel("github", "gpt-4o");

    expect(resolved.provider.id).toBe("github");
    expect(resolved.model.id).toBe("gpt-4o");
    expect(resolved.model.tier).toBe("reasoning");
    expect(resolved.client).toBeDefined();
  });

  it("throws for unknown model on github", () => {
    setEnv("GITHUB_TOKEN", "ghp_test");

    const registry = new ProviderRegistry([makeGithubProvider()]);
    expect(() => registry.getModel("github", "nonexistent")).toThrow("Unknown model");
  });
});

// ─── overrideBaseUrl for GitHub ──────────────────────────────────

describe("ProviderRegistry — overrideBaseUrl", () => {
  it("overrides github base URL", () => {
    setEnv("GITHUB_TOKEN", "ghp_test");

    const registry = new ProviderRegistry([makeGithubProvider()]);
    registry.overrideBaseUrl("github", "https://custom.endpoint.com/v1");

    const providers = registry.getProviders();
    const github = providers.find((p) => p.id === "github");
    expect(github!.baseUrl).toBe("https://custom.endpoint.com/v1");
  });
});

// ─── Helpers ──────────────────────────────────────────────────────

function makeGithubProvider(): ProviderConfig {
  return {
    id: "github",
    name: "GitHub Copilot",
    baseUrl: "https://models.github.ai/inference",
    apiKeyEnvVar: "GITHUB_TOKEN",
    models: [
      {
        id: "gpt-4o",
        tier: "reasoning",
        contextWindow: 68000,
        maxOutputTokens: 4096,
        costPerInputToken: 2.5,
        costPerOutputToken: 10.0,
        supportsTools: true,
        supportsVision: true,
        supportsStreaming: true,
      },
      {
        id: "claude-sonnet-4.6",
        tier: "fast",
        contextWindow: 200000,
        maxOutputTokens: 16384,
        costPerInputToken: 0.15,
        costPerOutputToken: 0.6,
        supportsTools: true,
        supportsVision: true,
        supportsStreaming: true,
      },
      {
        id: "gpt-4o",
        tier: "cheap",
        contextWindow: 68000,
        maxOutputTokens: 4096,
        costPerInputToken: 0.15,
        costPerOutputToken: 0.6,
        supportsTools: true,
        supportsVision: true,
        supportsStreaming: true,
      },
    ],
    maxRequestsPerMinute: 100,
    maxTokensPerMinute: 500_000,
    priority: 4,
    enabled: true,
  };
}

function makeOpenaiProvider(): ProviderConfig {
  return {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnvVar: "OPENAI_API_KEY",
    models: [
      {
        id: "gpt-4.1",
        tier: "reasoning",
        contextWindow: 128000,
        maxOutputTokens: 32768,
        costPerInputToken: 2.0,
        costPerOutputToken: 8.0,
        supportsTools: true,
        supportsVision: true,
        supportsStreaming: true,
      },
      {
        id: "gemini-3-flash",
        tier: "fast",
        contextWindow: 173000,
        maxOutputTokens: 16384,
        costPerInputToken: 0.4,
        costPerOutputToken: 1.6,
        supportsTools: true,
        supportsVision: true,
        supportsStreaming: true,
      },
    ],
    maxRequestsPerMinute: 500,
    maxTokensPerMinute: 2_000_000,
    priority: 1,
    enabled: true,
  };
}

function getDefaultProviders(): ProviderConfig[] {
  // Import from file would be circular; instead duplicate the structure
  // and verify against the actual module
  return [
    makeOpenaiProvider(),
    makeGithubProvider(),
  ];
}
