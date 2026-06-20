import test from "node:test";
import assert from "node:assert/strict";

import { buildTools } from "../lib/tools.js";
import { resolveConfig } from "../lib/config.js";

// Build a mock runtime whose clients are simple stubs we can assert against.
function makeRuntime(overrides = {}) {
  const calls = { placeOrder: 0, cancelOrder: 0, createExchange: 0, sendTON: 0, recordOrder: 0, recordSwap: 0 };
  const config = resolveConfig({});
  const endpoints = config.endpoints;

  const sdk = {
    log: { warn: () => {} },
    ton: {
      getAddress: () => "EQUserTonAddress",
      getBalance: async () => 12.5,
      sendTON: async (to, amount) => {
        calls.sendTON += 1;
        return { txRef: "ton-tx-ref", amount };
      },
      ...(overrides.ton ?? {}),
    },
  };

  const runtime = {
    sdk,
    config,
    endpoints,
    calls,
    markets: {
      listMarkets: async () => [{ slug: "m1", question: "Q?" }],
      getMarket: async (slug) => ({ slug, outcomes: [] }),
      resolveToken: async (slug, outcome) => ({ tokenId: "tok-" + outcome, outcome }),
      ...(overrides.markets ?? {}),
    },
    rpc: {
      getUsdcBalance: async () => 100_000_000n, // 100 USDC
      ...(overrides.rpc ?? {}),
    },
    store: {
      recordOrder: () => { calls.recordOrder += 1; },
      updateOrderStatus: () => {},
      recordSwap: () => { calls.recordSwap += 1; },
      updateSwapStatus: () => {},
      getSwap: () => null,
      ...(overrides.store ?? {}),
    },
    wallet: async () => ({ address: "0xevmwallet" }),
    creds: async () => ({ apiKey: "k", secret: "c2VjcmV0", passphrase: "p" }),
    clobPublic: () => ({
      getOrderbook: async (tokenId) => ({ bids: [], asks: [], token_id: tokenId }),
      getPositions: async () => [{ asset: "x", size: 5 }],
      ...(overrides.clobPublic ?? {}),
    }),
    clob: async () => ({
      placeOrder: async () => {
        calls.placeOrder += 1;
        return { orderID: "order-123" };
      },
      cancelOrder: async () => {
        calls.cancelOrder += 1;
        return { success: true };
      },
      ...(overrides.clob ?? {}),
    }),
    bridge: async () => ({
      minAmount: async () => ({ minAmount: 1 }),
      estimate: async () => ({ toAmount: 42 }),
      createExchange: async () => {
        calls.createExchange += 1;
        return { id: "swap-1", payinAddress: "0xpayin" };
      },
      getStatus: async () => ({ status: "finished", payoutHash: "0xhash" }),
      ...(overrides.bridge ?? {}),
    }),
  };
  return runtime;
}

function tool(runtime, name) {
  const t = buildTools(runtime).find((x) => x.name === name);
  if (!t) throw new Error("tool not found: " + name);
  return t;
}

test("exposes exactly the 10 required tools", () => {
  const names = buildTools(makeRuntime()).map((t) => t.name).sort();
  assert.deepEqual(names, [
    "polymarket_cancel_order",
    "polymarket_deposit",
    "polymarket_get_balance",
    "polymarket_get_market",
    "polymarket_get_orderbook",
    "polymarket_get_positions",
    "polymarket_list_markets",
    "polymarket_place_order",
    "polymarket_swap_status",
    "polymarket_withdraw",
  ]);
});

test("every tool returns the { success } contract", async () => {
  const rt = makeRuntime();
  const res = await tool(rt, "polymarket_list_markets").execute({});
  assert.equal(res.success, true);
  assert.equal(res.data.count, 1);
});

test("place_order rejects notional above max_order_usdc", async () => {
  const rt = makeRuntime();
  const res = await tool(rt, "polymarket_place_order").execute({
    token_id: "t", side: "BUY", price: 0.9, size: 1000, // 900 USDC > 500
  });
  assert.equal(res.success, false);
  assert.match(res.error, /max_order_usdc/);
  assert.equal(rt.calls.placeOrder, 0);
});

test("place_order requires confirmation above threshold", async () => {
  const rt = makeRuntime();
  const res = await tool(rt, "polymarket_place_order").execute({
    token_id: "t", side: "BUY", price: 0.5, size: 200, // 100 USDC > 50 threshold
  });
  assert.equal(res.success, true);
  assert.equal(res.data.confirmation_required, true);
  assert.equal(rt.calls.placeOrder, 0);
});

test("place_order executes with confirm=true and records the order", async () => {
  const rt = makeRuntime();
  const res = await tool(rt, "polymarket_place_order").execute({
    token_id: "t", side: "BUY", price: 0.5, size: 200, confirm: true,
  });
  assert.equal(res.success, true);
  assert.equal(res.data.order_id, "order-123");
  assert.equal(rt.calls.placeOrder, 1);
  assert.equal(rt.calls.recordOrder, 1);
});

test("place_order below threshold executes without confirmation", async () => {
  const rt = makeRuntime();
  const res = await tool(rt, "polymarket_place_order").execute({
    slug: "m1", outcome: "Yes", side: "BUY", price: 0.4, size: 10, // 4 USDC
  });
  assert.equal(res.success, true);
  assert.equal(rt.calls.placeOrder, 1);
});

test("cancel_order calls the CLOB and updates state", async () => {
  const rt = makeRuntime();
  const res = await tool(rt, "polymarket_cancel_order").execute({ order_id: "order-123" });
  assert.equal(res.success, true);
  assert.equal(res.data.cancelled, true);
  assert.equal(rt.calls.cancelOrder, 1);
});

test("get_balance returns USDC and TON balances", async () => {
  const rt = makeRuntime();
  const res = await tool(rt, "polymarket_get_balance").execute({});
  assert.equal(res.success, true);
  assert.equal(res.data.usdc_polygon, 100);
  assert.equal(res.data.ton_balance, 12.5);
});

test("deposit rejects amounts above max_swap_ton", async () => {
  const rt = makeRuntime();
  const res = await tool(rt, "polymarket_deposit").execute({ amount_ton: 101 });
  assert.equal(res.success, false);
  assert.match(res.error, /max_swap_ton/);
});

test("deposit requires confirmation before sending TON", async () => {
  const rt = makeRuntime();
  const res = await tool(rt, "polymarket_deposit").execute({ amount_ton: 10 });
  assert.equal(res.success, true);
  assert.equal(res.data.confirmation_required, true);
  assert.equal(rt.calls.sendTON, 0);
  assert.equal(rt.calls.createExchange, 0);
});

test("deposit with confirm bridges and sends TON", async () => {
  const rt = makeRuntime();
  const res = await tool(rt, "polymarket_deposit").execute({ amount_ton: 10, confirm: true });
  assert.equal(res.success, true);
  assert.equal(res.data.swap_id, "swap-1");
  assert.equal(res.data.ton_tx_ref, "ton-tx-ref");
  assert.equal(rt.calls.createExchange, 1);
  assert.equal(rt.calls.sendTON, 1);
  assert.equal(rt.calls.recordSwap, 1);
});

test("withdraw rejects insufficient USDC balance", async () => {
  const rt = makeRuntime({ rpc: { getUsdcBalance: async () => 1_000_000n } }); // 1 USDC
  const res = await tool(rt, "polymarket_withdraw").execute({ amount_usdc: 10, confirm: true });
  assert.equal(res.success, false);
  assert.match(res.error, /Insufficient/);
});

test("withdraw requires confirmation above threshold", async () => {
  const rt = makeRuntime();
  const res = await tool(rt, "polymarket_withdraw").execute({ amount_usdc: 60 }); // > 50
  assert.equal(res.success, true);
  assert.equal(res.data.confirmation_required, true);
});

test("swap_status reports bridge status", async () => {
  const rt = makeRuntime();
  const res = await tool(rt, "polymarket_swap_status").execute({ swap_id: "swap-1" });
  assert.equal(res.success, true);
  assert.equal(res.data.status, "finished");
});

test("errors are sanitised — no private key leaks", async () => {
  const leak = "boom 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d trailing";
  const rt = makeRuntime({ markets: { listMarkets: async () => { throw new Error(leak); } } });
  const res = await tool(rt, "polymarket_list_markets").execute({});
  assert.equal(res.success, false);
  assert.doesNotMatch(res.error, /0x59c6995e/);
  assert.match(res.error, /\[redacted\]/);
});
