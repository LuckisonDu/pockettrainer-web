// Find projects：搜索 GitHub 和 Hugging Face（浏览器直接请求公开接口，不需要 key），详情，Download & set up。
import { esc, kb } from '../util.js';
import { t } from '../i18n.js';
import { cachedJson, get, NetError } from '../net.js';
import { listGithub, listHf, licenseRisky, setupProject } from '../importer.js';
import { TrainClient } from '../train-client.js';
import { sheet, closeSheet, confirmBox, toast } from '../ui.js';
import { pkgTable, reportCard } from './env.js';
import { askHtml, wireAsk } from '../chatgpt.js';

const k = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n || 0);

export async function search(source, q) {
  const e = encodeURIComponent(q.trim());
  const url = source === 'github' ? `https://api.github.com/search/repositories?q=${e}+language:python&sort=stars&per_page=20`
    : `https://huggingface.co/api/${source === 'hfd' ? 'datasets' : 'models'}?search=${e}&sort=downloads&direction=-1&limit=20`;
  const [body, cached] = await cachedJson(url);
  const hits = source === 'github'
    ? body.items.map(o => ({ source, id: o.full_name, desc: o.description || '', stat: '★ ' + k(o.stargazers_count), license: o.license?.spdx_id && o.license.spdx_id !== 'NOASSERTION' ? o.license.spdx_id : null }))
    : body.map(o => ({ source, id: o.id || o.modelId, desc: (o.pipeline_tag || o.description || '').slice(0, 120), stat: `⬇ ${k(o.downloads)}  ♥ ${k(o.likes)}`, license: (o.tags || []).find(x => x.startsWith('license:'))?.slice(8) || null }));
  return { hits, cached };
}

export default async function page(el, app) {
  let S = { source: 'github', q: app.params.q || '', hits: null, cached: false, err: '', busy: false, setup: null };
  const draw = () => {
    el.innerHTML = `<h1>${esc(t('search_title'))}</h1><p class="mute">${esc(t('find_sub'))}</p><div class="card">
      <div class="row"><div class="seg" id="src"><button data-s="github" class="${S.source === 'github' ? 'on' : ''}">${esc(t('search_github'))}</button><button data-s="hf" class="${S.source !== 'github' ? 'on' : ''}">${esc(t('search_hf'))}</button></div>
      ${S.source !== 'github' ? `<div class="seg" id="typ"><button data-s="hf" class="${S.source === 'hf' ? 'on' : ''}">${esc(t('search_models'))}</button><button data-s="hfd" class="${S.source === 'hfd' ? 'on' : ''}">${esc(t('search_datasets'))}</button></div>` : ''}</div>
      <div class="row" style="margin-top:10px"><input type="search" id="q" style="flex:1;min-width:200px" placeholder="${esc(t('search_hint'))}" value="${esc(S.q)}"><button class="btn fill" id="go" ${S.busy ? 'disabled' : ''}>${esc(t('web_search_btn'))}</button></div>
      ${S.err ? `<div class="banner bad">${esc(S.err)}</div>` : ''}${S.cached ? `<div class="banner warn" style="font-weight:500">${esc(t('search_cached'))}</div>` : ''}</div>
      ${S.hits ? `<div class="card">${S.hits.length ? `<div class="list">${S.hits.map((h, i) => `<div class="clickable" data-h="${i}"><div class="row sp"><b>${esc(h.id)}</b><span class="small mute">${esc(h.stat)}</span></div><div class="small mute">${esc(h.desc)}</div>
        <span class="pill ${licenseRisky(h.license) ? 'warn' : ''}">${esc(h.license ? t('search_license', h.license) : t('search_license_unknown'))}</span></div>`).join('')}</div>` : `<p class="mute">${esc(t('search_empty'))}</p>`}</div>` : ''}
      <div class="row">${askHtml()}</div>`;
    const q = el.querySelector('#q'); q.oninput = () => { S.q = q.value; }; q.onkeydown = e => { if (e.key === 'Enter') run(); };
    el.querySelectorAll('#src [data-s]').forEach(b => b.onclick = () => { S.source = b.dataset.s === 'hf' && S.source === 'hfd' ? 'hfd' : b.dataset.s; S.hits = null; draw(); });
    el.querySelectorAll('#typ [data-s]').forEach(b => b.onclick = () => { S.source = b.dataset.s; S.hits = null; draw(); });
    el.querySelector('#go').onclick = run;
    el.querySelectorAll('[data-h]').forEach(r => r.onclick = () => detail(S.hits[+r.dataset.h]));
    wireAsk(el, t('find_title'), () => `Search: "${S.q}" on ${S.source}\nResults: ${(S.hits || []).slice(0, 8).map(h => `${h.id} (${h.license || 'no license'})`).join('; ')}`);
  };
  async function run() {
    if (!S.q.trim()) return; S.busy = true; S.err = ''; draw();
    try { Object.assign(S, await search(S.source, S.q)); } catch (e) { S.err = e.message; S.hits = null; }
    S.busy = false; draw();
  }
  async function detail(h) {
    const d = sheet(`<h2>${esc(h.id)}</h2><p class="mute">…</p>`);
    try {
      const L = h.source === 'github' ? await listGithub(h.id) : await listHf(h.id, h.source === 'hfd');
      let readme = ''; try { readme = (await get(L.readmeUrl, { accept: 'text/plain', maxBytes: 600000 })).replace(/^---\n[\s\S]*?\n---\n/, '').trim().slice(0, 900); } catch { /* 没有 README 也没关系 */ }
      const size = [...L.text, ...L.weights].reduce((s, f) => s + f.size, 0), risky = licenseRisky(L.license);
      const csv = L.text.find(f => /\.(csv|jsonl)$/i.test(f.path)), onnx = L.weights.find(f => /\.onnx$/i.test(f.path));
      d.querySelector('.in').innerHTML = `<h2>${esc(h.id)}</h2><div class="small mute">${esc(t('detail_size', kb(size)))} · ${esc(L.license ? t('search_license', L.license) : t('search_license_unknown'))}</div>
        ${risky ? `<div class="banner warn">${esc(t('search_lic_warn'))}</div>` : ''}
        ${readme ? `<h3>${esc(t('detail_readme'))}</h3><pre class="console" style="max-height:150px">${esc(readme)}</pre>` : ''}
        <h3>${esc(t('detail_files'))}</h3><div class="small mono" style="max-height:120px;overflow:auto">${[...L.text, ...L.weights].slice(0, 40).map(f => `${esc(f.path)} <span class="mute">${kb(f.size)}</span>`).join('<br>')}</div>
        <p class="small mute">${esc(t('detail_weights', L.weights.length))}</p>
        <div class="row"><button class="btn fill" id="dl">${esc(t('detail_download'))}</button>${csv ? `<button class="btn" id="tab">${esc(t('web_use_table'))}</button>` : ''}${onnx ? `<button class="btn" id="onx">${esc(t('web_use_onnx'))}</button>` : ''}<button class="btn" id="cl">${esc(t('common_close'))}</button></div>`;
      d.querySelector('#cl').onclick = closeSheet;
      d.querySelector('#dl').onclick = async () => { if (risky && !(await confirmBox(t('detail_confirm_title'), t('detail_confirm_text', L.license ? t('search_license', L.license) : t('search_license_unknown')), t('detail_download')))) return; closeSheet(); setup(h); };
      d.querySelector('#tab')?.addEventListener('click', () => { closeSheet(); app.go('tables', { hfd: h.id, url: csv.url, name: csv.path }); });
      d.querySelector('#onx')?.addEventListener('click', () => { closeSheet(); app.go('image', { url: onnx.url, name: h.id, size: onnx.size, license: L.license }); });
    } catch (e) { d.querySelector('.in').innerHTML = `<h2>${esc(h.id)}</h2><div class="banner bad">${esc(e.message)}</div><button class="btn" onclick="document.getElementById('sheet').close()">${esc(t('common_close'))}</button>`; }
  }
  // Download & set up：四步 + 实时日志 + 包对照表 + 环境报告
  async function setup(h) {
    const P = { phase: 0, status: '', log: [], pk: [], res: null, err: '' }; S.setup = P;
    const names = ['env_analyze', 'env_resolve', 'env_install', 'env_test'];
    const box = () => { let c = document.getElementById('setupbox'); if (!c) { c = document.createElement('div'); c.id = 'setupbox'; el.insertBefore(c, el.children[2] || null); } return c; };
    const paint = () => {
      box().innerHTML = `<div class="card"><h2>${esc(t('setup_title'))} · ${esc(h.id)}</h2><div class="steps">${names.map((k, i) => `<div class="${P.phase > i || P.res ? 'done' : P.phase === i ? 'cur' : ''}">${esc(t(k))}</div>`).join('')}</div>
        <div class="${P.err ? 'banner bad' : ''}">${esc(P.err || P.status)}</div>${P.pk.length ? pkgTable(P.pk) : ''}<pre class="console" style="max-height:170px">${esc(P.log.join('\n'))}</pre>
        ${P.res ? reportCard({ ready: P.res.ready, missing: P.res.missing }, P.res.license) + `<button class="btn fill" id="so">${esc(t('setup_open'))}</button>` : ''}</div>`;
      box().querySelector('#so')?.addEventListener('click', async () => { await app.setProject(P.res.name); app.go('editor'); });
    };
    const ctl = { phase: n => { P.phase = n; paint(); }, status: s => { P.status = s; paint(); }, log: l => { P.log.push(new Date().toLocaleTimeString([], { hour12: false }) + '  ' + l); paint(); }, packages: p => { P.pk = p; paint(); } };
    paint(); box().scrollIntoView({ behavior: 'smooth' });
    try { P.res = await setupProject(h.source, h.id, ctl, () => TrainClient.once({ cmd: 'test3' })); P.status = t('setup_done'); app.refreshSide(); }
    catch (e) { P.err = e.message; P.log.push('✗ ' + e.message); }
    paint();
  }
  draw(); if (S.q) run();
}
