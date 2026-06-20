import { keccak256 } from "../plugins/polymarket/lib/crypto/keccak.js";
import { utf8ToBytes, bigintToBytes, bytesToBigint, bytesToHex } from "../plugins/polymarket/lib/crypto/hex.js";
import { sign, privateKeyToAddress } from "../plugins/polymarket/lib/crypto/secp256k1.js";

const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const Gx = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const Gy = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;
const mod=(a,m=P)=>{const r=a%m;return r>=0n?r:r+m;};
function inv(a,m){let or=mod(a,m),r=m,os=1n,s=0n;while(r){const q=or/r;[or,r]=[r,or-q*r];[os,s]=[s,os-q*s];}return mod(os,m);}
function add(p,q){if(!p)return q;if(!q)return p;if(p.x===q.x&&mod(p.y+q.y,P)===0n)return null;let l;if(p.x===q.x)l=mod((3n*p.x*p.x)*inv(2n*p.y,P));else l=mod((q.y-p.y)*inv(q.x-p.x,P));const x=mod(l*l-p.x-q.x);const y=mod(l*(p.x-x)-p.y);return{x,y};}
function mul(k,p){let r=null,a=p;while(k>0n){if(k&1n)r=add(r,a);a=add(a,a);k>>=1n;}return r;}
function sqrt(a){return modpow(a,(P+1n)/4n,P);}
function modpow(b,e,m){let r=1n;b=mod(b,m);while(e>0n){if(e&1n)r=mod(r*b,m);b=mod(b*b,m);e>>=1n;}return r;}
function recover(hash,r,s,rec){const z=mod(bytesToBigint(hash),N);let x=r;if(rec&2)x+=N;const y2=mod(x*x*x+7n,P);let y=sqrt(y2);if((y&1n)!==BigInt(rec&1))y=P-y;const R={x,y};const rinv=inv(r,N);const u1=mod(-z*rinv,N);const u2=mod(s*rinv,N);const Q=add(mul(u1,{x:Gx,y:Gy}),mul(u2,R));const pub=new Uint8Array(64);pub.set(bigintToBytes(Q.x,32),0);pub.set(bigintToBytes(Q.y,32),32);return bytesToHex(keccak256(pub).slice(12));}

const priv="0xc85ef7d79691fe79573b1a7064c19c1a9819ebdbd1faaab1a8ec92344438aaf4";
const addr=privateKeyToAddress(priv);
const h=keccak256(utf8ToBytes("polymarket order test"));
const {r,s,recovery}=sign(h,priv);
const rec=recover(h,r,s,recovery);
console.log("addr     =",addr);
console.log("recovered=",rec);
console.log("MATCH    =",addr===rec);
