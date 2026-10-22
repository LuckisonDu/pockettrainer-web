// Notes：Key takeaways（规则生成）、Learning plan（勾选）、My notes（存在 IndexedDB）。
import { esc } from '../util.js';
import { t } from '../i18n.js';
import { allRuns, getNotes, getPlan, setPlan } from '../store.js';
import { takeaways } from '../advice.js';
import { friendly } from '../ui.js';
import { askHtml, wireAsk } from '../chatgpt.js';

export default async function page(el, app) {
  const proj = app.project, runs = (await allRuns()).filter(r => r.project === proj), notes = await getNotes(proj), plan = await getPlan(proj);
  const tk = await takeaways(runs, proj), lr = runs[0] ? runs[0].lr * 2 : 0.1;
  const items = [[t('plan_review'), 5], [t('plan_test', String(Number(lr.toPrecision(2)))), 8], [t('plan_compare'), 5]];
  el.innerHTML = `<div class="row sp"><h1>${esc(t('notes_title'))}</h1><a class="btn fill" href="#/note-new" style="text-decoration:none">+ ${esc(t('cd_add_note'))}</a></div>
    <div class="grid g2e"><div><div class="card"><h2>${esc(t('notes_takeaways'))}</h2><p class="small mute">${esc(t('web_notes_made'))}</p>
      <div class="list">${tk.map(([x, tag]) => `<div>${esc(x)} <span class="pill">${esc(tag)}</span></div>`).join('')}</div></div>
      <div class="card"><h2>${esc(t('notes_plan'))}</h2><div class="list">${items.map(([x, m], i) => `<label class="row sp clickable"><span><input type="checkbox" data-i="${i}" ${plan[i] ? 'checked' : ''}> ${esc(x)}</span><span class="pill">${esc(t('plan_min', m))}</span></label>`).join('')}</div>
        <p class="small mute" id="pd">${esc(t('plan_done', plan.filter(Boolean).length))}</p></div></div>
      <div class="card"><h2>${esc(t('notes_mine'))}</h2>${notes.length ? `<div class="list">${notes.map(n => `<div><b>${esc(n.title)}</b><div class="small mute">${esc(n.body)}</div><div class="small mute">${esc(friendly(n.date))}</div></div>`).join('')}</div>` : `<p class="mute">${esc(t('notes_empty'))}</p>`}</div></div>
    <div class="row">${askHtml()}</div>`;
  el.querySelectorAll('[data-i]').forEach(c => c.onchange = async () => { plan[+c.dataset.i] = c.checked; await setPlan(proj, plan); el.querySelector('#pd').textContent = t('plan_done', plan.filter(Boolean).length); });
  wireAsk(el, t('nav_notes'), () => `Key takeaways:\n${tk.map(x => '- ' + x[0]).join('\n')}\nNotes: ${notes.slice(0, 3).map(n => n.title).join(' | ')}`);
}
