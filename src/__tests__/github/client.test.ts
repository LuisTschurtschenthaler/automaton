/**
 * GitHub Client Tests
 *
 * Tests for the GitHubClient class: request handling, validation,
 * error handling, and all API methods.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  GitHubClient,
  GitHubApiError,
  validateRepoName,
  validateBranchName,
  validateFilePath,
} from "../../github/client.js";

// ─── Fetch Mock ────────────────────────────────────────────────

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
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers(),
  } as unknown as Response;
}

function errorResponse(status: number, body: string): Response {
  return {
    ok: false,
    status,
    statusText: "Error",
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(body),
    headers: new Headers(),
  } as unknown as Response;
}

// ─── Validation Tests ──────────────────────────────────────────

describe("validateRepoName", () => {
  it("accepts valid repo names", () => {
    expect(validateRepoName("my-repo")).toBeNull();
    expect(validateRepoName("my_repo")).toBeNull();
    expect(validateRepoName("MyRepo123")).toBeNull();
    expect(validateRepoName("repo.name")).toBeNull();
  });

  it("rejects empty names", () => {
    expect(validateRepoName("")).not.toBeNull();
  });

  it("rejects names over 100 chars", () => {
    expect(validateRepoName("a".repeat(101))).not.toBeNull();
  });

  it("rejects names with special characters", () => {
    expect(validateRepoName("repo name")).not.toBeNull();
    expect(validateRepoName("repo@name")).not.toBeNull();
    expect(validateRepoName("repo/name")).not.toBeNull();
  });

  it("rejects names starting or ending with dot", () => {
    expect(validateRepoName(".repo")).not.toBeNull();
    expect(validateRepoName("repo.")).not.toBeNull();
  });

  it("rejects . and ..", () => {
    expect(validateRepoName(".")).not.toBeNull();
    expect(validateRepoName("..")).not.toBeNull();
  });
});

describe("validateBranchName", () => {
  it("accepts valid branch names", () => {
    expect(validateBranchName("main")).toBeNull();
    expect(validateBranchName("feature/my-branch")).toBeNull();
    expect(validateBranchName("release-1.0.0")).toBeNull();
  });

  it("rejects empty names", () => {
    expect(validateBranchName("")).not.toBeNull();
  });

  it("rejects names over 255 chars", () => {
    expect(validateBranchName("a".repeat(256))).not.toBeNull();
  });

  it("rejects control characters", () => {
    expect(validateBranchName("branch\x00name")).not.toBeNull();
    expect(validateBranchName("branch\tname")).not.toBeNull();
  });

  it("rejects names with invalid git ref chars", () => {
    expect(validateBranchName("branch~name")).not.toBeNull();
    expect(validateBranchName("branch^name")).not.toBeNull();
    expect(validateBranchName("branch:name")).not.toBeNull();
    expect(validateBranchName("branch?name")).not.toBeNull();
    expect(validateBranchName("branch*name")).not.toBeNull();
    expect(validateBranchName("branch[name")).not.toBeNull();
    expect(validateBranchName("branch\\name")).not.toBeNull();
  });

  it("rejects names with bad slash usage", () => {
    expect(validateBranchName("/leading")).not.toBeNull();
    expect(validateBranchName("trailing/")).not.toBeNull();
    expect(validateBranchName("double//slash")).not.toBeNull();
  });

  it("rejects names ending in .lock", () => {
    expect(validateBranchName("branch.lock")).not.toBeNull();
  });

  it("rejects names starting with hyphen", () => {
    expect(validateBranchName("-branch")).not.toBeNull();
  });
});

describe("validateFilePath", () => {
  it("accepts valid file paths", () => {
    expect(validateFilePath("README.md")).toBeNull();
    expect(validateFilePath("src/index.ts")).toBeNull();
    expect(validateFilePath("deeply/nested/path/file.txt")).toBeNull();
  });

  it("rejects empty paths", () => {
    expect(validateFilePath("")).not.toBeNull();
  });

  it("rejects paths over 1024 chars", () => {
    expect(validateFilePath("a".repeat(1025))).not.toBeNull();
  });

  it("rejects paths starting with /", () => {
    expect(validateFilePath("/absolute/path")).not.toBeNull();
  });

  it("rejects paths with ..", () => {
    expect(validateFilePath("../escape")).not.toBeNull();
    expect(validateFilePath("dir/../escape")).not.toBeNull();
  });

  it("rejects paths with null bytes", () => {
    expect(validateFilePath("file\0name")).not.toBeNull();
  });
});

// ─── Client Tests ──────────────────────────────────────────────

describe("GitHubClient", () => {
  const client = new GitHubClient("ghp_test_token_123");

  describe("request headers", () => {
    it("sends correct auth and API version headers", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ login: "test-user", id: 1, html_url: "https://github.com/test-user" }));

      await client.getAuthenticatedUser();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.github.com/user");
      expect(options.headers.Authorization).toBe("Bearer ghp_test_token_123");
      expect(options.headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
      expect(options.headers.Accept).toBe("application/vnd.github+json");
      expect(options.headers["User-Agent"]).toBe("conway-automaton");
    });
  });

  describe("error handling", () => {
    it("throws GitHubApiError on non-2xx responses", async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(404, '{"message":"Not Found"}'));

      await expect(client.getAuthenticatedUser()).rejects.toThrow(GitHubApiError);
      await expect(
        (async () => {
          mockFetch.mockResolvedValueOnce(errorResponse(404, '{"message":"Not Found"}'));
          return client.getAuthenticatedUser();
        })(),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("includes status and body in error", async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(422, '{"message":"Validation Failed"}'));

      try {
        await client.getAuthenticatedUser();
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(GitHubApiError);
        const apiErr = err as GitHubApiError;
        expect(apiErr.status).toBe(422);
        expect(apiErr.body).toContain("Validation Failed");
      }
    });

    it("throws GitHubApiError on rate limit (403)", async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(403, '{"message":"API rate limit exceeded"}'));

      await expect(client.getAuthenticatedUser()).rejects.toThrow(GitHubApiError);
    });
  });

  describe("getAuthenticatedUser", () => {
    it("returns user data", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ login: "automaton-bot", id: 42, html_url: "https://github.com/automaton-bot" }),
      );

      const user = await client.getAuthenticatedUser();
      expect(user.login).toBe("automaton-bot");
      expect(user.id).toBe(42);
    });
  });

  describe("createRepo", () => {
    it("creates a private repo by default", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          id: 1,
          name: "my-repo",
          full_name: "automaton-bot/my-repo",
          private: true,
          html_url: "https://github.com/automaton-bot/my-repo",
          description: "Test repo",
          default_branch: "main",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
          language: null,
        }),
      );

      const repo = await client.createRepo({ name: "my-repo", description: "Test repo" });
      expect(repo.name).toBe("my-repo");
      expect(repo.private).toBe(true);

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.private).toBe(true);
      expect(body.auto_init).toBe(true);
    });

    it("rejects invalid repo names", async () => {
      await expect(client.createRepo({ name: "invalid name!" })).rejects.toThrow(/alphanumeric/);
    });

    it("rejects empty repo names", async () => {
      await expect(client.createRepo({ name: "" })).rejects.toThrow(/empty/);
    });
  });

  describe("listRepos", () => {
    it("returns repos with default params", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse([
          {
            id: 1,
            name: "repo-a",
            full_name: "user/repo-a",
            private: true,
            html_url: "https://github.com/user/repo-a",
            description: null,
            default_branch: "main",
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
            language: "TypeScript",
          },
        ]),
      );

      const repos = await client.listRepos();
      expect(repos).toHaveLength(1);
      expect(repos[0].name).toBe("repo-a");

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("sort=updated");
      expect(url).toContain("per_page=30");
      expect(url).toContain("type=owner");
    });

    it("caps per_page at 100", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([]));

      await client.listRepos({ perPage: 200 });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("per_page=100");
    });
  });

  describe("getFileContent", () => {
    it("fetches file with ref parameter", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          name: "README.md",
          path: "README.md",
          sha: "abc123",
          size: 100,
          content: Buffer.from("# Hello").toString("base64"),
          encoding: "base64",
          html_url: "https://github.com/user/repo/blob/main/README.md",
        }),
      );

      const file = await client.getFileContent("user", "repo", "README.md", "main");
      expect(file.sha).toBe("abc123");

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("?ref=main");
    });

    it("rejects invalid file paths", async () => {
      await expect(client.getFileContent("user", "repo", "../escape")).rejects.toThrow(/\.\./);
    });

    it("rejects absolute paths", async () => {
      await expect(client.getFileContent("user", "repo", "/etc/passwd")).rejects.toThrow(/start with/);
    });
  });

  describe("createOrUpdateFile", () => {
    it("base64-encodes content and sends commit", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          commit: {
            sha: "def456",
            html_url: "https://github.com/user/repo/commit/def456",
            message: "Add file",
          },
        }),
      );

      const result = await client.createOrUpdateFile("user", "repo", "src/index.ts", {
        content: "console.log('hello');",
        message: "Add file",
        branch: "main",
      });

      expect(result.sha).toBe("def456");

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      // Verify base64 encoding
      expect(Buffer.from(body.content, "base64").toString("utf-8")).toBe("console.log('hello');");
      expect(body.message).toBe("Add file");
      expect(body.branch).toBe("main");
    });

    it("includes sha for file updates", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ commit: { sha: "aaa", html_url: "https://x", message: "Update" } }),
      );

      await client.createOrUpdateFile("user", "repo", "file.txt", {
        content: "updated",
        message: "Update",
        sha: "old-sha-abc",
      });

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.sha).toBe("old-sha-abc");
    });
  });

  describe("createIssue", () => {
    it("creates an issue with labels", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          number: 42,
          title: "Bug report",
          body: "Details here",
          state: "open",
          html_url: "https://github.com/user/repo/issues/42",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
          labels: [{ name: "bug" }],
        }),
      );

      const issue = await client.createIssue("user", "repo", {
        title: "Bug report",
        body: "Details here",
        labels: ["bug"],
      });

      expect(issue.number).toBe(42);
      expect(issue.title).toBe("Bug report");
      expect(issue.labels[0].name).toBe("bug");
    });
  });

  describe("listIssues", () => {
    it("fetches issues with state filter", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([]));

      await client.listIssues("user", "repo", { state: "closed" });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("state=closed");
    });
  });

  describe("createPullRequest", () => {
    it("creates a PR", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          number: 7,
          title: "Feature PR",
          body: "Description",
          state: "open",
          html_url: "https://github.com/user/repo/pull/7",
          head: { ref: "feature" },
          base: { ref: "main" },
          created_at: "2026-01-01T00:00:00Z",
          merged: false,
        }),
      );

      const pr = await client.createPullRequest("user", "repo", {
        title: "Feature PR",
        body: "Description",
        head: "feature",
        base: "main",
      });

      expect(pr.number).toBe(7);
      expect(pr.head.ref).toBe("feature");
      expect(pr.base.ref).toBe("main");
    });

    it("rejects invalid branch names", async () => {
      await expect(
        client.createPullRequest("user", "repo", {
          title: "PR",
          head: "feature~bad",
          base: "main",
        }),
      ).rejects.toThrow(/Invalid head branch/);

      await expect(
        client.createPullRequest("user", "repo", {
          title: "PR",
          head: "feature",
          base: "main..bad",
        }),
      ).rejects.toThrow(/Invalid base branch/);
    });
  });

  describe("listPullRequests", () => {
    it("fetches PRs with default params", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([]));

      await client.listPullRequests("user", "repo");

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("state=open");
      expect(url).toContain("per_page=30");
    });
  });

  describe("buildAuthenticatedRemoteUrl", () => {
    it("embeds token in HTTPS URL", () => {
      const url = client.buildAuthenticatedRemoteUrl("user", "my-repo");
      expect(url).toBe("https://x-access-token:ghp_test_token_123@github.com/user/my-repo.git");
    });
  });

  describe("custom base URL", () => {
    it("uses custom base URL for GitHub Enterprise", async () => {
      const gheClient = new GitHubClient("token", "https://ghe.example.com/api/v3");
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ login: "user", id: 1, html_url: "https://ghe.example.com/user" }),
      );

      await gheClient.getAuthenticatedUser();

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("https://ghe.example.com/api/v3/user");
    });
  });
});
