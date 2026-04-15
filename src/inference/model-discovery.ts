/**
 * Model Discovery
 *
 * Queries provider /models endpoints to discover available models,
 * merges with static baseline, and generates suggested provider configs.
 */

import { ResilientHttpClient } from "../conway/http-client.js";
import { STATIC_MODEL_BASELINE } from "./types.js";
import type { ProviderConfig, ModelConfig, ModelTier } from "./provider-registry.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("model-discovery");

const DISCOVERY_TIMEOUT_MS = 15_000;

export interface DiscoveredModel {
  id: string;
  object?: string;
  created?: number;
  ownedBy?: string;
}

export interface DiscoveryResult {
  providerId: string;
  providerName: string;
  models: DiscoveredModel[];
  error?: string;
}

export interface ProviderEndpoint {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
}

/**
 * Discover models from an OpenAI-compatible /models endpoint.
 */
export async function discoverModelsFromProvider(
  endpoint: ProviderEndpoint,
  httpClient?: ResilientHttpClient,
): Promise<DiscoveryResult> {
  const client = httpClient ?? new ResilientHttpClient({
    baseTimeout: DISCOVERY_TIMEOUT_MS,
    maxRetries: 1,
  });

  const baseUrl = endpoint.baseUrl.replace(/\/+$/, "");
  // Try /v1/models first, then /models as fallback
  const urls = baseUrl.endsWith("/v1")
    ? [`${baseUrl}/models`]
    : [`${baseUrl}/v1/models`, `${baseUrl}/models`];

  for (const url of urls) {
    try {
      const resp = await client.request(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${endpoint.apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: DISCOVERY_TIMEOUT_MS,
      });

      if (!resp.ok) {
        continue;
      }

      const data = await resp.json() as any;
      const models: DiscoveredModel[] = [];

      // OpenAI-compatible format: { data: [{ id, ... }] }
      const modelList = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];

      for (const entry of modelList) {
        if (!entry || typeof entry !== "object") continue;
        const id = typeof entry.id === "string" ? entry.id : null;
        if (!id) continue;

        models.push({
          id,
          object: typeof entry.object === "string" ? entry.object : undefined,
          created: typeof entry.created === "number" ? entry.created : undefined,
          ownedBy: typeof entry.owned_by === "string" ? entry.owned_by : undefined,
        });
      }

      return {
        providerId: endpoint.id,
        providerName: endpoint.name,
        models,
      };
    } catch {
      // Try next URL
      continue;
    }
  }

  return {
    providerId: endpoint.id,
    providerName: endpoint.name,
    models: [],
    error: "Could not reach /models endpoint",
  };
}

/**
 * Discover models from all configured providers.
 */
export async function discoverAllModels(
  endpoints: ProviderEndpoint[],
): Promise<DiscoveryResult[]> {
  const results: DiscoveryResult[] = [];

  for (const endpoint of endpoints) {
    try {
      const result = await discoverModelsFromProvider(endpoint);
      results.push(result);
      logger.info(`Discovered ${result.models.length} models from ${endpoint.name}`);
    } catch (error) {
      results.push({
        providerId: endpoint.id,
        providerName: endpoint.name,
        models: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

/**
 * Build provider endpoints from environment variables and config.
 */
export function buildProviderEndpoints(config?: {
  githubToken?: string;
  ollamaBaseUrl?: string;
  groqApiKey?: string;
  togetherApiKey?: string;
}): ProviderEndpoint[] {
  const endpoints: ProviderEndpoint[] = [];

  const githubToken = config?.githubToken || process.env.GITHUB_TOKEN;
  if (githubToken) {
    endpoints.push({
      id: "github",
      name: "GitHub Copilot",
      baseUrl: "https://models.inference.ai.azure.com",
      apiKey: githubToken,
    });
  }

  const groqKey = config?.groqApiKey || process.env.GROQ_API_KEY;
  if (groqKey) {
    endpoints.push({
      id: "groq",
      name: "Groq",
      baseUrl: "https://api.groq.com/openai/v1",
      apiKey: groqKey,
    });
  }

  const togetherKey = config?.togetherApiKey || process.env.TOGETHER_API_KEY;
  if (togetherKey) {
    endpoints.push({
      id: "together",
      name: "Together AI",
      baseUrl: "https://api.together.xyz/v1",
      apiKey: togetherKey,
    });
  }

  const ollamaUrl = config?.ollamaBaseUrl || process.env.OLLAMA_BASE_URL;
  if (ollamaUrl) {
    endpoints.push({
      id: "local",
      name: "Local (Ollama)",
      baseUrl: ollamaUrl.replace(/\/+$/, ""),
      apiKey: "ollama",
    });
  }

  return endpoints;
}

// ─── Tier Heuristics ────────────────────────────────────────────

const CHEAP_PATTERNS = /\b(gpt-4\.1-nano|gpt-3\.5|nano|tiny|small|lite)\b/i;
const FAST_PATTERNS = /\b(gpt-4o-mini|gpt-4\.1-mini|gpt-5-mini|claude-haiku|llama.*8b|gemma|mini)\b/i;
const REASONING_PATTERNS = /\b(gpt-4o|gpt-4\.1|gpt-5|claude-sonnet|claude-opus|llama.*70b|mixtral.*8x22b)\b/i;

function inferTier(modelId: string): ModelTier {
  if (FAST_PATTERNS.test(modelId)) return "fast";
  if (CHEAP_PATTERNS.test(modelId)) return "cheap";
  if (REASONING_PATTERNS.test(modelId)) return "reasoning";
  return "fast"; // default
}

/**
 * Generate a suggested inference-providers.json config from discovery results.
 * Merges discovered models with static baseline pricing where available.
 */
export function generateSuggestedConfig(
  results: DiscoveryResult[],
): { providers: ProviderConfig[]; tierDefaults: Record<ModelTier, { preferredProvider: string; fallbackOrder: string[] }> } {
  const staticByModel = new Map(
    STATIC_MODEL_BASELINE.map((m) => [m.modelId, m]),
  );

  const providers: ProviderConfig[] = [];

  for (const result of results) {
    if (result.models.length === 0) continue;

    const models: ModelConfig[] = [];
    const seenTiers = new Set<ModelTier>();

    for (const discovered of result.models) {
      const staticMatch = staticByModel.get(discovered.id);
      const tier = inferTier(discovered.id);

      // Skip duplicate tiers (keep first match per tier)
      if (seenTiers.has(tier)) {
        // still add if it's a different model
        models.push({
          id: discovered.id,
          tier,
          contextWindow: staticMatch?.contextWindow ?? 128000,
          maxOutputTokens: staticMatch?.maxTokens ?? 8192,
          costPerInputToken: staticMatch ? staticMatch.costPer1kInput / 10 : 0,
          costPerOutputToken: staticMatch ? staticMatch.costPer1kOutput / 10 : 0,
          supportsTools: staticMatch?.supportsTools ?? true,
          supportsVision: staticMatch?.supportsVision ?? false,
          supportsStreaming: true,
        });
        continue;
      }

      seenTiers.add(tier);

      models.push({
        id: discovered.id,
        tier,
        contextWindow: staticMatch?.contextWindow ?? 128000,
        maxOutputTokens: staticMatch?.maxTokens ?? 8192,
        costPerInputToken: staticMatch ? staticMatch.costPer1kInput / 10 : 0,
        costPerOutputToken: staticMatch ? staticMatch.costPer1kOutput / 10 : 0,
        supportsTools: staticMatch?.supportsTools ?? true,
        supportsVision: staticMatch?.supportsVision ?? false,
        supportsStreaming: true,
      });
    }

    if (models.length === 0) continue;

    const baseUrlMap: Record<string, string> = {
      github: "https://models.inference.ai.azure.com",
      groq: "https://api.groq.com/openai/v1",
      together: "https://api.together.xyz/v1",
      local: "http://localhost:11434/v1",
    };

    const apiKeyMap: Record<string, string> = {
      github: "GITHUB_TOKEN",
      groq: "GROQ_API_KEY",
      together: "TOGETHER_API_KEY",
      local: "LOCAL_API_KEY",
    };

    providers.push({
      id: result.providerId,
      name: result.providerName,
      baseUrl: baseUrlMap[result.providerId] || "https://models.inference.ai.azure.com",
      apiKeyEnvVar: apiKeyMap[result.providerId] || "GITHUB_TOKEN",
      models,
      maxRequestsPerMinute: 500,
      maxTokensPerMinute: 1_000_000,
      priority: result.providerId === "local" ? 10 : providers.length + 1,
      enabled: true,
    });
  }

  const providerIds = providers.map((p) => p.id);

  return {
    providers,
    tierDefaults: {
      reasoning: {
        preferredProvider: providerIds[0] || "github",
        fallbackOrder: providerIds.slice(1),
      },
      fast: {
        preferredProvider: providerIds.find((id) => id === "groq") || providerIds[0] || "groq",
        fallbackOrder: providerIds.filter((id) => id !== "groq"),
      },
      cheap: {
        preferredProvider: providerIds.find((id) => id === "groq") || providerIds[0] || "groq",
        fallbackOrder: providerIds.filter((id) => id !== "groq"),
      },
    },
  };
}
