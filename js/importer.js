// 下载与导入：GitHub 导入、Hugging Face 文件清单、依赖扫描（requirements / import 语句）、Map to recipe。
// 安全规则：只允许 https + 白名单主机；只下载文本扩展名；单文件 <= 512 KB、<= 200 个文件、总计 <= 5 MB；
// 下载的代码只显示和编辑，绝不执行（这里没有 eval，也没有 Function）。
import { t } from './i18n.js';
import { get, enc, NetError } from './net.js';
import { sha256 } from './util.js';
import { dbSet, dbGet } from './db.js';
import { uniqueName, writeFile, readFile, listFiles, getProject, num, ConfigCode } from './store.js';

export const MAX_FILE = 512 * 1024, MAX_FILES = 200, MAX_TOTAL = 5 * 1048576, MAX_WEIGHT = 50 * 1048576;
export const EXAMPLE = 'https://github.com/karpathy/micrograd';
const TEXT_EXT = new Set('py md txt json yaml yml toml cfg ini csv jsonl ipynb kt java js ts c h cpp hpp rs go rb swift html css tex rst sh'.split(' '));
const TEXT_NAMES = new Set(['LICENSE', 'COPYING', 'README', 'Makefile', 'Dockerfile', 'NOTICE']);
const WEIGHT_EXT = new Set('safetensors bin gguf pt pth onnx h5 ckpt msgpack npz tflite mlmodel pb ot'.split(' '));
const LICENSE_NAMES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING', 'COPYING.md'];
const ext = n => (n.includes('.') ? n.split('.').pop().toLowerCase() : '');
export const isTextName = n => TEXT_EXT.has(ext(n)) || TEXT_NAMES.has(n);
export const isWeight = n => WEIGHT_EXT.has(ext(n));
// 许可证是不是"非商用 / 未知"：要给黄色警告
export function licenseRisky(l) { const x = (l || '').toLowerCase(); return !x || x === 'other' || x === 'unknown' || x === 'noassertion' || x.includes('-nc') || x.includes('noncommercial'); }

// ---------- 内置组件 & 依赖扫描 ----------
export const BUILTIN = [['trainer-core', '1.0'], ['lesson-utils', '1.0'], ['data-reader', '1.0'], ['onnxruntime-web', '1.x']];
const STDLIB = new Set(('os sys re json math random time typing collections itertools functools pathlib argparse logging dataclasses abc copy io glob shutil subprocess threading unittest datetime string struct hashlib pickle csv warnings contextlib enum operator heapq bisect textwrap traceback inspect types uuid urllib http socket tempfile gzip zipfile tarfile base64 decimal fractions statistics secrets platform signal queue multiprocessing concurrent asyncio ctypes importlib pprint numbers array weakref gc builtins __future__ sqlite3 xml html email configparser getpass locale codecs unicodedata zlib bz2 lzma select selectors optparse shlex difflib calendar timeit pdb doctest ast dis token tokenize keyword site sysconfig runpy pkgutil mmap fnmatch linecache stat filecmp errno ssl webbrowser tkinter cmath colorsys wave gettext venv distutils graphlib zoneinfo tomllib contextvars atexit sched').split(' '));
const IMPORT_TO_PKG = { cv2: 'opencv-python', PIL: 'pillow', sklearn: 'scikit-learn', yaml: 'pyyaml', bs4: 'beautifulsoup4', skimage: 'scikit-image' };
const HEAVY = new Set('torch torchvision torchaudio tensorflow transformers jax jaxlib keras diffusers accelerate xformers onnxruntime scipy pandas opencv-python sentence-transformers datasets tokenizers safetensors huggingface-hub pytorch-lightning lightning numpy'.split(' ')); // numpy 也要 Python 运行时
const norm = n => n.toLowerCase().replace(/_/g, '-');
export const isDepFile = p => { const n = p.split('/').pop(); return (n.startsWith('requirements') && n.endsWith('.txt')) || n === 'pyproject.toml' || n === 'environment.yml' || n === 'environment.yaml'; };

// 读 requirements.txt / pyproject.toml / environment.yml：[[包名, 版本要求]]
export function parseDeps(path, text) {
  const n = path.split('/').pop(), out = [], re = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*([<>=!~][^;#\s]*)?/;
  const add = s => { const m = re.exec(s.trim()); if (m && !['python', 'pip'].includes(norm(m[1]))) out.push([norm(m[1]), m[2] || '']); };
  if (n.endsWith('.txt')) text.split('\n').map(l => l.split('#')[0].trim()).filter(l => l && !l.startsWith('-') && !l.includes('://')).forEach(add);
  else if (n === 'pyproject.toml') for (const b of text.matchAll(/dependencies\s*=\s*\[([\s\S]*?)\]/g)) for (const q of b[1].matchAll(/"([^"]+)"/g)) add(q[1]);
  else text.split('\n').map(l => l.trim()).filter(l => l.startsWith('- ') && !l.includes(':')).forEach(l => add(l.slice(2).replace(/=/g, '==').replace(/====/g, '==')));
  return out;
}
// 扫描 .py / .ipynb 里的 import 语句（排除标准库和项目自己的模块）
export function scanImports(text, local) {
  const s = new Set();
  for (const m of text.matchAll(/^\s*(?:import|from)\s+([A-Za-z_][A-Za-z0-9_]*)/gm)) if (!STDLIB.has(m[1]) && !local.has(m[1])) s.add(norm(IMPORT_TO_PKG[m[1]] || m[1]));
  return s;
}
export function resolvePkg(name, spec, from) {
  const builtin = BUILTIN.some(([n]) => n === name);
  return { name, spec, from, status: builtin ? 'builtin' : 'na', reason: HEAVY.has(name) ? 'heavy' : 'python' };
}
// 对一个项目的全部文本文件做依赖扫描
export async function scanProject(proj) {
  const files = (await listFiles(proj)).map(f => f.path), deps = new Map(), local = new Set(files.flatMap(f => f.split('/').map(x => x.replace(/\.[^.]+$/, ''))));   // 文件名和文件夹名都算项目自己的模块
  for (const f of files.filter(isDepFile)) for (const [n, s] of parseDeps(f, await readFile(proj, f))) if (!deps.has(n)) deps.set(n, [s, f.split('/').pop()]);
  for (const f of files.filter(f => /\.(py|ipynb)$/.test(f))) for (const n of scanImports(await readFile(proj, f), local)) if (!deps.has(n)) deps.set(n, ['', 'imports']);
  return [...deps].map(([n, [s, from]]) => resolvePkg(n, s, from));
}

// ---------- GitHub 导入 ----------
export async function importGithub(link, progress = () => {}) {
  const t0 = performance.now();
  const m = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(tree|blob)\/([^/]+)(?:\/(.*?))?)?\/?$/.exec(link.trim());
  if (!m) throw new NetError(t('imp_err_form'));
  const [, owner, repo, kind, branch0, sub0 = ''] = m, sub = sub0.replace(/^\/|\/$/g, ''), skipped = [];
  const branch = branch0 || (await get(`https://api.github.com/repos/${owner}/${repo}`, { as: 'json' })).default_branch;
  const raw = p => `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${enc(p)}`;
  const wanted = []; let licensePath = null;
  if (kind === 'blob') {
    if (!isTextName(sub.split('/').pop())) throw new NetError(t('imp_err_notext'));
    wanted.push(sub);
    for (const n of LICENSE_NAMES) { try { await get(raw(n), { accept: 'text/plain' }); licensePath = n; break; } catch { /* 没有就试下一个名字 */ } }
  } else {
    const tree = await get(`https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, { as: 'json' });
    if (tree.truncated) skipped.push('(repository is very large: the file list was cut by GitHub)');
    let total = 0;
    for (const e of tree.tree) {
      if (e.type !== 'blob') continue;
      if (LICENSE_NAMES.includes(e.path)) licensePath = e.path;
      if (sub && !e.path.startsWith(sub + '/')) continue;
      const name = e.path.split('/').pop(), size = e.size || 0;
      if (e.path.includes('..') || e.path.split('/').some(s => s.startsWith('.') && s !== '.gitignore')) skipped.push(`${e.path} (hidden folder)`);
      else if (!isTextName(name)) skipped.push(`${e.path} (not a text file)`);
      else if (size > MAX_FILE) skipped.push(`${e.path} (larger than 512 KB)`);
      else if (wanted.length >= MAX_FILES) skipped.push(`${e.path} (more than ${MAX_FILES} files)`);
      else if (total + size > MAX_TOTAL) skipped.push(`${e.path} (over the 5 MB total)`);
      else { wanted.push(e.path); total += size; }
    }
  }
  if (!wanted.length) throw new NetError(t('imp_err_empty'));
  const base = kind === 'blob' ? sub.split('/').pop() : sub && kind === 'tree' ? `${repo} ${sub.split('/').pop()}` : repo;
  const name = await uniqueName(base.replace(/\//g, '-')), entries = []; let bytes = 0, license = null;
  const files = {};
  for (const [i, path] of wanted.entries()) {
    progress(i, wanted.length + 1);
    const data = await get(raw(path), { accept: 'text/plain', as: 'buf', maxBytes: MAX_FILE });
    const rel = 'code/' + (sub && kind === 'tree' ? path.slice(sub.length + 1) : path);
    files[rel] = new TextDecoder().decode(data); bytes += data.length;
    entries.push({ path: rel, sha256: await sha256(data), url: raw(path) });
  }
  if (licensePath) {
    const lic = await get(raw(licensePath), { accept: 'text/plain', as: 'buf', maxBytes: MAX_FILE });
    files['LICENSE'] = new TextDecoder().decode(lic); license = files['LICENSE'].slice(0, 1500);
    entries.push({ path: 'LICENSE', sha256: await sha256(lic), url: raw(licensePath) });
  }
  files['README.md'] = `# ${name}\n\nImported from ${link}\n\nThis project can be read and edited. Nothing in it is executed.\nCheck the project's license before using or sharing it.\n`;
  await saveImported(name, files, { source: link, license: licensePath ? 'see LICENSE' : '', imported: entries, weights: [], packages: [] });
  progress(wanted.length + 1, wanted.length + 1);
  return { project: name, files: entries.length, skipped, bytes, license, ms: performance.now() - t0 };
}
// 把一个导入的项目写进 IndexedDB（项目信息 + 文件 + manifest.json）
export async function saveImported(name, files, manifest) {
  await dbSet('proj:' + name, { name, kind: 'imported', createdAt: Date.now(), openedAt: Date.now(), blurb: manifest.source, source: manifest.source });
  for (const [p, text] of Object.entries(files)) await dbSet(`file:${name}:${p}`, text);
  await dbSet(`file:${name}:manifest.json`, JSON.stringify({ format: 1, name, kind: 'imported', requires: {}, files: Object.keys(files), data: [], ...manifest }, null, 2) + '\n');
}
export const readManifest = async name => { try { return JSON.parse(await readFile(name, 'manifest.json')); } catch { return null; } };

// "Map to recipe"：在导入的代码里扫描 learning_rate / lr / epochs / hidden 的赋值（只读文字，不执行），把配方键写到 code/model.py 开头
export async function mapToRecipe(proj) {
  const text = (await Promise.all((await listFiles(proj)).filter(f => /\.(py|ipynb|json|ya?ml|toml|cfg|ini|txt)$/.test(f.path) && f.path !== 'manifest.json').map(f => readFile(proj, f.path)))).join('\n');
  const find = names => { const m = new RegExp(`^[ \\t]*(?:${names})[ \\t]*[:=][ \\t]*([0-9][0-9.eE+-]*)`, 'm').exec(text); return m ? Number(m[1]) : null; };
  const notes = [], clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const pick = (label, v, def, lo, hi) => { if (v === null || Number.isNaN(v)) { notes.push(t('ed_map_missing', label, def)); return def; } const c = clamp(v, lo, hi); notes.push(c !== v ? t('ed_map_clamped', label, v, c, `${lo}–${hi}`) : t('ed_map_found', label, v)); return c; };
  const lr = pick('learning_rate', find('learning_rate|lr'), 0.05, 0.001, 1), ep = pick('epochs', find('epochs|num_epochs|n_epochs'), 6, 1, 30);
  const hid = pick('hidden_units', find('hidden_units|hidden_size|hidden_dim|n_hidden|hidden'), 128, 8, 512), seed = pick('seed', find('seed'), 1, 0, 1e9);
  const block = `# PocketTrainer recipe (made by Map to recipe; your original code is below, unchanged)\nhidden_units = ${Math.round(hid)}\nlearning_rate = ${num(lr)}\nepochs = ${Math.round(ep)}\nseed = ${Math.round(seed)}\n\n`;
  const old = await readFile(proj, 'code/model.py'); await writeFile(proj, 'code/model.py', block + old);
  if (!(await listFiles(proj)).some(f => f.path === 'code/model.py')) await dbSet(`file:${proj}:code/model.py`, block);
  return notes.join('\n');
}

// ---------- Hugging Face / GitHub 文件清单（Download & set up 用） ----------
function classify(path, size, url, hf, L) {
  const name = path.split('/').pop();
  if (path.includes('..') || path.split('/').some(s => s.startsWith('.') && s !== '.gitignore')) L.skipped.push(`${path} (hidden folder)`);
  else if (isWeight(name) && (hf || size > MAX_FILE)) L.weights.push({ path, size, url: url(path) });
  else if (!isTextName(name)) L.skipped.push(`${path} (not a text file)`);
  else if (size > MAX_FILE) L.skipped.push(`${path} (larger than 512 KB)`);
  else if (L.text.length >= MAX_FILES) L.skipped.push(`${path} (more than ${MAX_FILES} files)`);
  else if (L.text.reduce((s, f) => s + f.size, 0) + size > MAX_TOTAL) L.skipped.push(`${path} (over the 5 MB total)`);
  else L.text.push({ path, size, url: url(path) });
}
export async function listGithub(id) {
  const repo = await get(`https://api.github.com/repos/${id}`, { as: 'json' }), branch = repo.default_branch;
  const tree = (await get(`https://api.github.com/repos/${id}/git/trees/${encodeURIComponent(branch)}?recursive=1`, { as: 'json' })).tree;
  const raw = p => `https://raw.githubusercontent.com/${id}/${branch}/${enc(p)}`, L = { name: id.split('/')[1], source: 'github', id, text: [], weights: [], skipped: [], license: null, licenseUrl: null, readmeUrl: null };
  const sp = repo.license?.spdx_id; L.license = sp && sp !== 'NOASSERTION' ? sp : null;
  for (const e of tree) { if (e.type !== 'blob') continue; if (['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING'].includes(e.path)) L.licenseUrl = raw(e.path); if (e.path.toLowerCase() === 'readme.md') L.readmeUrl = raw(e.path); classify(e.path, e.size || 0, raw, false, L); }
  return L;
}
export async function listHf(id, dataset) {
  const kind = dataset ? 'datasets/' : '';
  const j = await get(`https://huggingface.co/api/${dataset ? 'datasets/' : 'models/'}${id}?blobs=true`, { as: 'json' });
  const url = p => `https://huggingface.co/${kind}${id}/resolve/main/${enc(p)}`, L = { name: id.split('/').pop(), source: dataset ? 'hfd' : 'hf', id, text: [], weights: [], skipped: [], license: null, licenseUrl: null, readmeUrl: url('README.md') };
  for (const s of j.siblings || []) classify(s.rfilename, s.size || 0, url, true, L);
  L.license = (j.cardData?.license && String(j.cardData.license)) || (j.tags || []).find(x => x.startsWith('license:'))?.slice(8) || null;
  return L;
}

// "Download & set up"：Analyze -> Resolve -> Install -> Test，每一步都是真的；下载的任何代码都不会被运行
// ctl: {phase(n), status(text), log(line), packages(list)}；返回项目名
export async function setupProject(source, id, ctl, runTest) {
  const t0 = performance.now();
  ctl.phase(0); ctl.status(t('setup_st_analyze'));
  const L = source === 'github' ? await listGithub(id) : await listHf(id, source === 'hfd');
  ctl.log(`${L.text.length} text files to download · ${L.weights.length} model files (listed only) · ${L.skipped.length} skipped · license: ${L.license || 'not stated'}`);
  const deps = new Map();
  for (const f of L.text.filter(f => isDepFile(f.path))) {
    const found = parseDeps(f.path, await get(f.url, { accept: 'text/plain', maxBytes: MAX_FILE }));
    ctl.log(`Read ${f.path}: ${found.length} packages`); for (const [n, s] of found) if (!deps.has(n)) deps.set(n, [s, f.path.split('/').pop()]);
  }
  const resolveAll = () => [...deps].map(([n, [s, from]]) => resolvePkg(n, s, from));
  ctl.phase(1); ctl.status(t('setup_st_resolve')); let packages = resolveAll(); ctl.packages(packages);
  ctl.log(`Resolve: ${packages.filter(p => p.status === 'builtin').length} built-in, ${packages.filter(p => p.status === 'na').length} not available here`);
  ctl.phase(2); ctl.status(t('setup_st_install'));
  const name = await uniqueName(L.name), files = {}, entries = []; let bytes = 0;
  for (const [i, f] of L.text.entries()) {
    ctl.status(`${t('setup_st_install')} ${i + 1}/${L.text.length}`);
    const d = await get(f.url, { accept: 'text/plain', as: 'buf', maxBytes: MAX_FILE });
    files['code/' + f.path] = new TextDecoder().decode(d); bytes += d.length; entries.push({ path: 'code/' + f.path, sha256: await sha256(d), url: f.url });
  }
  if (L.licenseUrl) { const d = await get(L.licenseUrl, { accept: 'text/plain', as: 'buf', maxBytes: MAX_FILE }); files.LICENSE = new TextDecoder().decode(d); entries.push({ path: 'LICENSE', sha256: await sha256(d), url: L.licenseUrl }); }
  const local = new Set(Object.keys(files).flatMap(f => f.split('/').map(x => x.replace(/\.[^.]+$/, ''))));
  let imp = 0; for (const [p, txt] of Object.entries(files)) if (/\.(py|ipynb)$/.test(p)) for (const n of scanImports(txt, local)) if (!deps.has(n)) { deps.set(n, ['', 'imports']); imp++; }
  packages = resolveAll(); ctl.packages(packages); ctl.log(`Imports scan: ${imp} extra packages found in import lines · ${packages.length} packages in total`);
  files['README.md'] = `# ${name}\n\nDownloaded from ${L.source}:${L.id}\n\nThis project can be read and edited. Nothing in it is executed.\nLicense: ${L.license || 'not stated'}. Check the license before using or sharing it.\n`;
  await saveImported(name, files, { source: `${L.source}:${L.id}`, license: L.license || '', imported: entries, packages, weights: L.weights.map(w => ({ ...w, downloaded: false })) });
  ctl.log(`Downloaded ${entries.length} files, ${Math.round(bytes / 1024)} KB`);
  ctl.phase(3); ctl.status(t('env_st_test'));
  const rep = await reportFor(name); let err = null;
  if (rep.ready) { const r = await runTest(); if (!r.ok) err = `Test failed (${JSON.stringify(r.steps)})`; else r.steps.forEach((s, i) => ctl.log(`Test step ${i + 1}: both computations agree (difference ${s.dist.toExponential(1)}), loss ${s.loss.toFixed(3)}`)); }
  else ctl.log('Read & edit only' + (rep.missing.length ? ` · missing: ${rep.missing.slice(0, 8).join(', ')}` : ''));
  ctl.phase(4); ctl.status(t('setup_done'));
  return { name, files: entries.length, bytes, skipped: L.skipped.length, weights: L.weights.length, license: L.license, ready: rep.ready, missing: rep.missing, ms: performance.now() - t0, err };
}
// 项目的环境报告：ready = 带四个配方键可以 Run；missing = 本软件没有的包
export async function reportFor(name) {
  const m = await readFile(name, 'code/model.py'), mf = await readManifest(name);
  const pk = mf?.packages?.length ? mf.packages : await scanProject(name);
  return { ready: ['hidden_units', 'learning_rate', 'epochs', 'seed'].every(k => ConfigCode.value(k, m) !== null), missing: pk.filter(p => p.status === 'na').map(p => p.name), packages: pk, manifest: mf };
}

// 下载一个模型权重文件（用户逐个点；<= 50 MB；只保存、不执行）
export async function downloadWeight(proj, w) {
  const buf = await get(w.url, { accept: 'application/octet-stream', as: 'buf', maxBytes: MAX_WEIGHT });
  const hash = await sha256(buf);
  await dbSet(`bin:${proj}:${w.path}`, buf.buffer);
  const mf = await readManifest(proj), e = mf.weights.find(x => x.path === w.path); e.downloaded = true; e.sha256 = hash; e.bytes = buf.length;
  await dbSet(`file:${proj}:manifest.json`, JSON.stringify(mf, null, 2) + '\n');
  return hash;
}
