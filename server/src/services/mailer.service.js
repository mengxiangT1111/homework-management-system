/**
 * 邮件通道（nodemailer）
 * =========================================
 * SMTP_HOST/PORT/SECURE/USER/PASS/FROM 全配齐才启用；
 * MAIL_CAPTURE=1 进入测试捕获模式：不发真邮件，记录到 _captured.last 供集成测试断言
 * （dotenv 不会覆盖已设置的环境变量，测试进程内设 MAIL_CAPTURE=1 即生效）。
 * 发送失败一律返回 {ok:false}，由调用方决定是否影响主流程。
 */
const nodemailer = require('nodemailer');

const cfg = {
  host: process.env.SMTP_HOST || '',
  port: Number(process.env.SMTP_PORT) || 465,
  secure: (process.env.SMTP_SECURE || '1') === '1',
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  from: process.env.SMTP_FROM || process.env.SMTP_USER || ''
};
const CAPTURE = process.env.MAIL_CAPTURE === '1';
const enabled = CAPTURE || Boolean(cfg.host && cfg.user && cfg.pass);

let transporter = null;
const _captured = { last: null };

async function sendMail({ to, subject, text, html }) {
  if (!to || !subject) return { ok: false, error: '缺少收件人或主题' };
  if (CAPTURE) {
    _captured.last = { to, subject, text, html, at: new Date().toISOString() };
    console.log(`[邮件][capture] -> ${to} | ${subject}`);
    return { ok: true };
  }
  if (!enabled) return { ok: false, error: '邮件服务未配置（SMTP_HOST/SMTP_USER/SMTP_PASS）' };
  try {
    if (!transporter) {
      transporter = nodemailer.createTransport({
        host: cfg.host, port: cfg.port, secure: cfg.secure,
        auth: { user: cfg.user, pass: cfg.pass }
      });
    }
    await transporter.sendMail({ from: cfg.from, to, subject, text, html });
    return { ok: true };
  } catch (e) {
    console.warn(`[邮件] 发送失败 to=${to}: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

module.exports = {
  sendMail,
  isEnabled: () => enabled,
  isCapture: () => CAPTURE,
  _captured
};
