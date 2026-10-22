// 所有联网都经过这里：只允许 https、只允许白名单主机（GitHub 和 Hugging Face 及其下载 CDN）。
// 联网只发生在用户点 搜索 / Import / Download 的时候；训练、编辑、校验全部离线。
import { t } from './i18n.js';
import { dbGet, dbSet } from './db.js';

export class NetError extends Error {}
const HOSTS = new Set(['github.com', 'api.github.com', 'raw.githubusercontent.com', 'huggingface.co']);
export const hostAllowed = h => HOSTS.has(h) || h.endsWith('.huggingface.co') || h.endsWith('.hf.co');
export function checkUrl(url) {
  let u; try { u = new URL(url); } catch { throw new NetError(t('imp_err_blocked')); }
  if (u.protocol !== 'https:' || !hostAllowed(u.hostname)) throw new NetError(t('imp_err_blocked'));
  return u;
}

// 读一个地址。as: 'json' | 'text' | 'buf'。maxBytes：最多读多少字节，超过就报错。
export async function get(url, { accept = 'application/json', maxBytes = 8 * 1048576, as = 'text' } = {}) {
  checkUrl(url);
  let res;
  try { res = await fetch(url, { headers: { Accept: accept }, redirect: 'follow', credentials: 'omit' }); }
  catch { throw new NetError(t('imp_err_offline')); }
  checkUrl(res.url || url);                                   // 重定向之后的地址也要在白名单里
  if (res.status === 403 || res.status === 429) throw new NetError(t('imp_err_limit'));
  if (res.status === 404) throw new NetError(t('imp_err_404'));
  if (!res.ok) throw new NetError(t('imp_err_http', res.status));
  if (+res.headers.get('content-length') > maxBytes) throw new NetError(t('imp_err_big'));
  const chunks = []; let n = 0; const rd = res.body.getReader();
  for (;;) { const { done, value } = await rd.read(); if (done) break; n += value.length; if (n > maxBytes) { rd.cancel(); throw new NetError(t('imp_err_big')); } chunks.push(value); }
  const buf = new Uint8Array(n); let o = 0; for (const c of chunks) { buf.set(c, o); o += c.length; }
  return as === 'buf' ? buf : as === 'json' ? JSON.parse(new TextDecoder().decode(buf)) : new TextDecoder().decode(buf);
}
// 搜索结果缓存在 IndexedDB：10 分钟内直接用缓存；联网失败时用旧缓存。返回 [内容, 是不是旧缓存]
export async function cachedJson(url) {
  const c = await dbGet('cache:' + url);
  if (c && Date.now() - c.t < 600000) return [c.body, false];
  try { const body = await get(url, { as: 'json' }); await dbSet('cache:' + url, { t: Date.now(), body }); return [body, false]; }
  catch (e) { if (c) return [c.body, true]; throw e; }
}
export const enc = path => path.split('/').map(encodeURIComponent).join('/');
