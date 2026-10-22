// 离线"教练"：只看最近几次运行的数字，用简单的 if 规则给建议（没有联网、没有大模型）。
import { t } from './i18n.js';
import { num, getFinal } from './store.js';

// Notes 页的 Key takeaways：[文字, 小标签]
export async function takeaways(runs, project) {
  const out = [], a = runs[0], b = runs.slice(1).find(r => r.lr !== a?.lr);
  out.push(a && b ? [t('adv_lr_gave', num(a.lr), a.accuracy * 100, num(b.lr), b.accuracy * 100), 'model.py'] : [t('adv_lr_ctrl'), 'model.py']);
  out.push(a ? [t('adv_compare', a.lastLoss, a.lastValLoss) + (a.lastValLoss - a.lastLoss > 0.25 ? t('adv_gap') : ''), t('tag_last_run')] : [t('adv_compare_plain'), t('tag_run')]);
  const c = await getFinal(project);
  out.push([c ? t('adv_ckpt', c.step) : t('adv_ckpt_plain'), 'train.py']);
  return out;
}
// Assistant 页的建议
export function coach(runs) {
  const r = runs[0]; if (!r) return [t('coach_none')];
  const tips = [], p = runs[1];
  if (r.wrong) tips.push(t('coach_wrong', Math.round(r.accuracy * 100)));
  if (r.fixed > 0) tips.push(t(r.fixed === 1 ? 'coach_fixed_one' : 'coach_fixed_many', r.fixed));
  if (!r.wrong && r.firstLoss > 0 && r.lastLoss >= r.firstLoss * 0.9) tips.push(t('coach_flat', num(r.lr * 2)));
  if (r.lastValLoss - r.lastLoss > 0.25) tips.push(t('coach_gap', r.lastValLoss - r.lastLoss));
  if (!r.wrong && r.accuracy < 0.8 && r.epochs <= 3) tips.push(t(r.epochs === 1 ? 'coach_epochs_one' : 'coach_epochs_many', r.epochs));
  if (!r.wrong && r.lr >= 0.15 && r.accuracy < 0.8) tips.push(t('coach_lr_large', num(r.lr)));
  if (p && p.lr !== r.lr) tips.push(t('coach_compare', num(p.lr), num(r.lr), p.accuracy * 100, r.accuracy * 100));
  return tips.length ? tips : [t('coach_ok')];
}
