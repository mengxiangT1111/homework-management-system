const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { auth } = require('../middleware/auth');

// 注册
router.post('/register', authController.register);
// 登录
router.post('/login', authController.login);
// 获取当前用户
router.get('/profile', auth, authController.getProfile);
// 修改个人信息
router.put('/profile', auth, authController.updateProfile);
// 修改密码
router.put('/password', auth, authController.changePassword);

module.exports = router;
