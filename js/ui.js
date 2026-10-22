// 界面小工具：图标、提示条、弹窗、代码高亮编辑器、曲线图。没有任何框架。
import { esc } from './util.js';
import { t } from './i18n.js';

const P = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const ICONS = {
  projects: P('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>'),
  editor: P('<path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/>'),
  env: P('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.4 2.4-2.6-.6-.6-2.6z"/>'),
  notes: P('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  assistant: P('<path d="M12 3l2.4 5.6L20 11l-5.6 2.4L12 19l-2.4-5.6L4 11l5.6-2.4z"/>'),
  settings: P('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  lab: P('<path d="M9 3h6M10 3v6L4 20h16L14 9V3"/>'),
  find: P('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'),
  table: P('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/>'),
  image: P('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5L5 20"/>'),
};

let toastTimer;
export function toast(msg) {
  const el = document.getElementById('toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}
// 弹窗（一个公用的 <dialog>）：html 是内容；返回 dialog 元素
export function sheet(html) {
  const d = document.getElementById('sheet');
  document.getElementById('sheetbody').innerHTML = html;
  if (!d.open) d.show();   // 非模态：框要留在 9:16 的应用框里
  d.querySelector('input, textarea, button')?.focus();
  return d;
}
export const closeSheet = () => document.getElementById('sheet').close();
// 简单的确认 / 输入弹窗（Promise 版）
export function confirmBox(title, text, okLabel = t('common_ok')) {
  return new Promise(res => {
    const d = sheet(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="row" style="justify-content:flex-end"><button class="btn" data-x="0">${t('common_cancel')}</button><button class="btn fill" data-x="1">${esc(okLabel)}</button></div>`);
    d.onclose = () => res(false);
    d.querySelectorAll('[data-x]').forEach(b => b.onclick = () => { d.onclose = null; d.close(); res(b.dataset.x === '1'); });
  });
}
export function promptBox(title, value = '', okLabel = t('common_ok')) {
  return new Promise(res => {
    const d = sheet(`<h2>${esc(title)}</h2><input type="text" id="pbv" style="width:100%" value="${esc(value)}"><div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" data-x="0">${t('common_cancel')}</button><button class="btn fill" data-x="1">${esc(okLabel)}</button></div>`);
    const inp = d.querySelector('#pbv'); inp.focus(); inp.select();
    d.onclose = () => res(null);
    const done = ok => { d.onclose = null; d.close(); res(ok ? inp.value : null); };
    inp.onkeydown = e => { if (e.key === 'Enter') done(true); };
    d.querySelectorAll('[data-x]').forEach(b => b.onclick = () => done(b.dataset.x === '1'));
  });
}
export const friendly = ms => {
  if (!ms) return t('day_never');
  const d = new Date(ms), now = new Date(), time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const days = Math.round((new Date(now.toDateString()) - new Date(d.toDateString())) / 864e5);
  return days === 0 ? t('day_today', time) : days === 1 ? t('day_yesterday', time) : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};

// ---------- 简单的 Python 语法着色（只是为了好看，不是真解析器） ----------
const KW = new Set('def class import from as for in if elif else while return pass break continue and or not is None True False with try except finally lambda yield raise global'.split(' '));
export function highlight(code) {
  return code.split('\n').map(line => {
    const ci = line.search(/#/);   // 注意：不处理字符串里的 #，这里只是着色
    let body = ci >= 0 ? line.slice(0, ci) : line, com = ci >= 0 ? line.slice(ci) : '';
    body = esc(body).replace(/(&quot;.*?&quot;|&#39;.*?&#39;)|\b(\d+\.?\d*(?:e-?\d+)?)\b|\b([A-Za-z_]\w*)\b/g, (m, s, n, w) =>
      s ? `<span class="t-str">${s}</span>` : n ? `<span class="t-num">${n}</span>` : KW.has(w) ? `<span class="t-kw">${w}</span>` : m);
    return body + (com ? `<span class="t-com">${esc(com)}</span>` : '');
  }).join('\n');
}
// 编辑器：行号 + 着色层 + 透明 textarea。onChange(text) 在每次输入后调用
export function codeEditor(host, text, onChange, readOnly = false) {
  host.innerHTML = `<div class="gut"></div><div class="wrap"><pre aria-hidden="true"></pre><textarea spellcheck="false" ${readOnly ? 'readonly' : ''}></textarea></div>`;
  const gut = host.querySelector('.gut'), pre = host.querySelector('pre'), ta = host.querySelector('textarea');
  const paint = () => {
    gut.textContent = ta.value.split('\n').map((_, i) => i + 1).join('\n');
    pre.innerHTML = highlight(ta.value) + '\n';
  };
  const sync = () => { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; gut.scrollTop = ta.scrollTop; };
  ta.value = text; paint();
  ta.addEventListener('input', () => { paint(); sync(); onChange?.(ta.value); });
  ta.addEventListener('scroll', sync);
  ta.addEventListener('keydown', e => { if (e.key === 'Tab' && !readOnly) { e.preventDefault(); document.execCommand('insertText', false, '    '); } });
  return { get: () => ta.value, set: v => { ta.value = v; paint(); }, focus: () => ta.focus() };
}

// ---------- 曲线图：Canvas 自己画（训练损失、验证损失、测试准确率） ----------
export function drawChart(canvas, curve, { total = 0, showAcc = true } = {}) {
  const css = getComputedStyle(document.documentElement), c = n => css.getPropertyValue(n).trim();
  const z = parseFloat(css.getPropertyValue('--z')) || 1, r0 = canvas.getBoundingClientRect();   // 应用框整体放大了 z 倍
  const dpr = (window.devicePixelRatio || 1) * z, W = Math.round(r0.width / z), H = Math.round(r0.height / z);
  if (!W) return;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const g = canvas.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, W, H);
  const L = 40, R = showAcc ? 40 : 12, T = 8, B = 24, w = W - L - R, h = H - T - B;
  const xmax = Math.max(total, curve.at(-1)?.step ?? 1, 1);
  const lmax = Math.max(0.5, ...curve.flatMap(p => [p.trainLoss, p.valLoss]).filter(Number.isFinite));
  const ymax = Math.max(1.2, Math.ceil(lmax / 0.4) * 0.4);   // 刻度每格 0.3 / 0.6 …
  const X = s => L + (s / xmax) * w, YL = v => T + h - (Math.min(v, ymax) / ymax) * h, YA = v => T + h - v * h;
  g.font = '11px system-ui'; g.fillStyle = c('--mute'); g.strokeStyle = c('--line'); g.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = T + (h * i) / 4; g.beginPath(); g.moveTo(L, y); g.lineTo(L + w, y); g.stroke();
    g.textAlign = 'right'; g.fillText((ymax * (1 - i / 4)).toFixed(1), L - 6, y + 4);
    if (showAcc) { g.textAlign = 'left'; g.fillText(100 - i * 25 + '%', L + w + 6, y + 4); }
  }
  g.textAlign = 'center'; g.fillText(t('ed_step') + (xmax ? ` (0 – ${xmax})` : ''), L + w / 2, H - 6);
  const line = (key, Y, color) => {
    const pts = curve.filter(p => Number.isFinite(p[key]));
    if (!pts.length) return;
    g.strokeStyle = color; g.lineWidth = 2; g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(X(p.step), Y(p[key])) : g.moveTo(X(p.step), Y(p[key]))));
    g.stroke();
    const l = pts.at(-1); g.fillStyle = color; g.beginPath(); g.arc(X(l.step), Y(l[key]), 3, 0, 7); g.fill();
  };
  line('trainLoss', YL, c('--blue')); line('valLoss', YL, c('--teal'));
  if (showAcc) line('acc', YA, c('--orange'));
}
export const chartLegend = () => `<div class="legend"><span><i style="background:var(--blue)"></i>${t('ed_train_loss')}</span><span><i style="background:var(--teal)"></i>${t('ed_val_loss')}</span><span><i style="background:var(--orange)"></i>${t('ed_acc')}</span></div>`;
