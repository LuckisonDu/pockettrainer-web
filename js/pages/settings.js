// Settings：存档开关、间隔、续训提示、验证、主题、语言、About。
import { esc } from '../util.js';
import { t, LANGS, lang, setLang, applyStatic } from '../i18n.js';
import { settings, saveSettings } from '../store.js';
import { askHtml, wireAsk } from '../chatgpt.js';

export default async function page(el, app) {
  el.innerHTML = `<h1>${esc(t('set_title'))}</h1><div class="grid g2e"><div>
    <div class="card"><h2>${esc(t('set_training'))}</h2>
      <label class="switch"><span>${esc(t('set_save_ckpts'))}</span><input type="checkbox" data-k="saveCheckpoints" ${settings.saveCheckpoints ? 'checked' : ''}></label>
      <div class="switch"><span>${esc(t('set_ckpt_interval'))}</span><select data-k="ckptInterval" aria-label="${esc(t('set_ckpt_interval'))}">${[10, 20, 50, 100].map(n => `<option value="${n}" ${n === settings.ckptInterval ? 'selected' : ''}>${esc(t('set_every_steps', n))}</option>`).join('')}</select></div>
      <label class="switch"><span>${esc(t('set_offer_resume'))}</span><input type="checkbox" data-k="offerResume" ${settings.offerResume ? 'checked' : ''}></label>
      <label class="switch"><span>${esc(t('set_verify'))}</span><input type="checkbox" data-k="verify" ${settings.verify ? 'checked' : ''}></label>
      <p class="small mute">${esc(t('set_training_note'))}</p></div>
    <div class="card"><h2>${esc(t('set_code_editor'))}</h2><label class="switch"><span>${esc(t('set_version_history'))}</span><input type="checkbox" data-k="versionHistory" ${settings.versionHistory ? 'checked' : ''}></label></div></div><div>
    <div class="card"><h2>${esc(t('set_storage_group'))}</h2>
      <div class="switch"><span>${esc(t('web_theme'))}</span><select id="theme" aria-label="${esc(t('web_theme'))}">${['system', 'light', 'dark'].map(v => `<option value="${v}" ${settings.theme === v ? 'selected' : ''}>${esc(t('web_theme_' + v))}</option>`).join('')}</select></div>
      <div class="switch"><span>${esc(t('web_language'))}</span><select id="lang" aria-label="${esc(t('web_language'))}">${LANGS.map(([c, n]) => `<option value="${c}" ${lang() === c ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div class="switch"><span>${esc(t('set_storage_title'))}</span><span class="small mute" id="usage">…</span></div></div>
    <div class="card"><h2>${esc(t('set_assistant'))}</h2><div class="switch"><span>${esc(t('set_voice'))}</span><span class="small mute">${esc(t('web_voice_val'))}</span></div><p class="small mute">${esc(t('set_assistant_note'))}</p></div>
    <div class="card"><h2>${esc(t('set_about'))}</h2><p>${esc(t('web_about_text'))}</p><h3>${esc(t('about_data_title'))}</h3><p class="small" style="white-space:pre-line">${esc(t('web_about_data'))}</p>
      <p class="small mute">${esc(t('web_about_version'))}<br>${esc(t('about_translations'))}</p></div></div></div><div class="row">${askHtml()}</div>`;
  el.querySelectorAll('[data-k]').forEach(i => i.onchange = () => { settings[i.dataset.k] = i.type === 'checkbox' ? i.checked : +i.value; saveSettings(); app.refreshSide(); });
  el.querySelector('#theme').onchange = e => { settings.theme = e.target.value; document.documentElement.dataset.theme = e.target.value === 'system' ? '' : e.target.value; saveSettings(); };
  el.querySelector('#lang').onchange = async e => { settings.lang = e.target.value; await saveSettings(); await setLang(e.target.value); app.go('settings'); location.reload(); };
  navigator.storage?.estimate?.().then(s => { el.querySelector('#usage').textContent = (s.usage / 1048576).toFixed(1) + ' MB'; });
  wireAsk(el, t('set_title'), () => `Settings: ${JSON.stringify(settings)}`);
}
