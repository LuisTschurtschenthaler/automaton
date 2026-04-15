/**
 * GitHub Tools Tests
 *
 * Tests for the higher-level GitHub tool functions that compose
 * GitHubClient calls. Mocks the client to test tool logic in isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GitHubClient } from "../../github/client.js";
import type { ConwayClient } from "../../types.js";
import {
  createRepository,
  listRepositories,
  getFile,
  createOrUpdateFile,
  createIssue,
  listIssues,
  createPullRequest,
  listPullRequests,
  setupGitRemote,
} from "../../github/tools.js";

// ─── Mock Factory ──────────────────────────────────────────────

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers(),
  } as unknown as Response;
}

function makeClient(): GitHubClient {
  return new GitHubClient("ghp_test_token");
}

const MOCK_USER = { login: "test-user", id: 1, html_url: "https://github.com/test-user" };

function queueUserResponse(): void {
  mockFetch.mockResolvedValueOnce(jsonResponse(MOCK_USER));
}

// ─── Repository Operations ─────────────────────────────────────

describe("createRepository", () => {
  it("creates a private repo with auto-init", async () => {
    const client = makeClient();

    // createRepo calls POST /user/repos directly (no owner resolution needed)
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        id: 1,
        name: "my-project",
        full_name: "test-user/my-project",
        private: true,
        html_url: "https://github.com/test-user/my-project",
        description: "A test project",
        default_branch: "main",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        language: null,
      }),
    );

    const repo = await createRepository(client, "my-project", "A test project");

    expect(repo.name).toBe("my-project");
    expect(repo.private).toBe(true);
    expect(repo.full_name).toBe("test-user/my-project");
  });
});

describe("listRepositories", () => {
  it("returns repos list", async () => {
    const client = makeClient();

    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 1,
          name: "repo-a",
          full_name: "user/repo-a",
          private: true,
          html_url: "https://github.com/user/repo-a",
          description: "First repo",
          default_branch: "main",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
          language: "TypeScript",
        },
        {
          id: 2,
          name: "repo-b",
          full_name: "user/repo-b",
          private: false,
          html_url: "https://github.com/user/repo-b",
          description: null,
          default_branch: "main",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
          language: null,
        },
      ]),
    );

    const repos = await listRepositories(client);
    expect(repos).toHaveLength(2);
    expect(repos[0].name).toBe("repo-a");
  });
});

// ─── File Operations ───────────────────────────────────────────

describe("getFile", () => {
  it("decodes base64 file content", async () => {
    const client = makeClient();

    queueUserResponse();
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        name: "index.ts",
        path: "src/index.ts",
        sha: "sha123",
        size: 50,
        content: Buffer.from("export const x = 1;").toString("base64"),
        encoding: "base64",
        html_url: "https://github.com/test-user/repo/blob/main/src/index.ts",
      }),
    );

    const result = await getFile(client, "repo", "src/index.ts");
    expect(result.content).toBe("export const x = 1;");
    expect(result.sha).toBe("sha123");
  });
});

describe("createOrUpdateFile", () => {
  it("creates a file with commit message", async () => {
    const client = makeClient();

    queueUserResponse();
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        commit: {
          sha: "commit-abc",
          html_url: "https://github.com/test-user/repo/commit/commit-abc",
          message: "Init file",
        },
      }),
    );

    const result = await createOrUpdateFile(client, "repo", "README.md", "# Hello", "Init file");
    expect(result.sha).toBe("commit-abc");
    expect(result.message).toBe("Init file");
  });

  it("passes sha for file updates", async () => {
    const client = makeClient();

    queueUserResponse();
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        commit: { sha: "new-sha", html_url: "https://x", message: "Update" },
      }),
    );

    await createOrUpdateFile(client, "repo", "file.txt", "new content", "Update", {
      sha: "old-sha",
      branch: "dev",
    });

    const [, options] = mockFetch.mock.calls[1]; // Second call (first is /user)
    const body = JSON.parse(options.body);
    expect(body.sha).toBe("old-sha");
    expect(body.branch).toBe("dev");
  });
});

// ─── Issue Operations ──────────────────────────────────────────

describe("createIssue", () => {
  it("creates an issue with labels", async () => {
    const client = makeClient();

    queueUserResponse();
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        number: 5,
        title: "Fix bug",
        body: "Details",
        state: "open",
        html_url: "https://github.com/test-user/repo/issues/5",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        labels: [{ name: "bug" }, { name: "priority" }],
      }),
    );

    const issue = await createIssue(client, "repo", "Fix bug", "Details", ["bug", "priority"]);
    expect(issue.number).toBe(5);
    expect(issue.labels).toHaveLength(2);
  });
});

describe("listIssues", () => {
  it("returns issues with state filter", async () => {
    const client = makeClient();

    queueUserResponse();
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          number: 1,
          title: "Open issue",
          body: null,
          state: "open",
          html_url: "https://github.com/test-user/repo/issues/1",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
          labels: [],
        },
      ]),
    );

    const issues = await listIssues(client, "repo", "open");
    expect(issues).toHaveLength(1);
    expect(issues[0].state).toBe("open");
  });
});

// ─── Pull Request Operations ───────────────────────────────────

describe("createPullRequest", () => {
  it("creates a PR between branches", async () => {
    const client = makeClient();

    queueUserResponse();
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        number: 10,
        title: "Add feature",
        body: "This PR adds...",
        state: "open",
        html_url: "https://github.com/test-user/repo/pull/10",
        head: { ref: "feature-branch" },
        base: { ref: "main" },
        created_at: "2026-01-01T00:00:00Z",
        merged: false,
      }),
    );

    const pr = await createPullRequest(client, "repo", "Add feature", "feature-branch", "main", "This PR adds...");
    expect(pr.number).toBe(10);
    expect(pr.head.ref).toBe("feature-branch");
    expect(pr.base.ref).toBe("main");
  });
});

describe("listPullRequests", () => {
  it("returns PRs", async () => {
    const client = makeClient();

    queueUserResponse();
    mockFetch.mockResolvedValueOnce(jsonResponse([]));

    const prs = await listPullRequests(client, "repo", "all");
    expect(prs).toHaveLength(0);
  });
});

// ─── Remote Setup ──────────────────────────────────────────────

describe("setupGitRemote", () => {
  it("configures remote in sandbox without exposing token", async () => {
    const client = makeClient();

    const mockConway: Partial<ConwayClient> = {
      exec: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
    };

    queueUserResponse();

    const result = await setupGitRemote(
      client,
      mockConway as ConwayClient,
      "/root/project",
      "my-repo",
      "origin",
    );

    // Result should NOT contain the token
    expect(result).not.toContain("ghp_test_token");
    expect(result).toContain("test-user/my-repo");
    expect(result).toContain("origin");

    // The exec call SHOULD contain the token (in sandbox only)
    const execCall = (mockConway.exec as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(execCall).toContain("x-access-token:");
    expect(execCall).toContain("git remote");
  });

  it("uses default remote name 'origin'", async () => {
    const client = makeClient();

    const mockConway: Partial<ConwayClient> = {
      exec: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
    };

    queueUserResponse();

    await setupGitRemote(client, mockConway as ConwayClient, "/root/project", "repo");

    const execCall = (mockConway.exec as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(execCall).toContain("'origin'");
  });
});

// ─── Owner Caching ─────────────────────────────────────────────

describe("owner resolution caching", () => {
  it("caches owner per client instance, only calls /user once", async () => {
    const client = makeClient();

    // First call resolves user
    queueUserResponse();
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        name: "f",
        path: "f",
        sha: "s",
        size: 1,
        content: Buffer.from("x").toString("base64"),
        encoding: "base64",
        html_url: "https://x",
      }),
    );

    await getFile(client, "repo", "f");

    // Second call should reuse cached owner — no /user call
    mockFetch.mockResolvedValueOnce(jsonResponse([]));
    await listIssues(client, "repo");

    // Total: /user + /contents/f + /issues = 3, not 4
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
