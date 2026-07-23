// Shared crypto (keccak-256 + secp256k1 ecrecover), extracted from reply-x-pro worker.
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
export { keccak256, ecrecoverAddress, recoverPersonalSign };
