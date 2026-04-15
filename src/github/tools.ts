/**
 * GitHub Tools
 *
 * Higher-level GitHub operations composed from the GitHubClient.
 * Used by the agent tool system for repository management, commits,
 * issues, and pull requests via the GitHub REST API.
 */

import { GitHubClient, validateRepoName, validateFilePath } from "./client.js";
import type {
  GitHubRepo,
  GitHubFile,
  GitHubIssue,
  GitHubPullRequest,
  GitHubCommitResult,
} from "./client.js";
import type { ConwayClient } from "../types.js";

// Re-export types for consumers
export type {
  GitHubRepo,
  GitHubFile,
  GitHubIssue,
  GitHubPullRequest,
  GitHubCommitResult,
};

/**
 * Resolve the authenticated GitHub username.
 * Cached per-client so we don't hit /user on every call.
 */
const usernameCache = new WeakMap<GitHubClient, string>();

async function resolveOwner(client: GitHubClient): Promise<string> {
  const cached = usernameCache.get(client);
  if (cached) return cached;
  const user = await client.getAuthenticatedUser();
  usernameCache.set(client, user.login);
  return user.login;
}

// ─── Repository Operations ─────────────────────────────────────

export async function createRepository(
  client: GitHubClient,
  name: string,
  description?: string,
): Promise<GitHubRepo> {
  return client.createRepo({
    name,
    description,
    isPrivate: true,     // Always private for security
    autoInit: true,      // Create with initial commit
  });
}

export async function listRepositories(
  client: GitHubClient,
  page: number = 1,
  perPage: number = 30,
): Promise<GitHubRepo[]> {
  return client.listRepos({ sort: "updated", perPage, page });
}

// ─── File Operations ───────────────────────────────────────────

export async function getFile(
  client: GitHubClient,
  repo: string,
  path: string,
  ref?: string,
): Promise<{ content: string; sha: string }> {
  const owner = await resolveOwner(client);
  const file = await client.getFileContent(owner, repo, path, ref);

  // Decode base64 content
  const content = Buffer.from(file.content, "base64").toString("utf-8");
  return { content, sha: file.sha };
}

export async function createOrUpdateFile(
  client: GitHubClient,
  repo: string,
  path: string,
  content: string,
  message: string,
  options?: { branch?: string; sha?: string },
): Promise<GitHubCommitResult> {
  const owner = await resolveOwner(client);
  return client.createOrUpdateFile(owner, repo, path, {
    content,
    message,
    branch: options?.branch,
    sha: options?.sha,
  });
}

// ─── Issue Operations ──────────────────────────────────────────

export async function createIssue(
  client: GitHubClient,
  repo: string,
  title: string,
  body?: string,
  labels?: string[],
): Promise<GitHubIssue> {
  const owner = await resolveOwner(client);
  return client.createIssue(owner, repo, { title, body, labels });
}

export async function listIssues(
  client: GitHubClient,
  repo: string,
  state: "open" | "closed" | "all" = "open",
  page: number = 1,
): Promise<GitHubIssue[]> {
  const owner = await resolveOwner(client);
  return client.listIssues(owner, repo, { state, page });
}

// ─── Pull Request Operations ───────────────────────────────────

export async function createPullRequest(
  client: GitHubClient,
  repo: string,
  title: string,
  head: string,
  base: string,
  body?: string,
): Promise<GitHubPullRequest> {
  const owner = await resolveOwner(client);
  return client.createPullRequest(owner, repo, { title, body, head, base });
}

export async function listPullRequests(
  client: GitHubClient,
  repo: string,
  state: "open" | "closed" | "all" = "open",
  page: number = 1,
): Promise<GitHubPullRequest[]> {
  const owner = await resolveOwner(client);
  return client.listPullRequests(owner, repo, { state, page });
}

// ─── Remote Setup ──────────────────────────────────────────────

/**
 * Configure a git remote in the sandbox with token-based authentication.
 * This allows the automaton to push to GitHub from its sandbox.
 *
 * The token is embedded in the remote URL (https://x-access-token:<token>@github.com/...)
 * and is only ever stored in the sandbox's git config — never exposed to the LLM.
 */
export async function setupGitRemote(
  client: GitHubClient,
  conway: ConwayClient,
  repoPath: string,
  repoName: string,
  remoteName: string = "origin",
): Promise<string> {
  const owner = await resolveOwner(client);
  const remoteUrl = client.buildAuthenticatedRemoteUrl(owner, repoName);

  // Remove existing remote if present, then add new one
  await conway.exec(
    `cd '${repoPath}' && git remote remove '${remoteName}' 2>/dev/null; git remote add '${remoteName}' '${remoteUrl}'`,
    10_000,
  );

  // Return sanitized URL (without token) for display
  return `Remote '${remoteName}' configured for ${owner}/${repoName}`;
}
