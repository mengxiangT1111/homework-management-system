/**
 * AI 智能批改模块路由 /api/grading
 */
const express = require('express');
const router = express.Router();
const { auth, requireRole } = require('../middleware/auth');
const { aiLimiter } = require('../middleware/rateLimit');
const templateCtrl = require('../controllers/gradingTemplateController');
const taskCtrl = require('../controllers/gradingTaskController');
const promptCtrl = require('../controllers/gradingPromptController');

router.use(auth);

// ===== 评分模板（教师/管理员） =====
// 注意：/templates/validate 必须注册在 /templates/:id 之前
router.post('/templates', requireRole('teacher', 'admin'), templateCtrl.create);
router.get('/templates', requireRole('teacher', 'admin'), templateCtrl.list);
router.post('/templates/validate', requireRole('teacher', 'admin'), templateCtrl.validate);
router.get('/templates/:id', requireRole('teacher', 'admin'), templateCtrl.getDetail);
router.put('/templates/:id', requireRole('teacher', 'admin'), templateCtrl.update);
router.post('/templates/:id/publish', requireRole('teacher', 'admin'), templateCtrl.publish);
router.post('/templates/:id/clone', requireRole('teacher', 'admin'), templateCtrl.clone);
router.patch('/templates/:id/status', requireRole('teacher', 'admin'), templateCtrl.toggleStatus);

// ===== 批改任务 / 结果 / 复核 =====
router.post('/tasks/batch', requireRole('teacher', 'admin'), aiLimiter, taskCtrl.createBatch);
router.get('/tasks', requireRole('teacher', 'admin'), taskCtrl.taskProgress);
router.post('/tasks/:id/cancel', requireRole('teacher', 'admin'), taskCtrl.cancelTask);
// 学生本人/该作业教师/管理员可查（权限在控制器内细分）
router.get('/results/submission/:submissionId', taskCtrl.resultBySubmission);
router.get('/reviews', requireRole('teacher', 'admin'), taskCtrl.reviewQueue);
router.post('/reviews/:id', requireRole('teacher', 'admin'), taskCtrl.submitReview);

// ===== 提示词版本管理（管理员） =====
router.get('/prompts', requireRole('admin'), promptCtrl.listVersions);
router.post('/prompts/versions', requireRole('admin'), promptCtrl.createVersion);
router.put('/prompts/routing', requireRole('admin'), promptCtrl.updateRouting);

module.exports = router;
