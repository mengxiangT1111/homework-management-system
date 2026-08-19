const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/authController');
const { auth } = require('../middleware/auth');

// 登录速率限制：15分钟内同一 IP 最多 10 次登录尝试（含成功，按 IP 计数）
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 10, // 最多10次
  message: {
    code: 429,
    success: false,
    message: '登录失败次数过多，账号已被临时锁定，请15分钟后再试',
    data: null
  },
  standardHeaders: true,
  legacyHeaders: false
});

// 注册速率限制：1小时内最多3次
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1小时
  max: 3, // 最多3次
  message: {
    code: 429,
    success: false,
    message: '注册请求过于频繁，请稍后再试',
    data: null
  },
  standardHeaders: true,
  legacyHeaders: false
});

// 注册
router.post('/register', registerLimiter, authController.register);
// 登录
router.post('/login', loginLimiter, authController.login);
// 获取当前用户
router.get('/profile', auth, authController.getProfile);
// 修改个人信息
router.put('/profile', auth, authController.updateProfile);
// 修改密码
router.put('/password', auth, authController.changePassword);

module.exports = router;