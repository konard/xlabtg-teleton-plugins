/**
 * Thin fetch wrapper with timeout, JSON handling and retry/backoff.
 *
 * Retries are limited to idempotent failures (network errors and the
 * retryable 5xx / 429 statuses) with exponential backoff. POSTs that create
 * swaps / orders pass `{ retry: 0 }` so we never double-submit.
 */

import { sleep } from "./util.js";

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export class HttpError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

function buildUrl(base, path, query) {
  const url = new URL(path.startsWith("http") ? path : `${base}${path}`);
  if (query && typeof query === "object") {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function readBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * @param {object} opts
 * @param {string} [opts.base]
 * @param {string} opts.path
 * @param {string} [opts.method]
 * @param {object} [opts.query]
 * @param {object} [opts.headers]
 * @param {any} [opts.body] serialised as JSON when an object
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.retry] retry attempts (default 2 for GET, set 0 for writes)
 * @param {typeof fetch} [opts.fetchImpl]
 */
export async function request({
  base = "",
  path,
  method = "GET",
  query,
  headers = {},
  body,
  timeoutMs = 20_000,
  retry = method === "GET" ? 2 : 0,
  retryBaseMs = 300,
  fetchImpl = globalThis.fetch,
} = {}) {
  const url = buildUrl(base, path, query);
  const hasBody = body !== undefined && body !== null;
  const isJsonBody = hasBody && typeof body === "object";

  let attempt = 0;
  while (true) {
    try {
      const response = await fetchImpl(url, {
        method,
        headers: {
          Accept: "application/json",
          ...(isJsonBody ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        body: hasBody ? (isJsonBody ? JSON.stringify(body) : body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });

      const data = await readBody(response);
      if (response.ok) return data;

      if (RETRYABLE_STATUSES.has(response.status) && attempt < retry) {
        attempt += 1;
        await sleep(retryBaseMs * 2 ** (attempt - 1));
        continue;
      }

      const detail =
        data && typeof data === "object"
          ? data.message || data.error || JSON.stringify(data)
          : data;
      throw new HttpError(`HTTP ${response.status}${detail ? `: ${detail}` : ""}`, {
        status: response.status,
        body: data,
      });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      // Network / timeout error — retry if budget remains.
      if (attempt < retry) {
        attempt += 1;
        await sleep(retryBaseMs * 2 ** (attempt - 1));
        continue;
      }
      throw err;
    }
  }
}
