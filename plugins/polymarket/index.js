/**
 * polymarket — trade Polymarket prediction markets from a TON wallet.
 *
 * Bridges TON ↔ USDC (Polygon) via ChangeNOW and trades on the Polymarket
 * CLOB using a dedicated EVM key. Exposes 10 LLM tools. All signing crypto
 * (Keccak-256, secp256k1, EIP-712, RLP) is implemented in pure JS under
 * lib/crypto so the plugin needs zero external dependencies.
 */

import { DEFAULT_CONFIG } from "./lib/config.js";
import { MIGRATION_SQL } from "./lib/state.js";
import { Runtime } from "./lib/runtime.js";
import { buildTools } from "./lib/tools.js";

export const manifest = {
  id: "polymarket",
  name: "polymarket",
  version: "1.0.0",
  description:
    "Trade Polymarket prediction markets from your TON wallet: list/inspect markets, place/cancel orders, manage positions and balance, and bridge TON ↔ USDC (Polygon) via ChangeNOW.",
  author: "Teleton Community",
  sdkVersion: ">=1.0.0",
  secrets: {
    EVM_PRIVATE_KEY: {
      required: true,
      description: "Dedicated Polygon EVM private key (0x + 64 hex) used to sign Polymarket orders and USDC transfers.",
    },
    POLY_API_KEY: { required: true, description: "Polymarket CLOB API key." },
    POLY_API_SECRET: { required: true, description: "Polymarket CLOB API secret (base64url HMAC key)." },
    POLY_API_PASSPHRASE: { required: true, description: "Polymarket CLOB API passphrase." },
    CHANGENOW_API_KEY: { required: true, description: "ChangeNOW API key for the TON ↔ USDC bridge." },
  },
  defaultConfig: { ...DEFAULT_CONFIG },
};

let activeRuntime = null;

export function migrate(db) {
  db.exec(MIGRATION_SQL);
}

export const tools = (sdk) => buildTools(getRuntime(sdk));

export function stop() {
  activeRuntime = null;
}

function getRuntime(sdk) {
  if (activeRuntime && activeRuntime.sdk === sdk) return activeRuntime;
  activeRuntime = new Runtime(sdk);
  return activeRuntime;
}
