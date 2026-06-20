/**
 * Configuration resolution and network endpoint maps.
 *
 * defaultConfig values (limits, slippage, confirmation threshold) come from
 * the manifest and can be overridden per-install via sdk.pluginConfig.
 */

export const DEFAULT_CONFIG = {
  network: "mainnet",
  max_swap_ton: 100,
  max_order_usdc: 500,
  require_confirmation_above_usdc: 50,
  default_slippage_bps: 100,
  changenow_from_network: "ton",
  changenow_to_network: "matic", // Polygon network code on ChangeNOW
};

// Per-network endpoints and on-chain constants.
const NETWORKS = {
  mainnet: {
    clobBase: "https://clob.polymarket.com",
    gammaBase: "https://gamma-api.polymarket.com",
    dataBase: "https://data-api.polymarket.com",
    polygonRpc: "https://polygon-rpc.com",
    chainId: 137,
    // USDC.e collateral on Polygon.
    usdcAddress: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
    // Polymarket CTF Exchange (EIP-712 verifyingContract).
    exchangeAddress: "0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e",
  },
  testnet: {
    // Polymarket CLOB v2 testnet runs on Polygon Amoy.
    clobBase: "https://clob-v2.polymarket.com",
    gammaBase: "https://gamma-api.polymarket.com",
    dataBase: "https://data-api.polymarket.com",
    polygonRpc: "https://rpc-amoy.polygon.technology",
    chainId: 80002,
    usdcAddress: "0x9999f7fea5938fd3b1e26a12c3f2fb024e194f97",
    exchangeAddress: "0xdfe02eb6733538f8ea35d585af8de5958ad99e40",
  },
};

export const CHANGENOW_BASE = "https://api.changenow.io/v2";

/**
 * Merge manifest defaults with the install-time pluginConfig and attach the
 * resolved network endpoints.
 * @param {object} pluginConfig
 */
export function resolveConfig(pluginConfig = {}) {
  const config = { ...DEFAULT_CONFIG, ...(pluginConfig ?? {}) };
  const networkKey = config.network === "testnet" ? "testnet" : "mainnet";
  const endpoints = NETWORKS[networkKey];
  return { ...config, network: networkKey, endpoints };
}
