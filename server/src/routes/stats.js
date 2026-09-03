const express = require('express');
const router = express.Router();
const statsController = require('../controllers/statsController');
const { cleanExpiredFiles } = require('../utils/fileCleaner');
const { auth, requireRole } = require('../middleware/auth');
const { success, fail } = require('../utils/response');

router.use(auth);

// 清理保留天数解析：负数/0 会让 cutoff 落在未来，把全校作业文件全量命中，
// 属不可恢复的破坏性操作，必须校验范围（1-3650 天）
function parseRetainDays(raw) {
  if (raw === undefined || raw === null || raw === '') return undefined; // 未提供，走默认
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > 3650) return null; // 提供了但非法
  return Math.floor(n);
}

// 显式传参但非法 → 422 拒绝；未传参 → 环境变量（同样校验）→ 默认 30
function resolveRetainDays(raw, res) {
  const fromQuery = parseRetainDays(raw);
  if (fromQuery === null) {
    fail(res, '清理天数需为 1-3650 之间的整数', 422);
    return null;
  }
  if (fromQuery !== undefined) return fromQuery;
  const fromEnv = parseRetainDays(process.env.FILE_RETAIN_DAYS);
  return fromEnv === null || fromEnv === undefined ? 30 : fromEnv;
}

// 管理员全局统计
router.get('/overview', requireRole('admin'), statsController.overview);
// 各作业提交率（图表）
router.get('/assignment-rates', requireRole('admin', 'teacher'), statsController.assignmentSubmitRates);
// 教师个人统计
router.get('/teacher', requireRole('teacher', 'admin'), statsController.teacherOverview);
// 学生个人统计
router.get('/student', requireRole('student'), statsController.studentOverview);

// 文件清理预览（不执行，只统计）
router.get('/cleanup/preview', requireRole('admin'), async (req, res, next) => {
  try {
    const retainDays = resolveRetainDays(req.query.days, res);
    if (retainDays === null) return;
    const { Assignment, Submission, SubmissionFile } = require('../models');
    const { Op } = require('sequelize');
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retainDays);

    const expiredAssignments = await Assignment.findAll({
      where: { deadline: { [Op.lt]: cutoffDate } },
      attributes: ['id', 'title', 'deadline']
    });
    const assignmentIds = expiredAssignments.map(a => a.id);
    let fileSize = 0;
    let fileCount = 0;
    if (assignmentIds.length > 0) {
      const files = await SubmissionFile.findAll({
        where: { is_cleaned: 0 },
        include: [{ model: Submission, as: 'submission', where: { assignment_id: { [Op.in]: assignmentIds } }, required: true }],
        attributes: ['file_size']
      });
      fileCount = files.length;
      fileSize = files.reduce((s, f) => s + Number(f.file_size), 0);
    }
    return success(res, {
      retainDays,
      cutoffDate,
      expiredAssignmentCount: assignmentIds.length,
      fileCount,
      fileSize,
      assignments: expiredAssignments
    }, '获取成功');
  } catch (err) {
    next(err);
  }
});

// 执行文件清理
router.post('/cleanup/run', requireRole('admin'), async (req, res, next) => {
  try {
    const retainDays = resolveRetainDays(req.body.days, res);
    if (retainDays === null) return;
    const result = await cleanExpiredFiles(retainDays);
    return success(res, result, `清理完成，共删除 ${result.cleanedCount} 个文件`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
