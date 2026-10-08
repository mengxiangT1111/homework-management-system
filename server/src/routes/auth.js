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

// 密码找回/重置速率限制：验证码为 6 位数字空间，限流必须紧（10 分钟 5 次/IP）
const resetLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: {
    code: 429,
    success: false,
    message: '操作过于频繁，请稍后再试',
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

// 密码找回（无登录态；独立限流防验证码爆破）
router.post('/forgot-password', resetLimiter, authController.forgotPassword);
router.post('/reset-password', resetLimiter, authController.resetPassword);

module.exports = router;