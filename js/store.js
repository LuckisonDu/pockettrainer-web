// 存储层：设置、项目、文件、运行记录、笔记。全部放在 IndexedDB（浏览器本地，不联网）。
// 键的命名：proj:<名字> 项目信息 | file:<名字>:<路径> 文件文本 | hist:<名字>:<路径> 旧版本
//           runs 运行记录 | notes:<名字> 笔记 | final:<名字> 训练完的权重 | settings 设置
import { dbGet, dbSet, dbDel, dbList } from './db.js';

// ---------- 设置 ----------
export const settings = { saveCheckpoints: true, ckptInterval: 20, offerResume: true, verify: true, theme: 'system', lang: '', versionHistory: true };
export async function loadSettings() { Object.assign(settings, (await dbGet('settings')) || {}); return settings; }
export const saveSettings = () => dbSet('settings', { ...settings });

// ---------- 读写 model.py 里的 "名字 = 数字" ----------
export const ConfigCode = {
  value: (key, text) => new RegExp(`^${key}[ \\t]*=[ \\t]*([^\\s#]+)`, 'm').exec(text)?.[1] ?? null,
  set: (key, v, text) => text.replace(new RegExp(`^(${key}[ \\t]*=[ \\t]*)[^\\s#]+`, 'm'), (_, a) => a + v),
};
export const RECIPE_KEYS = ['hidden_units', 'learning_rate', 'epochs', 'seed'];
export const isRunnable = text => RECIPE_KEYS.every(k => ConfigCode.value(k, text) !== null);

// 把小数写成最短形式：0.0500 -> 0.05
export const num = x => String(Number(Number(x).toPrecision(3)));

// ---------- 项目 ----------
export const DEFAULT = 'Photo classifier (CIFAR-10)';
export const TEMPLATES = [
  { title: DEFAULT, hidden: 128, lr: 0.05, epochs: 6, blurb: 'Train a small AI to recognise 10 kinds of photos.' },
  { title: 'Learning-rate lab', hidden: 128, lr: 0.2, epochs: 6, blurb: 'Change the learning rate and watch what happens.' },
];
const MODEL_PY = t => `# Model configuration
# PocketTrainer reads these four lines.
hidden_units = ${t.hidden}
learning_rate = ${t.lr}
epochs = ${t.epochs}
seed = 1
# The model (shown for learning):
# 2048 photo features -> hidden_units (ReLU) -> 10 classes
`;
const TRAIN_PY = `# train.py: what the built-in trainer does (shown for learning, not run as Python)
for step in range(total_steps):
    batch = next_batch(128)
    new_weights = fast_step(weights, batch)
    if verify_training_results:          # Settings > Training
        shadow = cpu_step(weights, batch)
        if differs(new_weights, shadow):
            new_weights = recompute(weights, batch)
    weights = new_weights
    if save_checkpoints and step % checkpoint_interval == 0:
        save_checkpoint(weights)          # atomic: write a temporary copy, check it, then switch
`;

export async function listProjects() {
  const ps = (await dbList('proj:')).map(([, v]) => v);
  return ps.sort((a, b) => b.openedAt - a.openedAt);
}
export const getProject = name => dbGet('proj:' + name);
export const touchProject = async name => { const p = await getProject(name); if (p) { p.openedAt = Date.now(); await dbSet('proj:' + name, p); } };

export async function uniqueName(name) {
  let n = name, k = 2;
  while (await getProject(n)) n = `${name} ${k++}`;
  return n;
}
export async function createProject(t, name = t.title, extra = {}) {
  name = await uniqueName(name);
  await dbSet('proj:' + name, { name, kind: 'recipe', createdAt: Date.now(), openedAt: Date.now(), blurb: t.blurb, ...extra });
  const files = {
    'code/model.py': MODEL_PY(t), 'code/train.py': TRAIN_PY,
    'code/config.json': `{\n  "project": "${name}"\n}\n`,
    'notes/learning-notes.md': '# Learning notes\n\nWrite what you tried and what happened.\n',
    'README.md': `# ${name}\n\n${t.blurb}\n\nOpen \`code/model.py\`, change the numbers, press Run.\n`,
  };
  for (const [p, text] of Object.entries(files)) await dbSet(`file:${name}:${p}`, text);
  return name;
}
export async function ensureDefaults() { if (!(await listProjects()).length) for (const t of TEMPLATES) await createProject(t); }

export async function listFiles(name) {
  const pre = `file:${name}:`;
  return (await dbList(pre)).map(([k, v]) => ({ path: k.slice(pre.length), size: new Blob([v]).size })).sort((a, b) => a.path.localeCompare(b.path));
}
export const readFile = async (name, path) => (await dbGet(`file:${name}:${path}`)) ?? '';
export async function writeFile(name, path, text) {
  const old = await dbGet(`file:${name}:${path}`);
  if (old === text) return;
  if (settings.versionHistory && old) {          // 保存时把旧版本留一份（最多 10 份）
    const h = (await dbGet(`hist:${name}:${path}`)) || [];
    await dbSet(`hist:${name}:${path}`, [{ t: Date.now(), text: old }, ...h].slice(0, 10));
  }
  await dbSet(`file:${name}:${path}`, text);
}
export const history = async (name, path) => (await dbGet(`hist:${name}:${path}`)) || [];
export const deleteFile = (name, path) => dbDel(`file:${name}:${path}`);

export async function deleteProject(name) {
  for (const pre of [`file:${name}:`, `hist:${name}:`, `bin:${name}:`]) for (const [k] of await dbList(pre)) await dbDel(k);
  await dbDel('proj:' + name); await dbDel('notes:' + name); await dbDel('final:' + name);
}
export async function duplicateProject(name) {
  const p = await getProject(name), nn = await uniqueName(name + ' copy');
  await dbSet('proj:' + nn, { ...p, name: nn, openedAt: Date.now() });
  for (const [k, v] of await dbList(`file:${name}:`)) await dbSet(`file:${nn}:${k.slice(`file:${name}:`.length)}`, v);
  await dbSet('notes:' + nn, (await dbGet('notes:' + name)) || []);
  return nn;
}
export async function renameProject(name, to) {
  to = to.trim(); if (!to || to === name || await getProject(to)) return name;
  const p = await getProject(name);
  await dbSet('proj:' + to, { ...p, name: to });
  for (const pre of ['file', 'hist', 'bin']) for (const [k, v] of await dbList(`${pre}:${name}:`)) { await dbSet(`${pre}:${to}:${k.slice(pre.length + name.length + 2)}`, v); await dbDel(k); }
  for (const pre of ['notes:', 'final:']) { const v = await dbGet(pre + name); if (v) await dbSet(pre + to, v); await dbDel(pre + name); }
  await dbDel('proj:' + name);
  return to;
}

// ---------- 运行记录（首页 Latest runs、Notes、Assistant 都读它） ----------
export const allRuns = async () => (await dbGet('runs')) || [];
export async function addRun(r) { await dbSet('runs', [r, ...(await allRuns())].slice(0, 50)); }
export function runSummary(r, t) {
  const acc = (r.accuracy * 100).toFixed(1) + '%';
  if (!r.protect) return t(r.wrong ? 'sum_off_wrong' : 'sum_off', acc);
  if (r.fixed > 0) return t(r.fixed === 1 ? 'sum_fixed_one' : 'sum_fixed_many', acc, r.fixed);
  return t('sum_verified', acc);
}

// ---------- 笔记 ----------
export const getNotes = async name => (await dbGet('notes:' + name)) || [];
export async function addNote(name, text, source) {
  const n = await getNotes(name);
  await dbSet('notes:' + name, [{ id: String(Date.now()), title: text.split('\n')[0], body: text.split('\n').slice(1).join(' ').trim(), date: Date.now(), source: source || '' }, ...n]);
}
export const getPlan = async name => (await dbGet('plan:' + name)) || [false, false, false];
export const setPlan = (name, v) => dbSet('plan:' + name, v);

// ---------- 最近一次训练完的权重（checkpoints/ 文件夹里显示） ----------
export const getFinal = name => dbGet('final:' + name);
