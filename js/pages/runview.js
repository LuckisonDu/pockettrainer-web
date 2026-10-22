// 训练结果的公用显示：结果横幅、Output 控制台、Loss/accuracy 曲线。Editor 和 Tables 页都用它。
import { esc } from '../util.js';
import { t } from '../i18n.js';
import { chartLegend, drawChart } from '../ui.js';

export function bannerHtml(tr) {
  const r = tr.result;
  if (tr.phase === 'crashed') return `<div class="banner warn">💥 ${esc(t('web_crashed', tr.crashedAt))}</div>`;
  if (!r) return '';
  if (r.wrong) return `<div class="banner bad">${esc(t('banner_failed', Math.round(r.acc * 100)))}</div>`;
  if (r.repairs > 0) return `<div class="banner warn">${esc(t(r.repairs === 1 ? 'banner_fixed_one' : 'banner_fixed_many', r.repairs))}</div>`;
  if (!tr.opts.protect) return `<div class="banner warn">${esc(t('banner_off'))}</div>`;
  return `<div class="banner ok">${esc(t('banner_ok'))}</div>` + (r.resumedFrom >= 0 ? `<div class="banner ok">${esc(t('banner_resumed', r.resumedFrom))}</div>` : '');
}
export function statsHtml(tr) {
  const r = tr.result; if (!r) return '';
  return `<div class="kv"><span class="mute">${esc(t('web_final_acc'))}</span><b>${(r.acc * 100).toFixed(1)}%</b></div>
    <div class="kv"><span class="mute">${esc(t('web_total_steps'))}</span><b>${r.total}</b></div>
    <div class="kv"><span class="mute">${esc(t('web_errors_fixed'))}</span><b>${r.repairs}</b></div>
    <div class="kv"><span class="mute">${esc(t('web_time'))}</span><b>${(r.elapsedMs / 1000).toFixed(1)} s</b></div>
    ${r.resumedFrom >= 0 ? `<div class="kv"><span class="mute">${esc(t('banner_resumed', r.resumedFrom))}</span><b>✓</b></div>` : ''}`;
}

// 把 #out（控制台）#chart（画布）等挂到 host 里，并随训练状态刷新。返回取消订阅函数。
export function mountRun(host, tr) {
  host.innerHTML = `<div class="grid g2e">
    <div class="card"><h2>${esc(t('web_chart_title'))}</h2>${chartLegend()}<div class="chartbox"><canvas class="chart" id="chart"></canvas></div><p class="small mute" style="margin:6px 0 0">${esc(t('web_chart_note'))}</p></div>
    <div class="card"><h2>${esc(t('ed_output'))}</h2><div class="progress"><i id="bar" style="width:0"></i></div><pre class="console" id="out"></pre></div></div>`;
  const out = host.querySelector('#out'), bar = host.querySelector('#bar'), canvas = host.querySelector('#chart');
  const paint = () => {
    out.textContent = tr.log.length ? tr.log.join('\n') : t('ed_press_run');
    out.scrollTop = out.scrollHeight;
    bar.style.width = (tr.total ? (tr.step / tr.total) * 100 : 0) + '%';
    drawChart(canvas, tr.curve, { total: tr.total });
  };
  const unsub = tr.subscribe(paint); paint();
  const onResize = () => drawChart(canvas, tr.curve, { total: tr.total });
  addEventListener('resize', onResize);
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', onResize);
  requestAnimationFrame(onResize);
  return () => { unsub(); removeEventListener('resize', onResize); };
}
