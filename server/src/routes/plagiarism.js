/**
 * Plagiarism Routes
 * 查重检测相关路由
 */

const express = require('express');
const router = express.Router();
const { auth, requireRole } = require('../middleware/auth');
const { plagiarismLimiter } = require('../middleware/rateLimit');
const plagiarismController = require('../controllers/plagiarismController');

// 所有路由需要登录
router.use(auth);

// 教师/管理员可用的路由
router.use(requireRole('teacher', 'admin'));

// ===== 具名任务路由（必须注册在参数路由之前，避免被 /:id 拦截） =====

// 查询作业最新查重任务状态（前端轮询进度）
router.get('/task/status/:assignmentId', plagiarismController.getTaskStatus);

// 取消进行中的查重任务
router.post('/task/cancel/:assignmentId', plagiarismController.cancelTask);

// ===== 参数路由 =====

// 全班一键查重（建任务，后台队列执行）
router.post('/batch-check/:assignmentId', plagiarismLimiter, plagiarismController.batchCheckAll);

// 手动触发单份查重检测
router.post('/check/:assignmentId/:submissionId', plagiarismLimiter, plagiarismController.checkPlagiarism);

// 获取某次提交的查重结果
router.get('/results/:assignmentId/:submissionId', plagiarismController.getPlagiarismResults);

// 获取某次提交的最高相似度
router.get('/max-score/:assignmentId/:submissionId', plagiarismController.getMaxPlagiarismScore);

// 获取某作业所有提交的查重摘要
router.get('/assignment-summary/:assignmentId', plagiarismController.getAssignmentSummary);

// 删除查重结果
router.delete('/results/:assignmentId/:submissionId', plagiarismController.deleteResults);

module.exports = router;
