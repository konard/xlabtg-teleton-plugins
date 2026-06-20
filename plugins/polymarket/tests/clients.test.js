import test from "node:test";
import assert from "node:assert/strict";

import { bigintToBytes, bytesToHex } from "../lib/crypto/hex.js";
import { EvmWallet } from "../lib/evm-wallet.js";
import { ClobClient } from "../lib/clob-client.js";
import { MarketsClient, normalizeMarket } from "../lib/markets.js";
import { ChangeNowBridge } from "../lib/bridge.js";
import { usdcToBaseUnits, baseUnitsToUsdc } from "../lib/evm-rpc.js";

function fakeFetch(handler) {
  return async (url, opts) => {
    const res = handler(url, opts);
    return {
      ok: res.ok ?? true,
      status: res.status ?? 200,
      text: async () => (typeof res.body === "string" ? res.body : JSON.stringify(res.body)),
    };
  };
}

const wallet = () => new EvmWallet({ privateKey: bytesToHex(bigintToBytes(7777n, 32)) });

// ── CLOB order amount math ─────────────────────────────────────────────────
test("buildSignedOrder computes BUY maker/taker amounts (6 decimals)", () => {
  const clob = new ClobClient({
    clobBase: "https://clob",
    dataBase: "https://data",
    wallet: wallet(),
    chainId: 137,
    exchangeAddress: "0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e",
  });
  const { signed, side } = clob.buildSignedOrder({ tokenId: "1", side: "buy", price: 0.4, size: 10 });
  assert.equal(side, "BUY");
  assert.equal(signed.makerAmount, "4000000"); // 0.4 * 10 USDC
  assert.equal(signed.takerAmount, "10000000"); // 10 shares
  assert.equal(signed.side, "BUY");
  assert.equal(signed.signature.length, 132);
});

test("buildSignedOrder inverts amounts for SELL", () => {
  const clob = new ClobClient({
    clobBase: "https://clob",
    dataBase: "https://data",
    wallet: wallet(),
    chainId: 137,
    exchangeAddress: "0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e",
  });
  const { signed } = clob.buildSignedOrder({ tokenId: "1", side: "SELL", price: 0.4, size: 10 });
  assert.equal(signed.makerAmount, "10000000"); // shares
  assert.equal(signed.takerAmount, "4000000"); // USDC
});

test("buildSignedOrder rejects bad side and missing wallet", () => {
  const clob = new ClobClient({ clobBase: "x", dataBase: "y", chainId: 137, exchangeAddress: "0x0" });
  assert.throws(() => clob.buildSignedOrder({ tokenId: "1", side: "BUY", price: 0.4, size: 1 }), /wallet/);
  const clob2 = new ClobClient({ clobBase: "x", dataBase: "y", wallet: wallet(), chainId: 137, exchangeAddress: "0x0" });
  assert.throws(() => clob2.buildSignedOrder({ tokenId: "1", side: "HOLD", price: 0.4, size: 1 }), /side/);
});

// ── Markets normalisation ──────────────────────────────────────────────────
test("normalizeMarket decodes JSON-encoded Gamma fields", () => {
  const market = normalizeMarket({
    slug: "test-market",
    question: "Will it?",
    conditionId: "0xcond",
    outcomes: '["Yes","No"]',
    outcomePrices: '["0.6","0.4"]',
    clobTokenIds: '["111","222"]',
    volume: "1000",
  });
  assert.equal(market.outcomes.length, 2);
  assert.deepEqual(market.outcomes[0], { name: "Yes", price: 0.6, tokenId: "111" });
  assert.equal(market.volume, 1000);
});

test("MarketsClient.resolveToken maps an outcome name to a token id", async () => {
  const fetchImpl = fakeFetch(() => ({
    body: [
      {
        slug: "test",
        conditionId: "0xc",
        outcomes: '["Yes","No"]',
        outcomePrices: '["0.5","0.5"]',
        clobTokenIds: '["aaa","bbb"]',
      },
    ],
  }));
  const client = new MarketsClient({ gammaBase: "https://gamma", fetchImpl });
  const resolved = await client.resolveToken("test", "no");
  assert.equal(resolved.tokenId, "bbb");
  assert.equal(resolved.outcome, "No");
});

test("MarketsClient.resolveToken throws on unknown outcome", async () => {
  const fetchImpl = fakeFetch(() => ({
    body: [{ slug: "test", conditionId: "0xc", outcomes: '["Yes","No"]', clobTokenIds: '["a","b"]' }],
  }));
  const client = new MarketsClient({ gammaBase: "https://gamma", fetchImpl });
  await assert.rejects(() => client.resolveToken("test", "Maybe"), /not found/);
});

// ── Bridge passes the API key header and never retries POST ────────────────
test("ChangeNowBridge.createExchange posts with api-key header", async () => {
  let seen = null;
  const fetchImpl = fakeFetch((url, opts) => {
    seen = { url, opts };
    return { body: { id: "swap1", payinAddress: "0xpayin" } };
  });
  const bridge = new ChangeNowBridge({ apiKey: "secret-key", fetchImpl });
  const res = await bridge.createExchange({
    fromCurrency: "ton",
    toCurrency: "usdc",
    fromNetwork: "ton",
    toNetwork: "matic",
    fromAmount: 10,
    address: "0xdest",
  });
  assert.equal(res.id, "swap1");
  assert.equal(seen.opts.method, "POST");
  assert.equal(seen.opts.headers["x-changenow-api-key"], "secret-key");
});

// ── USDC unit conversion ───────────────────────────────────────────────────
test("usdc unit helpers round-trip 6 decimals", () => {
  assert.equal(usdcToBaseUnits("1.5"), 1_500_000n);
  assert.equal(usdcToBaseUnits("0.000001"), 1n);
  assert.equal(baseUnitsToUsdc(2_500_000n), 2.5);
});
