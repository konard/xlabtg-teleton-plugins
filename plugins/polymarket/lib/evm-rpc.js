/**
 * Polygon JSON-RPC client — the small surface the plugin needs:
 *   - read USDC.e balance (eth_call balanceOf)
 *   - fetch nonce / fee data
 *   - broadcast a signed ERC-20 transfer (withdraw flow)
 *
 * ERC-20 amounts use 6 decimals (USDC.e on Polygon).
 */

import { keccak256 } from "./crypto/keccak.js";
import { bytesToHex, utf8ToBytes } from "./crypto/hex.js";
import { request } from "./http.js";

export const USDC_DECIMALS = 6;

function selector(signature) {
  return bytesToHex(keccak256(utf8ToBytes(signature)).slice(0, 4));
}

const BALANCE_OF = selector("balanceOf(address)");
const TRANSFER = selector("transfer(address,uint256)");

function padAddress(address) {
  return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

function padUint(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

/** Convert a USDC human amount to base units (6 decimals). */
export function usdcToBaseUnits(amount) {
  const [whole, frac = ""] = String(amount).split(".");
  const fracPadded = (frac + "0".repeat(USDC_DECIMALS)).slice(0, USDC_DECIMALS);
  return BigInt(whole || "0") * 10n ** BigInt(USDC_DECIMALS) + BigInt(fracPadded || "0");
}

/** Convert base units (6 decimals) to a human USDC number. */
export function baseUnitsToUsdc(units) {
  return Number(BigInt(units)) / 10 ** USDC_DECIMALS;
}

export class EvmRpc {
  /**
   * @param {object} opts
   * @param {string} opts.rpcUrl
   * @param {string} opts.usdcAddress
   * @param {number} opts.chainId
   * @param {number} [opts.timeoutMs]
   * @param {typeof fetch} [opts.fetchImpl]
   */
  constructor({ rpcUrl, usdcAddress, chainId, timeoutMs = 20_000, fetchImpl }) {
    this.rpcUrl = rpcUrl;
    this.usdcAddress = usdcAddress;
    this.chainId = chainId;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this._id = 0;
  }

  async call(method, params = []) {
    this._id += 1;
    const body = { jsonrpc: "2.0", id: this._id, method, params };
    const res = await request({
      path: this.rpcUrl,
      method: "POST",
      body,
      timeoutMs: this.timeoutMs,
      retry: 1,
      fetchImpl: this.fetchImpl,
    });
    if (res && res.error) {
      throw new Error(`RPC ${method} failed: ${res.error.message ?? JSON.stringify(res.error)}`);
    }
    return res?.result;
  }

  /** USDC.e balance in base units for an address. */
  async getUsdcBalance(address) {
    const data = `${BALANCE_OF}${padAddress(address)}`;
    const result = await this.call("eth_call", [
      { to: this.usdcAddress, data },
      "latest",
    ]);
    return BigInt(result ?? "0x0");
  }

  async getTransactionCount(address) {
    const result = await this.call("eth_getTransactionCount", [address, "pending"]);
    return BigInt(result ?? "0x0");
  }

  async getGasPrice() {
    const result = await this.call("eth_gasPrice", []);
    return BigInt(result ?? "0x0");
  }

  async sendRawTransaction(rawTx) {
    return this.call("eth_sendRawTransaction", [rawTx]);
  }

  /**
   * Build the ERC-20 transfer call data for USDC.
   * @param {string} to recipient address
   * @param {bigint} amountUnits base units
   */
  buildTransferData(to, amountUnits) {
    return `0x${TRANSFER.replace(/^0x/, "")}${padAddress(to)}${padUint(amountUnits)}`;
  }
}
