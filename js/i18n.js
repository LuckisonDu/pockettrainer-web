// 多语言：界面文字都在 i18n/<语言>.json 里（由 tools/make_i18n.py 生成）。代码、控制台里的程序行保持英文。
export const LANGS = [['en', 'English'], ['zh-CN', '简体中文'], ['zh-TW', '繁體中文'], ['es', 'Español'], ['fr', 'Français']];
export const ANSWER_LANG = { en: 'English', 'zh-CN': 'Simplified Chinese', 'zh-TW': 'Traditional Chinese', es: 'Spanish', fr: 'French' };
let dict = {}, fallback = {}, current = 'en';

// 按浏览器语言自动选
export function detect() {
  const l = (navigator.language || 'en').toLowerCase();
  if (l.startsWith('zh')) return /tw|hk|mo|hant/.test(l) ? 'zh-TW' : 'zh-CN';
  return ['es', 'fr'].find(x => l.startsWith(x)) || 'en';
}
export async function setLang(code) {
  current = LANGS.some(([c]) => c === code) ? code : 'en';
  const load = async c => (await fetch(new URL(`../i18n/${c}.json`, import.meta.url))).json();
  fallback = await load('en');
  dict = current === 'en' ? fallback : await load(current);
  document.documentElement.lang = current;
  return current;
}
export const lang = () => current;

// t('key', 参数...)：支持 %1$s %1$d %2$.1f %% 这种 Android 风格的占位符（所以能直接复用手机版的翻译表）
export function t(key, ...args) {
  const s = dict[key] ?? fallback[key] ?? key;
  return s.replace(/%(?:(\d+)\$)?(?:\.(\d+))?([sdf%])/g, (m, i, prec, type) => {
    if (type === '%') return '%';
    const v = args[(i ? +i : 1) - 1];
    return type === 'f' ? Number(v).toFixed(prec ?? 6) : String(v);
  });
}
// 静态 HTML 里的 data-i18n="key" 一次性翻译
export function applyStatic(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(e => { e.textContent = t(e.dataset.i18n); });
  root.querySelectorAll('[data-i18n-title]').forEach(e => { e.title = e.ariaLabel = t(e.dataset.i18nTitle); });
}
