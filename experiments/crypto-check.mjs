import { keccak256 } from "../plugins/polymarket/lib/crypto/keccak.js";
import { bytesToHex, utf8ToBytes } from "../plugins/polymarket/lib/crypto/hex.js";
import { privateKeyToAddress, getPublicPoint, sign, signToHex } from "../plugins/polymarket/lib/crypto/secp256k1.js";

const empty = bytesToHex(keccak256(new Uint8Array(0)));
console.log("keccak256('') =", empty);
console.log("expect          = 0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");

const abc = bytesToHex(keccak256(utf8ToBytes("abc")));
console.log("keccak256('abc')=", abc);
console.log("expect          = 0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");

// priv = 1 -> address 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf, pubkey x = Gx
const priv1 = "0x0000000000000000000000000000000000000000000000000000000000000001";
console.log("addr(1) =", privateKeyToAddress(priv1));
console.log("expect  = 0x7e5f4552091a69125d5dfcb7b8c2659029395bdf");
console.log("pub.x   =", getPublicPoint(priv1).x.toString(16));

// priv = 2 -> address 0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF
const priv2 = "0x0000000000000000000000000000000000000000000000000000000000000002";
console.log("addr(2) =", privateKeyToAddress(priv2));
console.log("expect  = 0x2b5ad5c4795c026514f8317c7a215e218dccd6cf");

// deterministic sign self-consistency + known vector check is non-trivial; just print
const h = keccak256(utf8ToBytes("hello"));
console.log("sig =", signToHex(h, priv1));
