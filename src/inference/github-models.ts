export const GITHUB_MODELS_INFERENCE_BASE_URL = "https://models.github.ai/inference";
export const GITHUB_MODELS_CATALOG_URL = "https://models.github.ai/catalog/models";
export const GITHUB_MODELS_API_VERSION = "2026-03-10";

const LEGACY_TO_API_MODEL_ID: Record<string, string> = {
  // GPT-5 family
  "gpt-5.4": "openai/gpt-5.4",
  "gpt-5.2": "openai/gpt-5.2",
  "gpt-5.3-codex": "openai/gpt-5.3-codex",
  "gpt-5": "openai/gpt-5",
  "gpt-5-mini": "openai/gpt-5-mini",
  "gpt-5-nano": "openai/gpt-5-nano",
  "gpt-5-chat": "openai/gpt-5-chat",
  // GPT-4 family
  "gpt-4.1": "openai/gpt-4.1",
  "gpt-4o": "openai/gpt-4o",
  // Claude family
  "claude-opus-4.6": "anthropic/claude-opus-4.6",
  "claude-sonnet-4.6": "anthropic/claude-sonnet-4.6",
  // Gemini family
  "gemini-3.1-pro": "google/gemini-3.1-pro",
  "gemini-3-flash": "google/gemini-3-flash",
  // Legacy (kept for reverse mapping of old data)
  "gpt-4.1-mini": "openai/gpt-4.1-mini",
  "gpt-4.1-nano": "openai/gpt-4.1-nano",
  "gpt-4o-mini": "openai/gpt-4o-mini",
  o1: "openai/o1",
  "o1-mini": "openai/o1-mini",
  o3: "openai/o3",
  "o3-mini": "openai/o3-mini",
  "o4-mini": "openai/o4-mini",
};

const API_TO_LEGACY_MODEL_ID = Object.fromEntries(
  Object.entries(LEGACY_TO_API_MODEL_ID).map(([legacyId, apiId]) => [apiId, legacyId]),
) as Record<string, string>;

export function toGitHubModelsApiModelId(modelId: string): string {
  return LEGACY_TO_API_MODEL_ID[modelId] ?? modelId;
}

export function fromGitHubModelsCatalogModelId(modelId: string): string {
  return API_TO_LEGACY_MODEL_ID[modelId] ?? modelId;
}

export function getGitHubModelsHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    ...getGitHubModelsDefaultHeaders(),
  };
}

export function getGitHubModelsDefaultHeaders(): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": GITHUB_MODELS_API_VERSION,
    "Content-Type": "application/json",
  };
}