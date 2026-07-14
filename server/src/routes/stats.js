const express = require('express');
const router = express.Router();
const statsController = require('../controllers/statsController');
const { cleanExpiredFiles } = require('../utils/fileCleaner');
const { auth, requireRole } = require('../middleware/auth');
const { success, fail } = require('../utils/response');

router.use(auth);

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
    const retainDays = Number(req.query.days) || Number(process.env.FILE_RETAIN_DAYS) || 30;
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
    const retainDays = Number(req.body.days) || Number(process.env.FILE_RETAIN_DAYS) || 30;
    const result = await cleanExpiredFiles(retainDays);
    return success(res, result, `清理完成，共删除 ${result.cleanedCount} 个文件`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
