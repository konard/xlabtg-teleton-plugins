import test from "node:test";
import assert from "node:assert/strict";

import { sanitizeError, ok, fail, toNumber } from "../lib/util.js";
import { Store } from "../lib/state.js";

test("sanitizeError redacts private keys and long tokens", () => {
  const pk = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
  const out = sanitizeError(new Error(`failed with key ${pk}`));
  assert.doesNotMatch(out, /0x59c6995e/);
  assert.match(out, /\[redacted\]/);
});

test("sanitizeError redacts labelled secrets", () => {
  const out = sanitizeError("api_key=supersecretvalue123 was rejected");
  assert.match(out, /\[redacted\]/);
});

test("sanitizeError truncates very long messages", () => {
  const out = sanitizeError("x".repeat(2000));
  assert.ok(out.length <= 501);
});

test("ok/fail wrap the plugin contract", () => {
  assert.deepEqual(ok({ a: 1 }), { success: true, data: { a: 1 } });
  const f = fail(new Error("nope"));
  assert.equal(f.success, false);
  assert.equal(f.error, "nope");
});

test("toNumber coerces and falls back", () => {
  assert.equal(toNumber("3.5"), 3.5);
  assert.equal(toNumber("abc", 0), 0);
});

test("Store degrades gracefully without a database", () => {
  const store = new Store(null);
  assert.equal(store.enabled, false);
  assert.doesNotThrow(() => store.recordSwap({ id: "s", direction: "deposit" }));
  assert.equal(store.getSwap("s"), null);
  assert.deepEqual(store.listSwaps(), []);
});

test("Store persists swaps through a sqlite-like db", () => {
  // Minimal in-memory stand-in for better-sqlite3's prepare().run/get/all.
  const rows = new Map();
  const db = {
    prepare(sql) {
      return {
        run(params) {
          if (sql.includes("INSERT OR REPLACE INTO polymarket_swaps")) rows.set(params.id, params);
        },
        get(id) {
          return rows.get(id) ?? null;
        },
        all() {
          return [...rows.values()];
        },
      };
    },
  };
  const store = new Store(db);
  store.recordSwap({ id: "s1", direction: "deposit", status: "sent", amount: 10 });
  assert.equal(store.getSwap("s1").direction, "deposit");
});
