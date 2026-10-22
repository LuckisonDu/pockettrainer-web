// Add note：写一条笔记；可以语音输入（Web Speech API），也可以把它作为 # 注释插进 model.py。
import { esc } from '../util.js';
import { t, lang } from '../i18n.js';
import { addNote, readFile, writeFile } from '../store.js';
import { toast } from '../ui.js';

export default async function page(el, app) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  el.innerHTML = `<h1>${esc(t('note_title'))}</h1><div class="card"><textarea class="big" id="nt" placeholder="${esc(t('note_hint'))}"></textarea>
    <div class="row" style="margin-top:10px"><button class="btn" id="mic" ${SR ? '' : 'disabled'} title="${esc(SR ? '' : t('ask_mic_unavailable'))}">🎤 ${esc(t('note_voice'))}</button>
    <button class="btn" id="ins">${esc(t('note_insert'))}</button><button class="btn fill" id="save">${esc(t('note_save'))}</button><a class="btn" href="#/notes" style="text-decoration:none">${esc(t('common_cancel'))}</a></div>
    <p class="small mute">${esc(SR ? t('web_mic_note') : t('ask_mic_unavailable'))}</p></div>`;
  const nt = el.querySelector('#nt');
  if (SR) el.querySelector('#mic').onclick = () => { const r = new SR(); r.lang = lang() === 'en' ? 'en-US' : lang(); r.onresult = e => { nt.value += (nt.value ? ' ' : '') + e.results[0][0].transcript; }; r.onerror = () => toast(t('ask_mic_unavailable')); r.start(); };
  el.querySelector('#save').onclick = async () => { if (nt.value.trim()) await addNote(app.project, nt.value.trim()); app.go('notes'); };
  el.querySelector('#ins').onclick = async () => {
    const line = nt.value.trim().split('\n').map(l => l.startsWith('#') ? l : '# ' + l).join('\n'); if (!line) return;
    const m = await readFile(app.project, 'code/model.py'); await writeFile(app.project, 'code/model.py', m.replace(/\n*$/, '\n') + line + '\n'); app.go('editor');
  };
}
