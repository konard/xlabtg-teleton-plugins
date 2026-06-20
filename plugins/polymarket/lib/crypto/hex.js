/**
 * Hex / byte conversion helpers shared by the crypto modules.
 */

/** @param {string} hex @returns {Uint8Array} */
export function hexToBytes(hex) {
  let h = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (h.length % 2 !== 0) h = "0" + h;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** @param {Uint8Array} bytes @returns {string} 0x-prefixed hex */
export function bytesToHex(bytes) {
  let s = "0x";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

/** @param {bigint} value @param {number} length byte length @returns {Uint8Array} */
export function bigintToBytes(value, length) {
  const out = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/** @param {Uint8Array} bytes @returns {bigint} */
export function bytesToBigint(bytes) {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

/** Concatenate Uint8Arrays. @param {...Uint8Array} arrays */
export function concatBytes(...arrays) {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

/** UTF-8 encode. @param {string} str @returns {Uint8Array} */
export function utf8ToBytes(str) {
  return new TextEncoder().encode(str);
}
