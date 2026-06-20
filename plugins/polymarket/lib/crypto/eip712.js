/**
 * Minimal EIP-712 typed-data hashing — enough for the Polymarket CTF Exchange
 * order struct. Pure JS, built on the local keccak256.
 *
 * Supports the value types we actually use: address, uintN, bytes32, string,
 * bool. Nested structs are not needed for the order payload.
 */

import { keccak256 } from "./keccak.js";
import { bigintToBytes, concatBytes, hexToBytes, utf8ToBytes } from "./hex.js";

/**
 * Build the canonical type string, e.g.
 *   Order(uint256 salt,address maker,...)
 * @param {string} primaryType
 * @param {Array<{name:string,type:string}>} fields
 */
function encodeType(primaryType, fields) {
  const inner = fields.map((f) => `${f.type} ${f.name}`).join(",");
  return `${primaryType}(${inner})`;
}

function typeHash(primaryType, fields) {
  return keccak256(utf8ToBytes(encodeType(primaryType, fields)));
}

/** Encode a single value to a 32-byte word per EIP-712 rules. */
function encodeValue(type, value) {
  if (type === "string") {
    return keccak256(utf8ToBytes(String(value)));
  }
  if (type === "address") {
    const word = new Uint8Array(32);
    word.set(hexToBytes(String(value)).slice(-20), 12);
    return word;
  }
  if (type === "bytes32") {
    const word = new Uint8Array(32);
    word.set(hexToBytes(String(value)).slice(0, 32), 0);
    return word;
  }
  if (type === "bool") {
    return bigintToBytes(value ? 1n : 0n, 32);
  }
  if (type.startsWith("uint") || type.startsWith("int")) {
    return bigintToBytes(BigInt(value), 32);
  }
  throw new Error(`unsupported EIP-712 type: ${type}`);
}

/**
 * hashStruct(s) = keccak256(typeHash || encodeData(s))
 * @param {string} primaryType
 * @param {Array<{name:string,type:string}>} fields
 * @param {Record<string, any>} data
 */
export function hashStruct(primaryType, fields, data) {
  const parts = [typeHash(primaryType, fields)];
  for (const f of fields) {
    parts.push(encodeValue(f.type, data[f.name]));
  }
  return keccak256(concatBytes(...parts));
}

const DOMAIN_FIELDS = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
];

/** @param {{name:string,version:string,chainId:number|bigint,verifyingContract:string}} domain */
export function domainSeparator(domain) {
  return hashStruct("EIP712Domain", DOMAIN_FIELDS, domain);
}

/**
 * Final EIP-712 digest: keccak256(0x1901 || domainSeparator || hashStruct).
 * @param {object} domain
 * @param {string} primaryType
 * @param {Array<{name:string,type:string}>} fields
 * @param {Record<string, any>} message
 * @returns {Uint8Array} 32-byte digest ready to be signed
 */
export function eip712Digest(domain, primaryType, fields, message) {
  const prefix = new Uint8Array([0x19, 0x01]);
  return keccak256(
    concatBytes(prefix, domainSeparator(domain), hashStruct(primaryType, fields, message))
  );
}
