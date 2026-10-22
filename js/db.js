// IndexedDB 的极简封装：一个键值仓库 "kv"。项目、文件、笔记、运行记录、存档都放这里（用键的前缀区分）。
// 主页面和 Web Worker 都能用（Worker 里也有 indexedDB）。
let dbp;
function open() {
  return dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open('pockettrainer', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction('kv', mode), s = t.objectStore('kv');
    const r = fn(s);
    t.oncomplete = () => res(r && 'result' in r ? r.result : undefined);
    t.onerror = t.onabort = () => rej(t.error);
  });
}
export const dbGet = k => tx('readonly', s => s.get(k));
export const dbSet = (k, v) => tx('readwrite', s => s.put(v, k));
export const dbDel = k => tx('readwrite', s => s.delete(k));
// 取出某个前缀下的所有 [键, 值]
export async function dbList(prefix) {
  const db = await open();
  return new Promise((res, rej) => {
    const out = [], r = db.transaction('kv').objectStore('kv').openCursor(IDBKeyRange.bound(prefix, prefix + '￿'));
    r.onsuccess = () => { const c = r.result; if (c) { out.push([c.key, c.value]); c.continue(); } else res(out); };
    r.onerror = () => rej(r.error);
  });
}
export async function dbClearPrefix(prefix) { for (const [k] of await dbList(prefix)) await dbDel(k); }
