// Tables：表格数据集（CSV / JSONL）-> 在浏览器里用同一个训练核训练（输入维度可变），带保护。
import { esc, kb } from '../util.js';
import { t } from '../i18n.js';
import { parseTable, numericColumns, buildDataset } from '../tabular.js';
import { get } from '../net.js';
import { settings } from '../store.js';
import { askHtml, wireAsk } from '../chatgpt.js';
import { mountRun, bannerHtml, statsHtml } from './runview.js';

const EXAMPLES = { iris: { file: 'iris.csv', label: 'species', h: 16, lr: 0.1, epochs: 100, license: 'CC BY 4.0 (UCI / Fisher 1936)' }, wine: { file: 'wine.csv', label: 'wine_class', h: 32, lr: 0.1, epochs: 100, license: 'CC BY 4.0 (UCI Wine, Forina et al.)' } };

export default async function page(el, app) {
  const tr = app.trainer;
  const S = { name: '', tab: null, label: -1, feats: [], num: [], h: 16, lr: 0.1, epochs: 100, seed: 1, err: '', info: '', src: '' };
  // 默认特征：所有数字列（标签列除外）；名字像 id / index 的列只是行号，默认不选
  const defaultFeats = () => S.num.map((n, i) => (n && i !== S.label && !/^(id|index|unnamed.*)$/i.test(S.tab.header[i].trim()) ? i : -1)).filter(i => i >= 0);
  async function load(name, text, src) {
    try { S.tab = parseTable(name, text); S.name = name; S.src = src; S.num = numericColumns(S.tab); S.err = '';
      S.label = S.tab.header.length - 1; S.feats = defaultFeats(); }
    catch (e) { S.err = e.message; }
    draw();
  }
  async function loadExample(key) {
    const ex = EXAMPLES[key], txt = await (await fetch(new URL('../../data/' + ex.file, import.meta.url))).text();
    await load(ex.file, txt, `${ex.file} · ${ex.license}`);
    S.label = S.tab.header.indexOf(ex.label); S.feats = defaultFeats();
    Object.assign(S, { h: ex.h, lr: ex.lr, epochs: ex.epochs }); draw();
  }
  function draw() {
    const T = S.tab;
    el.innerHTML = `<h1>${esc(t('web_tables_nav'))}</h1><p class="mute">${esc(t('web_tables_intro'))}</p>
      <div class="card"><h2>${esc(t('web_tab_source'))}</h2><div class="row"><button class="btn" data-ex="iris">iris</button><button class="btn" data-ex="wine">wine</button>
        <label class="btn">${esc(t('web_tab_file'))}<input type="file" id="file" accept=".csv,.jsonl,.json,.txt" style="display:none"></label><a class="btn" href="#/find" style="text-decoration:none" id="hfgo">${esc(t('web_tab_hf'))}</a></div>
        <div class="row" style="margin-top:8px"><input type="text" id="url" style="flex:1;min-width:220px" placeholder="https://huggingface.co/datasets/…/resolve/main/data.csv"><button class="btn" id="getUrl">${esc(t('web_tab_load_url'))}</button></div>
        ${S.err ? `<div class="banner bad">${esc(S.err)}</div>` : ''}${S.src ? `<p class="small mute">${esc(S.src)}</p>` : ''}</div>
      ${T ? `<div class="grid g2"><div class="card"><h2>${esc(t('web_tab_preview'))} · ${T.rows.length} ${esc(t('web_tab_rows'))}</h2><div style="overflow:auto;max-height:260px"><table><tr>${T.header.map(h => `<th>${esc(h)}</th>`).join('')}</tr>${T.rows.slice(0, 8).map(r => `<tr>${r.map(c => `<td>${esc(String(c).slice(0, 30))}</td>`).join('')}</tr>`).join('')}</table></div></div>
        <div class="card params"><h2>${esc(t('web_tab_columns'))}</h2><div class="p"><label>${esc(t('web_tab_label'))}</label><select id="label">${T.header.map((h, i) => `<option value="${i}" ${i === S.label ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></div>
          <div class="small mute">${esc(t('web_tab_features'))}</div><div style="max-height:130px;overflow:auto">${T.header.map((h, i) => i === S.label ? '' : `<label class="row small"><input type="checkbox" data-f="${i}" ${S.feats.includes(i) ? 'checked' : ''} ${S.num[i] ? '' : 'disabled'}> ${esc(h)}${S.num[i] ? '' : ' <span class="mute">(text)</span>'}</label>`).join('')}</div>
          <div class="p"><label>${esc(t('ed_hidden'))}</label><input id="th" type="text" value="${S.h}"></div><div class="p"><label>${esc(t('ed_lr'))}</label><input id="tl" type="text" value="${S.lr}"></div><div class="p"><label>${esc(t('ed_epochs'))}</label><input id="te" type="text" value="${S.epochs}"></div>
          <p class="small mute">${esc(t('web_tab_note'))}</p>
          <div class="row"><button class="btn fill big" id="run">${esc(tr.running ? t('ed_running') : t('ed_run'))}</button></div><div class="row" style="margin-top:8px"><button class="btn warn sm" id="bInt">⚡ ${esc(tr.interruptArmed ? t('lab_interrupt_armed') : t('lab_interrupt'))}</button></div></div></div>
        <div class="card" id="res"></div>` : ''}<div id="runhost"></div><div class="row">${askHtml()}</div>`;
    const $ = s => el.querySelector(s);
    el.querySelectorAll('[data-ex]').forEach(b => b.onclick = () => loadExample(b.dataset.ex));
    $('#file').onchange = async e => { const f = e.target.files[0]; if (f) { if (f.size > 5 * 1048576) { S.err = t('imp_err_big'); return draw(); } load(f.name, await f.text(), `${f.name} (${kb(f.size)}) · local file`); } };
    $('#getUrl').onclick = () => fetchUrl($('#url').value);
    if (!T) { wireAsk(el, t('web_tables_nav'), () => 'No table loaded yet.'); return; }
    $('#label').onchange = e => { S.label = +e.target.value; S.feats = defaultFeats(); draw(); };
    el.querySelectorAll('[data-f]').forEach(c => c.onchange = () => { S.feats = [...el.querySelectorAll('[data-f]')].filter(x => x.checked).map(x => +x.dataset.f); });
    $('#bInt').onclick = () => tr.toggleInterruption();
    $('#run').onclick = run;
    mountRun($('#runhost'), tr);
    const paint = () => { $('#res').innerHTML = bannerHtml(tr) + statsHtml(tr) + (S.info ? `<p class="small mute">${esc(S.info)}</p>` : ''); $('#res').style.display = $('#res').innerHTML.trim() ? '' : 'none'; };
    paint(); tr._tabPaint = paint;
    wireAsk(el, t('web_tables_nav'), () => `Table: ${S.name} (${T.rows.length} rows)\nColumns: ${T.header.join(', ')}\nLabel: ${T.header[S.label]}\nTraining: ${tr.log.slice(-6).join('\n')}`);
  }
  async function fetchUrl(url) {
    try { const txt = await get(url.trim(), { accept: 'text/plain', maxBytes: 5 * 1048576 }); await load(url.split('/').pop().split('?')[0] || 'data.csv', txt, url); }
    catch (e) { S.err = e.message; draw(); }
  }
  async function run() {
    if (tr.running) return;
    const g = id => el.querySelector(id).value.trim();
    const h = +g('#th'), lr = +g('#tl'), epochs = +g('#te');
    if (!(h >= 2 && h <= 512 && Number.isInteger(h)) || !(lr > 0 && lr <= 1) || !(epochs >= 1 && epochs <= 1000 && Number.isInteger(epochs))) { S.err = t('ed_err_hidden') + ' / ' + t('ed_err_lr') + ' / epochs 1–1000'; return draw(); }
    if (!S.feats.length) { S.err = t('web_tab_nofeat'); return draw(); }
    let data; try { data = buildDataset(S.tab, S.label, S.feats, S.seed); } catch (e) { S.err = e.message; return draw(); }
    S.err = ''; S.h = h; S.lr = lr; S.epochs = epochs;
    S.info = t('web_tab_split', data.nTrain, data.nTest, data.D, data.C);
    const total = Math.floor(data.nTrain / Math.min(128, data.nTrain)) * epochs;
    el.querySelector('#run').disabled = true;
    await tr.start({ project: 'Table: ' + S.name, dataset: 'tab:' + S.name, h, lr, epochs, seed: S.seed, D: data.D, C: data.C, evalEvery: Math.max(1, Math.floor(total / 20)), ckptEvery: Math.max(5, Math.floor(total / 6)) }, data);
    draw();
  }
  draw();
  if (app.params.url) fetchUrl(app.params.url);
  const unsub = tr.subscribe(() => { if (tr._tabPaint && el.querySelector('#res')) tr._tabPaint(); const b = el.querySelector('#run'); if (b) { b.textContent = tr.running ? t('ed_running') : t('ed_run'); b.disabled = tr.running; } });
  return () => { unsub(); delete tr._tabPaint; };
}
