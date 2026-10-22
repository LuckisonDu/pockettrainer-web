// 表格数据集（CSV / JSONL）-> 训练用数字：解析、选列、标准化（减均值除标准差）、划分训练/测试。
import { rng } from './mlp.js';

// 简单 CSV 解析（支持引号和引号里的逗号 / 换行）
export function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some(x => x !== '')) rows.push(row); row = []; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); if (row.some(x => x !== '')) rows.push(row); }
  return { header: rows[0] ?? [], rows: rows.slice(1) };
}
export function parseJSONL(text) {
  const objs = text.split('\n').map(l => l.trim()).filter(Boolean).map(l => JSON.parse(l));
  const header = [...new Set(objs.flatMap(o => Object.keys(o)))];
  return { header, rows: objs.map(o => header.map(h => (o[h] === undefined || o[h] === null ? '' : typeof o[h] === 'object' ? JSON.stringify(o[h]) : String(o[h])))) };
}
export const parseTable = (name, text) => (/\.jsonl?$/i.test(name) ? parseJSONL(text) : parseCSV(text));

// 哪些列"几乎全是数字"（可以当特征）
export function numericColumns(tab) {
  return tab.header.map((_, c) => {
    const vals = tab.rows.map(r => r[c]).filter(v => v !== '' && v !== undefined);
    return vals.length > 0 && vals.filter(v => Number.isFinite(Number(v))).length >= 0.95 * vals.length;
  });
}
// 建数据集：labelCol 是标签列（任何值都当"类别"），featureCols 是特征列编号。限制：<= 20000 行、<= 512 个特征、<= 50 类。
export function buildDataset(tab, labelCol, featureCols, seed = 1, testFrac = 0.2) {
  const rows = tab.rows.slice(0, 20000).filter(r => r[labelCol] !== '' && r[labelCol] !== undefined);
  if (featureCols.length > 512) throw new Error('At most 512 feature columns');
  const classes = [...new Set(rows.map(r => r[labelCol]))].sort((a, b) => (Number.isFinite(+a) && Number.isFinite(+b) ? a - b : a.localeCompare(b)));
  if (classes.length < 2) throw new Error('The label column needs at least 2 different values');
  if (classes.length > 50) throw new Error('Too many classes (' + classes.length + ' > 50): choose a different label column');
  const D = featureCols.length, n = rows.length, r = rng(seed * 31 + 7);
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const nTest = Math.max(1, Math.round(n * testFrac)), nTrain = n - nTest;
  const X = new Float32Array(n * D), Y = new Uint8Array(n);
  // 均值和标准差只用训练部分算（测试数据不能"偷看"）
  const mean = new Float64Array(D), sd = new Float64Array(D), cnt = new Float64Array(D);
  order.forEach((ri, k) => { Y[k] = classes.indexOf(rows[ri][labelCol]); featureCols.forEach((c, d) => { const v = Number(rows[ri][c]); X[k * D + d] = Number.isFinite(v) && rows[ri][c] !== '' ? v : NaN; if (k < nTrain && !Number.isNaN(X[k * D + d])) { mean[d] += X[k * D + d]; cnt[d]++; } }); });
  for (let d = 0; d < D; d++) mean[d] = cnt[d] ? mean[d] / cnt[d] : 0;
  for (let k = 0; k < nTrain; k++) for (let d = 0; d < D; d++) { const v = X[k * D + d]; if (!Number.isNaN(v)) sd[d] += (v - mean[d]) ** 2; }
  for (let d = 0; d < D; d++) sd[d] = Math.sqrt(sd[d] / Math.max(1, cnt[d])) || 1;
  for (let k = 0; k < n; k++) for (let d = 0; d < D; d++) { const v = X[k * D + d]; X[k * D + d] = Number.isNaN(v) ? 0 : (v - mean[d]) / sd[d]; }   // 缺失值 = 均值 = 标准化后 0
  return { D, C: classes.length, classes, trainX: X.slice(0, nTrain * D), trainY: Y.slice(0, nTrain), testX: X.slice(nTrain * D), testY: Y.slice(nTrain), nTrain, nTest };
}
