/**
 * Market data via the Polymarket Gamma API.
 *
 * Gamma returns several fields as JSON-encoded strings (outcomes,
 * outcomePrices, clobTokenIds). normalizeMarket() decodes them into a clean,
 * LLM-friendly shape and resolveMarket() maps an outcome name → token id for
 * order placement.
 */

import { request } from "./http.js";

function safeJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Decode a raw Gamma market into a clean object. */
export function normalizeMarket(raw) {
  const outcomes = safeJsonArray(raw.outcomes);
  const prices = safeJsonArray(raw.outcomePrices);
  const tokenIds = safeJsonArray(raw.clobTokenIds);

  return {
    slug: raw.slug,
    question: raw.question,
    conditionId: raw.conditionId,
    outcomes: outcomes.map((name, i) => ({
      name,
      price: prices[i] !== undefined ? Number(prices[i]) : null,
      tokenId: tokenIds[i] ?? null,
    })),
    volume: raw.volume !== undefined ? Number(raw.volume) : null,
    liquidity: raw.liquidity !== undefined ? Number(raw.liquidity) : null,
    endDate: raw.endDate ?? null,
    active: raw.active ?? null,
    closed: raw.closed ?? null,
  };
}

export class MarketsClient {
  /**
   * @param {object} opts
   * @param {string} opts.gammaBase
   * @param {number} [opts.timeoutMs]
   * @param {typeof fetch} [opts.fetchImpl]
   */
  constructor({ gammaBase, timeoutMs = 20_000, fetchImpl }) {
    this.gammaBase = gammaBase;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  /**
   * List markets.
   * @param {object} p
   * @param {number} [p.limit]
   * @param {boolean} [p.active]
   * @param {boolean} [p.closed]
   * @param {string} [p.tag]
   */
  async listMarkets({ limit = 20, active = true, closed = false, tag } = {}) {
    const bounded = Math.max(1, Math.min(100, Number(limit) || 20));
    const raw = await request({
      base: this.gammaBase,
      path: "/markets",
      query: {
        limit: bounded,
        active,
        closed,
        ...(tag ? { tag_slug: tag } : {}),
        order: "volume",
        ascending: false,
      },
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl,
    });
    const list = Array.isArray(raw) ? raw : raw?.data ?? [];
    return list.map(normalizeMarket);
  }

  /**
   * Get a single market by slug.
   * @param {string} slug
   * @returns {Promise<object|null>}
   */
  async getMarket(slug) {
    const raw = await request({
      base: this.gammaBase,
      path: "/markets",
      query: { slug },
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl,
    });
    const list = Array.isArray(raw) ? raw : raw?.data ?? [];
    return list.length ? normalizeMarket(list[0]) : null;
  }

  /**
   * Resolve a market + outcome to a CLOB token id.
   * @param {string} slug
   * @param {string} outcome e.g. "Yes" / "No"
   * @returns {Promise<{ conditionId: string, tokenId: string, outcome: string }>}
   */
  async resolveToken(slug, outcome) {
    const market = await this.getMarket(slug);
    if (!market) throw new Error(`Market not found for slug "${slug}"`);

    const wanted = String(outcome).trim().toLowerCase();
    const match = market.outcomes.find((o) => String(o.name).toLowerCase() === wanted);
    if (!match || !match.tokenId) {
      const available = market.outcomes.map((o) => o.name).join(", ");
      throw new Error(`Outcome "${outcome}" not found. Available: ${available || "none"}`);
    }
    return { conditionId: market.conditionId, tokenId: match.tokenId, outcome: match.name };
  }
}
