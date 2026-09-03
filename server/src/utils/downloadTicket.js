/**
 * 文件下载短时效票据（替代把 7 天 JWT 放进 URL）
 *
 * 背景：iframe/img/video 标签无法携带 Authorization 头，旧方案把完整 JWT 拼进
 * /api/files/download?token=...，导致 token 进入访问日志、浏览器历史与 Referrer，
 * 且在 JWT 有效期内（7 天）均可用。现改为：先经 POST /api/files/urls（Header 鉴权
 * + 归属校验）换取与 path 绑定的短时效票据（默认 10 分钟），再用于标签加载。
 *
 * 票据格式：`${exp}.${sig}`，sig = HMAC-SHA256(ticketKey, `${path}|${exp}`)。
 * 密钥从 JWT_SECRET 派生：轮换 JWT_SECRET 时旧票据同步失效。
 */
const crypto = require('crypto');

const DEFAULT_TTL_SEC = 600; // 10 分钟

// 启动时强校验（utils/auth.js 已保证 JWT_SECRET 存在，这里兜底）
function ticketKey() {
  return crypto.createHmac('sha256', process.env.JWT_SECRET)
    .update('file-download-ticket-v1')
    .digest();
}

function signTicket(filePath, ttlSec = DEFAULT_TTL_SEC) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = crypto.createHmac('sha256', ticketKey())
    .update(`${filePath}|${exp}`)
    .digest('base64url');
  return `${exp}.${sig}`;
}

/** 校验票据是否与 path 匹配且未过期（恒定时间比较） */
function verifyTicket(filePath, ticket) {
  if (typeof filePath !== 'string' || typeof ticket !== 'string') return false;
  const dot = ticket.indexOf('.');
  if (dot <= 0) return false;
  const exp = Number(ticket.slice(0, dot));
  const sig = ticket.slice(dot + 1);
  if (!Number.isInteger(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = crypto.createHmac('sha256', ticketKey())
    .update(`${filePath}|${exp}`)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { signTicket, verifyTicket, DEFAULT_TTL_SEC };
