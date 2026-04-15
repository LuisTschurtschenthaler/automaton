/**
 * GitHub REST API Client
 *
 * Thin wrapper around the GitHub REST API using native fetch.
 * Uses the automaton's configured GitHub token for authentication.
 * No external SDK dependencies — keeps bundle minimal.
 */

import { createLogger } from "../observability/logger.js";

const logger = createLogger("github");

const GITHUB_API = "https://api.github.com";

// ─── Types ─────────────────────────────────────────────────────

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  description: string | null;
  default_branch: string;
  created_at: string;
  updated_at: string;
  language: string | null;
}

export interface GitHubFile {
  name: string;
  path: string;
  sha: string;
  size: number;
  content: string;
  encoding: string;
  html_url: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  labels: Array<{ name: string }>;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  head: { ref: string };
  base: { ref: string };
  created_at: string;
  merged: boolean;
}

export interface GitHubCommitResult {
  sha: string;
  html_url: string;
  message: string;
}

export interface GitHubUser {
  login: string;
  id: number;
  html_url: string;
}

export class GitHubApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly body: string,
  ) {
    super(`GitHub API ${status} ${statusText}: ${body}`);
    this.name = "GitHubApiError";
  }
}

// ─── Validation ────────────────────────────────────────────────

/** Validate a GitHub repository name. */
export function validateRepoName(name: string): string | null {
  if (!name || name.length === 0) return "Repository name cannot be empty";
  if (name.length > 100) return "Repository name must be ≤100 characters";
  if (!/^[a-zA-Z0-9._-]+$/.test(name))
    return "Repository name may only contain alphanumeric characters, hyphens, underscores, and dots";
  if (name.startsWith(".") || name.endsWith("."))
    return "Repository name cannot start or end with a dot";
  if (name === "." || name === "..") return "Invalid repository name";
  return null;
}

/** Validate a branch name. */
export function validateBranchName(name: string): string | null {
  if (!name || name.length === 0) return "Branch name cannot be empty";
  if (name.length > 255) return "Branch name must be ≤255 characters";
  if (/[\x00-\x1f\x7f ~^:?*\[\\]/.test(name))
    return "Branch name contains invalid characters";
  if (name.startsWith("/") || name.endsWith("/") || name.includes("//"))
    return "Branch name has invalid slash usage";
  if (name.includes("..")) return "Branch name cannot contain '..'";
  if (name.endsWith(".lock") || name.endsWith("."))
    return "Branch name cannot end with .lock or dot";
  if (name.startsWith("-")) return "Branch name cannot start with a hyphen";
  return null;
}

/** Validate a file path within a repo. */
export function validateFilePath(path: string): string | null {
  if (!path || path.length === 0) return "File path cannot be empty";
  if (path.length > 1024) return "File path must be ≤1024 characters";
  if (path.startsWith("/")) return "File path should not start with /";
  if (path.includes("..")) return "File path cannot contain '..'";
  if (path.includes("\0")) return "File path cannot contain null bytes";
  return null;
}

// ─── Client ────────────────────────────────────────────────────

export class GitHubClient {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(token: string, baseUrl: string = GITHUB_API) {
    this.token = token;
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    logger.debug(`${method} ${path}`);

    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${this.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "conway-automaton",
    };

    if (body) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new GitHubApiError(response.status, response.statusText, text);
    }

    // 204 No Content
    if (response.status === 204) return undefined as T;

    return (await response.json()) as T;
  }

  // ── User ──

  async getAuthenticatedUser(): Promise<GitHubUser> {
    return this.request<GitHubUser>("GET", "/user");
  }

  // ── Repositories ──

  async createRepo(options: {
    name: string;
    description?: string;
    isPrivate?: boolean;
    autoInit?: boolean;
  }): Promise<GitHubRepo> {
    const validationError = validateRepoName(options.name);
    if (validationError) throw new Error(validationError);

    return this.request<GitHubRepo>("POST", "/user/repos", {
      name: options.name,
      description: options.description || "",
      private: options.isPrivate !== false, // default to private
      auto_init: options.autoInit !== false, // default to auto-init
    });
  }

  async listRepos(options?: {
    sort?: "created" | "updated" | "pushed" | "full_name";
    perPage?: number;
    page?: number;
  }): Promise<GitHubRepo[]> {
    const sort = options?.sort || "updated";
    const perPage = Math.min(options?.perPage || 30, 100);
    const page = options?.page || 1;
    return this.request<GitHubRepo[]>(
      "GET",
      `/user/repos?sort=${sort}&per_page=${perPage}&page=${page}&type=owner`,
    );
  }

  async getRepo(owner: string, repo: string): Promise<GitHubRepo> {
    return this.request<GitHubRepo>("GET", `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
  }

  // ── File Operations ──

  async getFileContent(
    owner: string,
    repo: string,
    path: string,
    ref?: string,
  ): Promise<GitHubFile> {
    const pathError = validateFilePath(path);
    if (pathError) throw new Error(pathError);

    const refParam = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    return this.request<GitHubFile>(
      "GET",
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}${refParam}`,
    );
  }

  async createOrUpdateFile(
    owner: string,
    repo: string,
    path: string,
    options: {
      content: string;
      message: string;
      branch?: string;
      sha?: string; // required for updates
    },
  ): Promise<GitHubCommitResult> {
    const pathError = validateFilePath(path);
    if (pathError) throw new Error(pathError);

    // Base64 encode the content
    const encoded = Buffer.from(options.content, "utf-8").toString("base64");

    const body: Record<string, unknown> = {
      message: options.message,
      content: encoded,
    };
    if (options.branch) body.branch = options.branch;
    if (options.sha) body.sha = options.sha;

    const result = await this.request<{ commit: { sha: string; html_url: string; message: string } }>(
      "PUT",
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`,
      body,
    );

    return {
      sha: result.commit.sha,
      html_url: result.commit.html_url,
      message: result.commit.message,
    };
  }

  // ── Issues ──

  async createIssue(
    owner: string,
    repo: string,
    options: {
      title: string;
      body?: string;
      labels?: string[];
    },
  ): Promise<GitHubIssue> {
    return this.request<GitHubIssue>(
      "POST",
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
      {
        title: options.title,
        body: options.body || "",
        labels: options.labels || [],
      },
    );
  }

  async listIssues(
    owner: string,
    repo: string,
    options?: {
      state?: "open" | "closed" | "all";
      perPage?: number;
      page?: number;
    },
  ): Promise<GitHubIssue[]> {
    const state = options?.state || "open";
    const perPage = Math.min(options?.perPage || 30, 100);
    const page = options?.page || 1;
    return this.request<GitHubIssue[]>(
      "GET",
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?state=${state}&per_page=${perPage}&page=${page}`,
    );
  }

  // ── Pull Requests ──

  async createPullRequest(
    owner: string,
    repo: string,
    options: {
      title: string;
      body?: string;
      head: string;
      base: string;
    },
  ): Promise<GitHubPullRequest> {
    const headError = validateBranchName(options.head);
    if (headError) throw new Error(`Invalid head branch: ${headError}`);
    const baseError = validateBranchName(options.base);
    if (baseError) throw new Error(`Invalid base branch: ${baseError}`);

    return this.request<GitHubPullRequest>(
      "POST",
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
      {
        title: options.title,
        body: options.body || "",
        head: options.head,
        base: options.base,
      },
    );
  }

  async listPullRequests(
    owner: string,
    repo: string,
    options?: {
      state?: "open" | "closed" | "all";
      perPage?: number;
      page?: number;
    },
  ): Promise<GitHubPullRequest[]> {
    const state = options?.state || "open";
    const perPage = Math.min(options?.perPage || 30, 100);
    const page = options?.page || 1;
    return this.request<GitHubPullRequest[]>(
      "GET",
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=${state}&per_page=${perPage}&page=${page}`,
    );
  }

  // ── Remote Setup ──

  /**
   * Build a HTTPS remote URL with embedded token for push access.
   * WARNING: This URL contains the token — only use in sandbox context.
   */
  buildAuthenticatedRemoteUrl(owner: string, repo: string): string {
    return `https://x-access-token:${this.token}@github.com/${owner}/${repo}.git`;
  }
}
