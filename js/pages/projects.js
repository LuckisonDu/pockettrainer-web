// Projects 首页：继续训练卡片、项目列表（改名 / 复制 / 删除 / 导出 zip）、最近运行。
import { esc } from '../util.js';
import { t } from '../i18n.js';
import { listProjects, TEMPLATES, createProject, deleteProject, duplicateProject, renameProject, allRuns, runSummary, listFiles, readFile, getFinal } from '../store.js';
import { sheet, closeSheet, confirmBox, promptBox, friendly, toast } from '../ui.js';
import { askHtml, wireAsk } from '../chatgpt.js';
import { makeZip, download } from '../zip.js';

export default async function page(el, app) {
  const tr = app.trainer;
  async function draw() {
    const projects = await listProjects(), runs = await allRuns(), cur = projects.find(p => p.name === app.project) || projects[0];
    const fin = cur ? await getFinal(cur.name) : null, pend = tr.pending;
    el.innerHTML = `
      <div class="row sp"><div><h1>${esc(t('nav_projects'))}</h1><span class="chip">${esc(t('home_offline'))}</span></div><button class="btn fill" id="newp">+ ${esc(t('home_new_project'))}</button></div>
      <div style="height:14px"></div>
      ${pend && !tr.running ? `<div class="card" style="border:2px solid var(--teal)"><h2>${esc(t('resume_title'))}</h2><p>${esc(t('resume_text'))} <b>${esc(t('web_resume_from', pend.step))}</b> (${esc(pend.project)})</p>
        <div class="row"><button class="btn fill" id="rs">${esc(t('resume_yes'))}</button><button class="btn" id="rd">${esc(t('resume_discard'))}</button></div></div>` : ''}
      ${cur ? `<div class="card"><div class="small mute" style="letter-spacing:.06em">${esc(t('home_continue'))}</div><h2 style="font-size:20px;margin-top:4px">${esc(cur.name)}</h2>
        <div class="mute small">${esc(t('home_last_opened', friendly(cur.openedAt)))} · ${esc(pend && pend.project === cur.name ? t('home_ckpt_unfinished', pend.step) : fin ? t('home_ckpt', fin.step) : t('home_no_ckpt'))}</div>
        <div class="row" style="margin-top:10px"><button class="btn fill" id="open">${esc(pend && pend.project === cur.name ? t('home_resume_project') : t('home_open_project'))}</button></div></div>` : ''}
      <div class="grid g2e">
        <div class="card"><h2>${esc(t('home_your_projects'))}</h2><div class="list">${projects.map(p => `<div class="row sp clickable" data-p="${esc(p.name)}"><div><b>${esc(p.name)}</b><div class="small mute">${esc(p.blurb || p.source || '')} · ${esc(friendly(p.openedAt))}</div></div><button class="btn sm" data-menu="${esc(p.name)}" aria-label="${esc(t('cd_more'))}">⋮</button></div>`).join('')}</div></div>
        <div class="card"><h2>${esc(t('home_latest_runs'))}</h2>${runs.length ? `<div class="list">${runs.slice(0, 6).map(r => `<div><b>${esc(r.project)}</b><div class="small ${r.wrong ? 'err' : 'mute'}">${esc(runSummary(r, t))}</div><div class="small mute">${esc(friendly(r.date))}</div></div>`).join('')}</div>` : `<p class="mute">${esc(t('home_no_runs'))}</p>`}</div>
      </div>
      <div class="card"><div class="list">
        ${[['lab', 'lab_title', 'lab_intro'], ['find', 'find_title', 'find_sub'], ['import', 'home_import_title', 'home_import_sub'], ['tables', 'web_tables_nav', 'web_tables_sub'], ['image', 'web_image_nav', 'web_onnx_model']].map(([r, k, s]) => `<a class="row sp clickable" href="#/${r}" style="text-decoration:none;color:inherit"><div><b>${esc(t(k))}</b>${s === 'lab_intro' ? '' : `<div class="small mute">${esc(t(s))}</div>`}</div><span class="mute">›</span></a>`).join('')}</div></div>
      <div class="row">${askHtml()}</div>`;
    wireAsk(el, t('nav_projects'), () => `Current project: ${cur?.name}\nProjects: ${projects.map(p => p.name).join(', ')}\nLatest run: ${runs[0] ? runSummary(runs[0], k => k) + ' acc=' + (runs[0].accuracy * 100).toFixed(1) : 'none'}`);
    el.querySelector('#newp').onclick = newProject;
    el.querySelector('#open')?.addEventListener('click', async () => { if (pend && pend.project === cur.name) { app.go('editor'); tr.resume(); } else app.go('editor'); });
    el.querySelector('#rs')?.addEventListener('click', () => { app.setProject(pend.project); app.go('editor'); tr.resume(); });
    el.querySelector('#rd')?.addEventListener('click', () => tr.discard());
    el.querySelectorAll('[data-p]').forEach(r => r.onclick = async e => { if (e.target.closest('[data-menu]')) return; await app.setProject(r.dataset.p); app.go('editor'); });
    el.querySelectorAll('[data-menu]').forEach(b => b.onclick = () => menu(b.dataset.menu));
  }
  function newProject() {
    const d = sheet(`<h2>${esc(t('home_new_project'))}</h2><div class="list">${TEMPLATES.map((x, i) => `<div class="clickable" data-t="${i}"><b>${esc(x.title)}</b><div class="small mute">${esc(x.blurb)}</div></div>`).join('')}</div>`);
    d.querySelectorAll('[data-t]').forEach(r => r.onclick = async () => { const n = await createProject(TEMPLATES[+r.dataset.t], undefined); closeSheet(); await app.setProject(n); draw(); });
  }
  function menu(name) {
    const d = sheet(`<h2>${esc(name)}</h2><div class="list"><div class="clickable" data-a="open">${esc(t('fm_open'))}</div><div class="clickable" data-a="rename">${esc(t('fm_rename'))}</div><div class="clickable" data-a="dup">${esc(t('fm_duplicate'))}</div><div class="clickable" data-a="zip">${esc(t('web_export_zip'))}</div><div class="clickable err" data-a="del">${esc(t('fm_delete'))}</div></div>`);
    d.querySelectorAll('[data-a]').forEach(r => r.onclick = async () => {
      const a = r.dataset.a; closeSheet();
      if (a === 'open') { await app.setProject(name); app.go('editor'); }
      if (a === 'rename') { const n = await promptBox(t('fm_rename'), name); if (n) { const to = await renameProject(name, n); if (app.project === name) await app.setProject(to); draw(); } }
      if (a === 'dup') { await duplicateProject(name); draw(); }
      if (a === 'zip') exportZip(name);
      if (a === 'del' && await confirmBox(t('fm_delete'), name, t('fm_delete'))) { await deleteProject(name); if (app.project === name) { app.project = (await listProjects())[0]?.name; } draw(); }
    });
  }
  const unsub = tr.subscribe(() => { if (!tr.running) draw(); });
  await draw();
  return unsub;
}

// Export 为 zip：项目里所有文件（文本）+ 最近一次训练的权重（如果有）
export async function exportZip(name) {
  const enc = new TextEncoder(), files = [];
  for (const f of await listFiles(name)) files.push({ path: f.path, data: enc.encode(await readFile(name, f.path)) });
  const fin = await getFinal(name);
  if (fin) files.push({ path: `checkpoints/step_${String(fin.step).padStart(6, '0')}.f32`, data: new Uint8Array(fin.params) });
  download(makeZip(files), name.replace(/[^\w.-]+/g, '_') + '.zip');
  toast(t('web_export_zip') + ' ✓');
}
