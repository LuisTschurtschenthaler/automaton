/**
 * GitHub OAuth Device Flow
 *
 * Implements the GitHub OAuth Device Authorization Grant (RFC 8628)
 * so users can authenticate with GitHub without manually creating a PAT.
 *
 * Flow:
 *   1. Request device + user codes from GitHub
 *   2. User visits https://github.com/login/device and enters the code
 *   3. Poll GitHub until the user authorizes (or times out)
 *   4. Receive an access token with the requested scopes
 *
 * The resulting token works with GitHub API and GitHub Models inference.
 */

import { createLogger } from "../observability/logger.js";
import {
  GITHUB_MODELS_CATALOG_URL,
  getGitHubModelsHeaders,
} from "../inference/github-models.js";

const logger = createLogger("github-oauth");

const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";

/**
 * Default client ID for the Conway Automaton GitHub OAuth App.
 * Override via GITHUB_OAUTH_CLIENT_ID env var or during setup.
 *
 * To register your own:
 *   1. Go to https://github.com/settings/developers
 *   2. New OAuth App → enable "Device Flow"
 *   3. Set the client_id here or in env
 */
const DEFAULT_CLIENT_ID = process.env.GITHUB_OAUTH_CLIENT_ID ?? "";

/**
 * Device flow does not require scopes to sign in, but repo access does.
 * GitHub Models rides on the signed-in account entitlement (Copilot/Models plan),
 * not a separate OAuth scope.
 */
const DEFAULT_SCOPES = "read:user repo";

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

export interface GitHubOAuthOptions {
  clientId?: string;
  scopes?: string;
  onUserCode?: (userCode: string, verificationUri: string) => void;
}

/**
 * Request a device code from GitHub.
 */
export async function requestDeviceCode(
  clientId: string,
  scopes: string = DEFAULT_SCOPES,
): Promise<DeviceCodeResponse> {
  const resp = await fetch(GITHUB_DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      scope: scopes,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`GitHub device code request failed (${resp.status}): ${body}`);
  }

  const data = await resp.json() as Record<string, unknown>;

  if (typeof data.error === "string") {
    throw new Error(`GitHub OAuth error: ${data.error} — ${data.error_description ?? ""}`);
  }

  return {
    device_code: data.device_code as string,
    user_code: data.user_code as string,
    verification_uri: data.verification_uri as string,
    expires_in: data.expires_in as number,
    interval: data.interval as number,
  };
}

/**
 * Poll GitHub for the access token after the user has entered the device code.
 * Respects the `interval` from the device code response.
 */
export async function pollForToken(
  clientId: string,
  deviceCode: string,
  interval: number,
  expiresIn: number,
): Promise<OAuthTokenResponse> {
  const deadline = Date.now() + expiresIn * 1000;
  let pollInterval = Math.max(interval, 5) * 1000; // minimum 5s per GitHub docs

  while (Date.now() < deadline) {
    await sleep(pollInterval);

    const resp = await fetch(GITHUB_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      throw new Error(`GitHub token poll failed (${resp.status})`);
    }

    const data = await resp.json() as Record<string, unknown>;

    if (data.access_token) {
      return {
        access_token: data.access_token as string,
        token_type: (data.token_type as string) ?? "bearer",
        scope: (data.scope as string) ?? "",
      };
    }

    const error = data.error as string | undefined;

    if (error === "authorization_pending") {
      // User hasn't entered the code yet — keep polling
      continue;
    }

    if (error === "slow_down") {
      // GitHub wants us to slow down — increase interval by 5s
      pollInterval += 5000;
      continue;
    }

    if (error === "expired_token") {
      throw new Error("Device code expired. Please try again.");
    }

    if (error === "access_denied") {
      throw new Error("User denied the authorization request.");
    }

    // Unknown error
    throw new Error(`GitHub OAuth error: ${error} — ${data.error_description ?? ""}`);
  }

  throw new Error("Device code expired (timeout). Please try again.");
}

/**
 * Run the full GitHub OAuth Device Flow.
 *
 * Returns the access token string on success.
 * The caller is responsible for displaying the user code
 * (use the `onUserCode` callback in options).
 */
export async function githubDeviceFlow(
  options: GitHubOAuthOptions = {},
): Promise<string> {
  const clientId = options.clientId || DEFAULT_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      "GitHub OAuth client_id not configured. " +
      "Set GITHUB_OAUTH_CLIENT_ID env var or register an OAuth App at https://github.com/settings/developers",
    );
  }

  const scopes = options.scopes ?? DEFAULT_SCOPES;

  logger.info("Starting GitHub OAuth device flow...");

  const deviceCode = await requestDeviceCode(clientId, scopes);

  // Notify caller to display the code
  options.onUserCode?.(deviceCode.user_code, deviceCode.verification_uri);

  logger.info(`Polling for authorization (expires in ${deviceCode.expires_in}s)...`);

  const token = await pollForToken(
    clientId,
    deviceCode.device_code,
    deviceCode.interval,
    deviceCode.expires_in,
  );

  logger.info("GitHub OAuth succeeded.");

  return token.access_token;
}

/**
 * Validate that a GitHub token has the expected access.
 * Returns the authenticated user's login, or throws on failure.
 */
export async function validateGitHubToken(token: string): Promise<string> {
  const resp = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) {
    if (resp.status === 401) {
      throw new Error("GitHub token is invalid or expired.");
    }
    throw new Error(`GitHub API returned ${resp.status}`);
  }

  const data = await resp.json() as Record<string, unknown>;
  return data.login as string;
}

/**
 * Check if a GitHub token can access GitHub Models inference.
 * Returns true if the models endpoint is reachable.
 */
export async function validateGitHubModelsAccess(token: string): Promise<boolean> {
  try {
    const resp = await fetch(GITHUB_MODELS_CATALOG_URL, {
      headers: getGitHubModelsHeaders(token),
      signal: AbortSignal.timeout(10_000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
