/**
 * 生成 JWT Token
 */
const jwt = require('jsonwebtoken');

function generateToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET || 'homework_system_secret_key_2024', {
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

module.exports = { generateToken, sanitizeUser };
