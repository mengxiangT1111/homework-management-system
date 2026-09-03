const express = require('express');
const router = express.Router();
const submissionController = require('../controllers/submissionController');
const { auth, requireRole } = require('../middleware/auth');
const { downloadLimiter } = require('../middleware/rateLimit');

router.use(auth);

// 学生：提交作业（绑定文件）
router.post('/assignment/:id', requireRole('student'), submissionController.submitAssignment);
// 学生：我的提交记录列表
router.get('/my/list', requireRole('student'), submissionController.mySubmissions);
// 学生：查看某作业的提交详情
router.get('/my/assignment/:id', requireRole('student'), submissionController.getMySubmission);

// 教师：查看提交详情
router.get('/detail/:id', requireRole('teacher', 'admin'), submissionController.getSubmission);
// 教师：打分评语
router.put('/:id/grade', requireRole('teacher', 'admin'), submissionController.gradeSubmission);
// 教师：催交（标记未交）
router.post('/assignment/:id/remind', requireRole('teacher', 'admin'), submissionController.remindUnsubmitted);
// 教师：打包下载全部作业
router.get('/assignment/:id/download', requireRole('teacher', 'admin'), downloadLimiter, submissionController.downloadAll);
// 教师：导出未交名单 Excel
router.get('/assignment/:id/export', requireRole('teacher', 'admin'), downloadLimiter, submissionController.exportUnsubmittedExcel);

module.exports = router;
