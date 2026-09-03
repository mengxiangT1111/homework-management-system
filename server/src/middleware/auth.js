const jwt = require('jsonwebtoken');
const { User } = require('../models');
const { pwdVersion } = require('../utils/auth');

// JWT 验证中间件
async function auth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ code: 401, success: false, message: '未提供认证令牌', data: null });
    }
    const token = authHeader.split(' ')[1];

    // JWT_SECRET 在 utils/auth.js 启动时已检查，这里直接使用
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findByPk(decoded.userId);
    if (!user) {
      return res.status(401).json({ code: 401, success: false, message: '用户不存在', data: null });
    }
    if (user.status !== 1) {
      return res.status(403).json({ code: 403, success: false, message: '账号已被禁用', data: null });
    }
    // 密码版本校验：改密码/重置密码后签发的旧 token 立即失效
    if (!decoded.pv || decoded.pv !== pwdVersion(user.password)) {
      return res.status(401).json({ code: 401, success: false, message: '凭证已失效（密码已变更），请重新登录', data: null });
    }
    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ code: 401, success: false, message: '令牌已过期，请重新登录', data: null });
    }
    return res.status(401).json({ code: 401, success: false, message: '认证失败：' + err.message, data: null });
  }
}

// 角色校验中间件工厂
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ code: 401, success: false, message: '请先登录', data: null });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ code: 403, success: false, message: '权限不足，无法访问该资源', data: null });
    }
    next();
  };
}

module.exports = { auth, requireRole };
