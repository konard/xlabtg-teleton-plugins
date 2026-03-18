/**
 * Integration tests for github-dev-assistant plugin.
 *
 * Tests full tool call flows using mocked GitHub API responses.
 * Verifies: tool input validation, API call construction, ToolResult shape,
 * and the require_pr_review policy guard.
 *
 * All tools return { success, data?, error? } per the SDK ToolResult contract.
 * Tools accept (params, context) per SimpleToolDef.execute signature.
 *
 * NOTE: Tools now take only sdk (not client + sdk). The GitHub client is
 * created internally per execution using sdk.secrets for the PAT token.
 * We mock global.fetch to intercept API calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { buildRepoOpsTools } from "../lib/repo-ops.js";
import { buildPRManagerTools } from "../lib/pr-manager.js";
import { buildIssueTrackerTools } from "../lib/issue-tracker.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSdk(config = {}, token = "ghp_testtoken") {
  return {
    secrets: {
      get: (key) => (key === "github_token" ? token : null),
      has: (key) => key === "github_token" && token !== null,
    },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    pluginConfig: {
      default_branch: "main",
      commit_author_name: "Test Agent",
      commit_author_email: "agent@test.local",
      require_pr_review: false,
      ...config,
    },
  };
}

// Fake context (PluginToolContext)
const fakeContext = { chatId: "123", senderId: 1, isGroup: false };

/**
 * Create a mock fetch that returns different responses based on
 * method + URL patterns.
 *
 * @param {Array<{match: RegExp|string, method?: string, status: number, body: any}>} routes
 */
function mockFetchRoutes(routes) {
  return vi.fn().mockImplementation(async (url, opts) => {
    const method = (opts?.method ?? "GET").toUpperCase();
    for (const route of routes) {
      const urlMatch =
        typeof route.match === "string" ? url.includes(route.match) : route.match.test(url);
      const methodMatch = !route.method || route.method.toUpperCase() === method;
      if (urlMatch && methodMatch) {
        const status = route.status ?? 200;
        return {
          ok: status >= 200 && status < 300,
          status,
          headers: { get: () => null },
          text: async () =>
            typeof route.body === "string" ? route.body : JSON.stringify(route.body),
        };
      }
    }
    throw new Error(`Unmatched fetch: ${method} ${url}`);
  });
}

function findTool(tools, name) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool '${name}' not found`);
  return tool;
}

// ---------------------------------------------------------------------------
// Repo ops tests
// ---------------------------------------------------------------------------

describe("github_list_repos", () => {
  let originalFetch;
  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks(); });

  it("returns repos list for authenticated user", async () => {
    const sdk = makeSdk();
    global.fetch = mockFetchRoutes([
      {
        match: "/user/repos",
        body: [
          { id: 1, name: "hello", full_name: "octocat/hello", private: false,
            html_url: "https://github.com/octocat/hello", language: "JavaScript",
            description: "My greeting tool", stargazers_count: 10 },
        ],
      },
      {
        match: "/user",
        method: "GET",
        body: { login: "octocat" },
      },
    ]);

    const tools = buildRepoOpsTools(sdk);
    const tool = findTool(tools, "github_list_repos");
    const result = await tool.execute({}, fakeContext);

    expect(result.success).toBe(true);
    expect(result.data.repos).toHaveLength(1);
    expect(result.data.repos[0].name).toBe("hello");
    expect(result.data.repos[0].language).toBe("JavaScript");
    expect(result.data.repos[0].private).toBe(false);
  });

  it("returns error for invalid type enum", async () => {
    const sdk = makeSdk();
    const tools = buildRepoOpsTools(sdk);
    const tool = findTool(tools, "github_list_repos");

    const result = await tool.execute({ owner: "octocat", type: "not-valid" }, fakeContext);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not-valid/);
  });
});

describe("github_create_repo", () => {
  let originalFetch;
  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks(); });

  it("creates repo and returns full_name and URL", async () => {
    const sdk = makeSdk();
    global.fetch = mockFetchRoutes([
      {
        match: "/user/repos",
        method: "POST",
        status: 201,
        body: {
          id: 999, name: "new-repo", full_name: "octocat/new-repo",
          private: false, html_url: "https://github.com/octocat/new-repo",
        },
      },
    ]);

    const tools = buildRepoOpsTools(sdk);
    const tool = findTool(tools, "github_create_repo");
    const result = await tool.execute({ name: "new-repo", description: "Test" }, fakeContext);

    expect(result.success).toBe(true);
    expect(result.data.full_name).toBe("octocat/new-repo");
    expect(result.data.html_url).toMatch(/github\.com/);
  });

  it("returns error when name parameter is missing", async () => {
    const sdk = makeSdk();
    const tools = buildRepoOpsTools(sdk);
    const tool = findTool(tools, "github_create_repo");

    const result = await tool.execute({}, fakeContext);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/name/);
  });
});

describe("github_get_file", () => {
  let originalFetch;
  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks(); });

  it("returns decoded file content", async () => {
    const sdk = makeSdk();
    const fileContent = "Hello, world!";
    const b64 = Buffer.from(fileContent).toString("base64");

    global.fetch = mockFetchRoutes([
      {
        match: "/contents/README.md",
        body: {
          type: "file", name: "README.md", path: "README.md",
          sha: "abc123", size: fileContent.length,
          content: b64 + "\n",
          encoding: "base64",
          html_url: "https://github.com/octocat/hello/blob/main/README.md",
        },
      },
    ]);

    const tools = buildRepoOpsTools(sdk);
    const tool = findTool(tools, "github_get_file");
    const result = await tool.execute({ owner: "octocat", repo: "hello", path: "README.md" }, fakeContext);

    expect(result.success).toBe(true);
    expect(result.data.type).toBe("file");
    expect(result.data.path).toBe("README.md");
    expect(result.data.content).toBe("Hello, world!");
  });

  it("returns directory listing when path is a dir", async () => {
    const sdk = makeSdk();
    global.fetch = mockFetchRoutes([
      {
        match: "/contents/src",
        body: [
          { name: "index.js", path: "src/index.js", type: "file", size: 100, sha: "a" },
          { name: "utils.js", path: "src/utils.js", type: "file", size: 200, sha: "b" },
        ],
      },
    ]);

    const tools = buildRepoOpsTools(sdk);
    const tool = findTool(tools, "github_get_file");
    const result = await tool.execute({ owner: "octocat", repo: "hello", path: "src" }, fakeContext);

    expect(result.success).toBe(true);
    expect(result.data.type).toBe("directory");
    const names = result.data.entries.map((e) => e.name);
    expect(names).toContain("index.js");
    expect(names).toContain("utils.js");
  });

  it("returns error when required params are missing", async () => {
    const sdk = makeSdk();
    const tools = buildRepoOpsTools(sdk);
    const tool = findTool(tools, "github_get_file");

    const result = await tool.execute({ owner: "octocat" }, fakeContext);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/repo/);
  });
});

describe("github_update_file", () => {
  let originalFetch;
  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks(); });

  it("encodes content and returns commit data", async () => {
    const sdk = makeSdk();
    let capturedBody;
    global.fetch = vi.fn().mockImplementation(async (url, opts) => {
      if (opts?.method === "PUT") {
        capturedBody = JSON.parse(opts.body);
        return {
          ok: true, status: 200,
          headers: { get: () => null },
          text: async () => JSON.stringify({
            content: { sha: "new-sha", path: "README.md" },
            commit: { sha: "commit-sha", html_url: "https://github.com/octocat/hello/commit/commit-sha" },
          }),
        };
      }
      throw new Error(`Unexpected fetch: ${opts?.method} ${url}`);
    });

    const tools = buildRepoOpsTools(sdk);
    const tool = findTool(tools, "github_update_file");
    const result = await tool.execute({
      owner: "octocat", repo: "hello", path: "README.md",
      content: "# Hello World", message: "Update README",
    }, fakeContext);

    expect(result.success).toBe(true);
    expect(result.data.action).toBe("created");
    expect(result.data.path).toBe("README.md");
    expect(result.data.commit_url).toMatch(/github\.com/);
    // Verify content was base64-encoded in the request
    expect(Buffer.from(capturedBody.content, "base64").toString()).toBe("# Hello World");
    expect(capturedBody.message).toBe("Update README");
    expect(capturedBody.committer.name).toBe("Test Agent");
  });
});

describe("github_create_branch", () => {
  let originalFetch;
  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks(); });

  it("creates branch from specified ref and returns branch data", async () => {
    const sdk = makeSdk();
    global.fetch = mockFetchRoutes([
      {
        match: "/git/ref/heads/main",
        method: "GET",
        body: { object: { sha: "base-sha-123" } },
      },
      {
        match: "/git/refs",
        method: "POST",
        status: 201,
        body: { ref: "refs/heads/feat/new-feature", object: { sha: "base-sha-123" } },
      },
    ]);

    const tools = buildRepoOpsTools(sdk);
    const tool = findTool(tools, "github_create_branch");
    const result = await tool.execute({
      owner: "octocat", repo: "hello", branch: "feat/new-feature", from_ref: "main",
    }, fakeContext);

    expect(result.success).toBe(true);
    expect(result.data.branch).toBe("feat/new-feature");
    expect(result.data.from_ref).toBe("main");
    expect(result.data.sha).toBe("base-sha-123");
  });
});

// ---------------------------------------------------------------------------
// PR manager tests
// ---------------------------------------------------------------------------

describe("github_create_pr", () => {
  let originalFetch;
  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks(); });

  it("creates PR and returns number + URL", async () => {
    const sdk = makeSdk();
    global.fetch = mockFetchRoutes([
      {
        match: "/pulls",
        method: "POST",
        status: 201,
        body: {
          number: 7, title: "Add feature", state: "open",
          head: { label: "octocat:feat/my-feature", sha: "abc" },
          base: { label: "octocat:main" },
          html_url: "https://github.com/octocat/hello/pull/7",
          user: { login: "octocat" }, draft: false,
        },
      },
    ]);

    const tools = buildPRManagerTools(sdk);
    const tool = findTool(tools, "github_create_pr");
    const result = await tool.execute({
      owner: "octocat", repo: "hello",
      title: "Add feature", head: "feat/my-feature",
    }, fakeContext);

    expect(result.success).toBe(true);
    expect(result.data.number).toBe(7);
    expect(result.data.html_url).toMatch(/github\.com/);
  });
});

describe("github_merge_pr - require_pr_review policy", () => {
  let originalFetch;
  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks(); });

  it("merges successfully when require_pr_review is false", async () => {
    const sdk = makeSdk({ require_pr_review: false });
    global.fetch = mockFetchRoutes([
      {
        match: "/pulls/7/merge",
        method: "PUT",
        body: { merged: true, sha: "merge-sha", message: "Merged" },
      },
    ]);

    const tools = buildPRManagerTools(sdk);
    const tool = findTool(tools, "github_merge_pr");
    const result = await tool.execute({ owner: "octocat", repo: "hello", pr_number: 7 }, fakeContext);

    expect(result.success).toBe(true);
    expect(result.data.pr_number).toBe(7);
    expect(result.data.sha).toBe("merge-sha");
  });

  it("returns error asking for confirmation when require_pr_review is true and confirmed not set", async () => {
    const sdk = makeSdk({ require_pr_review: true });

    global.fetch = mockFetchRoutes([
      {
        match: "/pulls/7",
        method: "GET",
        body: { number: 7, title: "Dangerous merge", state: "open",
          head: { label: "feat", sha: "abc" }, base: { label: "main" },
          html_url: "...", user: { login: "octocat" } },
      },
    ]);

    const tools = buildPRManagerTools(sdk);
    const tool = findTool(tools, "github_merge_pr");
    const result = await tool.execute({ owner: "octocat", repo: "hello", pr_number: 7 }, fakeContext);

    // Should return an error instructing the LLM to ask for user confirmation
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/require_pr_review/i);
    expect(result.error).toMatch(/confirmed=true/);
    // No merge should have been attempted
    const mergeCalls = global.fetch.mock.calls.filter(([url, opts]) =>
      url.includes("/merge") && opts?.method === "PUT"
    );
    expect(mergeCalls).toHaveLength(0);
  });

  it("merges when require_pr_review is true and confirmed=true", async () => {
    const sdk = makeSdk({ require_pr_review: true });
    global.fetch = mockFetchRoutes([
      {
        match: "/pulls/7/merge",
        method: "PUT",
        body: { merged: true, sha: "merge-sha", message: "Merged" },
      },
    ]);

    const tools = buildPRManagerTools(sdk);
    const tool = findTool(tools, "github_merge_pr");
    const result = await tool.execute({
      owner: "octocat", repo: "hello", pr_number: 7,
      confirmed: true,
    }, fakeContext);

    expect(result.success).toBe(true);
    expect(result.data.pr_number).toBe(7);
  });

  it("validates merge_method enum", async () => {
    const sdk = makeSdk();
    const tools = buildPRManagerTools(sdk);
    const tool = findTool(tools, "github_merge_pr");

    const result = await tool.execute({
      owner: "octocat", repo: "hello", pr_number: 7, merge_method: "invalid",
    }, fakeContext);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid/i);
  });
});

// ---------------------------------------------------------------------------
// Issue tracker tests
// ---------------------------------------------------------------------------

describe("github_create_issue", () => {
  let originalFetch;
  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks(); });

  it("creates issue and returns number + URL", async () => {
    const sdk = makeSdk();
    global.fetch = mockFetchRoutes([
      {
        match: "/issues",
        method: "POST",
        status: 201,
        body: {
          number: 15, title: "Bug: crash on startup", state: "open",
          html_url: "https://github.com/octocat/hello/issues/15",
          user: { login: "octocat" }, assignees: [{ login: "reviewer" }],
          labels: [{ name: "bug" }],
        },
      },
    ]);

    const tools = buildIssueTrackerTools(sdk);
    const tool = findTool(tools, "github_create_issue");
    const result = await tool.execute({
      owner: "octocat", repo: "hello",
      title: "Bug: crash on startup",
      body: "Steps to reproduce...",
      labels: ["bug"],
      assignees: ["reviewer"],
    }, fakeContext);

    expect(result.success).toBe(true);
    expect(result.data.number).toBe(15);
    expect(result.data.html_url).toMatch(/github\.com/);
    expect(result.data.labels).toContain("bug");
  });

  it("returns error when title parameter is missing", async () => {
    const sdk = makeSdk();
    const tools = buildIssueTrackerTools(sdk);
    const tool = findTool(tools, "github_create_issue");
    const result = await tool.execute({ owner: "o", repo: "r" }, fakeContext);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/title/);
  });
});

describe("github_close_issue", () => {
  let originalFetch;
  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks(); });

  it("closes issue with comment and returns closed state", async () => {
    const sdk = makeSdk();
    global.fetch = mockFetchRoutes([
      {
        match: "/issues/20/comments",
        method: "POST",
        status: 201,
        body: { id: 100, html_url: "...", body: "Closing comment", user: { login: "octocat" } },
      },
      {
        match: "/issues/20",
        method: "PATCH",
        body: {
          number: 20, title: "Old issue", state: "closed", state_reason: "not_planned",
          html_url: "https://github.com/octocat/hello/issues/20",
          user: { login: "octocat" },
        },
      },
    ]);

    const tools = buildIssueTrackerTools(sdk);
    const tool = findTool(tools, "github_close_issue");
    const result = await tool.execute({
      owner: "octocat", repo: "hello", issue_number: 20,
      comment: "Closing as not planned.", reason: "not_planned",
    }, fakeContext);

    expect(result.success).toBe(true);
    expect(result.data.number).toBe(20);
    expect(result.data.state).toBe("closed");
    expect(result.data.reason).toBe("not_planned");
    expect(result.data.html_url).toMatch(/github\.com/);
  });
});

describe("github_trigger_workflow", () => {
  let originalFetch;
  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks(); });

  it("triggers workflow and returns confirmation", async () => {
    const sdk = makeSdk();
    global.fetch = mockFetchRoutes([
      {
        match: "/dispatches",
        method: "POST",
        status: 204,
        body: null,
      },
    ]);

    const tools = buildIssueTrackerTools(sdk);
    const tool = findTool(tools, "github_trigger_workflow");
    const result = await tool.execute({
      owner: "octocat", repo: "hello",
      workflow_id: "ci.yml", ref: "main",
      inputs: { environment: "staging" },
    }, fakeContext);

    expect(result.success).toBe(true);
    expect(result.data.workflow_id).toBe("ci.yml");
    expect(result.data.ref).toBe("main");
    expect(result.data.inputs).toEqual({ environment: "staging" });
  });

  it("returns error when ref parameter is missing", async () => {
    const sdk = makeSdk();
    const tools = buildIssueTrackerTools(sdk);
    const tool = findTool(tools, "github_trigger_workflow");
    const result = await tool.execute({ owner: "o", repo: "r", workflow_id: "ci.yml" }, fakeContext);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/ref/);
  });
});

// ---------------------------------------------------------------------------
// Error handling tests
// ---------------------------------------------------------------------------

describe("GitHub API error handling", () => {
  let originalFetch;
  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks(); });

  it("returns success:false with error message on API failure", async () => {
    const sdk = makeSdk();
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    const tools = buildRepoOpsTools(sdk);
    const tool = findTool(tools, "github_list_repos");
    const result = await tool.execute({ owner: "someone" }, fakeContext);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Failed/i);
    expect(result.error).toMatch(/Network error/);
  });

  it("redacts token patterns from error messages", async () => {
    const sdk = makeSdk();
    global.fetch = vi.fn().mockRejectedValue(
      new Error("Token ghp_abc123secretXYZ is invalid")
    );

    const tools = buildRepoOpsTools(sdk);
    const tool = findTool(tools, "github_list_repos");
    const result = await tool.execute({}, fakeContext);

    expect(result.success).toBe(false);
    // The raw token should be redacted by formatError
    expect(result.error).not.toContain("ghp_abc123secretXYZ");
    expect(result.error).toContain("[REDACTED]");
  });
});
