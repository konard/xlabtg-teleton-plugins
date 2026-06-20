/**
 * Shared helpers: error sanitisation, sleep, numeric coercion.
 *
 * Security note: every error string that can reach the LLM / logs passes
 * through sanitizeError(), which strips anything that looks like a secret
 * (hex private keys, bearer tokens, api-key headers) and truncates to a
 * bounded length.
 */

const MAX_ERROR_LEN = 500;

// Patterns that could leak secrets into error messages.
const SECRET_PATTERNS = [
  /0x[a-fA-F0-9]{64}/g, // 32-byte hex (private keys)
  /\b[A-Za-z0-9_-]{40,}\b/g, // long opaque tokens / api keys
  /(bearer|token|api[_-]?key|secret|passphrase)\s*[:=]\s*\S+/gi,
];

/**
 * Reduce any thrown value to a short, secret-free string.
 * @param {unknown} err
 * @returns {string}
 */
export function sanitizeError(err) {
  let msg = "";
  if (err instanceof Error) msg = err.message || String(err);
  else if (typeof err === "string") msg = err;
  else {
    try {
      msg = JSON.stringify(err);
    } catch {
      msg = String(err);
    }
  }

  for (const pattern of SECRET_PATTERNS) {
    msg = msg.replace(pattern, "[redacted]");
  }

  if (msg.length > MAX_ERROR_LEN) msg = msg.slice(0, MAX_ERROR_LEN) + "…";
  return msg.trim() || "Unknown error";
}

/** @param {number} ms */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Coerce to a finite number or return fallback. */
export function toNumber(value, fallback = undefined) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Wrap a thrown error into the plugin tool failure contract. */
export function fail(err) {
  return { success: false, error: sanitizeError(err) };
}

/** Wrap a value into the plugin tool success contract. */
export function ok(data) {
  return { success: true, data };
}
