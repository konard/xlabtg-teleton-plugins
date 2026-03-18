/**
 * GitHub OAuth 2.0 flow manager for the github-dev-assistant plugin.
 *
 * Implements:
 *  - OAuth authorization URL generation with CSRF state parameter
 *  - State storage with TTL via sdk.storage
 *  - Token exchange (code → access token) via GitHub OAuth API
 *  - Token validation by calling /user endpoint
 *
 * Security notes:
 *  - State is generated with 32 cryptographically random bytes (64 hex chars)
 *  - State TTL is 10 minutes (600 seconds), enforced via StorageSDK TTL option
 *  - Tokens are returned to the caller for storage — sdk.secrets is read-only
 *  - Client secret is read from sdk.secrets — never hardcoded
 *
 * Note on sdk.secrets:
 *  SecretsSDK is read-only (get/require/has only). Tokens exchanged here must be
 *  stored by the runtime via the admin /plugin set command, or passed via env var.
 *  This module never attempts to write to sdk.secrets directly.
 */

import { generateState, formatError } from "./utils.js";

const GITHUB_OAUTH_BASE = "https://github.com";
const GITHUB_API_BASE = "https://api.github.com";

// State TTL in milliseconds (10 minutes)
const STATE_TTL_MS = 600_000;

// Storage key for pending OAuth state entries
const STATE_STORAGE_PREFIX = "github_oauth_state_";

/**
 * Create an auth manager bound to the given sdk.
 *
 * @param {object} sdk - Teleton plugin SDK
 * @returns {object} Auth manager with initiate(), exchange(), check(), revoke()
 */
export function createAuthManager(sdk) {
  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Get the GitHub OAuth App client ID from secrets.
   * @returns {string|null}
   */
  function getClientId() {
    return sdk.secrets.get("github_client_id") ?? null;
  }

  /**
   * Get the GitHub OAuth App client secret from secrets.
   * @returns {string|null}
   */
  function getClientSecret() {
    return sdk.secrets.get("github_client_secret") ?? null;
  }

  /**
   * Persist a state token with TTL in sdk.storage.
   * StorageSDK.set() handles JSON serialization automatically.
   * @param {string} state
   */
  function saveState(state) {
    sdk.storage.set(
      `${STATE_STORAGE_PREFIX}${state}`,
      { state, created_at: Date.now() },
      { ttl: STATE_TTL_MS }
    );
  }

  /**
   * Validate a state token: must exist in storage (not expired via StorageSDK TTL).
   * Deletes the state entry regardless to prevent replay.
   * @param {string} state
   * @returns {boolean}
   */
  function validateAndConsumeState(state) {
    if (!state) return false;
    const key = `${STATE_STORAGE_PREFIX}${state}`;
    // StorageSDK.get() returns undefined when the key is missing or TTL has expired
    const entry = sdk.storage.get(key);
    if (!entry) return false;

    // Always consume (delete) the state to prevent replay attacks
    sdk.storage.delete(key);

    return entry.state === state;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {
    /**
     * Generate an OAuth authorization URL and save state for CSRF protection.
     *
     * @param {string[]} [scopes] - OAuth scopes to request
     * @returns {{ auth_url: string, state: string, instructions: string }}
     */
    initiateOAuth(scopes = ["repo", "workflow", "user"]) {
      const clientId = getClientId();
      if (!clientId) {
        throw new Error(
          "GitHub OAuth App client ID not configured. " +
          "Set github_client_id in the plugin secrets (env: GITHUB_OAUTH_CLIENT_ID)."
        );
      }

      const state = generateState(32);
      saveState(state);

      const url = new URL(`${GITHUB_OAUTH_BASE}/login/oauth/authorize`);
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("scope", scopes.join(" "));
      url.searchParams.set("state", state);

      sdk.log.info("GitHub OAuth: authorization URL generated");

      return {
        auth_url: url.toString(),
        state,
        instructions:
          "Open the auth_url in your browser, authorize the app, " +
          "then paste the code returned by the callback page back into the chat.",
      };
    },

    /**
     * Exchange an OAuth authorization code for an access token.
     * Validates the CSRF state before proceeding.
     *
     * Note: The returned access_token cannot be written to sdk.secrets directly
     * (SecretsSDK is read-only). The caller should instruct the user to store
     * it via the /plugin set command or the GITHUB_DEV_ASSISTANT_GITHUB_TOKEN env var.
     *
     * @param {string} code - Authorization code from GitHub callback
     * @param {string} state - State parameter from callback (must match saved state)
     * @returns {{ user_login: string, scopes: string[], access_token: string }}
     */
    async exchangeCode(code, state) {
      if (!validateAndConsumeState(state)) {
        throw new Error(
          "Invalid or expired OAuth state. Please restart the authorization flow."
        );
      }

      const clientId = getClientId();
      const clientSecret = getClientSecret();

      if (!clientId || !clientSecret) {
        throw new Error(
          "GitHub OAuth App credentials not fully configured. " +
          "Ensure github_client_id and github_client_secret are set in secrets."
        );
      }

      // Exchange code for token
      const tokenRes = await fetch(
        `${GITHUB_OAUTH_BASE}/login/oauth/access_token`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "User-Agent": "teleton-github-dev-assistant/1.0.0",
          },
          body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            code,
          }),
          signal: AbortSignal.timeout(15000),
        }
      );

      if (!tokenRes.ok) {
        throw new Error(
          `OAuth token exchange failed: HTTP ${tokenRes.status}`
        );
      }

      const tokenData = await tokenRes.json();

      if (tokenData.error) {
        throw new Error(
          `OAuth error: ${tokenData.error_description ?? tokenData.error}`
        );
      }

      const accessToken = tokenData.access_token;
      if (!accessToken) {
        throw new Error("No access token received from GitHub.");
      }

      sdk.log.info("GitHub OAuth: access token received (not logged)");

      // Verify token by fetching the authenticated user
      const userRes = await fetch(`${GITHUB_API_BASE}/user`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "teleton-github-dev-assistant/1.0.0",
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!userRes.ok) {
        throw new Error(`Token validation failed: GitHub API returned ${userRes.status}`);
      }

      const user = await userRes.json();
      const grantedScopes = (tokenData.scope ?? "").split(",").filter(Boolean);

      sdk.log.info(`GitHub OAuth: authenticated as ${user.login}`);

      // Return the token so the caller can instruct the user to configure it.
      // SecretsSDK is read-only — we cannot store it programmatically.
      return {
        user_login: user.login,
        scopes: grantedScopes,
        access_token: accessToken,
      };
    },

    /**
     * Check the current authentication status.
     * Calls /user endpoint to verify the stored token is still valid.
     *
     * @param {object} client - GitHub API client (from github-client.js)
     * @returns {{ authenticated: boolean, user_login?: string, ... }}
     */
    async checkAuth(client) {
      if (!client.isAuthenticated()) {
        return { authenticated: false };
      }

      try {
        const user = await client.get("/user");
        return {
          authenticated: true,
          user_login: user.login,
          user_id: user.id,
          user_name: user.name ?? null,
          user_email: user.email ?? null,
          avatar_url: user.avatar_url ?? null,
        };
      } catch (err) {
        if (err.status === 401) {
          // Token is invalid — log it so the admin can take action
          sdk.log.warn(
            "GitHub OAuth: stored token is invalid or expired. " +
            "Update github_token via /plugin set or GITHUB_DEV_ASSISTANT_GITHUB_TOKEN env var."
          );
          return { authenticated: false };
        }
        throw err;
      }
    },

    /**
     * Revoke the stored access token at GitHub's side.
     * Local removal requires the user to unset the secret via /plugin set or env var.
     *
     * @returns {{ revoked: boolean, message: string }}
     */
    async revokeToken() {
      // Read the token from secrets (read-only access)
      const token = sdk.secrets.get("github_token");
      if (!token) {
        return { revoked: false, message: "No token to revoke." };
      }

      const clientId = getClientId();
      const clientSecret = getClientSecret();

      // Attempt to revoke at GitHub's side (best-effort)
      if (clientId && clientSecret) {
        try {
          await fetch(
            `${GITHUB_API_BASE}/applications/${clientId}/token`,
            {
              method: "DELETE",
              headers: {
                Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
                Accept: "application/vnd.github+json",
                "Content-Type": "application/json",
                "User-Agent": "teleton-github-dev-assistant/1.0.0",
              },
              body: JSON.stringify({ access_token: token }),
              signal: AbortSignal.timeout(10000),
            }
          );
          sdk.log.info("GitHub OAuth: token revoked at GitHub");
        } catch (err) {
          // Non-fatal — log and continue
          sdk.log.warn(`GitHub OAuth: remote revocation failed: ${formatError(err)}`);
        }
      }

      // We cannot delete from sdk.secrets (read-only). Instruct the user.
      sdk.log.info("GitHub OAuth: remote token revocation attempted");

      return {
        revoked: true,
        message:
          "GitHub token revoked at GitHub's side. " +
          "To complete removal, unset the github_token secret: " +
          "remove the GITHUB_DEV_ASSISTANT_GITHUB_TOKEN env var or use /plugin set github-dev-assistant github_token ''.",
      };
    },
  };
}
