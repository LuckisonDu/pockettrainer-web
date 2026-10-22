// "影子"实现：和 mlp.js 算同一件事，但写法完全不同 —— 逐个样本、逐个神经元、按教科书公式，用 64 位 Number 累加。
// 保护机制就是拿它重算同一步，和快速版的更新量比较（余弦距离 > 1e-4 就丢弃）。
// 慢一点没关系：它跑在另一个 Web Worker 里，和快速版同时算。

export function gradientRef(p, D, H, C, x, y, idx) {
  const n = idx.length, b1 = H * D, w2 = b1 + H, b2 = w2 + C * H;
  const g = new Float64Array(p.length);          // 注意：这里用 64 位累加
  let loss = 0;
  for (let s = 0; s < n; s++) {                  // 一个样本一个样本地算
    const xo = idx[s] * D, label = y[idx[s]];
    const h = new Float64Array(H), z = new Float64Array(C);
    for (let j = 0; j < H; j++) {
      let a = p[b1 + j];
      for (let i = 0; i < D; i++) a += p[j * D + i] * x[xo + i];
      h[j] = Math.max(a, 0);
    }
    for (let k = 0; k < C; k++) {
      let a = p[b2 + k];
      for (let j = 0; j < H; j++) a += p[w2 + k * H + j] * h[j];
      z[k] = a;
    }
    const mx = Math.max(...z);
    const e = Array.from(z, v => Math.exp(v - mx));
    const sum = e.reduce((u, v) => u + v, 0);
    loss += Math.log(sum) + mx - z[label];
    const dz = e.map((v, k) => (v / sum - (k === label ? 1 : 0)) / n);
    for (let k = 0; k < C; k++) {
      g[b2 + k] += dz[k];
      for (let j = 0; j < H; j++) g[w2 + k * H + j] += dz[k] * h[j];
    }
    for (let j = 0; j < H; j++) {
      if (h[j] <= 0) continue;                   // ReLU 关着的神经元没有梯度
      let d = 0;
      for (let k = 0; k < C; k++) d += dz[k] * p[w2 + k * H + j];
      g[b1 + j] += d;
      for (let i = 0; i < D; i++) g[j * D + i] += d * x[xo + i];
    }
  }
  return { g: Float32Array.from(g), loss: loss / n };
}
