// 训练 Worker：主页面发来命令，这里跑训练并把进度发回去（界面因此不卡）。
// 命令：{cmd:'run', o, data?, resume?}  {cmd:'interrupt'}  {cmd:'test3'}  {cmd:'compare'}
import { train, loadCheckpoint, saveCheckpoint, BATCH, epochOrder, CHECK_LIMIT, makeShadow } from './trainer.js';
import { loadBuiltin, verifyDataFiles } from './data.js';
import { dbSet, dbGet } from './db.js';
import * as M from './mlp.js';

const control = { injectAt: -1 };
const emit = m => postMessage(m);
let busy = false;

async function getData(o, given) {
  if (given) return given;
  if (o.dataset === 'builtin') return loadBuiltin();
  const t = await dbGet('tabdata:' + o.dataset);    // 表格数据集：页面重载后续训时从 IndexedDB 取
  if (!t) throw new Error('dataset missing');
  return t;
}

onmessage = async e => {
  const m = e.data;
  if (m.cmd === 'interrupt') { control.injectAt = (control.step ?? 0) + 3 + Math.floor(Math.random() * 10); return; }
  if (busy) return;
  busy = true;
  try {
    if (m.cmd === 'run') {
      let resume = null, o = m.o;
      if (m.resume) { resume = await loadCheckpoint(); if (!resume) throw new Error('no checkpoint'); o = { ...o, ...resume.head, injectAt: -1 }; }
      if (m.data) await dbSet('tabdata:' + o.dataset, m.data);       // 表格数据集随存档一起留着，续训要用
      const d = await getData(o, m.data);
      emit({ type: 'result', result: await train(o, d, resume, { emit, control }) });
    } else if (m.cmd === 'test3') emit({ type: 'result', result: await test3(m.data) });
    else if (m.cmd === 'compare') emit({ type: 'result', result: await compare(m.seed ?? 1) });
    else if (m.cmd === 'verify') { const lines = []; await verifyDataFiles(l => emit({ type: 'log', line: l })); emit({ type: 'result', result: { ok: true } }); }
    else if (m.cmd === 'measure') emit({ type: 'result', result: await measure() });
  } catch (err) { emit({ type: 'error', message: String(err.message || err) }); }
  busy = false;
};

// Environment 的 Test：真的跑 3 步，每步算两遍（快速版 + 朴素版），看更新量是否一致、损失是否有限
async function test3(given) {
  const d = given ?? await loadBuiltin(), H = 32, p = M.initParams(d.D, H, d.C, 1), g = new Float32Array(p.length), steps = [];
  const order = epochOrder(d.nTrain, 1, 0);
  const { gradientRef } = await import('./mlp_ref.js');
  for (let i = 0; i < 3; i++) {
    const idx = order.subarray(i * BATCH, (i + 1) * BATCH);
    const loss = M.gradient(p, d.D, H, d.C, d.trainX, d.trainY, idx, g);
    const xb = new Float32Array(BATCH * d.D), yb = new Uint8Array(BATCH);
    idx.forEach((s, b) => { xb.set(d.trainX.subarray(s * d.D, s * d.D + d.D), b * d.D); yb[b] = d.trainY[s]; });
    const r = gradientRef(p, d.D, H, d.C, xb, yb, Int32Array.from(yb, (_, k) => k));
    const dist = M.cosineDistance(g, r.g);
    steps.push({ dist, loss });
    if (dist > CHECK_LIMIT || !Number.isFinite(loss)) return { ok: false, steps };
    for (let k = 0; k < p.length; k++) p[k] -= 0.05 * g[k];
  }
  return { ok: true, steps };
}

// "Measure my computer"：量一下这台电脑跑一步训练要多久（真实计时，不是假的看门狗）
async function measure() {
  const d = await loadBuiltin(), H = 128, p = M.initParams(d.D, H, d.C, 1), g = new Float32Array(p.length);
  const idx = epochOrder(d.nTrain, 1, 0).subarray(0, BATCH), times = [];
  for (let i = 0; i < 5; i++) { const t = performance.now(); M.gradient(p, d.D, H, d.C, d.trainX, d.trainY, idx, g); times.push(performance.now() - t); }
  times.sort((a, b) => a - b);
  return { medianMs: times[2], minMs: times[0], maxMs: times[4], cores: navigator.hardwareConcurrency };
}

// Protection lab 的 Compare methods：同一个打断，同时比较 参考(无错误) / None / Checkpoint-only / Our method（3 个 epoch，H=64）
async function compare(seed) {
  const d = await loadBuiltin(), epochs = 3, total = Math.floor(d.nTrain / BATCH) * epochs, hit = Math.floor(total / 2), rows = [];
  const plan = [['cmp_ref', false, -1], ['cmp_none', false, hit], ['cmp_ckpt', false, hit], ['cmp_ours', true, hit]];
  for (const [i, [name, protect, injectAt]] of plan.entries()) {
    emit({ type: 'progress', index: i, name });
    // headless：不写存档、不留最终权重。Checkpoint-only 只存档、不校验，所以和 None 一样看不见错误更新（见 cmp_explain）
    const r = await train({ h: 64, lr: 0.05, epochs, seed, protect, injectAt, saveCkpts: false, project: '__compare', dataset: 'builtin', D: d.D, C: d.C, headless: true, evalEvery: total }, d, null, { emit: () => {}, control: { injectAt: -1 } });
    rows.push({ name, acc: r.acc, repairs: r.repairs, seconds: r.elapsedMs / 1000 });
  }
  return { rows };
}
