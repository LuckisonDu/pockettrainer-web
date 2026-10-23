// Service worker：第一次打开后把页面、脚本、翻译和训练数据都存进浏览器缓存，之后断网也能训练 / 编辑。
// 搜索和下载（GitHub / Hugging Face）需要网络，不经过这里（跨域请求直接放行）。
const CACHE = 'pockettrainer-v2-6';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'css/app.css', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon.png', 'icons/logo.svg',
  'js/main.js', 'js/i18n.js', 'js/store.js', 'js/db.js', 'js/util.js', 'js/ui.js', 'js/chatgpt.js', 'js/train-client.js', 'js/trainer.js', 'js/train-worker.js', 'js/shadow-worker.js',
  'js/mlp.js', 'js/mlp_ref.js', 'js/data.js', 'js/advice.js', 'js/net.js', 'js/importer.js', 'js/zip.js', 'js/tabular.js',
  'js/pages/projects.js', 'js/pages/editor.js', 'js/pages/runview.js', 'js/pages/lab.js', 'js/pages/env.js', 'js/pages/notes.js', 'js/pages/note-new.js', 'js/pages/assistant.js',
  'js/pages/settings.js', 'js/pages/find.js', 'js/pages/import.js', 'js/pages/tables.js', 'js/pages/image.js',
  'i18n/en.json', 'i18n/zh-CN.json', 'i18n/zh-TW.json', 'i18n/es.json', 'i18n/fr.json',
  'data/dataset.json', 'data/train_x.f16', 'data/train_y.u8', 'data/test_x.f16', 'data/test_y.u8', 'data/iris.csv', 'data/wine.csv'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;     // 跨域（GitHub / HF）直接走网络
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => {
    // 缓存里有就用；同时在后台更新一份（有网时），下次打开就是新的
    const net = fetch(e.request).then(r => { if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone())); return r; }).catch(() => hit);
    return hit || net;
  }));
});
