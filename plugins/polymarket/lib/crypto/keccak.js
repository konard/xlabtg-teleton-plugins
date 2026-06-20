/**
 * Keccak-256 (the hash used by Ethereum / EVM) — pure JS, no dependencies.
 *
 * This is the original Keccak padding (0x01), NOT the NIST SHA3-256 padding
 * (0x06). EVM address derivation and EIP-712 hashing both rely on this.
 *
 * Implemented with BigInt lanes for clarity over raw speed; the inputs we hash
 * (addresses, 32-byte words, short structs) are tiny, so performance is fine.
 */

const MASK64 = (1n << 64n) - 1n;

// Round constants for Keccak-f[1600].
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

// Rotation offsets (rho step), indexed by lane position 0..24.
const ROT = [
  0n, 1n, 62n, 28n, 27n,
  36n, 44n, 6n, 55n, 20n,
  3n, 10n, 43n, 25n, 39n,
  41n, 45n, 15n, 21n, 8n,
  18n, 2n, 61n, 56n, 14n,
];

function rotl(x, n) {
  if (n === 0n) return x & MASK64;
  return ((x << n) | (x >> (64n - n))) & MASK64;
}

function keccakF(state) {
  for (let round = 0; round < 24; round++) {
    // θ (theta)
    const C = new Array(5);
    for (let x = 0; x < 5; x++) {
      C[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
    }
    const D = new Array(5);
    for (let x = 0; x < 5; x++) {
      D[x] = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1n);
    }
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        state[x + 5 * y] ^= D[x];
      }
    }

    // ρ (rho) + π (pi)
    const B = new Array(25).fill(0n);
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        const idx = x + 5 * y;
        const newX = y;
        const newY = (2 * x + 3 * y) % 5;
        B[newX + 5 * newY] = rotl(state[idx], ROT[idx]);
      }
    }

    // χ (chi)
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        state[x + 5 * y] = B[x + 5 * y] ^ ((~B[((x + 1) % 5) + 5 * y] & MASK64) & B[((x + 2) % 5) + 5 * y]);
      }
    }

    // ι (iota)
    state[0] ^= RC[round];
  }
}

/**
 * @param {Uint8Array} input
 * @returns {Uint8Array} 32-byte digest
 */
export function keccak256(input) {
  const rate = 136; // bytes (1088 bits) for Keccak-256
  const state = new Array(25).fill(0n);

  // Pad: append 0x01, zero-fill, set high bit of the last block byte (0x80).
  const padLen = rate - (input.length % rate);
  const padded = new Uint8Array(input.length + padLen);
  padded.set(input);
  padded[input.length] = 0x01;
  padded[padded.length - 1] |= 0x80;

  // Absorb
  for (let offset = 0; offset < padded.length; offset += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let b = 0; b < 8; b++) {
        lane |= BigInt(padded[offset + i * 8 + b]) << (8n * BigInt(b));
      }
      state[i] ^= lane;
    }
    keccakF(state);
  }

  // Squeeze first 32 bytes
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    let lane = state[i];
    for (let b = 0; b < 8; b++) {
      out[i * 8 + b] = Number(lane & 0xffn);
      lane >>= 8n;
    }
  }
  return out;
}
