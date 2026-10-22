// Environment：Analyze -> Resolve -> Install -> Test 四步真检查；Environment report 摘要；模型权重文件清单（逐个下载）。
import { esc, sha256, kb } from '../util.js';
import { t } from '../i18n.js';
import { listFiles, readFile, getProject, ConfigCode } from '../store.js';
import { TrainClient } from '../train-client.js';
import { scanProject, readManifest, reportFor, isTextName, BUILTIN, downloadWeight, MAX_WEIGHT } from '../importer.js';
import { dbGet } from '../db.js';
import { toast } from '../ui.js';
import { askHtml, wireAsk } from '../chatgpt.js';

export function pkgTable(pk) {
  if (!pk.length) return `<p class="mute small">${esc(t('web_no_pkgs'))}</p>`;
  return `<table><tr><th>${esc(t('env_packages'))}</th><th></th><th></th></tr>${pk.map(p => `<tr><td><b>${esc(p.name)}</b><div class="small mute">${esc(p.from || '')}</div></td>
    <td class="small mute">${esc(t('env_needs', p.spec || '–', p.status === 'builtin' ? (BUILTIN.find(b => b[0] === p.name)?.[1] || '1.0') : '–'))}</td>
    <td><span class="pill ${p.status === 'builtin' ? '' : 'warn'}">${esc(p.status === 'builtin' ? t('env_pkg_builtin') : t('pkg_na'))}</span>${p.status === 'na' ? `<div class="small mute">${esc(p.reason === 'heavy' ? t('pkg_reason_heavy') : t('pkg_reason_python'))}</div>` : ''}</td></tr>`).join('')}</table>`;
}
export function reportCard(rep, license) {
  return `<div class="card"><h2>${esc(t('report_title'))}</h2><div class="row"><span class="pill ${rep.ready ? '' : 'warn'}">${esc(rep.ready ? t('report_ready') : t('report_readonly'))}</span>
    ${license !== undefined ? `<span class="small mute">${esc(license ? t('search_license', license) : t('search_license_unknown'))}</span>` : ''}</div>
    ${rep.missing.length ? `<p class="small">${esc(t('report_missing', rep.missing.slice(0, 12).join(', ')))}${rep.missing.length > 12 ? ' …' : ''}</p>` : ''}</div>`;
}

export default async function page(el, app) {
  const proj = app.project;
  const S = { phase: 0, status: t('env_st_none'), pk: [], conflict: null, log: [], passed: null, busy: false };
  const say = s => { S.log.push(new Date().toLocaleTimeString([], { hour12: false }) + '  ' + s); draw(); };
  let rep = await reportFor(proj), mf = rep.manifest, destroyed = false;
  const stepNames = ['env_analyze', 'env_resolve', 'env_install', 'env_test'];
  async function draw() {
    if (destroyed) return;
    const weights = mf?.weights || [];
    el.innerHTML = `<div class="row sp"><div><h1>${esc(t('env_title'))}</h1><div class="mute">${esc(t('env_project'))}: <b>${esc(proj)}</b></div></div><button class="btn fill" id="chk" ${S.busy ? 'disabled' : ''}>${esc(S.busy ? t('env_checking') : t('env_check_again'))}</button></div>
      <div class="grid g2e"><div><div class="card"><h2>${esc(t('env_check'))}</h2><div class="steps">${stepNames.map((k, i) => `<div class="${S.phase > i ? 'done' : S.phase === i && S.busy ? 'cur' : ''}">${esc(t(k))}</div>`).join('')}</div>
        <div class="${S.passed === false ? 'banner bad' : S.passed ? 'banner ok' : 'mute'}">${esc(S.status)}</div></div>
        <div class="card"><h2>${esc(t('env_packages'))}</h2>${S.busy && !S.pk.length ? `<p class="mute">${esc(t('env_waiting'))}</p>` : pkgTable(S.pk)}</div>
        <div class="card"><h2>${esc(t('env_conflict_title'))}</h2>${S.passed === null ? `<p class="mute">${esc(t('env_not_checked'))}</p>` : S.conflict ? `<p class="banner warn" style="font-weight:500">${esc(S.conflict)}</p>` : `<p class="banner ok" style="font-weight:500">${esc(t('env_no_conflict'))}</p>`}</div></div>
      <div>${S.passed !== null ? reportCard({ ready: rep.ready, missing: S.pk.filter(p => p.status === 'na').map(p => p.name) }, mf?.license) : ''}
        <div class="card"><h2>${esc(t('env_log'))}</h2><pre class="console">${esc(S.log.join('\n'))}</pre></div>
        ${weights.length ? `<div class="card"><h2>${esc(t('weights_title'))}</h2><p class="small mute">${esc(t('weights_note'))}</p><div class="list">${weights.map((w, i) => `<div class="row sp"><div><span class="mono small">${esc(w.path)}</span><div class="small mute">${kb(w.size)}${w.sha256 ? ' · sha256 ' + esc(w.sha256.slice(0, 12)) + '…' : ''}</div></div>
          ${w.downloaded ? `<span class="pill">${esc(t('weights_done'))}</span>` : w.size > MAX_WEIGHT ? `<span class="pill warn">${esc(t('weights_toobig'))}</span>` : `<button class="btn sm" data-w="${i}">${esc(t('weights_download'))}</button>`}</div>`).join('')}</div></div>` : ''}</div></div>
      <div class="row">${askHtml()}</div>`;
    el.querySelector('#chk').onclick = check;
    el.querySelectorAll('[data-w]').forEach(b => b.onclick = async () => { b.disabled = true; try { await downloadWeight(proj, weights[+b.dataset.w]); mf = await readManifest(proj); toast(t('weights_done')); } catch (e) { toast(e.message); } draw(); });
    wireAsk(el, t('env_title'), () => `Project: ${proj}\nStatus: ${S.status}\nPackages: ${S.pk.map(p => `${p.name} (${p.status})`).join(', ')}\nLog:\n${S.log.slice(-8).join('\n')}`);
  }
  async function check() {
    if (S.busy) return;
    Object.assign(S, { busy: true, passed: null, phase: 0, pk: [], conflict: null, log: [], status: t('env_st_manifest') }); draw();
    const fail = m => { say('✗ ' + m); S.passed = false; S.busy = false; S.status = m; draw(); };
    try {
      // 1. Analyze：读文件、查有没有不是文本的文件、查配方键
      const files = await listFiles(proj), model = await readFile(proj, 'code/model.py'); rep = await reportFor(proj); mf = rep.manifest;
      const bad = files.filter(f => f.path !== 'manifest.json' && !isTextName(f.path.split('/').pop()) && !/\.(md|txt|json)$/.test(f.path));
      if (bad.length) return fail(`Files that are not plain text/data are not allowed: ${bad.map(b => b.path).join(', ')}`);
      say(`${files.length} files present · no executable files · recipe keys: ${rep.ready ? 'found' : 'not found'}`);
      S.phase = 1; S.status = t('env_st_resolve'); draw();
      // 2. Resolve：读 requirements / import 语句，对照本软件内置组件
      S.pk = (await getProject(proj)).kind === 'imported' ? (rep.packages.length ? rep.packages : await scanProject(proj)) : BUILTIN.slice(0, 3).map(([n, v]) => ({ name: n, spec: v.split('.')[0], from: 'manifest', status: 'builtin', reason: '' })).concat(await scanProject(proj));
      const na = S.pk.filter(p => p.status === 'na');
      S.conflict = na.length ? `${na.length} not available: ${na.slice(0, 6).map(p => p.name).join(', ')}${na.length > 6 ? '…' : ''} (${t('pkg_reason_python')})` : null;
      say(na.length ? `Resolve: ${S.pk.length - na.length} built-in, ${na.length} not available` : `All ${S.pk.length} required packages are compatible`);
      S.phase = 2; S.status = t('env_st_data'); draw();
      // 3. Install：核对 SHA-256（内置数据文件 / 导入文件和导入时记录的是否一致）
      if (mf?.kind === 'imported') {
        let changed = 0; for (const e of mf.imported) { const txt = await dbGet(`file:${proj}:${e.path}`); if (txt === undefined) return fail('Missing file: ' + e.path); if (await sha256(txt) !== e.sha256) changed++; }
        say(`SHA-256 checked for ${mf.imported.length} files from ${mf.source}: ${changed ? changed + ' edited by you' : 'all unchanged'}`);
      } else { await TrainClient.once({ cmd: 'verify' }, say); }
      S.phase = 3; S.status = t('env_st_test'); draw();
      // 4. Test：只有带配方键的项目才跑 3 步对拍
      if (rep.ready) {
        const r = await TrainClient.once({ cmd: 'test3' });
        r.steps.forEach((s, i) => say(`Test step ${i + 1}: both computations agree (difference ${s.dist.toExponential(1)}), loss ${s.loss.toFixed(3)}`));
        if (!r.ok) return fail('Test failed: the two computations disagree');
        say('✓ Project is ready'); S.status = t('env_st_ready');
      } else { say('Read & edit only: this project has no recipe keys (use Map to recipe in the editor)'); S.status = t('env_st_ready_ro'); }
      S.phase = 4; S.passed = true; S.busy = false; draw();
    } catch (e) { fail(e.message); }
  }
  await draw(); check();
  return () => { destroyed = true; };
}
