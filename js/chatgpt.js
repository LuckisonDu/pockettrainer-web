// "Ask ChatGPT"：网页不接 API、不自动发送。把"将要发出的文字"完整显示出来，用户可以改、可以加自己的问题；
// 点按钮后把全文复制到剪贴板，再在新标签页打开 https://chatgpt.com/?q=...（由浏览器联网，不是本页面）。
import { esc } from './util.js';
import { t, lang, ANSWER_LANG } from './i18n.js';
import { sheet, closeSheet, toast } from './ui.js';

const MAX_LINK_CHARS = 1500;
export const askHtml = () => `<button class="btn" data-ask>✦ ${t('ask_button')}</button>`;

// 给页面里的 [data-ask] 按钮接上点击：ctxFn() 返回"这个页面当前内容"的文字
export function wireAsk(el, pageName, ctxFn) {
  el.querySelectorAll('[data-ask]').forEach(b => b.onclick = () => openAsk(pageName, ctxFn()));
}

export function openAsk(pageName, context) {
  const base = `${t('ask_lang', ANSWER_LANG[lang()])}\n\nI am using PocketTrainer (a small web app that trains a tiny neural network in the browser and double-checks every training step). I am on the "${pageName}" page.\n\n${context}`;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const d = sheet(`<h2>✦ ${t('ask_title')}</h2><p class="small mute">${esc(t('ask_explain'))}</p>
    <label class="small mute">${t('ask_text_label')}</label><textarea class="big" id="askText">${esc(base)}</textarea>
    <label class="small mute">${t('ask_question_label')}</label>
    <div class="row"><input type="text" id="askQ" style="flex:1" placeholder="${esc(t('ask_question_label'))}"><button class="btn" id="askMic" ${SR ? '' : 'disabled'} title="${esc(SR ? '' : t('ask_mic_unavailable'))}">🎤 ${t('ask_mic')}</button></div>
    <p class="small mute">${esc(SR ? t('web_mic_note') : t('ask_mic_unavailable'))}</p>
    <div class="row" style="justify-content:flex-end"><button class="btn" id="askClose">${t('common_close')}</button><button class="btn fill" id="askOpen">${t('ask_open')}</button></div>`);
  d.querySelector('#askClose').onclick = closeSheet;
  if (SR) d.querySelector('#askMic').onclick = () => {          // 语音输入：Web Speech API（Chrome 可能把声音发到云端识别，不是离线）
    const r = new SR(); r.lang = lang() === 'en' ? 'en-US' : lang(); r.interimResults = false;
    r.onresult = e => { d.querySelector('#askQ').value += (d.querySelector('#askQ').value ? ' ' : '') + e.results[0][0].transcript; };
    r.onerror = () => toast(t('ask_mic_unavailable')); r.start();
  };
  d.querySelector('#askOpen').onclick = async () => {
    let text = d.querySelector('#askText').value.trim(); const q = d.querySelector('#askQ').value.trim();
    if (q) text += '\n\n' + q;
    try { await navigator.clipboard.writeText(text); } catch { /* 剪贴板不可用时，用户仍能看到文字 */ }
    const cut = text.length > MAX_LINK_CHARS;
    window.open('https://chatgpt.com/?q=' + encodeURIComponent(cut ? text.slice(0, MAX_LINK_CHARS) : text), '_blank', 'noopener');
    toast(cut ? t('ask_copied_cut') : t('ask_copied'));
  };
}
