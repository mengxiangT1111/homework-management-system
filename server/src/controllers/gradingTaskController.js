/**
 * 批改任务 / 结果 / 人工复核 控制器
 */
const { Op } = require('sequelize');
const {
  GradingTask, GradingReview, GradingResult, Submission, Assignment, User
} = require('../models');
const gradingService = require('../services/grading/grading.service');
const { success, fail, paginate, normalizePage } = require('../utils/response');

// 教师触发批量批改（异步，立即返回）
exports.createBatch = async (req, res, next) => {
  try {
    const { assignment_id, template_id, reference_answer, grading_criteria, mode, force } = req.body;
    if (!assignment_id || !template_id) {
      return fail(res, '缺少必要参数：assignment_id、template_id', 422);
    }
    if (mode && !['balanced', 'strict', 'encouraging'].includes(mode)) {
      return fail(res, 'mode 取值非法（balanced/strict/encouraging）', 422);
    }
    const data = await gradingService.createBatchTasks({
      teacher: req.user,
      assignmentId: Number(assignment_id),
      templateId: Number(template_id),
      referenceAnswer: reference_answer,
      gradingCriteria: grading_criteria,
      mode: mode || 'balanced',
      force: force === true
    });
    return success(res, data, `已创建 ${data.count} 个批改任务，稍后可在列表查看进度`);
  } catch (err) {
    if (err.status && err.status < 500) return fail(res, err.message, err.status);
    next(err);
  }
};

// 任务进度（前端轮询）
exports.taskProgress = async (req, res, next) => {
  try {
    const assignmentId = Number(req.query.assignment_id);
    if (!assignmentId) return fail(res, '缺少 assignment_id', 422);
    const assignment = await Assignment.findByPk(assignmentId);
    if (!assignment) return fail(res, '作业不存在', 404);
    if (req.user.role === 'teacher' && assignment.teacher_id !== req.user.id) {
      return fail(res, '只能查看自己作业的批改进度', 403);
    }
    const data = await gradingService.getAssignmentProgress(assignmentId);
    return success(res, data);
  } catch (err) { next(err); }
};

// 取消待执行任务
exports.cancelTask = async (req, res, next) => {
  try {
    const task = await GradingTask.findByPk(req.params.id);
    if (!task) return fail(res, '任务不存在', 404);
    if (req.user.role === 'teacher' && task.created_by !== req.user.id) {
      return fail(res, '只能取消自己创建的任务', 403);
    }
    if (task.status !== 'pending') return fail(res, '任务已在执行或已结束，无法取消', 422);
    await task.update({ status: 'cancelled' });
    return success(res, null, '任务已取消');
  } catch (err) { next(err); }
};

// 查看提交的最新批改结果（学生本人 / 该作业教师 / 管理员）
exports.resultBySubmission = async (req, res, next) => {
  try {
    const submissionId = Number(req.params.submissionId);
    const submission = await Submission.findByPk(submissionId, {
      include: [{ model: Assignment, as: 'assignment' }]
    });
    if (!submission) return fail(res, '提交记录不存在', 404);

    const isOwner = submission.student_id === req.user.id;
    const isTeacher = req.user.role === 'teacher' && submission.assignment && submission.assignment.teacher_id === req.user.id;
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isTeacher && !isAdmin) return fail(res, '无权查看该批改结果', 403);

    const result = await gradingService.getLatestResult(submissionId);
    if (!result) return success(res, null, '暂无批改结果');
    return success(res, result);
  } catch (err) { next(err); }
};

// 人工复核队列（教师看自己作业产生的工单，管理员看全部）
exports.reviewQueue = async (req, res, next) => {
  try {
    const { page, pageSize } = normalizePage(req.query);
    const status = req.query.status || 'pending';
    const where = { status };

    if (req.user.role === 'teacher') {
      const myAssignments = await Assignment.findAll({
        where: { teacher_id: req.user.id }, attributes: ['id']
      });
      const taskRows = await GradingTask.findAll({
        where: { assignment_id: myAssignments.map(a => a.id) },
        attributes: ['id']
      });
      where.task_id = taskRows.map(t => t.id); // 空数组=无工单
    }

    const { rows, count } = await GradingReview.findAndCountAll({
      where,
      include: [
        { model: GradingResult, as: 'result' },
        { model: Submission, as: 'submission', include: [{ model: User, as: 'student', attributes: ['id', 'username', 'real_name'] }] }
      ],
      order: [['created_at', 'ASC']],
      offset: (page - 1) * pageSize,
      limit: pageSize
    });
    return paginate(res, rows.map(r => {
      const json = r.toJSON();
      // 数值化，避免 DECIMAL 字符串
      if (json.result) {
        json.result.total_score = Number(json.result.total_score);
        json.result.full_score = Number(json.result.full_score);
        json.result.confidence = Number(json.result.confidence);
      }
      json.original_score = Number(json.original_score);
      if (json.final_score !== null && json.final_score !== undefined) json.final_score = Number(json.final_score);
      return json;
    }), count, page, pageSize);
  } catch (err) { next(err); }
};

// 提交复核结论（approve/adjust/reject）
exports.submitReview = async (req, res, next) => {
  try {
    const { action, final_score, dimension_adjustments, comment } = req.body;
    if (!['approve', 'adjust', 'reject'].includes(action)) {
      return fail(res, 'action 必须是 approve/adjust/reject', 422);
    }
    const review = await GradingReview.findByPk(req.params.id);
    if (!review) return fail(res, '复核工单不存在', 404);
    if (review.status !== 'pending') return fail(res, '该工单已处理', 422);

    // 教师只能处理自己作业产生的工单
    if (req.user.role === 'teacher') {
      const task = await GradingTask.findByPk(review.task_id);
      if (!task || task.created_by !== req.user.id) return fail(res, '无权处理该复核工单', 403);
    }

    const updated = await gradingService.submitReview({
      review,
      reviewer: req.user,
      action,
      finalScore: final_score,
      dimensionAdjustments: dimension_adjustments,
      comment
    });
    return success(res, updated, '复核结论已提交');
  } catch (err) {
    if (err.status && err.status < 500) return fail(res, err.message, err.status);
    next(err);
  }
};
