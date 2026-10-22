// 小工具：CRC32、SHA-256、数字格式化、HTML 转义、half(float16)->float32 转换

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(bytes) {            // bytes: Uint8Array
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

export async function sha256(data) {       // data: ArrayBuffer / Uint8Array / string
  if (typeof data === 'string') data = new TextEncoder().encode(data);
  if (!(data instanceof Uint8Array)) data = new Uint8Array(data);
  // crypto.subtle 只在 https 或 localhost 下存在；通过普通 http 的局域网地址打开时，用下面手写的版本
  const h = globalThis.crypto?.subtle ? new Uint8Array(await crypto.subtle.digest('SHA-256', data)) : sha256Js(data);
  return [...h].map(b => b.toString(16).padStart(2, '0')).join('');
}
// 纯 JavaScript 的 SHA-256（标准算法：64 轮压缩函数）
const K = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
export function sha256Js(msg) {
  const n = msg.length, padded = new Uint8Array(((n + 9 + 63) >> 6) << 6), dv = new DataView(padded.buffer);
  padded.set(msg); padded[n] = 0x80; dv.setUint32(padded.length - 4, n * 8 >>> 0); dv.setUint32(padded.length - 8, Math.floor(n / 0x20000000));
  const H = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]), w = new Uint32Array(64);
  const rr = (x, k) => (x >>> k) | (x << (32 - k));
  for (let o = 0; o < padded.length; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) { const a = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3), b = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10); w[i] = (w[i - 16] + a + w[i - 7] + b) | 0; }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0, t2 = ((rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  const out = new Uint8Array(32), ov = new DataView(out.buffer); H.forEach((v, i) => ov.setUint32(i * 4, v)); return out;
}

export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const pct = (v, d = 1) => (v * 100).toFixed(d) + '%';
export const kb = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

// float16 -> float32（浏览器没有内置的 Float16Array，这里手动转）
export function halfToFloat(buf) {
  const u = new Uint16Array(buf.buffer ?? buf, buf.byteOffset ?? 0, (buf.byteLength ?? buf.length) / 2);
  const out = new Float32Array(u.length);
  for (let i = 0; i < u.length; i++) {
    const h = u[i], e = (h >> 10) & 31, m = h & 1023, s = h & 0x8000 ? -1 : 1;
    out[i] = e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15);
  }
  return out;
}
