// 训练客户端：主页面这边管理训练 Worker，保存界面要显示的状态（步数、曲线、日志、修复次数），并处理"模拟闪退""续训"。
import { settings, addRun } from './store.js';
import { loadCheckpoint, clearCheckpoint } from './trainer.js';

export class TrainClient {
  constructor() { this.subs = new Set(); this.reset(); this.interruptArmed = false; this.crashArmed = false; this.pending = null; this.refreshPending(); }
  reset() { Object.assign(this, { phase: 'idle', step: 0, total: 0, curve: [], log: [], repairs: 0, elapsedMs: 0, accuracy: 0, injected: false, resumedFrom: -1, result: null, error: null, opts: null }); }
  subscribe(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
  emit() { this.subs.forEach(f => f(this)); }
  get running() { return this.phase === 'training'; }

  // 有没有没训练完的存档（首页和 Settings 用）
  async refreshPending() { const c = await loadCheckpoint().catch(() => null); this.pending = c && settings.offerResume ? c.head : null; this.emit(); return this.pending; }

  // 开始训练。o = {h, lr, epochs, seed, project, dataset, D, C, ...}；data = 表格数据集（内置数据集不用传）
  start(o, data) {
    if (this.running) return Promise.resolve(null);
    o = { ckptEvery: settings.ckptInterval, saveCkpts: settings.saveCheckpoints, protect: settings.verify, dataset: 'builtin', ...o };
    const injectAt = this.interruptArmed ? Math.floor(Math.floor(5000 / 128) * o.epochs * (0.25 + 0.5 * Math.random())) : -1;
    this.crashAt = this.crashArmed && o.saveCkpts ? Math.max(Math.floor(Math.floor((data?.nTrain ?? 5000) / Math.min(128, data?.nTrain ?? 5000)) * o.epochs / 2), o.ckptEvery + 1) : -1;
    this.reset(); this.opts = o;
    this.total = Math.floor((data?.nTrain ?? 5000) / Math.min(128, data?.nTrain ?? 5000)) * o.epochs;
    this.log = [`Run ${o.project}: hidden_units=${o.h} learning_rate=${o.lr} epochs=${o.epochs} seed=${o.seed}`, o.protect ? 'Verify training results: ON' : 'Verify training results: OFF'];
    this.interruptArmed = false; this.crashArmed = false;
    return this.launch({ cmd: 'run', o: { ...o, injectAt }, data });
  }
  // 从存档续训（页面重新打开后，或模拟闪退后）
  async resume() {
    if (this.running) return null;
    const c = await loadCheckpoint(); if (!c) return null;
    const h = c.head;
    this.reset(); this.opts = { ...h, ckptEvery: settings.ckptInterval, saveCkpts: settings.saveCheckpoints };
    this.step = h.step; this.curve = h.curve; this.repairs = h.repairs; this.resumedFrom = h.step; this.crashAt = -1;
    this.log = [`Run ${h.project}: hidden_units=${h.h} learning_rate=${h.lr} epochs=${h.epochs} seed=${h.seed}`];
    return this.launch({ cmd: 'resume', o: this.opts, resume: true });
  }
  async discard() { await clearCheckpoint(); this.pending = null; if (this.phase === 'crashed') this.phase = 'idle'; this.emit(); }
  stop() { this.worker?.terminate(); this.worker = null; if (this.running) { this.phase = 'idle'; this.log.push('Stopped.'); this.emit(); this.refreshPending(); } }

  // 软件模拟的"系统打断"：训练中 -> 接下来几步里注入一次 NaN；没训练 -> 下次 Run 时注入
  toggleInterruption() { if (this.running) { this.worker.postMessage({ cmd: 'interrupt' }); this.interruptArmed = true; } else this.interruptArmed = !this.interruptArmed; this.emit(); }
  toggleCrash() { if (!this.running) this.crashArmed = !this.crashArmed; this.emit(); }

  launch(msg) {
    this.phase = 'training'; this.emit();
    const w = this.worker = new Worker(new URL('./train-worker.js', import.meta.url), { type: 'module' });
    return new Promise(resolve => {
      const finish = r => { w.terminate(); if (this.worker === w) this.worker = null; resolve(r); };
      w.onmessage = async e => {
        const m = e.data;
        if (m.type === 'step') { this.step = m.step; this.total = m.total; this.elapsedMs = m.elapsedMs; }
        else if (m.type === 'point') { this.curve.push(m.pt); this.accuracy = m.pt.acc; }
        else if (m.type === 'log') this.log.push(m.line);
        else if (m.type === 'injected') { this.injected = true; this.interruptArmed = false; }
        else if (m.type === 'ckpt') {
          if (this.crashAt > 0 && m.step >= this.crashAt) {      // 模拟闪退：直接把 Worker 杀掉（进程里的一切丢失，只剩 IndexedDB 里的存档）
            w.terminate(); this.worker = null; this.crashAt = -1; this.crashedAt = m.step;
            this.phase = 'crashed'; this.log.push(`💥 Simulated crash: the training worker was killed at step ${m.step}. Nothing in memory survived.`);
            await this.refreshPending(); this.emit(); return finish({ crashed: true, step: m.step });
          }
        }
        else if (m.type === 'result') {
          const r = m.result; this.result = r; this.repairs = r.repairs; this.accuracy = r.acc; this.elapsedMs = r.elapsedMs; this.phase = 'done'; this.curve = r.curve;
          this.pending = null;
          const c = r.curve, o = this.opts;
          await addRun({ date: Date.now(), project: o.project, accuracy: r.acc, protect: o.protect, fixed: r.repairs, lr: o.lr, hidden: o.h, epochs: o.epochs,
            seconds: r.elapsedMs / 1000, firstLoss: c[0]?.trainLoss ?? 0, lastLoss: c.at(-1)?.trainLoss ?? 0, lastValLoss: c.at(-1)?.valLoss ?? 0, wrong: r.wrong, resumedFrom: r.resumedFrom });
          this.emit(); return finish(r);
        }
        else if (m.type === 'error') { this.error = m.message; this.phase = 'idle'; this.log.push('✗ ' + m.message); this.emit(); return finish(null); }
        this.emit();
      };
      w.onerror = ev => { this.error = String(ev.message || 'worker error'); this.phase = 'idle'; this.emit(); finish(null); };
      w.postMessage(msg.cmd === 'resume' ? { cmd: 'run', o: msg.o, resume: true } : msg, msg.data ? [msg.data.trainX.buffer, msg.data.testX.buffer].filter(Boolean) : []);
    });
  }
  // 一次性命令（Environment 的 3 步测试、Measure my computer 等）：开一个临时 Worker 跑完就关
  static once(msg, onLog) {
    const w = new Worker(new URL('./train-worker.js', import.meta.url), { type: 'module' });
    return new Promise((res, rej) => {
      w.onmessage = e => { const m = e.data; if (m.type === 'log') onLog?.(m.line); else if (m.type === 'result') { w.terminate(); res(m.result); } else if (m.type === 'error') { w.terminate(); rej(new Error(m.message)); } };
      w.onerror = ev => { w.terminate(); rej(new Error(ev.message)); };
      w.postMessage(msg);
    });
  }
}
