/**
 * 统一通知出口：站内信（必达，失败不影响主流程）+ 邮件扇出（可选）
 * =========================================
 * EMAIL_NOTIFY_TYPES 控制哪些通知类型抄送邮件（逗号分隔，默认 grade,deadline）。
 * 邮件失败静默（站内信已保证触达），不向上抛错。
 */
const { Notification, User } = require('../models');
const mailer = require('./mailer.service');

const EMAIL_TYPES = new Set(
  (process.env.EMAIL_NOTIFY_TYPES || 'grade,deadline')
    .split(',').map(s => s.trim()).filter(Boolean)
);

async function notify({ user_id, title, content, type, related_id, email = true }) {
  if (!email || !type || !EMAIL_TYPES.has(type) || !mailer.isEnabled()) {
    // 仅站内信
    try { await Notification.create({ user_id, title, content, type, related_id }); }
    catch (e) { console.warn('[通知] 站内信写入失败（不影响主流程）:', e.message); }
    return;
  }
  try {
    const user = await User.findByPk(user_id, { attributes: ['email'] });
    try { await Notification.create({ user_id, title, content, type, related_id }); }
    catch (e) { console.warn('[通知] 站内信写入失败（不影响主流程）:', e.message); }
    if (user && user.email) {
      // 异步发送即可：站内信已落库，邮件慢/失败都不影响接口返回
      mailer.sendMail({ to: user.email, subject: `【信衡】${title}`, text: content }).catch(() => {});
    }
  } catch (e) {
    console.warn('[通知] 扇出查询失败（不影响主流程）:', e.message);
  }
}

module.exports = { notify, EMAIL_TYPES };
