/**
 * ChangeNOW API v2 client — the cross-chain swap orchestrator for the
 * TON ↔ USDC (Polygon) bridge.
 *
 * Only the endpoints the plugin uses are wrapped:
 *   - estimated-amount  (quote)
 *   - min-amount        (minimum swap guard)
 *   - exchange (POST)   (create a swap; never retried — avoids double swaps)
 *   - by-id             (poll status)
 */

import { CHANGENOW_BASE } from "./config.js";
import { request } from "./http.js";

export class ChangeNowBridge {
  /**
   * @param {object} opts
   * @param {string} opts.apiKey
   * @param {string} [opts.base]
   * @param {number} [opts.timeoutMs]
   * @param {typeof fetch} [opts.fetchImpl]
   */
  constructor({ apiKey, base = CHANGENOW_BASE, timeoutMs = 20_000, fetchImpl } = {}) {
    this.apiKey = apiKey;
    this.base = base;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  get headers() {
    return this.apiKey ? { "x-changenow-api-key": this.apiKey } : {};
  }

  /**
   * Estimate output amount for a swap.
   * @param {object} p
   * @returns {Promise<object>}
   */
  estimate({ fromCurrency, toCurrency, fromNetwork, toNetwork, fromAmount, flow = "standard" }) {
    return request({
      base: this.base,
      path: "/exchange/estimated-amount",
      query: {
        fromCurrency,
        toCurrency,
        fromNetwork,
        toNetwork,
        fromAmount,
        flow,
      },
      headers: this.headers,
      timeoutMs: this.timeoutMs,
      retry: 2,
      fetchImpl: this.fetchImpl,
    });
  }

  /**
   * Minimum swappable amount for a pair.
   * @param {object} p
   */
  minAmount({ fromCurrency, toCurrency, fromNetwork, toNetwork, flow = "standard" }) {
    return request({
      base: this.base,
      path: "/exchange/min-amount",
      query: { fromCurrency, toCurrency, fromNetwork, toNetwork, flow },
      headers: this.headers,
      timeoutMs: this.timeoutMs,
      retry: 2,
      fetchImpl: this.fetchImpl,
    });
  }

  /**
   * Create a swap. POST is never retried to avoid duplicate exchanges.
   * @param {object} p
   * @returns {Promise<object>} includes id, payinAddress, payoutAddress, ...
   */
  createExchange({
    fromCurrency,
    toCurrency,
    fromNetwork,
    toNetwork,
    fromAmount,
    address,
    flow = "standard",
    refundAddress,
  }) {
    return request({
      base: this.base,
      path: "/exchange",
      method: "POST",
      body: {
        fromCurrency,
        toCurrency,
        fromNetwork,
        toNetwork,
        fromAmount,
        address,
        flow,
        ...(refundAddress ? { refundAddress } : {}),
      },
      headers: this.headers,
      timeoutMs: this.timeoutMs,
      retry: 0,
      fetchImpl: this.fetchImpl,
    });
  }

  /**
   * Poll a swap status by id.
   * @param {string} id
   */
  getStatus(id) {
    return request({
      base: this.base,
      path: "/exchange/by-id",
      query: { id },
      headers: this.headers,
      timeoutMs: this.timeoutMs,
      retry: 2,
      fetchImpl: this.fetchImpl,
    });
  }
}
