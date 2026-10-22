// 训练主循环 + 保护（影子校验）+ 原子存档 + 打断注入。在 Web Worker 里运行（train-worker.js 调用它）。
import * as M from './mlp.js';
import { gradientRef } from './mlp_ref.js';
import { crc32 } from './util.js';
import { dbGet, dbSet } from './db.js';

export const BATCH = 128;
export const CHECK_LIMIT = 1e-4;   // 两份更新量的余弦距离超过它 => 判定有错
export const EVAL_EVERY = 13;      // 每 13 步在测试集上测一次（画曲线）

// ---------------- 影子：第二份独立实现，放在另一个 Worker 里同时算 ----------------
export function makeShadow() {
  try {
    const w = new Worker(new URL('./shadow-worker.js', import.meta.url), { type: 'module' });
    let wait;
    w.onmessage = e => wait?.(e.data);
    return {
      mode: 'second worker',
      run: (p, xb, yb, D, H, C) => new Promise(r => { wait = r; w.postMessage({ p, xb, yb, D, H, C }); }),
      close: () => w.terminate(),
    };
  } catch (e) {   // 浏览器不支持嵌套 Worker：退回同线程里先算快速版、再算朴素版
    return { mode: 'same thread', run: async (p, xb, yb, D, H, C) => gradientRef(p, D, H, C, xb, yb, Int32Array.from(yb, (_, i) => i)), close() {} };
  }
}

// ---------------- 原子存档 ----------------
// 两个槽 A / B 轮流写：先写"不是当前有效"的那个槽，读回来校验和通过了，再把指针 ptr 切过去。
// 就算写到一半页面被关，指针仍指着旧的完整存档。
export async function saveCheckpoint(head, params) {
  const hb = new TextEncoder().encode(JSON.stringify(head));
  const buf = new Uint8Array(8 + hb.length + params.byteLength);
  new DataView(buf.buffer).setUint32(0, hb.length);
  buf.set(hb, 8);
  buf.set(new Uint8Array(params.buffer, params.byteOffset, params.byteLength), 8 + hb.length);
  const crc = crc32(buf);
  const ptr = await dbGet('ckpt:ptr');
  const slot = ptr === 'A' ? 'B' : 'A';
  await dbSet('ckpt:' + slot, { buf: buf.buffer, crc });
  const back = await dbGet('ckpt:' + slot);                 // 读回来再算一遍校验和
  if (crc32(new Uint8Array(back.buf)) !== crc) throw new Error('checkpoint verify failed');
  await dbSet('ckpt:ptr', slot);                              // 最后一步：切换指针
}
export async function loadCheckpoint() {
  const slot = await dbGet('ckpt:ptr');
  if (!slot) return null;
  const rec = await dbGet('ckpt:' + slot);
  if (!rec || crc32(new Uint8Array(rec.buf)) !== rec.crc) return null;   // 校验不过 => 当作没有
  const u8 = new Uint8Array(rec.buf), hl = new DataView(rec.buf).getUint32(0);
  const head = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + hl)));
  const params = new Float32Array(rec.buf.slice(8 + hl));
  return { head, params };
}
export const clearCheckpoint = () => dbSet('ckpt:ptr', null);

// ---------------- 每步取哪 128 张图 ----------------
// 每个 epoch 用固定种子洗牌一次 => 续训时顺序和没中断时完全一样
export function epochOrder(n, seed, epoch) {
  const r = M.rng(seed * 1000 + epoch + 1), a = Int32Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------------- 训练 ----------------
// o: {D,C,h,lr,epochs,seed,protect,injectAt,ckptEvery,saveCkpts,project,dataset}  d: 数据  resume: loadCheckpoint() 的结果或 null
// ctx: {emit(msg), control:{injectAt}}   返回最终结果
export async function train(o, d, resume, ctx) {
  const { D, C } = d, H = o.h, emit = ctx.emit;
  const B = Math.min(BATCH, d.nTrain), evalEvery = o.evalEvery ?? EVAL_EVERY;   // 小数据集（如 iris 只有 120 条）一批就是全部
  const perEpoch = Math.floor(d.nTrain / B), total = perEpoch * o.epochs;
  let p, step = 0, curve = [], repairs = 0, elapsed0 = 0;
  if (resume) {
    ({ step, curve, repairs, elapsedMs: elapsed0 } = resume.head);
    p = resume.params;
    emit({ type: 'log', line: `Resumed from step ${step} (checkpoint)` });
  } else p = M.initParams(D, H, C, o.seed);
  const g1 = new Float32Array(p.length);
  const shadow = o.protect ? makeShadow() : null;
  let order = null, orderEpoch = -1, lossSum = 0, lossN = 0, injected = false;
  const t0 = performance.now() - elapsed0;
  ctx.control.injectAt = resume ? -1 : o.injectAt ?? -1;
  while (step < total) {
    const epoch = Math.floor(step / perEpoch);
    if (epoch !== orderEpoch) { order = epochOrder(d.nTrain, o.seed, epoch); orderEpoch = epoch; }
    const idx = order.subarray((step % perEpoch) * B, (step % perEpoch + 1) * B);
    // 影子拿到的是"本步开始前"的权重副本和这一批数据，和快速版同时开算
    let pending = null;
    if (shadow) {
      const xb = new Float32Array(B * D), yb = new Uint8Array(B);
      idx.forEach((s, b) => { xb.set(d.trainX.subarray(s * D, s * D + D), b * D); yb[b] = d.trainY[s]; });
      pending = shadow.run(p.slice(), xb, yb, D, H, C);
    }
    // ① 第一份计算（快速路径）
    lossSum += M.gradient(p, D, H, C, d.trainX, d.trainY, idx, g1); lossN++;
    // 模拟系统打断：把这一步的更新量污染成 NaN（浏览器拿不到真实的 GPU 打断，这是软件模拟）
    if (step === ctx.control.injectAt) { g1.fill(NaN); injected = true; ctx.control.injectAt = -1; emit({ type: 'injected', step: step + 1 }); }
    // ② 保护：比较两份更新量
    if (shadow) {
      const r = await pending;
      let bad = false, tries = 0;
      if (M.cosineDistance(g1, r.g) > CHECK_LIMIT) {
        // 丢掉快速版结果，重算（最多 3 次）；仍然对不上就采用影子的结果
        bad = true;
        for (tries = 1; tries <= 3; tries++) {
          const again = new Float32Array(p.length);
          M.gradient(p, D, H, C, d.trainX, d.trainY, idx, again);
          if (M.cosineDistance(again, r.g) <= CHECK_LIMIT) { g1.set(again); break; }
          if (tries === 3) g1.set(r.g);
        }
        repairs++;
        emit({ type: 'log', line: `⚠ Step ${step + 1}: wrong update detected, discarded and recomputed` });
      }
    } else await Promise.resolve();   // 让出一下，使"打断""停止"消息能被处理
    // ③ SGD 一步
    for (let i = 0; i < p.length; i++) p[i] -= o.lr * g1[i];
    step++; ctx.control.step = step;
    emit({ type: 'step', step, total, elapsedMs: performance.now() - t0 });
    if (step % evalEvery === 0 || step === total) {
      const e = M.evaluate(p, D, H, C, d.testX, d.testY, d.nTest);
      const pt = { step, acc: e.acc, trainLoss: lossSum / lossN, valLoss: e.loss };
      curve.push(pt); lossSum = 0; lossN = 0;
      emit({ type: 'point', pt });
      emit({ type: 'log', line: `Step ${step}/${total}  loss: ${pt.trainLoss.toFixed(3)}  val_loss: ${pt.valLoss.toFixed(3)}  val_acc: ${(e.acc * 100).toFixed(1)}%` });
    }
    if (o.saveCkpts && step % o.ckptEvery === 0 && step < total) {
      await saveCheckpoint({ step, ...pick(o, ['h', 'lr', 'epochs', 'seed', 'protect', 'project', 'dataset', 'D', 'C']), curve, repairs, elapsedMs: performance.now() - t0 }, p);
      emit({ type: 'ckpt', step });
    }
  }
  shadow?.close();
  const e = M.evaluate(p, D, H, C, d.testX, d.testY, d.nTest);
  if (!o.headless) await clearCheckpoint();
  const result = { acc: e.acc, loss: e.loss, repairs, injected, total, elapsedMs: performance.now() - t0, curve, wrong: !o.protect && injected && e.acc < 0.2, shadowMode: shadow?.mode, resumedFrom: resume ? resume.head.step : -1 };
  if (!o.headless) await dbSet('final:' + (o.project || 'default'), { step: total, h: H, D, C, params: p.buffer.slice(0), at: Date.now() });
  emit({ type: 'log', line: result.wrong ? `Validation: FAILED — accuracy ${(e.acc * 100).toFixed(1)}% (no error was reported)` : `Validation: OK\nTest accuracy: ${(e.acc * 100).toFixed(1)}% (${d.nTest.toLocaleString('en-US')} examples the model has never seen)` });
  emit({ type: 'log', line: repairs > 0 ? `⚠ Error detected and fixed (${repairs})` : o.protect ? '✓ Verified' : 'Finished (protection was off)' });
  return result;
}
const pick = (o, ks) => Object.fromEntries(ks.map(k => [k, o[k]]));
