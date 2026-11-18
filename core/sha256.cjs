// SHA-256 of a text (as UTF-8), in hex. Translation cache keys are made with it; written out here
// so the keys are the same wherever the core runs, with no platform's crypto module behind them
// (tests/core-boundary.test.cjs checks it against Node's).
const K = new Uint32Array(64), H0 = new Uint32Array(8);
{
  // The fractional parts of the cube roots (K) and square roots (H0) of the first primes.
  const frac = x => ((x - Math.floor(x)) * 0x100000000) >>> 0;
  let n = 0;
  for (let p = 2; n < 64; p++) {
    let prime = true; for (let d = 2; d * d <= p; d++) if (p % d === 0) { prime = false; break; }
    if (!prime) continue;
    if (n < 8) H0[n] = frac(Math.sqrt(p));
    K[n++] = frac(Math.cbrt(p));
  }
}
const encoder = new TextEncoder();
function sha256(text) {
  const bytes = encoder.encode(String(text)), length = bytes.length, total = ((length + 9 + 63) >> 6) << 6;
  const data = new Uint8Array(total); data.set(bytes); data[length] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(total - 8, Math.floor(length / 0x20000000)); view.setUint32(total - 4, (length << 3) >>> 0);
  const h = Uint32Array.from(H0), w = new Uint32Array(64), rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < total; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      w[i] = (w[i - 16] + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + w[i - 7] + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) >>> 0;
    }
    let [a, b, c, d, e, f, g, k] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (k + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      k = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += k;
  }
  return Array.from(h, x => x.toString(16).padStart(8, '0')).join('');
}
module.exports = { sha256 };
