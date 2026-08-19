/**
 * Plagiarism Routes
 * 查重检测相关路由
 */

const express = require('express');
const router = express.Router();
const { auth, requireRole } = require('../middleware/auth');
const plagiarismController = require('../controllers/plagiarismController');

// 所有路由需要登录
router.use(auth);

// 教师/管理员可用的路由
router.use(requireRole('teacher', 'admin'));

// 全班一键查重（放在具体ID路由前面避免冲突）
router.post('/batch-check/:assignmentId', plagiarismController.batchCheckAll);

// 手动触发单份查重检测
router.post('/check/:assignmentId/:submissionId', plagiarismController.checkPlagiarism);

// 获取某次提交的查重结果
router.get('/results/:assignmentId/:submissionId', plagiarismController.getPlagiarismResults);

// 获取某次提交的最高相似度
router.get('/max-score/:assignmentId/:submissionId', plagiarismController.getMaxPlagiarismScore);

// 获取某作业所有提交的查重摘要
router.get('/assignment-summary/:assignmentId', plagiarismController.getAssignmentSummary);

// 删除查重结果
router.delete('/results/:assignmentId/:submissionId', plagiarismController.deleteResults);

module.exports = router;