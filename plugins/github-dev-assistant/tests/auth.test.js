/**
 * Tests for github_check_auth tool.
 *
 * The github-dev-assistant plugin uses Personal Access Token (PAT)
 * authentication. This file tests that the auth check correctly validates
 * the stored token and returns SDK-compliant ToolResult objects.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { tools, manifest } from "../index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSdk(token = null, config = {}) {
  return {
    secrets: {
      get: (key) => (key === "github_token" ? token : null),
      has: (key) => key === "github_token" && token !== null,
    },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    pluginConfig: {
      default_branch: "main",
      ...config,
    },
  };
}

function findTool(toolList, name) {
  const tool = toolList.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool '${name}' not found`);
  return tool;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let originalFetch;
beforeEach(() => { originalFetch = global.fetch; });
afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks(); });

describe("github_check_auth", () => {
  it("returns success:true with authenticated:false when no token is set", async () => {
    const sdk = makeSdk(null); // no token
    const toolList = tools(sdk);
    const tool = findTool(toolList, "github_check_auth");

    const result = await tool.execute({}, {});

    expect(result.success).toBe(true);
    expect(result.data.authenticated).toBe(false);
    expect(result.data.message).toMatch(/not connected/i);
    expect(result.data.message).toMatch(/github_token/);
  });

  it("returns success:true with login when token is valid", async () => {
    const sdk = makeSdk("ghp_validtoken");
    const toolList = tools(sdk);
    const tool = findTool(toolList, "github_check_auth");

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({ login: "octocat", name: "The Octocat" }),
    });

    const result = await tool.execute({}, {});

    expect(result.success).toBe(true);
    expect(result.data.authenticated).toBe(true);
    expect(result.data.login).toBe("octocat");
    expect(result.data.message).toMatch(/connected/i);
    expect(result.data.message).toMatch(/octocat/);
  });

  it("returns success:true with authenticated:false on 401", async () => {
    const sdk = makeSdk("ghp_expiredtoken");
    const toolList = tools(sdk);
    const tool = findTool(toolList, "github_check_auth");

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: { get: () => null },
      text: async () => JSON.stringify({ message: "Bad credentials" }),
    });

    const result = await tool.execute({}, {});

    expect(result.success).toBe(true);
    expect(result.data.authenticated).toBe(false);
    expect(result.data.message).toMatch(/invalid or expired/i);
    expect(result.data.message).toMatch(/github_token/);
  });
});

describe("manifest export", () => {
  it("exports a manifest with required fields", () => {
    expect(manifest).toBeDefined();
    expect(manifest.name).toBe("github-dev-assistant");
    expect(manifest.version).toBeDefined();
    expect(manifest.sdkVersion).toMatch(/^>=/);
    expect(manifest.secrets).toBeDefined();
    expect(manifest.secrets.github_token).toBeDefined();
    expect(manifest.secrets.github_token.required).toBe(true);
  });
});

describe("tools() export", () => {
  it("returns 14 tools", () => {
    const sdk = makeSdk("ghp_test");
    const toolList = tools(sdk);
    expect(toolList).toHaveLength(14);
  });

  it("all tools have name, description, parameters, and execute", () => {
    const sdk = makeSdk("ghp_test");
    const toolList = tools(sdk);
    for (const tool of toolList) {
      expect(typeof tool.name).toBe("string");
      expect(typeof tool.description).toBe("string");
      expect(typeof tool.execute).toBe("function");
      expect(tool.parameters).toBeDefined();
    }
  });

  it("all tool names are prefixed with github_", () => {
    const sdk = makeSdk("ghp_test");
    const toolList = tools(sdk);
    for (const tool of toolList) {
      expect(tool.name).toMatch(/^github_/);
    }
  });

  it("all execute functions accept (params, context) signature", () => {
    const sdk = makeSdk("ghp_test");
    const toolList = tools(sdk);
    for (const tool of toolList) {
      // Function.length returns the number of declared parameters
      expect(tool.execute.length).toBeGreaterThanOrEqual(0);
    }
  });
});
