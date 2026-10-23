// Protection lab：故意把训练弄坏，看保护怎么修。含 Compare methods 三种做法对比、Measure my computer。
import { esc } from '../util.js';
import { t } from '../i18n.js';
import { TrainClient } from '../train-client.js';
import { askHtml, wireAsk } from '../chatgpt.js';
import { bannerHtml } from './runview.js';
import { ConfigCode, readFile, settings } from '../store.js';

export default async function page(el, app) {
  const tr = app.trainer;
  let rows = null, cmpBusy = '', meas = null, cmpErr = '', autoDone = false;
  const draw = () => {
    el.innerHTML = `<h1>${esc(t('lab_title'))}</h1><p class="mute">${esc(t('lab_intro'))}</p>
      <div class="card" id="demoCard"><h2>${esc(t('demo_title'))}</h2><p class="small mute">${esc(t('demo_sub'))}</p>
        <button class="btn fill big" id="demo" ${cmpBusy || tr.running ? 'disabled' : ''}>${esc(cmpBusy || t('demo_btn'))}</button>
        ${rows ? (() => { const n = rows.find(r => r.name === 'cmp_none'), o = rows.find(r => r.name === 'cmp_ours'); const bad = n && n.acc < 0.3; return `<div class="grid g2e" style="margin-top:10px"><div class="banner bad"><b>${esc(t('demo_none'))}</b><div style="font-size:30px;font-weight:800">${(n.acc * 100).toFixed(1)}%</div><div class="small">${esc(bad ? t('demo_wrong') : '')}</div></div><div class="banner ok"><b>${esc(t('demo_ours'))}</b><div style="font-size:30px;font-weight:800">${(o.acc * 100).toFixed(1)}%</div><div class="small">${esc(t('demo_fixed'))} · ${esc(t('demo_fixed_n', o.repairs))}</div></div></div>`; })() : ''}</div>
      
      <div class="grid g2e"><div class="card">
        <label class="switch"><span><b>${esc(t('set_verify'))}</b><br><span class="small mute">${esc(t('lab_verify_sub'))}</span></span><input type="checkbox" id="vf" ${settings.verify ? 'checked' : ''}></label>
        <div class="row" style="margin:10px 0"><button class="btn warn" id="bInt">⚡ ${esc(tr.interruptArmed ? t('lab_interrupt_armed') : t('lab_interrupt'))}</button>
          <button class="btn info" id="bCrash" ${settings.saveCheckpoints ? '' : 'disabled'}>⊗ ${esc(tr.crashArmed ? t('lab_crash_armed') : t('lab_crash'))}</button></div>
        <p class="small mute">${esc(settings.saveCheckpoints ? t('lab_crash_note') : t('lab_crash_note_off'))}</p>
        <p class="small" style="background:var(--warn-bg);color:var(--warn-ink);padding:8px 10px;border-radius:10px">${esc(t('web_sim_note'))}</p>
        <button class="btn fill big" id="run" ${tr.running ? 'disabled' : ''}>${esc(tr.running ? t('ed_running') : t('web_run_here'))}</button>
        <div class="progress"><i style="width:${tr.total ? tr.step / tr.total * 100 : 0}%"></i></div>
        <div class="small mute">${tr.running ? `${tr.step}/${tr.total}` : ''}</div>
        ${tr.phase === 'crashed' || (tr.pending && !tr.running) ? `<div class="banner warn" style="font-weight:500">${esc(t('web_resume_from', tr.pending?.step ?? tr.crashedAt))}<div class="row" style="margin-top:8px"><button class="btn fill sm" id="rs">${esc(t('resume_yes'))}</button></div></div>` : ''}
        ${bannerHtml(tr)}
      </div><div class="card"><h2>${esc(t('lab_compare'))}</h2><p class="small mute">${esc(t('lab_compare_note'))}</p>
        <button class="btn fill" id="cmp" ${cmpBusy || tr.running ? 'disabled' : ''}>${esc(cmpBusy || t('lab_compare'))}</button>${cmpErr ? `<div class="err small">${esc(cmpErr)}</div>` : ''}
        ${rows ? `<table style="margin-top:10px"><tr><th></th><th>${esc(t('web_acc'))}</th><th>${esc(t('web_repairs'))}</th><th>s</th><th></th></tr>${rows.map(r => `<tr><td>${esc(t(r.name))}</td><td><b>${(r.acc * 100).toFixed(1)}%</b></td><td>${r.repairs}</td><td>${r.seconds.toFixed(1)}</td><td><span class="pill ${r.ok ? '' : 'bad'}">${esc(r.ok ? t('cmp_matches') : t('cmp_differs'))}</span></td></tr>`).join('')}</table><p class="small mute">${esc(t('cmp_explain'))}</p>` : ''}</div></div>
      <div class="card"><h2>${esc(t('web_measure'))}</h2><p class="small mute">${esc(t('web_measure_note'))}</p><button class="btn" id="meas">${esc(t('web_measure'))}</button>
        ${meas ? `<p><b>${meas.medianMs.toFixed(0)} ms</b> / step (min ${meas.minMs.toFixed(0)}, max ${meas.maxMs.toFixed(0)}) · ${meas.cores} CPU threads · ${esc(t('web_measure_est', Math.round(meas.medianMs * 234 * 1.4 / 1000)))}</p>` : ''}</div>
      <div class="row">${askHtml()}</div>`;
    const $ = s => el.querySelector(s);
    $('#vf').onchange = e => { settings.verify = e.target.checked; import('../store.js').then(m => m.saveSettings()); app.refreshSide(); };
    $('#bInt').onclick = () => tr.toggleInterruption(); $('#bCrash').onclick = () => tr.toggleCrash();
    $('#run').onclick = async () => { const m = await readFile(app.project, 'code/model.py'); tr.start({ project: app.project, h: +ConfigCode.value('hidden_units', m) || 128, lr: +ConfigCode.value('learning_rate', m) || 0.05, epochs: +ConfigCode.value('epochs', m) || 6, seed: +ConfigCode.value('seed', m) || 1, D: 2048, C: 10 }); };
    $('#rs')?.addEventListener('click', () => tr.resume());
    const runCompare = async () => {
      cmpBusy = t('lab_run_of', 1, t('cmp_ref')); rows = null; cmpErr = ''; draw();
      const w = new Worker(new URL('../train-worker.js', import.meta.url), { type: 'module' });
      w.onmessage = e => { const m = e.data;
        if (m.type === 'progress') { cmpBusy = t('lab_run_of', m.index + 1, t(m.name)); draw(); }
        else if (m.type === 'result') { const ref = m.result.rows[0].acc; rows = m.result.rows.map(r => ({ ...r, ok: r.acc >= ref - 0.03 })); cmpBusy = ''; w.terminate(); draw(); }
        else if (m.type === 'error') { cmpErr = m.message; cmpBusy = ''; w.terminate(); draw(); } };
      w.postMessage({ cmd: 'compare', seed: 1 });
    };
    $('#cmp').onclick = runCompare; $('#demo').onclick = runCompare;
    if (!autoDone && /[?&]demo=1/.test(location.hash) && !cmpBusy && !tr.running) { autoDone = true; runCompare(); }
    $('#meas').onclick = async () => { $('#meas').disabled = true; meas = await TrainClient.once({ cmd: 'measure' }); draw(); };
    wireAsk(el, t('lab_title'), () => `Verify: ${settings.verify}\nLast run: ${tr.log.slice(-6).join('\n')}\nCompare: ${rows ? rows.map(r => `${r.name} ${(r.acc * 100).toFixed(1)}% repairs ${r.repairs}`).join('; ') : 'not run'}`);
  };
  draw();
  const unsub = tr.subscribe(() => { if (el.isConnected && !cmpBusy) draw(); });
  return unsub;
}
