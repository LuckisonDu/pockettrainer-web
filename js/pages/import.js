// Import from GitHub：按地址 / tree / blob 链接导入文本文件；Map to recipe。
import { esc, kb } from '../util.js';
import { t } from '../i18n.js';
import { importGithub, EXAMPLE, mapToRecipe } from '../importer.js';
import { askHtml, wireAsk } from '../chatgpt.js';

export default async function page(el, app) {
  let state = { busy: false, prog: [0, 1], res: null, err: '', url: '', note: '' };
  const draw = () => {
    const r = state.res;
    el.innerHTML = `<h1>${esc(t('imp_title'))}</h1><div class="card"><p class="small mute">${esc(t('imp_help'))}</p>
      <div class="row"><input type="text" id="u" style="flex:1;min-width:240px" placeholder="https://github.com/owner/repo" value="${esc(state.url)}"><button class="btn fill" id="go" ${state.busy ? 'disabled' : ''}>${esc(t('imp_button'))}</button></div>
      <div class="row" style="margin-top:8px"><button class="btn sm" id="ex">${esc(t('imp_example'))}</button></div><p class="small mute">${esc(t('imp_rules'))}</p>
      ${state.busy ? `<div class="progress"><i style="width:${state.prog[0] / state.prog[1] * 100}%"></i></div><div class="small">${esc(t('imp_progress', state.prog[0], state.prog[1]))}</div>` : ''}
      ${state.err ? `<div class="banner bad">${esc(state.err)}</div>` : ''}</div>
      ${r ? `<div class="card"><h2>${esc(t('imp_done_title', r.project))}</h2><div>${esc(t('imp_done_line', r.files, Math.round(r.bytes / 1024), r.ms / 1000))}</div>
        <p class="banner warn" style="font-weight:500">${esc(t('imp_license_warn'))}</p>
        <h3>${esc(r.license ? t('imp_license_yes') : t('imp_license_no'))}</h3>${r.license ? `<pre class="console" style="max-height:140px">${esc(r.license)}</pre>` : ''}
        ${r.skipped.length ? `<h3>${esc(t('imp_skipped', r.skipped.length))}</h3><pre class="console" style="max-height:120px">${esc(r.skipped.slice(0, 40).join('\n'))}</pre>` : ''}
        <div class="row" style="margin-top:10px"><button class="btn fill" id="open">${esc(t('setup_open'))}</button><button class="btn" id="map">${esc(t('ed_map'))}</button></div>
        ${state.note ? `<p class="small" style="white-space:pre-line">${esc(state.note)}<br>${esc(t('ed_map_after'))}</p>` : ''}</div>` : ''}
      <div class="row">${askHtml()}</div>`;
    const u = el.querySelector('#u'); u.oninput = () => { state.url = u.value; };
    el.querySelector('#ex').onclick = () => { state.url = EXAMPLE; u.value = EXAMPLE; };
    el.querySelector('#go').onclick = async () => {
      state = { ...state, busy: true, err: '', res: null, note: '' }; draw();
      try { state.res = await importGithub(state.url, (a, b) => { state.prog = [a, b]; el.querySelector('.progress i')?.style.setProperty('width', a / b * 100 + '%'); }); }
      catch (e) { state.err = e.message.startsWith('Import') ? e.message : (e.message || String(e)); }
      state.busy = false; draw();
    };
    el.querySelector('#open')?.addEventListener('click', async () => { await app.setProject(r.project); app.go('editor'); });
    el.querySelector('#map')?.addEventListener('click', async () => { state.note = await mapToRecipe(r.project); draw(); });
    wireAsk(el, t('imp_title'), () => `Import address: ${state.url}\nResult: ${r ? `${r.project}, ${r.files} files` : state.err || 'none'}`);
  };
  draw();
}
