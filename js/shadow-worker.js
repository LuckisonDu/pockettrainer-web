// 影子 Worker：收到权重 + 一批数据，用朴素版（mlp_ref.js）算出更新量，原样送回。
import { gradientRef } from './mlp_ref.js';
onmessage = e => {
  const { p, xb, yb, D, H, C } = e.data;
  const r = gradientRef(p, D, H, C, xb, yb, Int32Array.from(yb, (_, i) => i));
  postMessage({ g: r.g, loss: r.loss }, [r.g.buffer]);
};
