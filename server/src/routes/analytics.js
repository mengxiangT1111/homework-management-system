/**
 * 学情分析与预警系统路由
 * - 教师端：课程学情画像 / 学习风险预警通知
 * - 学生端：个人学情自查
 * 未交催办复用既有 POST /api/submissions/assignment/:id/remind，不在此重复实现
 */
const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const { auth, requireRole } = require('../middleware/auth');

router.use(auth);

// 课程学情画像总览（KPI/趋势/学生画像/共性错误/查重风险/未交名单）
router.get('/course/:courseId/profile', requireRole('teacher', 'admin'), analyticsController.courseProfile);

// 向风险学生发送学习预警通知
router.post('/course/:courseId/warn', requireRole('teacher', 'admin'), analyticsController.sendWarning);

// 学生个人学情自查
router.get('/my/profile', requireRole('student'), analyticsController.myProfile);

module.exports = router;
