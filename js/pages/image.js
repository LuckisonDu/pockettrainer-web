// Image model（ONNX）：从 Hugging Face 下载 .onnx -> 在浏览器里运行 -> 用两种后端核对（WASM/CPU 与 WebGPU）。
// 对应手机版的 Core ML 路：同一张图跑两个后端，输出一致才算 "Verified"，不一致就是"悄悄算错"的警告。
import { esc, kb, sha256 } from '../util.js';
import { t } from '../i18n.js';
import { get } from '../net.js';
import { dbGet, dbSet } from '../db.js';
import { licenseRisky, MAX_WEIGHT } from '../importer.js';
import { askHtml, wireAsk } from '../chatgpt.js';
import { cosineDistance } from '../mlp.js';

// 默认模型：MobileNetV4-small（ImageNet 分类，fp32 ONNX，约 15 MB）。原始模型 timm/mobilenetv4_conv_small.e2400_r224_in1k 是 Apache-2.0；
// 这个 ONNX 转换仓库自己没有写许可证，所以界面按"未写明"显示黄色提醒。
const DEFAULT = { name: 'onnx-community/mobilenetv4_conv_small.e2400_r224_in1k', url: 'https://huggingface.co/onnx-community/mobilenetv4_conv_small.e2400_r224_in1k/resolve/main/onnx/model.onnx', size: 15086122, license: null, baseLicense: 'apache-2.0 (base model timm/mobilenetv4_conv_small.e2400_r224_in1k)' };

let ortMod;
async function loadOrt() {
  if (ortMod) return ortMod;
  ortMod = await import(new URL('../../vendor/ort.webgpu.min.mjs', import.meta.url));
  const o = ortMod.env.wasm; o.wasmPaths = new URL('../../vendor/', import.meta.url).href; o.numThreads = 1;   // 单线程：不需要特殊的跨源隔离头
  return ortMod;
}
const softmax = a => { const m = Math.max(...a), e = Array.from(a, v => Math.exp(v - m)), s = e.reduce((x, y) => x + y, 0); return e.map(v => v / s); };
const top = (a, labels, k = 5) => { const p = softmax(a); return [...p.keys()].sort((i, j) => p[j] - p[i]).slice(0, k).map(i => ({ i, p: p[i], label: labels?.[i] ?? 'class ' + i })); };

// 取图 -> 最短边缩到 256 -> 中心裁 224 -> 减均值除标准差 -> [1,3,224,224]
export async function preprocess(blob, size = 224) {
  const bmp = await createImageBitmap(blob), s = 256 / Math.min(bmp.width, bmp.height), c = new OffscreenCanvas(size, size), g = c.getContext('2d');
  g.imageSmoothingQuality = 'high'; g.drawImage(bmp, (size - bmp.width * s) / 2, (size - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
  const px = g.getImageData(0, 0, size, size).data, out = new Float32Array(3 * size * size), mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  for (let i = 0; i < size * size; i++) for (let ch = 0; ch < 3; ch++) out[ch * size * size + i] = (px[i * 4 + ch] / 255 - mean[ch]) / std[ch];
  return out;
}

// 在一个后端上跑一遍：返回 {logits, ms}
export async function runBackend(ort, modelBuf, input, ep, shape) {
  const t0 = performance.now();
  const sess = await ort.InferenceSession.create(modelBuf, { executionProviders: [ep], graphOptimizationLevel: 'all' });
  const tCreate = performance.now() - t0, t1 = performance.now();
  const res = await sess.run({ [sess.inputNames[0]]: new ort.Tensor('float32', input, shape) });
  const logits = Float32Array.from(res[sess.outputNames[0]].data);
  const ms = performance.now() - t1; await sess.release?.();
  return { logits, ms, createMs: tCreate };
}

export default async function page(el, app) {
  const M = app.params.url ? { name: app.params.name, url: app.params.url, size: app.params.size || 0, license: app.params.license ?? null } : DEFAULT;
  const S = { model: null, hash: '', file: null, status: '', busy: false, res: null, err: '', labels: null, gpu: 'checking' };
  const key = 'bin:__onnx:' + M.url;
  S.model = await dbGet(key) ? new Uint8Array(await dbGet(key)) : null;
  if (S.model) S.hash = await sha256(S.model);
  navigator.gpu?.requestAdapter().then(a => { S.gpu = a ? 'yes' : 'no'; draw(); }).catch(() => { S.gpu = 'no'; draw(); }); if (!navigator.gpu) S.gpu = 'no';

  function draw() {
    const r = S.res;
    el.innerHTML = `<h1>${esc(t('web_image_nav'))}</h1><p class="mute">${esc(t('web_image_intro'))}</p>
      <div class="grid g2e"><div class="card"><h2>1 · ${esc(t('web_onnx_model'))}</h2><div><b>${esc(M.name)}</b> <span class="small mute">${M.size ? kb(M.size) : ''}</span></div>
        <div class="pill warn" style="margin:6px 0">${esc(M.license ? t('search_license', M.license) : t('search_license_unknown'))}</div>${M.baseLicense ? `<div class="small mute">${esc(M.baseLicense)}</div>` : ''}
        ${licenseRisky(M.license) ? `<div class="small mute">${esc(t('search_lic_warn'))}</div>` : ''}
        <div class="row" style="margin-top:8px"><button class="btn fill" id="dl" ${S.busy || S.model ? 'disabled' : ''}>${esc(S.model ? t('weights_done') : t('weights_download'))}</button></div>
        ${S.model ? `<div class="small mute mono" style="word-break:break-all">${S.model.length} bytes · sha256 ${esc(S.hash)}</div>` : ''}</div>
      <div class="card"><h2>2 · ${esc(t('web_onnx_image'))}</h2><div class="dz" id="dz">${S.file ? `<img id="prev" style="max-width:100%;max-height:180px;border-radius:8px">` : esc(t('web_onnx_pick'))}</div>
        <input type="file" id="img" accept="image/*" style="margin-top:8px"></div></div>
      <div class="card"><h2>3 · ${esc(t('web_onnx_run'))}</h2><p class="small mute">${esc(S.gpu === 'yes' ? t('web_onnx_gpu_yes') : S.gpu === 'no' ? t('web_onnx_gpu_no') : '…')}</p>
        <button class="btn fill" id="run" ${S.busy || !S.model || !S.file ? 'disabled' : ''}>${esc(S.busy ? S.status || t('ed_running') : t('web_onnx_run'))}</button>
        ${S.err ? `<div class="banner bad">${esc(S.err)}</div>` : ''}
        ${r ? `<div class="banner ${r.verdict === 'ok' ? 'ok' : r.verdict === 'diff' ? 'warn' : ''}" id="verdict">${esc(r.verdict === 'ok' ? t('web_onnx_ok') : r.verdict === 'diff' ? t('web_onnx_diff') : t('web_onnx_cpu_only'))}</div>
          <table><tr><th></th><th>${esc(t('web_onnx_top1'))}</th><th>ms</th></tr>${r.rows.map(x => `<tr><td><b>${esc(x.ep)}</b></td><td>${esc(x.top.map(p => `${p.label} ${(p.p * 100).toFixed(1)}%`).join(' · '))}</td><td>${x.ms.toFixed(0)}</td></tr>`).join('')}</table>
          ${r.cmp ? `<p class="small" id="cmpline">${esc(t('web_onnx_cmp', r.cmp.cos.toFixed(6), r.cmp.maxDiff.toExponential(2), r.cmp.same ? '✓' : '✗'))}</p>` : ''}` : ''}</div>
      <div class="row">${askHtml()}</div>`;
    const $ = s => el.querySelector(s);
    if (S.file) { const img = $('#prev'); if (img) img.src = URL.createObjectURL(S.file); }
    $('#img').onchange = e => { S.file = e.target.files[0] || null; S.res = null; draw(); };
    $('#dl').onclick = async () => {
      S.busy = true; S.err = ''; S.status = t('weights_download') + '…'; draw();
      try { if (M.size > MAX_WEIGHT) throw new Error(t('weights_toobig')); S.model = await get(M.url, { accept: 'application/octet-stream', as: 'buf', maxBytes: MAX_WEIGHT }); S.hash = await sha256(S.model); await dbSet(key, S.model.buffer.slice(0)); }
      catch (e) { S.err = e.message; }
      S.busy = false; draw();
    };
    $('#run').onclick = go;
    wireAsk(el, t('web_image_nav'), () => `Model: ${M.name}\nResult: ${r ? r.rows.map(x => `${x.ep}: ${x.top[0].label}`).join('; ') + ' / ' + r.verdict : 'not run'}`);
  }
  async function go() {
    S.busy = true; S.err = ''; S.res = null; S.status = 'ONNX Runtime…'; draw();
    try {
      const ort = await loadOrt(), shape = [1, 3, 224, 224], input = await preprocess(S.file);
      try { const base = M.url.replace(/\/resolve\/main\/.*$/, ''); const cfg = JSON.parse(await get(base + '/resolve/main/config.json', { accept: 'application/json', maxBytes: 1e6 })); S.labels = Object.fromEntries(Object.entries(cfg.id2label || {}).map(([k, v]) => [+k, String(v).split(',')[0]])); } catch { S.labels = null; }
      S.status = 'WASM (CPU)…'; draw();
      const rows = [], cpu = await runBackend(ort, S.model, input, 'wasm', shape); rows.push({ ep: 'WASM (CPU)', ms: cpu.ms, top: top(cpu.logits, S.labels), logits: cpu.logits });
      let verdict = 'cpu_only', cmp = null;
      if (S.gpu === 'yes') {
        S.status = 'WebGPU…'; draw();
        try {
          const gpu = await runBackend(ort, S.model, input, 'webgpu', shape); rows.push({ ep: 'WebGPU', ms: gpu.ms, top: top(gpu.logits, S.labels), logits: gpu.logits });
          let maxDiff = 0; for (let i = 0; i < cpu.logits.length; i++) maxDiff = Math.max(maxDiff, Math.abs(cpu.logits[i] - gpu.logits[i]));
          const cos = 1 - cosineDistance(cpu.logits, gpu.logits), same = rows[0].top[0].i === rows[1].top[0].i;
          cmp = { cos, maxDiff, same }; verdict = cos > 0.999 && same ? 'ok' : 'diff';
        } catch (e) { S.err = 'WebGPU: ' + e.message; }
      }
      S.res = { rows, verdict, cmp };
    } catch (e) { S.err = e.message; }
    S.busy = false; draw();
  }
  draw();
}
