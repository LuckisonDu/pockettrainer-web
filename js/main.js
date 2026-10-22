// 入口：启动、侧栏 / 底部 Tab、路由（地址里 # 后面的部分）、Service Worker 注册。
import { t, setLang, detect, applyStatic, LANGS } from './i18n.js';
import { settings, loadSettings, ensureDefaults, listProjects, getProject, touchProject, DEFAULT } from './store.js';
import { TrainClient } from './train-client.js';
import { ICONS, toast } from './ui.js';
import { esc } from './util.js';

// 底部 Tab：和手机版一样 4 个。Editor 从 Projects 进入；Protection lab / Find / Tables / Image model 是首页上的入口卡片。
const TABS = [['projects', 'nav_projects'], ['env', 'nav_environment'], ['notes', 'nav_notes'], ['assistant', 'nav_assistant']];
const TAB_OF = { projects: 'projects', editor: 'projects', lab: 'projects', find: 'projects', import: 'projects', tables: 'projects', image: 'projects', env: 'env', notes: 'notes', 'note-new': 'notes', assistant: 'assistant' };
const TITLES = { editor: 'nav_editor', lab: 'lab_title', find: 'find_title', import: 'imp_title', tables: 'web_tables_nav', image: 'web_image_nav', 'note-new': 'note_title', settings: 'set_title' };

export const app = {
  t, trainer: new TrainClient(), project: null, route: 'projects', params: {}, settings,
  go(r, params = {}) { app.params = params; if (location.hash === '#/' + r) route(); else location.hash = '#/' + r; },
  async setProject(name) { app.project = name; try { localStorage.setItem('pt_project', name); } catch { /* 隐私模式下没有 localStorage 也没关系 */ } await touchProject(name); },
  refreshSide() {},   // 旧接口（以前的侧栏）：现在没有侧栏，什么都不用做
};
window.PT = app;   // 方便测试脚本和同学在控制台里看

let cleanup = null, token = 0;
async function route() {
  const r = location.hash.replace(/^#\//, '').split('?')[0] || 'projects';
  app.route = r;
  const my = ++token;
  cleanup?.(); cleanup = null;
  const view = document.getElementById('view'); view.innerHTML = '';
  try {
    const mod = await import(`./pages/${r}.js`);
    if (my !== token) return;
    cleanup = (await mod.default(view, app)) || null;
  } catch (e) { console.error(e); view.innerHTML = `<div class="card err">${esc(e.message)}</div>`; }
  renderChrome(); document.getElementById('main').scrollTop = 0;
}

// 顶栏（Offline 标签 + 设置齿轮，子页面是返回键 + 标题）和底部 Tab
function renderChrome() {
  const r = app.route, sub = TITLES[r];
  document.getElementById('topbar').innerHTML = (sub
    ? `<button class="nav icon" id="back" aria-label="${esc(t('cd_back'))}" style="width:44px">‹</button><div class="ttl">${esc(t(sub))}</div>`
    : `<div class="brand" style="margin:0"><img src="icons/icon-192.png" alt="" style="width:36px;height:36px"><div><b style="font-size:16px">PocketTrainer</b><span class="chip">${esc(t('home_offline_short'))}</span></div></div><span style="flex:1"></span>`)
    + `<a class="nav icon ${r === 'settings' ? 'on' : ''}" href="#/settings" aria-label="${esc(t('cd_settings'))}" style="width:44px;justify-content:center">${ICONS.settings}</a>`;
  document.getElementById('back')?.addEventListener('click', () => (history.length > 1 ? history.back() : app.go(TAB_OF[r] || 'projects')));
  const cur = TAB_OF[r];
  document.getElementById('tabbar').innerHTML = TABS.map(([x, k]) => `<a class="tab ${cur === x ? 'on' : ''}" href="#/${x}">${ICONS[x]}${esc(t(k))}</a>`).join('');
}
// 应用框：高度占满窗口，宽度 = min(窗口宽, 窗口高 x 9/16)；框内是 390 宽的手机版式，整体放大 z 倍
function layout() {
  const W = Math.min(innerWidth, innerHeight * 9 / 16), z = W / 390, s = document.documentElement.style;
  s.setProperty('--W', W + 'px'); s.setProperty('--H', innerHeight + 'px'); s.setProperty('--z', String(z));
  document.getElementById('phone').classList.toggle('full', W >= innerWidth - 1);
  window.dispatchEvent(new Event('pt-layout'));
}
// 键盘：Enter / 空格 = 点击；Esc 关闭弹窗。可点击的 div 自动变成可 Tab 到的按钮
function keyboard() {
  const SEL = '.clickable, [data-h], [data-p], [data-t], [data-a], [data-file]';
  const mark = root => root.querySelectorAll?.(SEL).forEach(e => { if (!e.hasAttribute('tabindex')) { e.tabIndex = 0; e.setAttribute('role', 'button'); } });
  new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => n.nodeType === 1 && (n.matches?.(SEL) && (n.tabIndex = 0, n.setAttribute('role', 'button')), mark(n))))).observe(document.getElementById('phone'), { childList: true, subtree: true });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { const d = document.getElementById('sheet'); if (d.open) d.close(); }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.(SEL) && !e.target.matches('input, textarea, select, button, a')) { e.preventDefault(); e.target.click(); }
  });
}

async function boot() {
  await loadSettings();
  await setLang(settings.lang || detect());
  applyStatic();
  document.documentElement.dataset.theme = settings.theme === 'system' ? '' : settings.theme;
  await ensureDefaults();
  let saved = null; try { saved = localStorage.getItem('pt_project'); } catch { /* 同上 */ }
  app.project = (saved && await getProject(saved)) ? saved : (await getProject(DEFAULT)) ? DEFAULT : (await listProjects())[0]?.name;
  layout(); addEventListener('resize', layout); keyboard();
  window.addEventListener('hashchange', route);
  await route();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
