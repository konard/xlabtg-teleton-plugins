/**
 * Minimal RLP encoder — enough to build and sign EIP-1559 (type-2) Polygon
 * transactions for the ERC-20 transfer used by the withdraw flow.
 *
 * Inputs are a tree of Uint8Array leaves and arrays. Helpers convert numbers /
 * hex to the minimal big-endian byte form RLP expects (no leading zeros).
 */

import { bytesToBigint, concatBytes, hexToBytes } from "./hex.js";

function encodeLength(len, offset) {
  if (len < 56) return new Uint8Array([offset + len]);
  const hex = len.toString(16);
  const lenBytes = hexToBytes(hex.length % 2 ? "0" + hex : hex);
  return concatBytes(new Uint8Array([offset + 55 + lenBytes.length]), lenBytes);
}

/**
 * @param {Uint8Array|Array} input
 * @returns {Uint8Array}
 */
export function rlpEncode(input) {
  if (Array.isArray(input)) {
    const items = input.map(rlpEncode);
    const body = concatBytes(...items);
    return concatBytes(encodeLength(body.length, 0xc0), body);
  }
  const bytes = input;
  if (bytes.length === 1 && bytes[0] < 0x80) return bytes;
  return concatBytes(encodeLength(bytes.length, 0x80), bytes);
}

/** Strip leading zero bytes (RLP integers are minimal big-endian). */
export function trimLeadingZeros(bytes) {
  let i = 0;
  while (i < bytes.length - 1 && bytes[i] === 0) i++;
  return bytes.slice(i);
}

/** Convert a number/bigint/hex value into a minimal big-endian byte array. */
export function toMinimalBytes(value) {
  if (value === 0 || value === 0n || value === "0x0" || value === "0x") {
    return new Uint8Array(0);
  }
  let bytes;
  if (typeof value === "string") {
    bytes = hexToBytes(value);
  } else {
    let v = BigInt(value);
    const out = [];
    while (v > 0n) {
      out.unshift(Number(v & 0xffn));
      v >>= 8n;
    }
    bytes = new Uint8Array(out);
  }
  return trimLeadingZeros(bytes);
}

export { bytesToBigint };
