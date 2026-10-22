// Editor + Run：model.py（行号 + 着色）、Parameters 与代码双向同步、Run、Output、曲线。
import { esc } from '../util.js';
import { t } from '../i18n.js';
import { ConfigCode, isRunnable, listFiles, readFile, writeFile, history, num, settings } from '../store.js';
import { codeEditor, sheet, closeSheet, toast } from '../ui.js';
import { askHtml, wireAsk } from '../chatgpt.js';
import { mountRun, bannerHtml, statsHtml } from './runview.js';

const RANGES = { learning_rate: [0.001, 1, false], hidden_units: [8, 512, true], epochs: [1, 30, true] };

export default async function page(el, app) {
  const tr = app.trainer, proj = app.project;
  if (!proj) { el.innerHTML = '<div class="card">…</div>'; return; }
  let file = app.params.file || 'code/model.py', text = await readFile(proj, file), saveTimer;
  const files = (await listFiles(proj)).map(f => f.path);
  if (!files.includes(file)) { file = 'code/model.py'; text = await readFile(proj, file); }
  const tabs = [...new Set(['code/model.py', 'code/train.py', 'code/config.json', 'README.md', file].filter(f => files.includes(f)))];

  el.innerHTML = `<div class="grid g2">
    <div class="card"><div class="row sp"><div class="tabs" id="tabs">${tabs.map(f => `<button data-f="${esc(f)}" class="${f === file ? 'on' : ''}">${esc(f.split('/').pop())}</button>`).join('')}</div>
      <div class="row"><button class="btn sm" id="files">${esc(t('cd_files'))}</button><button class="btn sm" id="hist">${esc(t('set_version_history'))}</button>${askHtml()}</div></div>
      <div class="editor" id="ed"></div>
      <p class="small mute" style="margin:8px 0 0">${esc(t('ed_note'))}</p><div id="recipe"></div></div>
    <div><div class="card params"><h2>${esc(t('ed_params'))}</h2>
      <div class="p"><label for="p_lr">${esc(t('ed_lr'))}</label><input id="p_lr" type="text" inputmode="decimal"></div>
      <div class="p"><label for="p_h">${esc(t('ed_hidden'))}</label><input id="p_h" type="text" inputmode="numeric"></div>
      <div class="p"><label for="p_e">${esc(t('ed_epochs'))}</label><input id="p_e" type="text" inputmode="numeric"></div>
      <div id="perr" class="small err"></div>
      <div class="row" style="margin:10px 0"><button class="btn fill big" id="run">${esc(t('ed_run'))}</button></div>
      <div class="row"><button class="btn warn sm" id="bInt">⚡ ${esc(t('lab_interrupt'))}</button><button class="btn info sm" id="bCrash">⊗ ${esc(t('lab_crash'))}</button><a class="btn soft sm" href="#/lab" style="text-decoration:none">${esc(t('lab_compare'))}</a></div>
      <p class="small mute" style="margin:8px 0 0">${esc(t('web_sim_note'))}</p></div>
      <div class="card" id="result"></div></div></div>
    <div id="runhost"></div>`;
  const $ = s => el.querySelector(s);
  const ed = codeEditor($('#ed'), text, onEdit);
  const unsub = mountRun($('#runhost'), tr);

  // ---- 参数框 <-> 代码 ----
  const inputs = { learning_rate: $('#p_lr'), hidden_units: $('#p_h'), epochs: $('#p_e') };
  function code2params(txt) { for (const [k, inp] of Object.entries(inputs)) { const v = ConfigCode.value(k, txt); if (v !== null && document.activeElement !== inp) inp.value = v; } }
  function validate(txt = text) {
    const bad = []; $('#perr').textContent = '';
    for (const [k, [lo, hi, isInt]] of Object.entries(RANGES)) {
      const v = Number(inputs[k].value), ok = inputs[k].value.trim() !== '' && Number.isFinite(v) && v >= lo && v <= hi && (!isInt || Number.isInteger(v));
      inputs[k].classList.toggle('bad', !ok); if (!ok) bad.push(t(k === 'learning_rate' ? 'ed_err_lr' : k === 'hidden_units' ? 'ed_err_hidden' : 'ed_err_epochs'));
    }
    $('#perr').textContent = bad[0] || ''; return !bad.length;
  }
  function recipeNote() {
    const runnable = isRunnable(rawModel);
    $('#recipe').innerHTML = runnable ? '' : `<div class="banner warn" style="font-weight:500">${esc(t('ed_not_runnable'))}<div style="margin-top:8px"><button class="btn sm" id="map">${esc(t('ed_map'))}</button></div></div>`;
    $('#run').disabled = !runnable || tr.running; Object.values(inputs).forEach(i => i.disabled = !runnable);
    $('#map')?.addEventListener('click', async () => { const { mapToRecipe } = await import('../importer.js'); const note = await mapToRecipe(proj); const d = sheet(`<h2>${esc(t('ed_map'))}</h2><p style="white-space:pre-line">${esc(note)}</p><p class="small mute">${esc(t('ed_map_after'))}</p><div class="row" style="justify-content:flex-end"><button class="btn fill" id="mok">${esc(t('common_ok'))}</button></div>`); d.querySelector('#mok').onclick = () => { closeSheet(); app.go('editor', { file: 'code/model.py' }); }; });
  }
  let rawModel = file === 'code/model.py' ? text : await readFile(proj, 'code/model.py');
  function onEdit(v) {
    text = v; if (file === 'code/model.py') { rawModel = v; code2params(v); validate(); recipeNote(); }
    clearTimeout(saveTimer); saveTimer = setTimeout(() => writeFile(proj, file, v), 500);
  }
  for (const [k, inp] of Object.entries(inputs)) inp.addEventListener('input', async () => {
    if (!validate()) return;
    const modelText = file === 'code/model.py' ? text : rawModel;
    const nt = ConfigCode.set(k, inp.value.trim(), modelText); rawModel = nt;
    if (file === 'code/model.py') { text = nt; ed.set(nt); }
    clearTimeout(saveTimer); saveTimer = setTimeout(() => writeFile(proj, 'code/model.py', nt), 300);
  });
  code2params(rawModel); validate(); recipeNote();

  // ---- 标签、历史版本 ----
  el.querySelectorAll('#tabs [data-f]').forEach(b => b.onclick = async () => { await writeFile(proj, file, text); app.go('editor', { file: b.dataset.f }); });
  $('#files').onclick = () => {   // 项目文件列表：点一个文件就在编辑器里打开
    const d = sheet(`<h2>${esc(t('files_title'))} · ${esc(proj)}</h2><div class="list">${files.map(f => `<div class="clickable" data-file="${esc(f)}">${esc(f)}</div>`).join('')}</div>`);
    d.querySelectorAll('[data-file]').forEach(r => r.onclick = async () => { closeSheet(); await writeFile(proj, file, text); app.go('editor', { file: r.dataset.file }); });
  };
  $('#hist').onclick = async () => {
    const hs = await history(proj, file);
    const d = sheet(`<h2>${esc(t('set_version_history'))} · ${esc(file)}</h2>${hs.length ? `<div class="list">${hs.map((h, i) => `<div class="row sp"><span class="small">${new Date(h.t).toLocaleString()} · ${h.text.length} chars</span><button class="btn sm" data-r="${i}">${esc(t('ed_restore'))}</button></div>`).join('')}</div>` : `<p class="mute">${esc(t('ed_hist_none'))}</p>`}`);
    d.querySelectorAll('[data-r]').forEach(b => b.onclick = async () => { const v = hs[+b.dataset.r].text; ed.set(v); text = v; await writeFile(proj, file, v); if (file === 'code/model.py') { rawModel = v; code2params(v); validate(); recipeNote(); } closeSheet(); });
  };

  // ---- Run 和打断 / 闪退按钮 ----
  $('#run').onclick = async () => {
    if (!validate() || tr.running) return;
    await writeFile(proj, file, text);
    const m = file === 'code/model.py' ? text : rawModel;
    tr.start({ project: proj, h: +ConfigCode.value('hidden_units', m), lr: +ConfigCode.value('learning_rate', m), epochs: +ConfigCode.value('epochs', m), seed: +ConfigCode.value('seed', m), D: 2048, C: 10 });
  };
  $('#bInt').onclick = () => tr.toggleInterruption();
  $('#bCrash').onclick = () => tr.toggleCrash();
  const refresh = () => {
    $('#run').textContent = tr.running ? t('ed_running') : t('ed_run'); $('#run').disabled = tr.running || !isRunnable(rawModel);
    $('#bInt').classList.toggle('armed', tr.interruptArmed); $('#bInt').textContent = '⚡ ' + (tr.interruptArmed ? t('lab_interrupt_armed') : t('lab_interrupt'));
    $('#bCrash').classList.toggle('armed', tr.crashArmed); $('#bCrash').textContent = '⊗ ' + (tr.crashArmed ? t('lab_crash_armed') : t('lab_crash'));
    const pend = tr.pending && !tr.running ? `<div class="banner warn" style="font-weight:500">${esc(t('resume_text'))} <b>${esc(t('web_resume_from', tr.pending.step))}</b><div class="row" style="margin-top:8px"><button class="btn fill sm" id="rs">${esc(t('resume_yes'))}</button><button class="btn sm" id="rd">${esc(t('resume_discard'))}</button></div></div>` : '';
    $('#result').innerHTML = pend + bannerHtml(tr) + statsHtml(tr) + (tr.error ? `<div class="banner bad">${esc(tr.error)}</div>` : '');
    $('#rs')?.addEventListener('click', () => tr.resume()); $('#rd')?.addEventListener('click', () => tr.discard());
    $('#result').style.display = $('#result').innerHTML.trim() ? '' : 'none';
  };
  const unsub2 = tr.subscribe(refresh); refresh();
  wireAsk(el, t('nav_editor'), () => `Project: ${proj}\nFile: ${file}\n\n${text.slice(0, 700)}\n\nOutput:\n${tr.log.slice(-8).join('\n')}`);
  return () => { unsub(); unsub2(); clearTimeout(saveTimer); writeFile(proj, file, text); };
}
