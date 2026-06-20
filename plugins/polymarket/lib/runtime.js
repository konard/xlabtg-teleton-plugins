/**
 * Runtime wiring: lazily constructs the API clients and the EVM wallet from
 * the host SDK. Secrets are read on demand (never at plugin init) so the
 * validator's mock SDK — which has no real secrets — can still load the plugin.
 */

import { resolveConfig } from "./config.js";
import { MarketsClient } from "./markets.js";
import { ClobClient } from "./clob-client.js";
import { ChangeNowBridge } from "./bridge.js";
import { EvmRpc } from "./evm-rpc.js";
import { EvmWallet } from "./evm-wallet.js";
import { Store } from "./state.js";

/** Read a secret, tolerating both the new (require) and old (get) SDK shapes. */
export async function getSecret(sdk, name, { required = false } = {}) {
  const secrets = sdk?.secrets;
  let value = null;
  if (required && typeof secrets?.require === "function") {
    value = await secrets.require(name);
  } else if (typeof secrets?.get === "function") {
    value = (await secrets.get(name)) ?? (await secrets.get(name.toLowerCase()));
  }
  if (required && !value) {
    throw new Error(`${name} is required. Add it to Teleton secrets.`);
  }
  return value || null;
}

export class Runtime {
  constructor(sdk) {
    this.sdk = sdk ?? {};
    this.config = resolveConfig(this.sdk.pluginConfig);
    this.endpoints = this.config.endpoints;
    this.store = new Store(this.sdk.db ?? null);

    // Public clients need no secrets.
    this.markets = new MarketsClient({ gammaBase: this.endpoints.gammaBase });
    this.rpc = new EvmRpc({
      rpcUrl: this.endpoints.polygonRpc,
      usdcAddress: this.endpoints.usdcAddress,
      chainId: this.endpoints.chainId,
    });

    this._wallet = undefined;
    this._creds = undefined;
    this._bridge = undefined;
    this._clob = undefined;
    this._clobPublic = undefined;
  }

  /** Public CLOB client (orderbook / price / positions) — no wallet needed. */
  clobPublic() {
    if (this._clobPublic === undefined) {
      this._clobPublic = new ClobClient({
        clobBase: this.endpoints.clobBase,
        dataBase: this.endpoints.dataBase,
        chainId: this.endpoints.chainId,
        exchangeAddress: this.endpoints.exchangeAddress,
      });
    }
    return this._clobPublic;
  }

  /** EVM wallet from the EVM_PRIVATE_KEY secret (cached). */
  async wallet() {
    if (this._wallet === undefined) {
      const pk = await getSecret(this.sdk, "EVM_PRIVATE_KEY", { required: true });
      this._wallet = new EvmWallet({ privateKey: pk });
    }
    return this._wallet;
  }

  /** CLOB L2 credentials from secrets (cached). */
  async creds() {
    if (this._creds === undefined) {
      this._creds = {
        apiKey: await getSecret(this.sdk, "POLY_API_KEY", { required: true }),
        secret: await getSecret(this.sdk, "POLY_API_SECRET", { required: true }),
        passphrase: await getSecret(this.sdk, "POLY_API_PASSPHRASE", { required: true }),
      };
    }
    return this._creds;
  }

  /** ChangeNOW bridge client (cached). */
  async bridge() {
    if (this._bridge === undefined) {
      const apiKey = await getSecret(this.sdk, "CHANGENOW_API_KEY", { required: true });
      this._bridge = new ChangeNowBridge({ apiKey });
    }
    return this._bridge;
  }

  /** CLOB client bound to the EVM wallet (cached). */
  async clob() {
    if (this._clob === undefined) {
      const wallet = await this.wallet();
      this._clob = new ClobClient({
        clobBase: this.endpoints.clobBase,
        dataBase: this.endpoints.dataBase,
        wallet,
        chainId: this.endpoints.chainId,
        exchangeAddress: this.endpoints.exchangeAddress,
      });
    }
    return this._clob;
  }
}
