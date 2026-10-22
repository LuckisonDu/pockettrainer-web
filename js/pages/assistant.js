// Assistant：离线规则教练（Offline coach · rule-based）。只看最近运行的数字。
import { esc } from '../util.js';
import { t } from '../i18n.js';
import { allRuns, num } from '../store.js';
import { coach } from '../advice.js';
import { askHtml, wireAsk } from '../chatgpt.js';

export default async function page(el, app) {
  const runs = (await allRuns()).filter(r => r.project === app.project), r = runs[0], tips = coach(runs);
  el.innerHTML = `<div class="row sp"><h1>${esc(t('asst_title'))}</h1><span class="chip">${esc(t('asst_badge'))}</span></div>
    ${r ? `<div class="card"><h3>${esc(t('asst_last'))}</h3><div>${esc(t('asst_line', r.accuracy * 100, num(r.lr), r.hidden, r.epochs))}</div></div>` : ''}
    <div class="card"><div class="list">${tips.map(x => `<div>✦ ${esc(x)}</div>`).join('')}</div></div>
    <p class="small mute">${esc(t('asst_note'))}</p><div class="row">${askHtml()}</div>`;
  wireAsk(el, t('nav_assistant'), () => `Coach tips:\n${tips.map(x => '- ' + x).join('\n')}`);
}
