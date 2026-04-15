/**
 * Model Discovery Tests
 *
 * Tests: discoverModelsFromProvider, discoverAllModels,
 * buildProviderEndpoints, generateSuggestedConfig.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  discoverModelsFromProvider,
  discoverAllModels,
  buildProviderEndpoints,
  generateSuggestedConfig,
  type ProviderEndpoint,
  type DiscoveryResult,
} from "../inference/model-discovery.js";
import { ResilientHttpClient } from "../conway/http-client.js";

// ─── Env helpers ──────────────────────────────────────────────────

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

// ─── buildProviderEndpoints ──────────────────────────────────────

describe("buildProviderEndpoints", () => {
  beforeEach(() => {
    clearEnv("GITHUB_TOKEN");
    clearEnv("GROQ_API_KEY");
    clearEnv("TOGETHER_API_KEY");
    clearEnv("OLLAMA_BASE_URL");
  });

  it("returns empty array when no keys are set", () => {
    const endpoints = buildProviderEndpoints();
    expect(endpoints).toEqual([]);
  });

  it("includes github endpoint when githubToken is provided", () => {
    const endpoints = buildProviderEndpoints({ githubToken: "ghp_test" });
    const github = endpoints.find((e) => e.id === "github");
    expect(github).toBeDefined();
    expect(github!.name).toBe("GitHub Copilot");
    expect(github!.baseUrl).toBe("https://models.inference.ai.azure.com");
    expect(github!.apiKey).toBe("ghp_test");
  });

  it("includes github endpoint from GITHUB_TOKEN env var", () => {
    setEnv("GITHUB_TOKEN", "ghp_env_test");
    const endpoints = buildProviderEndpoints();
    const github = endpoints.find((e) => e.id === "github");
    expect(github).toBeDefined();
    expect(github!.apiKey).toBe("ghp_env_test");
  });

  it("prefers config over env var for github", () => {
    setEnv("GITHUB_TOKEN", "ghp_env");
    const endpoints = buildProviderEndpoints({ githubToken: "ghp_config" });
    const github = endpoints.find((e) => e.id === "github");
    expect(github!.apiKey).toBe("ghp_config");
  });

  it("includes groq endpoint when groqApiKey is provided", () => {
    const endpoints = buildProviderEndpoints({ groqApiKey: "gsk-test" });
    const groq = endpoints.find((e) => e.id === "groq");
    expect(groq).toBeDefined();
    expect(groq!.baseUrl).toBe("https://api.groq.com/openai/v1");
  });

  it("includes groq endpoint from env var", () => {
    setEnv("GROQ_API_KEY", "gsk_test");
    const endpoints = buildProviderEndpoints();
    const groq = endpoints.find((e) => e.id === "groq");
    expect(groq).toBeDefined();
  });

  it("includes together endpoint from config", () => {
    const endpoints = buildProviderEndpoints({ togetherApiKey: "tog_test" });
    const together = endpoints.find((e) => e.id === "together");
    expect(together).toBeDefined();
  });

  it("includes local endpoint when ollamaBaseUrl is provided", () => {
    const endpoints = buildProviderEndpoints({ ollamaBaseUrl: "http://localhost:11434" });
    const local = endpoints.find((e) => e.id === "local");
    expect(local).toBeDefined();
    expect(local!.baseUrl).toBe("http://localhost:11434");
    expect(local!.apiKey).toBe("ollama");
  });

  it("strips trailing slash from ollama URL", () => {
    const endpoints = buildProviderEndpoints({ ollamaBaseUrl: "http://localhost:11434/" });
    const local = endpoints.find((e) => e.id === "local");
    expect(local!.baseUrl).toBe("http://localhost:11434");
  });

  it("returns multiple endpoints when multiple keys are set", () => {
    const endpoints = buildProviderEndpoints({
      githubToken: "ghp_test",
      groqApiKey: "gsk_test",
    });
    expect(endpoints.length).toBe(2);
    expect(endpoints.map((e) => e.id)).toEqual(["github", "groq"]);
  });
});

// ─── discoverModelsFromProvider ──────────────────────────────────

describe("discoverModelsFromProvider", () => {
  it("parses OpenAI-compatible /models response", async () => {
    const mockResponse = {
      data: [
        { id: "gpt-4o", object: "model", created: 1700000000, owned_by: "openai" },
        { id: "gpt-4o-mini", object: "model", created: 1700000001, owned_by: "openai" },
      ],
    };

    const mockClient = {
      request: vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      }),
    } as unknown as ResilientHttpClient;

    const result = await discoverModelsFromProvider(
      { id: "github", name: "GitHub", baseUrl: "https://models.inference.ai.azure.com", apiKey: "ghp_test" },
      mockClient,
    );

    expect(result.providerId).toBe("github");
    expect(result.models.length).toBe(2);
    expect(result.models[0].id).toBe("gpt-4o");
    expect(result.models[0].ownedBy).toBe("openai");
    expect(result.models[1].id).toBe("gpt-4o-mini");
    expect(result.error).toBeUndefined();
  });

  it("handles flat array response format", async () => {
    const mockClient = {
      request: vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          { id: "model-a" },
          { id: "model-b" },
        ],
      }),
    } as unknown as ResilientHttpClient;

    const result = await discoverModelsFromProvider(
      { id: "local", name: "Local", baseUrl: "http://localhost:11434/v1", apiKey: "ollama" },
      mockClient,
    );

    expect(result.models.length).toBe(2);
    expect(result.models[0].id).toBe("model-a");
  });

  it("returns empty models on non-ok response", async () => {
    const mockClient = {
      request: vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      }),
    } as unknown as ResilientHttpClient;

    const result = await discoverModelsFromProvider(
      { id: "github", name: "GitHub", baseUrl: "https://models.inference.ai.azure.com", apiKey: "bad-key" },
      mockClient,
    );

    expect(result.models.length).toBe(0);
    expect(result.error).toBeDefined();
  });

  it("returns empty models on network error", async () => {
    const mockClient = {
      request: vi.fn().mockRejectedValue(new Error("Network error")),
    } as unknown as ResilientHttpClient;

    const result = await discoverModelsFromProvider(
      { id: "github", name: "GitHub", baseUrl: "https://models.inference.ai.azure.com", apiKey: "ghp_test" },
      mockClient,
    );

    expect(result.models.length).toBe(0);
    expect(result.error).toBeDefined();
  });

  it("skips entries without id", async () => {
    const mockClient = {
      request: vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: "valid-model" },
            { object: "model" }, // no id
            { id: "" }, // empty id
            null,
          ],
        }),
      }),
    } as unknown as ResilientHttpClient;

    const result = await discoverModelsFromProvider(
      { id: "test", name: "Test", baseUrl: "https://test.com/v1", apiKey: "key" },
      mockClient,
    );

    expect(result.models.length).toBe(1);
    expect(result.models[0].id).toBe("valid-model");
  });

  it("tries /v1/models then /models for non-v1 base URLs", async () => {
    let callCount = 0;
    const mockClient = {
      request: vi.fn().mockImplementation(async (url: string) => {
        callCount++;
        if (url.includes("/v1/models")) {
          return { ok: false, status: 404 };
        }
        return {
          ok: true,
          json: async () => ({ data: [{ id: "found-via-fallback" }] }),
        };
      }),
    } as unknown as ResilientHttpClient;

    const result = await discoverModelsFromProvider(
      { id: "custom", name: "Custom", baseUrl: "https://custom.api.com", apiKey: "key" },
      mockClient,
    );

    expect(result.models.length).toBe(1);
    expect(result.models[0].id).toBe("found-via-fallback");
    expect(callCount).toBe(2);
  });

  it("only tries /models once for /v1 base URLs", async () => {
    let callCount = 0;
    const mockClient = {
      request: vi.fn().mockImplementation(async () => {
        callCount++;
        return {
          ok: true,
          json: async () => ({ data: [{ id: "model-1" }] }),
        };
      }),
    } as unknown as ResilientHttpClient;

    const result = await discoverModelsFromProvider(
      { id: "test", name: "Test", baseUrl: "https://api.test.com/v1", apiKey: "key" },
      mockClient,
    );

    expect(callCount).toBe(1);
    expect(result.models.length).toBe(1);
  });

  it("sends correct authorization header", async () => {
    const mockClient = {
      request: vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      }),
    } as unknown as ResilientHttpClient;

    await discoverModelsFromProvider(
      { id: "github", name: "GitHub", baseUrl: "https://models.inference.ai.azure.com", apiKey: "ghp_secret_token" },
      mockClient,
    );

    const callArgs = (mockClient.request as any).mock.calls[0];
    expect(callArgs[1].headers.Authorization).toBe("Bearer ghp_secret_token");
  });
});

// ─── discoverAllModels ───────────────────────────────────────────

describe("discoverAllModels", () => {
  it("discovers from multiple providers", async () => {
    // Mock globalThis.fetch for the real HTTP client
    const originalFetch = globalThis.fetch;
    let fetchCallCount = 0;

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      fetchCallCount++;
      return new Response(JSON.stringify({
        data: [{ id: `model-from-${fetchCallCount}` }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    try {
      const results = await discoverAllModels([
        { id: "provider-a", name: "Provider A", baseUrl: "https://a.test.com/v1", apiKey: "key-a" },
        { id: "provider-b", name: "Provider B", baseUrl: "https://b.test.com/v1", apiKey: "key-b" },
      ]);

      expect(results.length).toBe(2);
      expect(results[0].providerId).toBe("provider-a");
      expect(results[1].providerId).toBe("provider-b");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles individual provider failures gracefully", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      // Any URL containing "broken" fails
      if (typeof url === "string" && url.includes("broken")) {
        throw new Error("Connection refused");
      }
      return new Response(JSON.stringify({
        data: [{ id: "working-model" }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    try {
      const results = await discoverAllModels([
        { id: "broken", name: "Broken", baseUrl: "https://broken.test.com/v1", apiKey: "key" },
        { id: "working", name: "Working", baseUrl: "https://working.test.com/v1", apiKey: "key" },
      ]);

      expect(results.length).toBe(2);
      expect(results[0].models.length).toBe(0);
      expect(results[0].error).toBeDefined();
      expect(results[1].models.length).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ─── generateSuggestedConfig ─────────────────────────────────────

describe("generateSuggestedConfig", () => {
  it("generates config from discovery results", () => {
    const results: DiscoveryResult[] = [
      {
        providerId: "github",
        providerName: "GitHub Copilot",
        models: [
          { id: "gpt-4o", object: "model", ownedBy: "openai" },
          { id: "gpt-4o-mini", object: "model", ownedBy: "openai" },
        ],
      },
    ];

    const config = generateSuggestedConfig(results);

    expect(config.providers.length).toBe(1);
    expect(config.providers[0].id).toBe("github");
    expect(config.providers[0].name).toBe("GitHub Copilot");
    expect(config.providers[0].baseUrl).toBe("https://models.inference.ai.azure.com");
    expect(config.providers[0].apiKeyEnvVar).toBe("GITHUB_TOKEN");
    expect(config.providers[0].models.length).toBe(2);
    expect(config.providers[0].enabled).toBe(true);
  });

  it("assigns correct tiers based on model name heuristics", () => {
    const results: DiscoveryResult[] = [
      {
        providerId: "github",
        providerName: "GitHub Copilot",
        models: [
          { id: "gpt-4o" },
          { id: "gpt-4o-mini" },
          { id: "gpt-4.1-nano" },
        ],
      },
    ];

    const config = generateSuggestedConfig(results);
    const models = config.providers[0].models;

    const reasoningModel = models.find((m) => m.id === "gpt-4o");
    const fastModel = models.find((m) => m.id === "gpt-4o-mini");
    const cheapModel = models.find((m) => m.id === "gpt-4.1-nano");

    expect(reasoningModel!.tier).toBe("reasoning");
    expect(fastModel!.tier).toBe("fast");
    expect(cheapModel!.tier).toBe("cheap");
  });

  it("merges static baseline pricing when available", () => {
    const results: DiscoveryResult[] = [
      {
        providerId: "github",
        providerName: "GitHub Copilot",
        models: [
          { id: "gpt-4o" },
        ],
      },
    ];

    const config = generateSuggestedConfig(results);
    const model = config.providers[0].models[0];

    // gpt-4o is in STATIC_MODEL_BASELINE (as "github" provider with costPer1kInput: 25)
    expect(model.costPerInputToken).toBeGreaterThan(0);
    expect(model.costPerOutputToken).toBeGreaterThan(0);
  });

  it("sets zero cost for unknown models", () => {
    const results: DiscoveryResult[] = [
      {
        providerId: "local",
        providerName: "Local",
        models: [
          { id: "totally-unknown-model-xyz" },
        ],
      },
    ];

    const config = generateSuggestedConfig(results);
    const model = config.providers[0].models[0];

    expect(model.costPerInputToken).toBe(0);
    expect(model.costPerOutputToken).toBe(0);
  });

  it("skips providers with no models", () => {
    const results: DiscoveryResult[] = [
      {
        providerId: "empty",
        providerName: "Empty",
        models: [],
        error: "unreachable",
      },
      {
        providerId: "github",
        providerName: "GitHub",
        models: [{ id: "gpt-4o" }],
      },
    ];

    const config = generateSuggestedConfig(results);
    expect(config.providers.length).toBe(1);
    expect(config.providers[0].id).toBe("github");
  });

  it("generates tier defaults with correct provider ordering", () => {
    const results: DiscoveryResult[] = [
      {
        providerId: "github",
        providerName: "GitHub",
        models: [{ id: "gpt-4o" }],
      },
      {
        providerId: "groq",
        providerName: "Groq",
        models: [{ id: "llama-3.3-70b-versatile" }],
      },
    ];

    const config = generateSuggestedConfig(results);

    // reasoning prefers first provider
    expect(config.tierDefaults.reasoning.preferredProvider).toBe("github");
    // fast and cheap prefer groq
    expect(config.tierDefaults.fast.preferredProvider).toBe("groq");
    expect(config.tierDefaults.cheap.preferredProvider).toBe("groq");
  });

  it("handles multiple providers generating complete config", () => {
    const results: DiscoveryResult[] = [
      {
        providerId: "github",
        providerName: "GitHub Copilot",
        models: [
          { id: "gpt-4o" },
          { id: "gpt-4o-mini" },
        ],
      },
      {
        providerId: "groq",
        providerName: "Groq",
        models: [
          { id: "llama-3.3-70b-versatile" },
          { id: "llama-3.1-8b-instant" },
        ],
      },
    ];

    const config = generateSuggestedConfig(results);

    expect(config.providers.length).toBe(2);
    expect(config.providers[0].id).toBe("github");
    expect(config.providers[1].id).toBe("groq");

    // All providers should have valid structure
    for (const provider of config.providers) {
      expect(provider.id).toBeTruthy();
      expect(provider.name).toBeTruthy();
      expect(provider.baseUrl).toBeTruthy();
      expect(provider.apiKeyEnvVar).toBeTruthy();
      expect(provider.models.length).toBeGreaterThan(0);
      expect(provider.maxRequestsPerMinute).toBeGreaterThan(0);
      expect(provider.maxTokensPerMinute).toBeGreaterThan(0);
      expect(typeof provider.priority).toBe("number");
      expect(typeof provider.enabled).toBe("boolean");
    }

    // Tier defaults should reference real providers
    const providerIds = config.providers.map((p) => p.id);
    expect(providerIds).toContain(config.tierDefaults.reasoning.preferredProvider);
  });

  it("sets local provider priority to 10", () => {
    const results: DiscoveryResult[] = [
      {
        providerId: "local",
        providerName: "Local",
        models: [{ id: "llama3:8b" }],
      },
    ];

    const config = generateSuggestedConfig(results);
    expect(config.providers[0].priority).toBe(10);
  });
});
