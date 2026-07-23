// Pascual Reply — free-mode proxy (Cloudflare Worker)
//
// Uses OpenRouter's FREE models. The key insight: OpenRouter's set of :free
// models changes constantly (models get renamed/removed), so a hardcoded list
// rots. This worker instead fetches the current model catalog from OpenRouter,
// picks the ones priced at 0, and tries them in turn until one answers.
//
// The OpenRouter key lives ONLY here as a Wrangler secret (env.OPENROUTER_KEY);
// it is never shipped in the extension. Because the models are free, there is no
// paid balance to burn — the protections below exist to stop your key being
// spammed/flagged, not to protect money.
//
// DEFENSE IN DEPTH (three layers — knowing the URL is not enough to call it):
//   1) Origin allow-list (env.ALLOWED_ORIGINS): Chrome attaches
//      "Origin: chrome-extension://<your-id>" to fetches from the extension's
//      service worker. A normal browser CANNOT forge this header, so random
//      websites and in-browser abuse are blocked outright. (curl can forge it —
//      that's what layers 2 and 3 are for.)
//   2) Shared secret header (env.CLIENT_TOKEN): the extension sends
//      "x-pascual-token: <token>". Stops scripted callers that don't know it.
//      The token is visible to anyone who unpacks the extension, so it is a
//      speed-bump, not a vault — combined with layers 1 & 3 it's effective.
//   3) Per-IP daily rate limit (KV): caps damage from anyone who gets past 1 & 2.
//
// Bindings:
//   - Secret  OPENROUTER_KEY   = your OpenRouter API key (free tier is fine)
//   - Var     ALLOWED_ORIGINS  = comma-separated, e.g.
//                                "chrome-extension://abcdef...,chrome-extension://ghij..."
//                                (add your published extension ID here)
//   - Secret  CLIENT_TOKEN     = a random string, also embedded in the extension
//   - KV       RL              = KV namespace for per-IP rate limiting

// ============================================================================
// Self-contained crypto: keccak-256 + secp256k1 ecrecover (no libraries).
// The Arc reth node does NOT expose personal_ecRecover, so EIP-191 signatures
// are verified here. This is a standard, well-trodden implementation using
// BigInt; it runs fine under the Workers CSP (pure JS, no eval, no WASM).
// ============================================================================

// ---- keccak-256 (Ethereum's hash; NOT NIST SHA3) ----
// Canonical 32-bit implementation (js-sha3 structure), verified against the
// empty-string and "abc" vectors. State is 50 int32 words (25 lanes, lo/hi
// interleaved). Round constants below are the lo/hi pairs, flattened.
const _KRC = [
  1, 0, 32898, 0, 32906, 2147483648, 2147516416, 2147483648, 32907, 0,
  2147483649, 0, 2147516545, 2147483648, 32777, 2147483648, 138, 0, 136, 0,
  2147516425, 0, 2147483658, 0, 2147516555, 0, 139, 2147483648, 32905, 2147483648,
  32771, 2147483648, 32770, 2147483648, 128, 2147483648, 32778, 0, 2147483658, 2147483648,
  2147516545, 2147483648, 32896, 2147483648, 2147483649, 0, 2147516424, 2147483648
];
function _keccakf(s) {
  let h, l, c0, c1, c2, c3, c4, c5, c6, c7, c8, c9;
  let b0, b1, b2, b3, b4, b5, b6, b7, b8, b9, b10, b11, b12, b13, b14, b15, b16, b17, b18, b19, b20, b21, b22, b23, b24, b25, b26, b27, b28, b29, b30, b31, b32, b33, b34, b35, b36, b37, b38, b39, b40, b41, b42, b43, b44, b45, b46, b47, b48, b49;
  for (let n = 0; n < 48; n += 2) {
    c0 = s[0] ^ s[10] ^ s[20] ^ s[30] ^ s[40]; c1 = s[1] ^ s[11] ^ s[21] ^ s[31] ^ s[41];
    c2 = s[2] ^ s[12] ^ s[22] ^ s[32] ^ s[42]; c3 = s[3] ^ s[13] ^ s[23] ^ s[33] ^ s[43];
    c4 = s[4] ^ s[14] ^ s[24] ^ s[34] ^ s[44]; c5 = s[5] ^ s[15] ^ s[25] ^ s[35] ^ s[45];
    c6 = s[6] ^ s[16] ^ s[26] ^ s[36] ^ s[46]; c7 = s[7] ^ s[17] ^ s[27] ^ s[37] ^ s[47];
    c8 = s[8] ^ s[18] ^ s[28] ^ s[38] ^ s[48]; c9 = s[9] ^ s[19] ^ s[29] ^ s[39] ^ s[49];
    h = c8 ^ ((c2 << 1) | (c3 >>> 31)); l = c9 ^ ((c3 << 1) | (c2 >>> 31));
    s[0] ^= h; s[1] ^= l; s[10] ^= h; s[11] ^= l; s[20] ^= h; s[21] ^= l; s[30] ^= h; s[31] ^= l; s[40] ^= h; s[41] ^= l;
    h = c0 ^ ((c4 << 1) | (c5 >>> 31)); l = c1 ^ ((c5 << 1) | (c4 >>> 31));
    s[2] ^= h; s[3] ^= l; s[12] ^= h; s[13] ^= l; s[22] ^= h; s[23] ^= l; s[32] ^= h; s[33] ^= l; s[42] ^= h; s[43] ^= l;
    h = c2 ^ ((c6 << 1) | (c7 >>> 31)); l = c3 ^ ((c7 << 1) | (c6 >>> 31));
    s[4] ^= h; s[5] ^= l; s[14] ^= h; s[15] ^= l; s[24] ^= h; s[25] ^= l; s[34] ^= h; s[35] ^= l; s[44] ^= h; s[45] ^= l;
    h = c4 ^ ((c8 << 1) | (c9 >>> 31)); l = c5 ^ ((c9 << 1) | (c8 >>> 31));
    s[6] ^= h; s[7] ^= l; s[16] ^= h; s[17] ^= l; s[26] ^= h; s[27] ^= l; s[36] ^= h; s[37] ^= l; s[46] ^= h; s[47] ^= l;
    h = c6 ^ ((c0 << 1) | (c1 >>> 31)); l = c7 ^ ((c1 << 1) | (c0 >>> 31));
    s[8] ^= h; s[9] ^= l; s[18] ^= h; s[19] ^= l; s[28] ^= h; s[29] ^= l; s[38] ^= h; s[39] ^= l; s[48] ^= h; s[49] ^= l;
    b0 = s[0]; b1 = s[1]; b32 = (s[11] << 4) | (s[10] >>> 28); b33 = (s[10] << 4) | (s[11] >>> 28);
    b14 = (s[20] << 3) | (s[21] >>> 29); b15 = (s[21] << 3) | (s[20] >>> 29); b46 = (s[31] << 9) | (s[30] >>> 23); b47 = (s[30] << 9) | (s[31] >>> 23);
    b28 = (s[40] << 18) | (s[41] >>> 14); b29 = (s[41] << 18) | (s[40] >>> 14); b20 = (s[2] << 1) | (s[3] >>> 31); b21 = (s[3] << 1) | (s[2] >>> 31);
    b2 = (s[13] << 12) | (s[12] >>> 20); b3 = (s[12] << 12) | (s[13] >>> 20); b34 = (s[22] << 10) | (s[23] >>> 22); b35 = (s[23] << 10) | (s[22] >>> 22);
    b16 = (s[33] << 13) | (s[32] >>> 19); b17 = (s[32] << 13) | (s[33] >>> 19); b48 = (s[42] << 2) | (s[43] >>> 30); b49 = (s[43] << 2) | (s[42] >>> 30);
    b40 = (s[5] << 30) | (s[4] >>> 2); b41 = (s[4] << 30) | (s[5] >>> 2); b22 = (s[14] << 6) | (s[15] >>> 26); b23 = (s[15] << 6) | (s[14] >>> 26);
    b4 = (s[25] << 11) | (s[24] >>> 21); b5 = (s[24] << 11) | (s[25] >>> 21); b36 = (s[34] << 15) | (s[35] >>> 17); b37 = (s[35] << 15) | (s[34] >>> 17);
    b18 = (s[45] << 29) | (s[44] >>> 3); b19 = (s[44] << 29) | (s[45] >>> 3); b10 = (s[6] << 28) | (s[7] >>> 4); b11 = (s[7] << 28) | (s[6] >>> 4);
    b42 = (s[17] << 23) | (s[16] >>> 9); b43 = (s[16] << 23) | (s[17] >>> 9); b24 = (s[26] << 25) | (s[27] >>> 7); b25 = (s[27] << 25) | (s[26] >>> 7);
    b6 = (s[36] << 21) | (s[37] >>> 11); b7 = (s[37] << 21) | (s[36] >>> 11); b38 = (s[47] << 24) | (s[46] >>> 8); b39 = (s[46] << 24) | (s[47] >>> 8);
    b30 = (s[8] << 27) | (s[9] >>> 5); b31 = (s[9] << 27) | (s[8] >>> 5); b12 = (s[18] << 20) | (s[19] >>> 12); b13 = (s[19] << 20) | (s[18] >>> 12);
    b44 = (s[29] << 7) | (s[28] >>> 25); b45 = (s[28] << 7) | (s[29] >>> 25); b26 = (s[38] << 8) | (s[39] >>> 24); b27 = (s[39] << 8) | (s[38] >>> 24);
    b8 = (s[48] << 14) | (s[49] >>> 18); b9 = (s[49] << 14) | (s[48] >>> 18);
    s[0] = b0 ^ (~b2 & b4); s[1] = b1 ^ (~b3 & b5); s[10] = b10 ^ (~b12 & b14); s[11] = b11 ^ (~b13 & b15); s[20] = b20 ^ (~b22 & b24); s[21] = b21 ^ (~b23 & b25);
    s[30] = b30 ^ (~b32 & b34); s[31] = b31 ^ (~b33 & b35); s[40] = b40 ^ (~b42 & b44); s[41] = b41 ^ (~b43 & b45);
    s[2] = b2 ^ (~b4 & b6); s[3] = b3 ^ (~b5 & b7); s[12] = b12 ^ (~b14 & b16); s[13] = b13 ^ (~b15 & b17); s[22] = b22 ^ (~b24 & b26); s[23] = b23 ^ (~b25 & b27);
    s[32] = b32 ^ (~b34 & b36); s[33] = b33 ^ (~b35 & b37); s[42] = b42 ^ (~b44 & b46); s[43] = b43 ^ (~b45 & b47);
    s[4] = b4 ^ (~b6 & b8); s[5] = b5 ^ (~b7 & b9); s[14] = b14 ^ (~b16 & b18); s[15] = b15 ^ (~b17 & b19); s[24] = b24 ^ (~b26 & b28); s[25] = b25 ^ (~b27 & b29);
    s[34] = b34 ^ (~b36 & b38); s[35] = b35 ^ (~b37 & b39); s[44] = b44 ^ (~b46 & b48); s[45] = b45 ^ (~b47 & b49);
    s[6] = b6 ^ (~b8 & b0); s[7] = b7 ^ (~b9 & b1); s[16] = b16 ^ (~b18 & b10); s[17] = b17 ^ (~b19 & b11); s[26] = b26 ^ (~b28 & b20); s[27] = b27 ^ (~b29 & b21);
    s[36] = b36 ^ (~b38 & b30); s[37] = b37 ^ (~b39 & b31); s[46] = b46 ^ (~b48 & b40); s[47] = b47 ^ (~b49 & b41);
    s[8] = b8 ^ (~b0 & b2); s[9] = b9 ^ (~b1 & b3); s[18] = b18 ^ (~b10 & b12); s[19] = b19 ^ (~b11 & b13); s[28] = b28 ^ (~b20 & b22); s[29] = b29 ^ (~b21 & b23);
    s[38] = b38 ^ (~b30 & b32); s[39] = b39 ^ (~b31 & b33); s[48] = b48 ^ (~b40 & b42); s[49] = b49 ^ (~b41 & b43);
    s[0] ^= _KRC[n]; s[1] ^= _KRC[n + 1];
  }
}
function keccak256(bytes) {
  const rate = 136;
  const s = new Array(50).fill(0);
  const len = bytes.length;
  const padded = new Uint8Array(Math.ceil((len + 1) / rate) * rate);
  padded.set(bytes);
  padded[len] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 4; i++) {
      s[i] ^= padded[off + i * 4] | (padded[off + i * 4 + 1] << 8) | (padded[off + i * 4 + 2] << 16) | (padded[off + i * 4 + 3] << 24);
    }
    _keccakf(s);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    const v = s[i];
    out[i * 4] = v & 0xff; out[i * 4 + 1] = (v >>> 8) & 0xff; out[i * 4 + 2] = (v >>> 16) & 0xff; out[i * 4 + 3] = (v >>> 24) & 0xff;
  }
  return out;
}

// ---- secp256k1 ecrecover ----
const _P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const _N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const _GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const _GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;
function _mod(a, m) { return ((a % m) + m) % m; }
function _inv(a, m) {
  let [lm, hm] = [1n, 0n], [low, high] = [_mod(a, m), m];
  while (low > 1n) {
    const r = high / low;
    [lm, hm] = [hm - lm * r, lm];
    [low, high] = [high - low * r, low];
  }
  return _mod(lm, m);
}
// Jacobian point ops on secp256k1 (a=0).
function _jDouble(p) {
  const [x, y, z] = p;
  if (y === 0n) return [0n, 0n, 0n];
  const ysq = _mod(y * y, _P);
  const s = _mod(4n * x * ysq, _P);
  const m = _mod(3n * x * x, _P);
  const nx = _mod(m * m - 2n * s, _P);
  const ny = _mod(m * (s - nx) - 8n * ysq * ysq, _P);
  const nz = _mod(2n * y * z, _P);
  return [nx, ny, nz];
}
function _jAdd(p, q) {
  if (p[2] === 0n) return q;
  if (q[2] === 0n) return p;
  const [x1, y1, z1] = p, [x2, y2, z2] = q;
  const z1z1 = _mod(z1 * z1, _P), z2z2 = _mod(z2 * z2, _P);
  const u1 = _mod(x1 * z2z2, _P), u2 = _mod(x2 * z1z1, _P);
  const s1 = _mod(y1 * z2 * z2z2, _P), s2 = _mod(y2 * z1 * z1z1, _P);
  if (u1 === u2) return s1 === s2 ? _jDouble(p) : [0n, 0n, 0n];
  const h = _mod(u2 - u1, _P), r = _mod(s2 - s1, _P);
  const hh = _mod(h * h, _P), hhh = _mod(h * hh, _P);
  const nx = _mod(r * r - hhh - 2n * u1 * hh, _P);
  const ny = _mod(r * (u1 * hh - nx) - s1 * hhh, _P);
  const nz = _mod(h * z1 * z2, _P);
  return [nx, ny, nz];
}
function _jMul(k, p) {
  let r = [0n, 0n, 0n], a = p;
  while (k > 0n) { if (k & 1n) r = _jAdd(r, a); a = _jDouble(a); k >>= 1n; }
  return r;
}
function _toAffine(p) {
  if (p[2] === 0n) return null;
  const zi = _inv(p[2], _P), zi2 = _mod(zi * zi, _P);
  return [_mod(p[0] * zi2, _P), _mod(p[1] * zi2 * zi, _P)];
}
// Recover the 20-byte Ethereum address from a 32-byte msgHash and 65-byte sig.
function ecrecoverAddress(msgHash, sig) {
  if (sig.length !== 65) return null;
  const r = _bytesToBig(sig.slice(0, 32));
  const s = _bytesToBig(sig.slice(32, 64));
  let v = sig[64];
  if (v >= 27) v -= 27;
  if (v !== 0 && v !== 1) return null;
  if (r <= 0n || r >= _N || s <= 0n || s >= _N) return null;
  const z = _bytesToBig(msgHash);
  // R point from r (x-coord), y parity = v.
  const x = r;
  let ySq = _mod(x * x * x + 7n, _P);
  let y = _modSqrt(ySq, _P);
  if (y === null) return null;
  if ((y & 1n) !== BigInt(v)) y = _P - y;
  const R = [x, y, 1n];
  const rInv = _inv(r, _N);
  // Q = r^-1 (sR - zG)
  const sR = _jMul(_mod(s, _N), R);
  const zG = _jMul(_mod(z, _N), [_GX, _GY, 1n]);
  const zGneg = [zG[0], _mod(-zG[1], _P), zG[2]];
  const Q = _jMul(rInv, _jAdd(sR, zGneg));
  const aff = _toAffine(Q);
  if (!aff) return null;
  const pub = new Uint8Array(64);
  _bigToBytes(aff[0], 32).forEach((b, i) => pub[i] = b);
  _bigToBytes(aff[1], 32).forEach((b, i) => pub[32 + i] = b);
  const h = keccak256(pub);
  return "0x" + [...h.slice(12)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function _bytesToBig(b) { let x = 0n; for (const v of b) x = (x << 8n) | BigInt(v); return x; }
function _bigToBytes(x, len) {
  const out = new Uint8Array(len);
  for (let i = len - 1; i >= 0; i--) { out[i] = Number(x & 0xffn); x >>= 8n; }
  return out;
}
// Tonelli–Shanks not needed: secp256k1 p ≡ 3 (mod 4), so sqrt = a^((p+1)/4).
function _modSqrt(a, p) {
  const r = _modPow(a, (p + 1n) / 4n, p);
  return _mod(r * r, p) === _mod(a, p) ? r : null;
}
function _modPow(b, e, m) {
  let r = 1n; b = _mod(b, m);
  while (e > 0n) { if (e & 1n) r = _mod(r * b, m); e >>= 1n; b = _mod(b * b, m); }
  return r;
}
// Verify an EIP-191 personal_sign signature; returns recovered lowercase address.
function recoverPersonalSign(message, signatureHex) {
  const msgBytes = new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode("\x19Ethereum Signed Message:\n" + msgBytes.length);
  const full = new Uint8Array(prefix.length + msgBytes.length);
  full.set(prefix); full.set(msgBytes, prefix.length);
  const hash = keccak256(full);
  const sig = _hexToBytes(signatureHex);
  return ecrecoverAddress(hash, sig);
}
function _hexToBytes(hex) {
  const h = hex.replace(/^0x/, "");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const MODELS_URL = OPENROUTER_BASE + "/models";
const CHAT_URL = OPENROUTER_BASE + "/chat/completions";

// How many free models to try per request before giving up.
const MAX_TRIES = 5;
// Daily free-request cap per device fingerprint. The fingerprint combines the
// caller's IP and User-Agent (NOT cid — that would reset on reinstall). This
// survives a reinstall: uninstalling the extension wipes its local counter, but
// the same IP+UA still maps to the same server-side record, so the limit holds.
// (Not unbeatable — a VPN/new network changes the IP — but it stops the trivial
//  "remove & reinstall" reset.)
const DAILY_LIMIT = 25;
// Cache the free-model list this long (seconds) to avoid refetching every call.
const MODELS_CACHE_TTL = 3600;

// Prefer larger / more capable free models first. Anything matching these hints
// (in order) floats to the top; the rest follow. Purely heuristic.
const PREFER = ["gemma-4-31b", "gpt-oss", "nemotron-3-super", "gemma-4", "nemotron", "llama", "qwen", "mistral"];

// ===== x402-style payments (Arc testnet) =====
// Paid modes ("analyze"/"sentiment") keep working after the free daily limit if
// the user has credits. Credits are bought on GET /pay: the user sends testnet
// USDC on Arc (chain 5042002) to PAY_TO via MetaMask, then the tx hash is
// verified here over plain JSON-RPC (no crypto libs needed) and credits are
// granted to the caller's IP fingerprint. Switching to Base mainnet later is a
// config change (ARC_RPC_URL / USDC_ADDRESS / CHAIN_ID vars).
//
// Extra bindings (all optional — without PAY_TO the paid path is disabled and
// over-limit paid modes just get the usual 429):
//   - Var PAY_TO        = treasury address receiving USDC
//   - Var ARC_RPC_URL   = RPC endpoint (default: Arc testnet)
//   - Var USDC_ADDRESS  = USDC token contract (default: Arc testnet tUSDC)
//   - Var CHAIN_ID      = decimal chain id (default: 5042002)
const ARC_RPC_DEFAULT = "https://rpc.testnet.arc.network";
const ARC_USDC_DEFAULT = "0x3600000000000000000000000000000000000000";
const ARC_CHAIN_DEFAULT = 5042002;
const CREDIT_PACK = 50;               // credits granted per payment
const PACK_PRICE_UNITS = "250000";    // $0.25 in 6-decimal USDC units
const PAID_MODES = ["analyze", "sentiment", "improve"];
// keccak256("Transfer(address,address,uint256)") — standard ERC-20 event topic.
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function payConfig(env) {
  if (!env.PAY_TO) return null;
  return {
    payTo: env.PAY_TO.toLowerCase(),
    rpcUrl: env.ARC_RPC_URL || ARC_RPC_DEFAULT,
    usdc: (env.USDC_ADDRESS || ARC_USDC_DEFAULT).toLowerCase(),
    chainId: parseInt(env.CHAIN_ID, 10) || ARC_CHAIN_DEFAULT,
  };
}

// ===== Wallet linking (no in-worker ECDSA) =====
// Credits are keyed by wallet address. To let the extension (running on x.com)
// prove which wallet it owns without shipping an elliptic-curve library into a
// Worker, we use a link-token handshake performed on the /pay page, which
// already holds the wallet via MetaMask:
//   1) extension opens /pay#link=<random cid the extension generated>
//   2) user signs "Link this device (cid) to <addr>" — signature is verified by
//      the RPC node's personal_ecRecover (delegated ECDSA), binding cid↔addr.
//   3) worker stores link:<cid> = addr, and hands the extension a bearer token
//      = HMAC(cid) that it sends as x-pascual-addr-token on future calls.
// A stolen cid is useless without also passing the HMAC, and the HMAC is only
// ever returned to the page that proved wallet ownership.
async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// Resolve the caller's verified wallet address from the bearer token, or null.
// Token format: "<cid>.<hmac>"; we recompute the HMAC and look up link:<cid>.
async function verifiedAddress(env, request) {
  if (!env.LINK_SECRET) return null;
  const tok = request.headers.get("x-pascual-addr-token") || "";
  const dot = tok.lastIndexOf(".");
  if (dot < 1) return null;
  const cid = tok.slice(0, dot);
  const mac = tok.slice(dot + 1);
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(cid) || !/^[0-9a-f]{64}$/.test(mac)) return null;
  const expect = await hmacHex(env.LINK_SECRET, cid);
  // Constant-time-ish compare (lengths are fixed here).
  if (mac.length !== expect.length) return null;
  let diff = 0;
  for (let i = 0; i < mac.length; i++) diff |= mac.charCodeAt(i) ^ expect.charCodeAt(i);
  if (diff !== 0) return null;
  const addr = await redisRaw(env, `get/${encodeURIComponent("pr:link:" + cid)}`);
  return (typeof addr === "string" && /^0x[0-9a-f]{40}$/.test(addr)) ? addr : null;
}

// Build the x402 402-response body (payment required / wallet not linked).
function payRequired(cfg, request, addr) {
  const payUrl = new URL("/pay", request.url).toString();
  return {
    error: addr
      ? `No analyze credits left. Buy ${CREDIT_PACK} credits for USDC. / Кредиты анализа закончились. Купите ${CREDIT_PACK} кредитов за USDC.`
      : `Link a wallet and buy ${CREDIT_PACK} credits for USDC to keep analyzing. / Привяжите кошелёк и купите ${CREDIT_PACK} кредитов за USDC.`,
    x402Version: 1,
    payUrl,
    wallet: addr || null,
    accepts: [{
      scheme: "exact",
      network: "arc-testnet",
      chainId: cfg.chainId,
      asset: cfg.usdc,
      payTo: cfg.payTo,
      maxAmountRequired: PACK_PRICE_UNITS,
      description: `${CREDIT_PACK} Pascual Reply Pro analyze credits`,
    }],
  };
}

async function rpcCall(rpcUrl, method, params) {
  const resp = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message || "RPC error");
  return data.result;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// SHA-256 hex of the client IP — the rate-limit key.
// We hash ONLY the IP. Earlier attempts mixed in cid and User-Agent, but both
// vary per request from an extension (cid regenerates on reinstall; Chrome bumps
// its UA version string), which silently created a fresh counter each time — the
// "it keeps resetting" bug. The IP is the one signal the client can't trivially
// change, so it's the stable key. (A VPN/new network still gets a new bucket —
// unavoidable without user login — but reinstalls and UA changes no longer reset.)
async function fingerprint(ip) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(ip)));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// Atomic counter via Upstash Redis REST. Cloudflare KV is eventually-consistent
// and loses/races per-request increments, so it can't gate a hard daily limit.
// Redis INCR is atomic and strongly consistent. Returns the new count, or null
// if Upstash isn't configured / unreachable (caller then fails open).
async function redisIncr(env, key, ttlSeconds) {
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) return null;
  const base = env.UPSTASH_REDIS_REST_URL.replace(/\/$/, "");
  const headers = { "Authorization": `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}` };
  try {
    const incr = await fetch(`${base}/incr/${encodeURIComponent(key)}`, { headers });
    const data = await incr.json();
    const count = typeof data.result === "number" ? data.result : parseInt(data.result, 10);
    // Set expiry only on first hit (count === 1) so the window is a rolling day.
    if (count === 1 && ttlSeconds) {
      await fetch(`${base}/expire/${encodeURIComponent(key)}/${ttlSeconds}`, { headers });
    }
    return count;
  } catch (_) {
    return null;
  }
}

// Generic Upstash REST command (path segments are URL-encoded by the caller as
// needed). Returns the raw result or null if Redis isn't configured/reachable.
async function redisRaw(env, path) {
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) return null;
  const base = env.UPSTASH_REDIS_REST_URL.replace(/\/$/, "");
  try {
    const r = await fetch(`${base}/${path}`, {
      headers: { "Authorization": `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}` },
    });
    const data = await r.json();
    return data.result;
  } catch (_) {
    return null;
  }
}

// Read current count without incrementing (for the pre-check).
async function redisGet(env, key) {
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) return null;
  const base = env.UPSTASH_REDIS_REST_URL.replace(/\/$/, "");
  try {
    const r = await fetch(`${base}/get/${encodeURIComponent(key)}`, {
      headers: { "Authorization": `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}` },
    });
    const data = await r.json();
    return data.result == null ? 0 : parseInt(data.result, 10) || 0;
  } catch (_) {
    return null;
  }
}

// Fetch the current list of free (price 0) chat models, cached via Cache API.
async function getFreeModels(apiKey, ctx) {
  const cache = caches.default;
  const cacheKey = new Request("https://pascual-reply.cache/free-models");
  const cached = await cache.match(cacheKey);
  if (cached) {
    try { return await cached.json(); } catch (_) {}
  }

  const resp = await fetch(MODELS_URL, {
    headers: { "Authorization": `Bearer ${apiKey}` },
  });
  if (!resp.ok) return [];
  const data = await resp.json();

  const free = [];
  for (const m of data.data || []) {
    const p = m.pricing || {};
    const prompt = parseFloat(p.prompt || "1");
    const completion = parseFloat(p.completion || "1");
    const id = m.id || "";
    // Free text models only. Skip audio/image/preview endpoints.
    if (prompt === 0 && completion === 0 && id.endsWith(":free")) {
      free.push(id);
    }
  }

  // Sort by preference hints.
  free.sort((a, b) => {
    const ra = PREFER.findIndex(h => a.includes(h));
    const rb = PREFER.findIndex(h => b.includes(h));
    return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb);
  });

  // Cache the result.
  const toCache = new Response(JSON.stringify(free), {
    headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${MODELS_CACHE_TTL}` },
  });
  if (ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheKey, toCache));
  else await cache.put(cacheKey, toCache);

  return free;
}

// The /pay page: MetaMask → switch to Arc testnet → ERC-20 transfer of USDC to
// the treasury → submit the tx hash back to /pay/submit for verification.
function payPageHtml(cfg) {
  const chainHex = "0x" + cfg.chainId.toString(16);
  const price = (parseInt(PACK_PRICE_UNITS, 10) / 1e6).toFixed(2);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Pascual Reply Pro — Credits</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0f0c16;color:#f2f0f7;display:flex;min-height:100vh;align-items:center;justify-content:center}
  .card{width:380px;max-width:92vw;background:#16121f;border:1px solid rgba(139,92,246,.45);border-radius:16px;padding:28px;box-shadow:0 12px 40px rgba(0,0,0,.55)}
  h1{font-size:18px;margin:0 0 6px}
  .sub{color:#9b93ad;font-size:13px;margin-bottom:18px}
  .row{display:flex;justify-content:space-between;font-size:13px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.06)}
  .row b{font-family:monospace}
  button{width:100%;margin-top:18px;padding:12px;border:none;border-radius:10px;font-size:14px;font-weight:700;color:#fff;cursor:pointer;background:linear-gradient(135deg,#8b5cf6 0%,#e94560 100%)}
  button:disabled{opacity:.5;cursor:default}
  #status{margin-top:14px;font-size:13px;line-height:1.5;min-height:20px;color:#c9c2da;word-break:break-all}
  .ok{color:#6ee7a0}.err{color:#ff8080}
</style></head><body><div class="card">
<h1>✦ Analyze Credits</h1>
<div class="sub">Pay-per-use analysis, settled in USDC on Arc Testnet. No subscription, no card.</div>
<div class="row"><span>Credits</span><b>${CREDIT_PACK} analyses</b></div>
<div class="row"><span>Price</span><b>$${price} tUSDC</b></div>
<div class="row"><span>Network</span><b>Arc Testnet (${cfg.chainId})</b></div>
<button id="payBtn">Pay with wallet</button>
<div id="status"></div>
</div>
<script>
const CFG = ${JSON.stringify({ chainHex, usdc: cfg.usdc, payTo: cfg.payTo, amount: PACK_PRICE_UNITS })};
const S = document.getElementById('status');
const set = (m, cls) => { S.textContent = m; S.className = cls || ''; };
function pad32(hex) { return hex.replace(/^0x/, '').toLowerCase().padStart(64, '0'); }
function hexMsg(s) { return '0x' + Array.from(new TextEncoder().encode(s)).map(b => b.toString(16).padStart(2,'0')).join(''); }

// cid is passed by the extension in the URL hash (#link=<cid>). If present, we
// link this wallet to that device so credits attach to the right identity.
function getCid() {
  const m = (location.hash || '').match(/link=([A-Za-z0-9_-]{8,128})/);
  return m ? m[1] : null;
}

async function ensureChain() {
  try {
    await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CFG.chainHex }] });
  } catch (e) {
    if (e.code === 4902) {
      await ethereum.request({ method: 'wallet_addEthereumChain', params: [{
        chainId: CFG.chainHex, chainName: 'Arc Testnet',
        nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
        rpcUrls: ['https://rpc.testnet.arc.network'],
        blockExplorerUrls: ['https://testnet.arcscan.app']
      }] });
    } else throw e;
  }
}

// Link the connected wallet to this device (signature → /pay/claim → token).
async function linkWallet(from) {
  const cid = getCid();
  if (!cid) return; // opened directly (not from the extension) — skip linking
  const message = 'Pascual Reply Pro — link this device to ' + from.toLowerCase() + '\\ncid: ' + cid;
  set('Sign the (free) link message in your wallet…');
  const signature = await ethereum.request({ method: 'personal_sign', params: [hexMsg(message), from] });
  const resp = await fetch('/pay/claim', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cid, address: from.toLowerCase(), signature })
  });
  const res = await resp.json().catch(() => ({}));
  if (!resp.ok || !res.token) throw new Error(res.error || 'Wallet link failed');
  // The extension knows the cid and polls /pay/link-status to fetch this same
  // token — no cross-origin storage needed.
  return res.token;
}

document.getElementById('payBtn').onclick = async () => {
  const btn = document.getElementById('payBtn');
  try {
    if (!window.ethereum) { set('No wallet found. Install MetaMask.', 'err'); return; }
    btn.disabled = true;
    set('Connecting wallet…');
    const [from] = await ethereum.request({ method: 'eth_requestAccounts' });
    await ensureChain();
    let token = null;
    try { token = await linkWallet(from); } catch (e) { set(e.message || 'Link failed', 'err'); btn.disabled = false; return; }
    set('Confirm the USDC transfer in your wallet…');
    const data = '0xa9059cbb' + pad32(CFG.payTo) + pad32(BigInt(CFG.amount).toString(16));
    const txHash = await ethereum.request({ method: 'eth_sendTransaction', params: [{ from, to: CFG.usdc, data }] });
    set('Tx sent: ' + txHash + ' — verifying (may take ~10s)…');
    const headers = { 'Content-Type': 'application/json' };
    const cid = getCid();
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const resp = await fetch('/pay/submit', { method: 'POST', headers, body: JSON.stringify({ txHash, cid }) });
      const res = await resp.json().catch(() => ({}));
      if (resp.ok) { set('✓ Payment confirmed! ' + res.credits + ' credits added to your wallet. Close this tab and analyze away.', 'ok'); return; }
      if (resp.status !== 425) { set(res.error || ('Verification failed (HTTP ' + resp.status + ')'), 'err'); btn.disabled = false; return; }
      set('Waiting for confirmation… (' + (i + 1) + ')');
    }
    set('Timed out waiting for the transaction. Reload and try submitting again.', 'err');
    btn.disabled = false;
  } catch (e) {
    set(e && e.message ? e.message : 'Payment cancelled', 'err');
    btn.disabled = false;
  }
};
</script></body></html>`;
}

// Verify a payment tx over JSON-RPC: receipt must be successful and contain a
// USDC Transfer log to the treasury for at least the pack price. Idempotent by
// tx hash (each tx grants credits exactly once) — mirrors the quest-spec rule.
async function handlePaySubmit(request, env) {
  const cfg = payConfig(env);
  if (!cfg) return json({ error: "Payments not configured" }, 501);

  let body;
  try { body = await request.json(); } catch (_) { return json({ error: "Invalid JSON" }, 400); }
  const txHash = String(body?.txHash || "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(txHash)) return json({ error: "Invalid tx hash" }, 400);
  // Optional device id: paying from a wallet already proves ownership, so if the
  // page forwards its cid we bind cid→payer here too. This makes the extension
  // find its token even when the separate sign-to-link step was skipped.
  const cid = String(body?.cid || "");
  const cidValid = /^[a-zA-Z0-9_-]{8,128}$/.test(cid);

  let receipt;
  try { receipt = await rpcCall(cfg.rpcUrl, "eth_getTransactionReceipt", [txHash]); }
  catch (e) { return json({ error: "RPC error: " + e.message }, 502); }
  // 425 = not mined yet — the page keeps polling.
  if (!receipt) return json({ error: "Transaction not confirmed yet" }, 425);
  if (receipt.status !== "0x1") return json({ error: "Transaction reverted" }, 400);

  // Find the USDC Transfer to the treasury and capture its `from` (the payer).
  // Credits are bound to the PAYER address, never to the submitter's IP — a tx
  // hash is public on-chain data, so anyone could POST someone else's hash. The
  // real payer proves ownership by signing a challenge (see /pay/claim); here we
  // just record which address the credits belong to.
  const wanted = BigInt(PACK_PRICE_UNITS);
  let payer = null;
  for (const log of (receipt.logs || [])) {
    if ((log.address || "").toLowerCase() !== cfg.usdc) continue;
    if ((log.topics?.[0] || "").toLowerCase() !== TRANSFER_TOPIC) continue;
    const to = "0x" + (log.topics?.[2] || "").slice(-40).toLowerCase();
    if (to !== cfg.payTo) continue;
    let amountOk = false;
    try { amountOk = BigInt(log.data) >= wanted; } catch (_) { amountOk = false; }
    if (!amountOk) continue;
    payer = "0x" + (log.topics?.[1] || "").slice(-40).toLowerCase();
    break;
  }
  if (!payer || payer === "0x") {
    return json({ error: "No matching USDC transfer to treasury found in this transaction" }, 400);
  }

  // Atomic-order redemption. The write order is: (1) grant credits to the payer,
  // (2) mark the tx redeemed. If step 2's SETNX loses (someone already redeemed),
  // we roll the credit back. If step 1 fails, the tx stays un-redeemed so the
  // page can retry — the user never pays and gets nothing.
  const creditsKey = `pr:credits:addr:${payer}`;
  const granted = await redisRaw(env, `incrby/${encodeURIComponent(creditsKey)}/${CREDIT_PACK}`);
  if (granted == null) {
    // Credit store unreachable — do NOT mark redeemed; user retries.
    return json({ error: "Credit store unavailable, try again in a moment" }, 503);
  }

  // SETNX the idempotency marker. Upstash /setnx returns 1 if set, 0 if it
  // already existed. TTL 90 days via a follow-up expire on first set.
  const setnx = await redisRaw(env, `setnx/${encodeURIComponent("pr:tx:" + txHash)}/1`);
  if (setnx === 1) {
    await redisRaw(env, `expire/${encodeURIComponent("pr:tx:" + txHash)}/7776000`);
    // Bind this device to the paying wallet so the extension can read the balance.
    if (cidValid && env.LINK_SECRET) {
      await redisRaw(env, `set/${encodeURIComponent("pr:link:" + cid)}/${encodeURIComponent(payer)}`);
      await redisRaw(env, `expire/${encodeURIComponent("pr:link:" + cid)}/7776000`);
    }
    return json({ ok: true, payer, credits: CREDIT_PACK, totalCredits: granted });
  }
  if (setnx === 0) {
    // Already redeemed — undo the credit we just added and report it.
    await redisRaw(env, `decrby/${encodeURIComponent(creditsKey)}/${CREDIT_PACK}`);
    return json({ error: "This transaction was already redeemed" }, 409);
  }
  // setnx null (store hiccup) — undo credit, ask to retry (tx not marked).
  await redisRaw(env, `decrby/${encodeURIComponent(creditsKey)}/${CREDIT_PACK}`);
  return json({ error: "Credit store unavailable, try again in a moment" }, 503);
}

// Verify a wallet-link signature and bind cid↔address. The signature is checked
// by the RPC node (personal_ecRecover) so no ECDSA library is needed here.
async function handlePayClaim(request, env) {
  if (!env.LINK_SECRET) return json({ error: "Wallet linking not configured" }, 501);
  const cfg = payConfig(env);
  if (!cfg) return json({ error: "Payments not configured" }, 501);

  let body;
  try { body = await request.json(); } catch (_) { return json({ error: "Invalid JSON" }, 400); }
  const cid = String(body?.cid || "");
  const address = String(body?.address || "").toLowerCase();
  const signature = String(body?.signature || "");
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(cid)) return json({ error: "Bad cid" }, 400);
  if (!/^0x[0-9a-f]{40}$/.test(address)) return json({ error: "Bad address" }, 400);
  if (!/^0x[0-9a-f]{130}$/.test(signature)) return json({ error: "Bad signature" }, 400);

  // The message the page asked the wallet to sign. Must match pay-page JS.
  const message = `Pascual Reply Pro — link this device to ${address}\ncid: ${cid}`;

  // Recover the signer locally (the Arc reth node has no personal_ecRecover).
  let recovered;
  try {
    recovered = recoverPersonalSign(message, signature);
  } catch (e) {
    return json({ error: "Signature verification error: " + e.message }, 500);
  }
  if (!recovered || recovered.toLowerCase() !== address) {
    return json({ error: "Signature does not match address" }, 400);
  }

  // Bind cid → address (90-day TTL) and return the bearer token to this page.
  await redisRaw(env, `set/${encodeURIComponent("pr:link:" + cid)}/${encodeURIComponent(address)}`);
  await redisRaw(env, `expire/${encodeURIComponent("pr:link:" + cid)}/7776000`);
  const token = cid + "." + await hmacHex(env.LINK_SECRET, cid);
  const credits = await redisGet(env, `pr:credits:addr:${address}`);
  return json({ ok: true, address, token, credits: credits ?? 0 });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    if (url.pathname === "/pay") {
      const cfg = payConfig(env);
      if (!cfg) return json({ error: "Payments not configured" }, 501);
      if (request.method === "GET") {
        return new Response(payPageHtml(cfg), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      return json({ error: "Method not allowed" }, 405);
    }
    if (url.pathname === "/pay/submit" && request.method === "POST") {
      // Note: intentionally NOT behind the Origin/token layers — the payment
      // page itself posts here, and a valid on-chain tx is the authorization.
      return handlePaySubmit(request, env);
    }
    if (url.pathname === "/pay/claim" && request.method === "POST") {
      return handlePayClaim(request, env);
    }
    if (url.pathname === "/pay/link-status" && request.method === "POST") {
      // The extension polls this with its cid; once the user has linked a wallet
      // on the pay page, we return the bearer token (which the extension could
      // compute only with the server secret). Returns {linked:false} until then.
      if (!env.LINK_SECRET) return json({ error: "Wallet linking not configured" }, 501);
      let b; try { b = await request.json(); } catch (_) { return json({ error: "Invalid JSON" }, 400); }
      const cid = String(b?.cid || "");
      if (!/^[a-zA-Z0-9_-]{8,128}$/.test(cid)) return json({ error: "Bad cid" }, 400);
      const addr = await redisRaw(env, `get/${encodeURIComponent("pr:link:" + cid)}`);
      if (typeof addr === "string" && /^0x[0-9a-f]{40}$/.test(addr)) {
        const token = cid + "." + await hmacHex(env.LINK_SECRET, cid);
        const credits = await redisGet(env, `pr:credits:addr:${addr}`);
        return json({ linked: true, address: addr, token, credits: credits ?? 0 });
      }
      return json({ linked: false });
    }

    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

    if (!env.OPENROUTER_KEY) {
      return json({ error: "Worker not configured (OPENROUTER_KEY missing)" }, 500);
    }

    // Layer 1 — Origin allow-list. Only requests from our own extension pass.
    // A real browser cannot spoof the Origin header, so this blocks websites and
    // in-page abuse. Skipped only if ALLOWED_ORIGINS is not configured (dev).
    if (env.ALLOWED_ORIGINS) {
      const origin = request.headers.get("Origin") || "";
      const allowed = env.ALLOWED_ORIGINS.split(",").map(s => s.trim()).filter(Boolean);
      if (!allowed.includes(origin)) {
        return json({ error: "Forbidden" }, 403);
      }
    }

    // Layer 2 — shared secret header.
    if (env.CLIENT_TOKEN) {
      if ((request.headers.get("x-pascual-token") || "") !== env.CLIENT_TOKEN) {
        return json({ error: "Forbidden" }, 403);
      }
    }

    let payload;
    try { payload = await request.json(); }
    catch (_) { return json({ error: "Invalid JSON body" }, 400); }

    // Usage query: return the current server-side count for this IP without
    // generating anything. The popup calls this to show a TRUE remaining count
    // (the extension's local counter is unreliable — it resets on reinstall).
    if (payload && payload.usage === true) {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const day = new Date().toISOString().slice(0, 10);
      const fp = await fingerprint(ip);
      const used = await redisGet(env, `pr:free:${day}:${fp}`);
      // Credits are keyed by the linked wallet address. `credits` stays null
      // (unknown) when no wallet is linked or Redis is unreachable — the client
      // must not render that as a hard 0.
      const addr = await verifiedAddress(env, request);
      let credits = null;
      if (addr) credits = await redisGet(env, `pr:credits:addr:${addr}`);
      return json({ used: used ?? 0, limit: DAILY_LIMIT, credits, wallet: addr || null });
    }

    const { messages, systemPrompt } = payload || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return json({ error: "No messages provided" }, 400);
    }

    // Request kind sent by the extension ("reply" | "analyze" | "sentiment").
    // All modes currently share the same daily limit; the per-mode counter below
    // exists so pricing/limits can diverge later (e.g. x402 pay-per-analyze)
    // without another protocol change. Unknown/missing values collapse to "reply".
    const mode = /^[a-z_]{1,24}$/.test(payload.mode || "") ? payload.mode : "reply";

    // Layer 3 — atomic reservation. We RESERVE the charge up front (before the
    // multi-second LLM call), then refund it if generation ultimately fails. A
    // prior read-then-write gate (GET then INCR after success) is racy: N
    // concurrent requests all read the same pre-limit value and overshoot. INCR
    // returning the post-increment value is the classic atomic rate-limiter.
    let rlKey = null;        // daily free-quota key (refund target if !useCredit)
    let creditsKey = null;   // wallet credit key   (refund target if useCredit)
    let useCredit = false;   // true → this request was charged to credits
    let reserved = false;    // true → we hold a reservation to refund on failure
    {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const day = new Date().toISOString().slice(0, 10);
      const fp = await fingerprint(ip);
      rlKey = `pr:free:${day}:${fp}`;

      // Reserve a free-quota slot atomically.
      const usedNow = await redisIncr(env, rlKey, 172800); // null if Redis off → fail open
      if (usedNow != null && usedNow > DAILY_LIMIT) {
        // Over the free cap. Give the slot back — this request won't use it.
        await redisRaw(env, `decr/${encodeURIComponent(rlKey)}`);
        const cfg = payConfig(env);
        const addr = await verifiedAddress(env, request);
        creditsKey = addr ? `pr:credits:addr:${addr}` : null;

        if (cfg && PAID_MODES.includes(mode) && creditsKey) {
          // Atomically reserve one credit: DECR first, refund if it goes < 0.
          const left = await redisRaw(env, `decr/${encodeURIComponent(creditsKey)}`);
          if (typeof left === "number" && left >= 0) {
            useCredit = true;
            reserved = true;
          } else {
            if (typeof left === "number") {
              await redisRaw(env, `incr/${encodeURIComponent(creditsKey)}`); // undo overshoot
            }
            return json(payRequired(cfg, request, addr), 402);
          }
        } else if (cfg && PAID_MODES.includes(mode) && !creditsKey) {
          // Paid mode but no wallet linked → 402 asking to link + pay.
          return json(payRequired(cfg, request, null), 402);
        } else {
          return json(
            { error: `Daily free limit reached (${DAILY_LIMIT}/${DAILY_LIMIT}). Add your own API key in settings for unlimited use, or link a wallet and buy credits. / Дневной лимит бесплатного режима исчерпан (${DAILY_LIMIT}/${DAILY_LIMIT}). Добавьте свой API-ключ или привяжите кошелёк и купите кредиты.`, limit: DAILY_LIMIT, used: DAILY_LIMIT },
            429
          );
        }
      } else if (usedNow != null) {
        reserved = true; // holding a free-quota slot; refund on failure
      }
    }

    // Refund the reservation (called when generation fails for any reason).
    const refund = async () => {
      if (!reserved) return;
      reserved = false;
      const key = useCredit ? creditsKey : rlKey;
      if (key) await redisRaw(env, `incr/${encodeURIComponent(key)}`);
    };

    const fullMessages = [];
    if (systemPrompt) fullMessages.push({ role: "system", content: systemPrompt });
    fullMessages.push(...messages);

    let models;
    try {
      models = await getFreeModels(env.OPENROUTER_KEY, ctx);
    } catch (e) {
      await refund();
      return json({ error: "Could not load free model list: " + e.message }, 502);
    }
    if (!models.length) {
      await refund();
      return json({ error: "No free models available on OpenRouter right now. Please try again later or add your own API key." }, 502);
    }

    let lastError = "unknown";
    for (const model of models.slice(0, MAX_TRIES)) {
      try {
        const resp = await fetch(CHAT_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${env.OPENROUTER_KEY}`,
            "X-Title": "Pascual Reply",
          },
          body: JSON.stringify({
            model,
            messages: fullMessages,
            max_tokens: 1000,
            temperature: 0.85,
          }),
        });

        const text = await resp.text();
        let data = {};
        try { data = JSON.parse(text); } catch (_) { data = { error: { message: text.slice(0, 200) } }; }

        if (!resp.ok || data.error) {
          lastError = data.error?.message || `HTTP ${resp.status}`;
          continue; // try next model
        }
        const reply = data.choices?.[0]?.message?.content?.trim();
        if (reply) {
          // Success — the charge was already reserved atomically before the call,
          // so nothing is deducted here; we just consume the reservation and
          // report the resulting balance. `reserved` is cleared so no refund runs.
          reserved = false;
          const used = useCredit ? await redisGet(env, rlKey) : await redisGet(env, rlKey);
          const creditsLeft = useCredit ? await redisGet(env, creditsKey) : undefined;
          // Fire-and-forget per-mode stat (not part of the limit) for future
          // per-mode pricing decisions.
          if (ctx && ctx.waitUntil) {
            const day = new Date().toISOString().slice(0, 10);
            ctx.waitUntil(Promise.resolve(redisIncr(env, `pr:mode:${day}:${mode}`, 172800)));
          }
          return json({ reply, used: used ?? undefined, limit: DAILY_LIMIT, credits: creditsLeft ?? undefined });
        }
        lastError = "empty response";
      } catch (e) {
        lastError = e.message;
      }
    }

    await refund();
    return json({ error: `All free models failed. Last error: ${lastError}` }, 502);
  },
};
