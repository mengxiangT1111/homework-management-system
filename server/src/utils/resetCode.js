/**
 * 密码找回验证码（无表方案）
 * =========================================
 * 不新建数据表（既有库零迁移）：验证码 = HMAC-SHA256(JWT_SECRET|purpose, userId|密码哈希指纹|时间窗) 前 6 位数字。
 * - 10 分钟时间窗，校验放行当前窗与上一窗（跨窗边界容错）
 * - HMAC 输入掺密码哈希指纹：重置成功后密码变化 → 旧验证码立即失效（天然防重放，无需撤销表）
 */
const crypto = require('crypto');

const WINDOW_MS = 10 * 60 * 1000;

function hmacInput(userId, pwdFp, window) {
  return `${userId}|${pwdFp}|${window}`;
}

function codeFor(userId, pwdFp, window) {
  const jwt = process.env.JWT_SECRET || '';
  const h = crypto.createHmac('sha256', `${jwt}|password-reset`).update(hmacInput(userId, pwdFp, window)).digest('hex');
  const n = parseInt(h.slice(0, 6), 16) % 1000000;
  return String(n).padStart(6, '0');
}

function safeEq(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** 生成验证码。pwdHash 传用户当前密码哈希（防重放的关键输入） */
function generate(userId, pwdHash, now = Date.now()) {
  const fp = crypto.createHash('sha256').update(String(pwdHash || '')).digest('hex').slice(0, 12);
  return codeFor(userId, fp, Math.floor(now / WINDOW_MS));
}

/** 校验验证码（当前窗 + 上一窗，均对当前密码哈希计算） */
function verify(userId, pwdHash, code, now = Date.now()) {
  const c = String(code || '');
  if (!/^\d{6}$/.test(c)) return false;
  const fp = crypto.createHash('sha256').update(String(pwdHash || '')).digest('hex').slice(0, 12);
  const w = Math.floor(now / WINDOW_MS);
  return safeEq(c, codeFor(userId, fp, w)) || safeEq(c, codeFor(userId, fp, w - 1));
}

module.exports = { generate, verify, WINDOW_MS };
