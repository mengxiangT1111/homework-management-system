/**
 * 生成 JWT Token
 */
const jwt = require('jsonwebtoken');

// 启动时强制检查 JWT_SECRET
if (!process.env.JWT_SECRET) {
  console.error('\n❌ FATAL ERROR: JWT_SECRET is not defined in environment variables!');
  console.error('   Please set JWT_SECRET in your .env file before starting the server.\n');
  process.exit(1);
}

function generateToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
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
