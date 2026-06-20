/**
 * Minimal secp256k1 (the curve used by Ethereum) — pure JS + Node `crypto`
 * for HMAC-SHA256 (RFC 6979) and CSPRNG. No external dependencies.
 *
 * Provides exactly what the Polymarket order signer needs:
 *   - private key -> public key / EVM address
 *   - deterministic ECDSA signing with recovery id and low-S normalisation
 *     (the (r, s, v) form Ethereum / EIP-712 expects)
 *
 * Correctness is covered by known test vectors in the plugin test suite.
 */

import { createHmac, randomBytes } from "node:crypto";

import { keccak256 } from "./keccak.js";
import { bigintToBytes, bytesToBigint, bytesToHex, hexToBytes } from "./hex.js";

// Curve parameters.
const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const Gx = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const Gy = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;
const HALF_N = N >> 1n;

function mod(a, m = P) {
  const r = a % m;
  return r >= 0n ? r : r + m;
}

// Extended Euclidean modular inverse.
function invMod(a, m = P) {
  let oldR = mod(a, m);
  let r = m;
  let oldS = 1n;
  let s = 0n;
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  return mod(oldS, m);
}

// Jacobian point arithmetic ({ x, y, z }). Identity is z === 0n.
const IDENTITY = { x: 0n, y: 1n, z: 0n };

function jacobianDouble(p) {
  if (p.z === 0n) return IDENTITY;
  const { x, y, z } = p;
  const ysq = mod(y * y);
  const s = mod(4n * x * ysq);
  const m = mod(3n * x * x); // a = 0 for secp256k1
  const nx = mod(m * m - 2n * s);
  const ny = mod(m * (s - nx) - 8n * ysq * ysq);
  const nz = mod(2n * y * z);
  return { x: nx, y: ny, z: nz };
}

function jacobianAdd(p, q) {
  if (p.z === 0n) return q;
  if (q.z === 0n) return p;
  const z1z1 = mod(p.z * p.z);
  const z2z2 = mod(q.z * q.z);
  const u1 = mod(p.x * z2z2);
  const u2 = mod(q.x * z1z1);
  const s1 = mod(p.y * q.z * z2z2);
  const s2 = mod(q.y * p.z * z1z1);
  if (u1 === u2) {
    if (s1 !== s2) return IDENTITY;
    return jacobianDouble(p);
  }
  const h = mod(u2 - u1);
  const r = mod(s2 - s1);
  const hh = mod(h * h);
  const hhh = mod(h * hh);
  const u1hh = mod(u1 * hh);
  const nx = mod(r * r - hhh - 2n * u1hh);
  const ny = mod(r * (u1hh - nx) - s1 * hhh);
  const nz = mod(h * p.z * q.z);
  return { x: nx, y: ny, z: nz };
}

function jacobianMul(k, point) {
  let result = IDENTITY;
  let addend = point;
  let n = k;
  while (n > 0n) {
    if (n & 1n) result = jacobianAdd(result, addend);
    addend = jacobianDouble(addend);
    n >>= 1n;
  }
  return result;
}

function toAffine(p) {
  if (p.z === 0n) throw new Error("point at infinity");
  const zinv = invMod(p.z);
  const zinv2 = mod(zinv * zinv);
  const zinv3 = mod(zinv2 * zinv);
  return { x: mod(p.x * zinv2), y: mod(p.y * zinv3) };
}

const G = { x: Gx, y: Gy, z: 1n };

/** Normalise a private key into a 0 < d < n bigint. */
function normalizePriv(privateKey) {
  const bytes = typeof privateKey === "string" ? hexToBytes(privateKey) : privateKey;
  const d = bytesToBigint(bytes);
  if (d <= 0n || d >= N) throw new Error("invalid private key");
  return d;
}

/** @returns {{ x: bigint, y: bigint }} */
export function getPublicPoint(privateKey) {
  const d = normalizePriv(privateKey);
  return toAffine(jacobianMul(d, G));
}

/** Uncompressed public key bytes (64 bytes, no 0x04 prefix). */
export function getPublicKeyBytes(privateKey) {
  const { x, y } = getPublicPoint(privateKey);
  const out = new Uint8Array(64);
  out.set(bigintToBytes(x, 32), 0);
  out.set(bigintToBytes(y, 32), 32);
  return out;
}

/** EVM address (lowercase, 0x-prefixed) derived from a private key. */
export function privateKeyToAddress(privateKey) {
  const pub = getPublicKeyBytes(privateKey);
  const hash = keccak256(pub);
  return bytesToHex(hash.slice(12));
}

/** Generate a fresh random 32-byte private key (0x-prefixed hex). */
export function generatePrivateKey() {
  while (true) {
    const bytes = randomBytes(32);
    const d = bytesToBigint(bytes);
    if (d > 0n && d < N) return bytesToHex(bytes);
  }
}

// RFC 6979 deterministic nonce generation (HMAC-SHA256).
function rfc6979k(hash, d) {
  const h1 = bigintToBytes(mod(bytesToBigint(hash), N), 32);
  const x = bigintToBytes(d, 32);
  let v = new Uint8Array(32).fill(1);
  let k = new Uint8Array(32).fill(0);

  const hmac = (key, ...data) => {
    const mac = createHmac("sha256", Buffer.from(key));
    for (const d2 of data) mac.update(Buffer.from(d2));
    return new Uint8Array(mac.digest());
  };

  k = hmac(k, v, new Uint8Array([0x00]), x, h1);
  v = hmac(k, v);
  k = hmac(k, v, new Uint8Array([0x01]), x, h1);
  v = hmac(k, v);

  while (true) {
    v = hmac(k, v);
    const candidate = bytesToBigint(v);
    if (candidate > 0n && candidate < N) return candidate;
    k = hmac(k, v, new Uint8Array([0x00]));
    v = hmac(k, v);
  }
}

/**
 * Deterministic ECDSA signature over secp256k1.
 * @param {Uint8Array} msgHash 32-byte hash (already keccak256'd for EIP-712)
 * @param {string|Uint8Array} privateKey
 * @returns {{ r: bigint, s: bigint, recovery: number }}
 */
export function sign(msgHash, privateKey) {
  const d = normalizePriv(privateKey);
  const z = mod(bytesToBigint(msgHash), N);

  while (true) {
    const k = rfc6979k(msgHash, d);
    const point = toAffine(jacobianMul(k, G));
    const r = mod(point.x, N);
    if (r === 0n) continue;
    let s = mod(invMod(k, N) * (z + r * d), N);
    if (s === 0n) continue;

    let recovery = (point.y & 1n) === 1n ? 1 : 0;
    if (point.x >= N) recovery |= 2;

    // Enforce low-S (EIP-2): if s > n/2, negate and flip recovery parity.
    if (s > HALF_N) {
      s = N - s;
      recovery ^= 1;
    }
    return { r, s, recovery };
  }
}

// Modular exponentiation (used for the modular square root below).
function modPow(base, exp, m) {
  let result = 1n;
  let b = mod(base, m);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = mod(result * b, m);
    b = mod(b * b, m);
    e >>= 1n;
  }
  return result;
}

// secp256k1 uses p ≡ 3 (mod 4), so sqrt(a) = a^((p+1)/4) mod p.
function modSqrt(a) {
  return modPow(a, (P + 1n) / 4n, P);
}

/**
 * Recover the signer's EVM address from a hash and an (r, s, recovery) tuple.
 * The inverse of sign() — used by the test suite to prove the signing pipeline
 * round-trips, and useful for verifying third-party signatures.
 * @param {Uint8Array} msgHash 32-byte hash
 * @param {{ r: bigint, s: bigint, recovery: number }} sig
 * @returns {string} 0x-prefixed lowercase address
 */
export function recoverAddress(msgHash, { r, s, recovery }) {
  const z = mod(bytesToBigint(msgHash), N);
  const x = recovery & 2 ? r + N : r;
  if (x >= P) throw new Error("invalid signature: x out of range");

  // Recover R's y from the curve equation y^2 = x^3 + 7.
  const ySq = mod(x * x * x + 7n);
  let y = modSqrt(ySq);
  if ((y & 1n) !== BigInt(recovery & 1)) y = mod(-y);

  const R = { x, y, z: 1n };
  const rInv = invMod(r, N);
  const u1 = mod(-z * rInv, N);
  const u2 = mod(s * rInv, N);
  const point = toAffine(jacobianAdd(jacobianMul(u1, G), jacobianMul(u2, R)));

  const pub = new Uint8Array(64);
  pub.set(bigintToBytes(point.x, 32), 0);
  pub.set(bigintToBytes(point.y, 32), 32);
  return bytesToHex(keccak256(pub).slice(12));
}

/**
 * Ethereum-style 65-byte signature hex: r (32) || s (32) || v (1, = 27 + recovery).
 * @param {Uint8Array} msgHash
 * @param {string|Uint8Array} privateKey
 * @returns {string}
 */
export function signToHex(msgHash, privateKey) {
  const { r, s, recovery } = sign(msgHash, privateKey);
  const out = new Uint8Array(65);
  out.set(bigintToBytes(r, 32), 0);
  out.set(bigintToBytes(s, 32), 32);
  out[64] = 27 + recovery;
  return bytesToHex(out);
}

export { N as CURVE_N };
