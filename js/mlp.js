// 两层神经网络（MLP）：D 个输入 -> H 个隐藏单元(ReLU) -> C 个类别。纯 JavaScript，没有任何机器学习库。
// 所有权重放在一个 Float32Array 里，排列顺序：W1 [H*D] | b1 [H] | W2 [C*H] | b2 [C]
// 这是"快速路径"实现（循环展开、按行连续访问）。影子校验用的"朴素版"在 mlp_ref.js，写法完全不同。

export const paramSize = (D, H, C) => H * D + H + C * H + C;

// 固定种子的随机数（mulberry32）：同一个 seed 永远给出同样的序列 => 结果可复现
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// He 初始化：高斯随机数（Box-Muller）乘 sqrt(2/输入数)
export function initParams(D, H, C, seed) {
  const r = rng(seed * 7919 + 13), p = new Float32Array(paramSize(D, H, C));
  const gauss = () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
  const s1 = Math.sqrt(2 / D), s2 = Math.sqrt(2 / H), w2 = H * D + H;
  for (let i = 0; i < H * D; i++) p[i] = gauss() * s1;
  for (let i = 0; i < C * H; i++) p[w2 + i] = gauss() * s2;
  return p;
}

// 前向：n 个样本 -> hid[n*H]（ReLU 之后）、logits[n*C]
export function forward(p, D, H, C, x, xo0, n, hid, logits) {
  const b1 = H * D, w2 = b1 + H, b2 = w2 + C * H;
  for (let b = 0; b < n; b++) {
    const xo = xo0 + b * D;
    for (let j = 0; j < H; j++) {
      const wo = j * D;
      let s0 = 0, s1 = 0, s2 = 0, s3 = 0, i = 0;
      for (; i + 3 < D; i += 4) {           // 4 个累加器：让 CPU 流水线更满
        s0 += p[wo + i] * x[xo + i];
        s1 += p[wo + i + 1] * x[xo + i + 1];
        s2 += p[wo + i + 2] * x[xo + i + 2];
        s3 += p[wo + i + 3] * x[xo + i + 3];
      }
      for (; i < D; i++) s0 += p[wo + i] * x[xo + i];
      const v = p[b1 + j] + s0 + s1 + s2 + s3;
      hid[b * H + j] = v > 0 ? v : 0;      // ReLU
    }
    for (let k = 0; k < C; k++) {
      let s = p[b2 + k];
      for (let j = 0; j < H; j++) s += p[w2 + k * H + j] * hid[b * H + j];
      logits[b * C + k] = s;
    }
  }
}

// 梯度（"更新量"）：写进 g（和 p 同样排列），返回这一批的平均交叉熵损失。
// x 是整张数据表，idx 是这一批用到的样本编号（数据不用拷贝）。
export function gradient(p, D, H, C, x, y, idx, g) {
  const n = idx.length, b1 = H * D, w2 = b1 + H, b2 = w2 + C * H;
  const xb = new Float32Array(n * D);
  for (let b = 0; b < n; b++) xb.set(x.subarray(idx[b] * D, idx[b] * D + D), b * D);
  const hid = new Float32Array(n * H), logits = new Float32Array(n * C);
  forward(p, D, H, C, xb, 0, n, hid, logits);
  g.fill(0);
  // 1) softmax：输出层误差 dl = (概率 - 正确答案) / n
  const dl = new Float32Array(n * C);
  let loss = 0;
  for (let b = 0; b < n; b++) {
    let mx = logits[b * C];
    for (let k = 1; k < C; k++) if (logits[b * C + k] > mx) mx = logits[b * C + k];
    let sum = 0;
    for (let k = 0; k < C; k++) { const e = Math.exp(logits[b * C + k] - mx); dl[b * C + k] = e; sum += e; }
    const yb = y[idx[b]];
    loss += Math.log(sum) + mx - logits[b * C + yb];
    for (let k = 0; k < C; k++) dl[b * C + k] = (dl[b * C + k] / sum - (k === yb ? 1 : 0)) / n;
  }
  // 2) 输出层梯度，并把误差传回隐藏层 dh
  const dh = new Float32Array(n * H);
  for (let b = 0; b < n; b++) for (let k = 0; k < C; k++) {
    const d = dl[b * C + k];
    g[b2 + k] += d;
    for (let j = 0; j < H; j++) {
      g[w2 + k * H + j] += d * hid[b * H + j];
      dh[b * H + j] += d * p[w2 + k * H + j];
    }
  }
  for (let i = 0; i < n * H; i++) if (hid[i] <= 0) dh[i] = 0;   // ReLU 的导数
  // 3) 第一层梯度（最耗时）：每个隐藏单元一行，逐样本累加 d * x
  for (let j = 0; j < H; j++) {
    const wo = j * D;
    let gb = 0;
    for (let b = 0; b < n; b++) {
      const d = dh[b * H + j];
      if (d === 0) continue;
      gb += d;
      const xo = b * D;
      for (let i = 0; i < D; i++) g[wo + i] += d * xb[xo + i];
    }
    g[b1 + j] = gb;
  }
  return loss / n;
}

// 在测试集上算准确率(0~1)和平均损失。权重坏成 NaN 时一律猜第 0 类（所以约等于 10%）
export function evaluate(p, D, H, C, x, y, n) {
  const chunk = 250, hid = new Float32Array(chunk * H), logits = new Float32Array(chunk * C);
  let right = 0, loss = 0;
  for (let s = 0; s < n; s += chunk) {
    const m = Math.min(chunk, n - s);
    forward(p, D, H, C, x, s * D, m, hid, logits);
    for (let b = 0; b < m; b++) {
      let best = 0, mx = logits[b * C];
      for (let k = 1; k < C; k++) if (logits[b * C + k] > logits[b * C + best]) best = k;
      for (let k = 1; k < C; k++) if (logits[b * C + k] > mx) mx = logits[b * C + k];
      let sum = 0;
      for (let k = 0; k < C; k++) sum += Math.exp(logits[b * C + k] - mx);
      loss += Math.log(sum) + mx - logits[b * C + y[s + b]];
      if (best === y[s + b]) right++;
    }
  }
  return { acc: right / n, loss: loss / n };
}

// 两份更新量的余弦距离：0 = 方向完全一样，越大越不一样。出现 NaN 一律算"不一样"（返回 2）
export function cosineDistance(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const c = dot / (Math.sqrt(na) * Math.sqrt(nb));
  return Number.isNaN(c) ? 2 : 1 - c;
}
