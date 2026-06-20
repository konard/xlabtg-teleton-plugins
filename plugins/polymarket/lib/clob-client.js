/**
 * Polymarket CLOB v2 client.
 *
 * Public endpoints (orderbook, price) need no auth. Order placement signs the
 * order with the EVM key (EIP-712, L1) and authenticates the request with the
 * API-key HMAC headers (L2). Positions come from the Polymarket data API.
 *
 * Amount model (both USDC collateral and outcome shares use 6 decimals):
 *   BUY  size s @ price p  ->  makerAmount = p*s USDC, takerAmount = s shares
 *   SELL size s @ price p  ->  makerAmount = s shares, takerAmount = p*s USDC
 */

import { randomBytes } from "node:crypto";

import { request } from "./http.js";
import { bytesToBigint } from "./crypto/hex.js";

const DECIMALS = 6;
const SCALE = 10 ** DECIMALS;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const SIDE_CODE = { BUY: 0, SELL: 1 };

function toUnits(value) {
  return Math.round(Number(value) * SCALE).toString();
}

function randomSalt() {
  return bytesToBigint(new Uint8Array(randomBytes(12))).toString();
}

export class ClobClient {
  /**
   * @param {object} opts
   * @param {string} opts.clobBase
   * @param {string} opts.dataBase
   * @param {import('./evm-wallet.js').EvmWallet} [opts.wallet]
   * @param {number} opts.chainId
   * @param {string} opts.exchangeAddress
   * @param {number} [opts.timeoutMs]
   * @param {typeof fetch} [opts.fetchImpl]
   */
  constructor({ clobBase, dataBase, wallet, chainId, exchangeAddress, timeoutMs = 20_000, fetchImpl }) {
    this.clobBase = clobBase;
    this.dataBase = dataBase;
    this.wallet = wallet;
    this.chainId = chainId;
    this.exchangeAddress = exchangeAddress;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  /** Public orderbook for an outcome token. */
  getOrderbook(tokenId) {
    return request({
      base: this.clobBase,
      path: "/book",
      query: { token_id: tokenId },
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl,
    });
  }

  /** Best price for a side ("buy" / "sell"). */
  getPrice(tokenId, side = "buy") {
    return request({
      base: this.clobBase,
      path: "/price",
      query: { token_id: tokenId, side },
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl,
    });
  }

  /** Positions for an address (Polymarket data API). */
  getPositions(address) {
    return request({
      base: this.dataBase,
      path: "/positions",
      query: { user: address, sizeThreshold: 0.1 },
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl,
    });
  }

  /**
   * Build and sign an order struct (no network call) — separated so it can be
   * unit-tested deterministically.
   * @returns {{ signed: object, side: string }}
   */
  buildSignedOrder({ tokenId, side, price, size, feeRateBps = 0, expiration = 0 }) {
    if (!this.wallet) throw new Error("EVM wallet not configured (set evm_private_key)");
    const sideUpper = String(side).toUpperCase();
    const sideCode = SIDE_CODE[sideUpper];
    if (sideCode === undefined) throw new Error(`Invalid side "${side}" (expected BUY or SELL)`);

    const usdc = toUnits(Number(price) * Number(size));
    const shares = toUnits(size);
    const makerAmount = sideUpper === "BUY" ? usdc : shares;
    const takerAmount = sideUpper === "BUY" ? shares : usdc;

    const order = {
      salt: randomSalt(),
      maker: this.wallet.address,
      signer: this.wallet.address,
      taker: ZERO_ADDRESS,
      tokenId: String(tokenId),
      makerAmount,
      takerAmount,
      expiration: String(expiration),
      nonce: "0",
      feeRateBps: String(feeRateBps),
      side: sideCode,
      signatureType: 0,
    };

    const signature = this.wallet.signOrder(order, {
      chainId: this.chainId,
      verifyingContract: this.exchangeAddress,
    });

    return {
      signed: { ...order, side: sideUpper, signature },
      side: sideUpper,
    };
  }

  /**
   * Place an order on the CLOB.
   * @param {object} p
   * @param {object} p.creds { apiKey, secret, passphrase }
   */
  async placeOrder({ tokenId, side, price, size, orderType = "GTC", feeRateBps = 0, creds }) {
    const { signed } = this.buildSignedOrder({ tokenId, side, price, size, feeRateBps });
    const body = JSON.stringify({ order: signed, owner: creds.apiKey, orderType });
    const headers = this.wallet.buildL2Headers({
      apiKey: creds.apiKey,
      secret: creds.secret,
      passphrase: creds.passphrase,
      method: "POST",
      path: "/order",
      body,
    });
    return request({
      base: this.clobBase,
      path: "/order",
      method: "POST",
      body, // already serialised
      headers: { ...headers, "Content-Type": "application/json" },
      timeoutMs: this.timeoutMs,
      retry: 0,
      fetchImpl: this.fetchImpl,
    });
  }

  /**
   * Cancel an order by id.
   * @param {object} p
   * @param {string} p.orderId
   * @param {object} p.creds
   */
  async cancelOrder({ orderId, creds }) {
    const body = JSON.stringify({ orderID: orderId });
    const headers = this.wallet.buildL2Headers({
      apiKey: creds.apiKey,
      secret: creds.secret,
      passphrase: creds.passphrase,
      method: "DELETE",
      path: "/order",
      body,
    });
    return request({
      base: this.clobBase,
      path: "/order",
      method: "DELETE",
      body,
      headers: { ...headers, "Content-Type": "application/json" },
      timeoutMs: this.timeoutMs,
      retry: 0,
      fetchImpl: this.fetchImpl,
    });
  }
}
