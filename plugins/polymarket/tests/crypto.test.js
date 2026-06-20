import test from "node:test";
import assert from "node:assert/strict";

import { keccak256 } from "../lib/crypto/keccak.js";
import {
  utf8ToBytes,
  bytesToHex,
  hexToBytes,
  bigintToBytes,
} from "../lib/crypto/hex.js";
import {
  privateKeyToAddress,
  sign,
  recoverAddress,
  signToHex,
  CURVE_N,
} from "../lib/crypto/secp256k1.js";
import { rlpEncode, toMinimalBytes } from "../lib/crypto/rlp.js";
import { eip712Digest } from "../lib/crypto/eip712.js";
import { EvmWallet } from "../lib/evm-wallet.js";

// ── Keccak-256 known vectors ───────────────────────────────────────────────
test("keccak256 matches known vectors", () => {
  assert.equal(
    bytesToHex(keccak256(utf8ToBytes(""))),
    "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
  );
  assert.equal(
    bytesToHex(keccak256(utf8ToBytes("abc"))),
    "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45"
  );
});

// ── Address derivation (well-known secp256k1 vectors) ──────────────────────
test("privateKeyToAddress matches well-known vectors", () => {
  assert.equal(
    privateKeyToAddress(bigintToBytes(1n, 32)),
    "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf"
  );
  assert.equal(
    privateKeyToAddress(bigintToBytes(2n, 32)),
    "0x2b5ad5c4795c026514f8317c7a215e218dccd6cf"
  );
});

// ── ECDSA sign / recover round-trip + low-S enforcement ────────────────────
test("sign produces low-S signatures that recover the signer", () => {
  const halfN = CURVE_N >> 1n;
  for (const k of [1234567890n, 99n, 0xdeadbeefn]) {
    const pk = bigintToBytes(k, 32);
    const addr = privateKeyToAddress(pk);
    const hash = keccak256(utf8ToBytes(`message-${k}`));
    const sig = sign(hash, pk);
    assert.ok(sig.s <= halfN, "s must be in the lower half (EIP-2)");
    assert.equal(recoverAddress(hash, sig), addr);
  }
});

test("signToHex emits a 65-byte signature", () => {
  const pk = bigintToBytes(7n, 32);
  const hash = keccak256(utf8ToBytes("x"));
  const hex = signToHex(hash, pk);
  assert.equal(hex.length, 132); // 0x + 65 bytes
  const v = parseInt(hex.slice(-2), 16);
  assert.ok(v === 27 || v === 28);
});

// ── RLP encoding vectors (from the RLP spec) ───────────────────────────────
test("rlpEncode matches spec vectors", () => {
  assert.equal(bytesToHex(rlpEncode(utf8ToBytes("dog"))), "0x83646f67");
  assert.equal(bytesToHex(rlpEncode(utf8ToBytes(""))), "0x80");
  assert.equal(
    bytesToHex(rlpEncode([utf8ToBytes("cat"), utf8ToBytes("dog")])),
    "0xc88363617483646f67"
  );
  assert.equal(bytesToHex(rlpEncode(toMinimalBytes(15))), "0x0f");
  assert.equal(bytesToHex(rlpEncode(toMinimalBytes(1024))), "0x820400");
  assert.equal(bytesToHex(toMinimalBytes(0)), "0x");
});

// ── EIP-712 + order signing round-trip ─────────────────────────────────────
const ORDER_FIELDS = [
  { name: "salt", type: "uint256" },
  { name: "maker", type: "address" },
  { name: "signer", type: "address" },
  { name: "taker", type: "address" },
  { name: "tokenId", type: "uint256" },
  { name: "makerAmount", type: "uint256" },
  { name: "takerAmount", type: "uint256" },
  { name: "expiration", type: "uint256" },
  { name: "nonce", type: "uint256" },
  { name: "feeRateBps", type: "uint256" },
  { name: "side", type: "uint8" },
  { name: "signatureType", type: "uint8" },
];

test("EvmWallet.signOrder produces a signature recoverable to the wallet", () => {
  const wallet = new EvmWallet({ privateKey: bytesToHex(bigintToBytes(424242n, 32)) });
  const verifyingContract = "0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e";
  const order = {
    salt: "12345",
    maker: wallet.address,
    signer: wallet.address,
    taker: "0x0000000000000000000000000000000000000000",
    tokenId: "999",
    makerAmount: "4000000",
    takerAmount: "10000000",
    expiration: "0",
    nonce: "0",
    feeRateBps: "0",
    side: 0,
    signatureType: 0,
  };
  const sigHex = wallet.signOrder(order, { chainId: 137, verifyingContract });

  const digest = eip712Digest(
    { name: "Polymarket CTF Exchange", version: "1", chainId: 137, verifyingContract },
    "Order",
    ORDER_FIELDS,
    order
  );
  const bytes = hexToBytes(sigHex);
  const r = BigInt(bytesToHex(bytes.slice(0, 32)));
  const s = BigInt(bytesToHex(bytes.slice(32, 64)));
  const recovery = bytes[64] - 27;
  assert.equal(recoverAddress(digest, { r, s, recovery }), wallet.address);
});

// ── EIP-1559 transaction signing produces a type-2 envelope ────────────────
test("signTransaction yields a 0x02 typed transaction", () => {
  const wallet = new EvmWallet({ privateKey: bytesToHex(bigintToBytes(555n, 32)) });
  const raw = wallet.signTransaction({
    chainId: 137,
    nonce: 0,
    maxPriorityFeePerGas: 30_000_000_000n,
    maxFeePerGas: 60_000_000_000n,
    gasLimit: 120_000n,
    to: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
    value: 0n,
    data: "0xa9059cbb",
  });
  assert.ok(raw.startsWith("0x02"));
  assert.ok(raw.length > 100);
});
