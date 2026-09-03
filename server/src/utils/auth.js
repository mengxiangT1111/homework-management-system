/**
 * 生成 JWT Token
 */
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// 启动时强制检查 JWT_SECRET
if (!process.env.JWT_SECRET) {
  console.error('\n❌ FATAL ERROR: JWT_SECRET is not defined in environment variables!');
  console.error('   Please set JWT_SECRET in your .env file before starting the server.\n');
  process.exit(1);
}

/**
 * 密码版本指纹：改密码/管理员重置密码后哈希变化，指纹随之变化，
 * 旧 token 里的 pv 与库中不再一致 → 立即失效（无需黑名单、无需改表）。
 */
function pwdVersion(passwordHash) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET)
    .update(`pwd:${passwordHash}`)
    .digest('hex')
    .slice(0, 12);
}

function generateToken(userId, passwordHash) {
  return jwt.sign({ userId, pv: pwdVersion(passwordHash) }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });
}

/**
 * 脱敏用户信息（去除密码）
 */
function sanitizeUser(user) {
  if (!user) return null;
  const values = user.toJSON ? user.toJSON() : user;
  const { password, ...rest } = values;
  return rest;
}

module.exports = { generateToken, sanitizeUser, pwdVersion };
