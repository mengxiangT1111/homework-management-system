/**
 * Plagiarism Controller
 * 查重检测控制器
 * - 单份查重：同步执行（COS 文件先物化到本地）
 * - 全班查重：建任务 → 后台队列执行 → 前端轮询 /task/status 进度
 */

const { Op } = require('sequelize');
const {
  Submission, SubmissionFile, Assignment, User, PlagiarismResult, PlagiarismTask
} = require('../models');
const { success, fail } = require('../utils/response');
const detectionService = require('../services/detectionService');
const { ensureLocalFile } = require('../utils/fileStorage').helpers;
const plagiarismService = require('../services/plagiarism/plagiarism.service');

/** 校验作业归属：仅作业发布教师或 admin 可操作 */
async function assertAssignmentOwner(req, res, assignmentId) {
  const assignment = await Assignment.findByPk(assignmentId);
  if (!assignment) {
    fail(res, '作业不存在', 404);
    return null;
  }
  if (assignment.teacher_id !== req.user.id && req.user.role !== 'admin') {
    fail(res, '仅作业发布教师可进行查重检测', 403);
    return null;
  }
  return assignment;
}

/** 任务行 → 前端格式 */
function formatTask(task) {
  return {
    taskId: task.id,
    status: task.status,
    totalSubmissions: task.total_submissions,
    totalPairs: task.total_pairs,
    completedPairs: task.completed_pairs,
    failedPairs: task.failed_pairs,
    suspiciousCount: task.suspicious_count,
    errorMsg: task.error_msg,
    startedAt: task.started_at,
    finishedAt: task.finished_at,
    createdAt: task.created_at
  };
}

/**
 * 教师手动触发单份查重检测（同步）
 * POST /api/plagiarism/check/:assignmentId/:submissionId
 */
exports.checkPlagiarism = async (req, res, next) => {
  try {
    const { assignmentId, submissionId } = req.params;

    const assignment = await assertAssignmentOwner(req, res, assignmentId);
    if (!assignment) return;

    const targetSubmission = await Submission.findByPk(submissionId, {
      include: [
        { model: SubmissionFile, as: 'files' },
        { model: User, as: 'student', attributes: ['id', 'real_name', 'username'] }
      ]
    });
    if (!targetSubmission) return fail(res, '提交记录不存在', 404);

    const otherSubmissions = await Submission.findAll({
      where: { assignment_id: assignmentId, id: { [Op.ne]: submissionId } },
      include: [
        { model: SubmissionFile, as: 'files' },
        { model: User, as: 'student', attributes: ['id', 'real_name', 'username'] }
      ]
    });

    if (otherSubmissions.length === 0) {
      return success(res, { results: [] }, '没有其他提交可供对比');
    }

    const isHealthy = await detectionService.healthCheck();
    if (!isHealthy) {
      return fail(res, '查重检测服务未启动，请联系管理员', 503);
    }

    const targetFiles = targetSubmission.Files || targetSubmission.files || [];
    if (targetFiles.length === 0) return fail(res, '目标提交无文件', 400);
    if (targetFiles[0].is_cleaned) return fail(res, '目标提交文件已被过期清理，无法查重', 422);

    // COS 兼容：调检测服务前把文件物化到本地（cos:// → 本地临时文件）
    let sourceLocalPath;
    try {
      sourceLocalPath = await ensureLocalFile(targetFiles[0].file_path);
    } catch (e) {
      return fail(res, `源文件获取失败：${e.message}`, 422);
    }

    const candidateEntries = [];
    for (const sub of otherSubmissions) {
      const files = sub.Files || sub.files || [];
      if (files.length > 0 && !files[0].is_cleaned) {
        try {
          candidateEntries.push({
            submissionId: sub.id,
            studentName: sub.student?.real_name || sub.student?.username || '未知',
            localPath: await ensureLocalFile(files[0].file_path)
          });
        } catch (e) {
          console.warn(`单份查重：提交 ${sub.id} 文件物化失败，跳过: ${e.message}`);
        }
      }
    }

    if (candidateEntries.length === 0) {
      return success(res, { results: [] }, '其他提交均无可检测文件');
    }

    const detectionResult = await detectionService.detect({
      sourcePath: sourceLocalPath,
      candidatePaths: candidateEntries.map(e => e.localPath),
      assignmentId: parseInt(assignmentId),
      submissionId: parseInt(submissionId),
      timeout: plagiarismService.DETECT_CALL_TIMEOUT
    });

    const savedResults = [];
    for (const detResult of detectionResult.results || []) {
      const matchedEntry = candidateEntries.find(e => e.localPath === detResult.candidate);
      if (!matchedEntry) continue;

      const [plagResult] = await PlagiarismResult.upsert({
        assignment_id: parseInt(assignmentId),
        submission_id: parseInt(submissionId),
        compared_with_id: matchedEntry.submissionId,
        similarity_score: detResult.similarity_score || 0,
        image_hash_score: detResult.image_hash_score || 0,
        graph_similarity: detResult.graph_similarity || 0,
        text_similarity: detResult.text_similarity || 0,
        orb_match_count: detResult.orb_match_count || 0,
        is_isomorphic: detResult.is_isomorphic ? 1 : 0,
        is_suspicious: detResult.is_suspicious ? 1 : 0,
        details: detResult.details || null,
        status: detResult.error ? 'error' : 'done',
        error_message: detResult.error || null,
        checked_at: new Date()
      });

      savedResults.push({
        id: plagResult.id,
        comparedWithId: matchedEntry.submissionId,
        studentName: matchedEntry.studentName,
        similarityScore: detResult.similarity_score || 0,
        imageHashScore: detResult.image_hash_score || 0,
        graphSimilarity: detResult.graph_similarity || 0,
        textSimilarity: detResult.text_similarity || 0,
        orbMatchCount: detResult.orb_match_count || 0,
        isIsomorphic: detResult.is_isomorphic || false,
        isSuspicious: detResult.is_suspicious || false,
        details: detResult.details || null
      });
    }

    return success(res, {
      assignmentId: parseInt(assignmentId),
      submissionId: parseInt(submissionId),
      studentName: targetSubmission.student?.real_name || targetSubmission.student?.username || '未知',
      topSimilarity: detectionResult.top_similarity || 0,
      totalCompared: savedResults.length,
      results: savedResults
    }, '查重检测完成');

  } catch (error) {
    try {
      await PlagiarismResult.update(
        { status: 'error', error_message: error.message, checked_at: new Date() },
        { where: { submission_id: req.params.submissionId, assignment_id: req.params.assignmentId } }
      );
    } catch (e) {}
    next(error);
  }
};

/**
 * 全班一键查重（异步任务化）
 * POST /api/plagiarism/batch-check/:assignmentId
 * 建任务 → 队列后台执行 → 前端轮询 GET /task/status/:assignmentId
 */
exports.batchCheckAll = async (req, res, next) => {
  try {
    const { assignmentId } = req.params;

    // 1. 验证作业归属
    const assignment = await assertAssignmentOwner(req, res, assignmentId);
    if (!assignment) return;

    // 2. 已有进行中的任务直接返回（幂等，避免重复建任务重复计算）
    const running = await PlagiarismTask.findOne({
      where: { assignment_id: assignmentId, status: ['pending', 'processing'] },
      order: [['id', 'DESC']]
    });
    if (running) {
      return success(res, { task: formatTask(running), alreadyRunning: true }, '该作业已有查重任务在进行中');
    }

    // 3. 检查服务健康（提前给教师明确提示，避免建了任务全失败）
    const isHealthy = await detectionService.healthCheck();
    if (!isHealthy) {
      return fail(res, '查重检测服务未启动，请联系管理员', 503);
    }

    // 4. 统计可查重提交数
    const entries = await plagiarismService.loadValidSubmissionEntries(assignmentId);
    const n = entries.length;
    if (n < 2) {
      return success(res, { total: n, results: [] }, '提交人数不足，至少需要2人才能查重');
    }

    // 5. 建任务，后台队列执行（C(n,2) 组合去重 + 双向写入）
    const task = await PlagiarismTask.create({
      assignment_id: parseInt(assignmentId),
      created_by: req.user.id,
      total_submissions: n,
      total_pairs: (n * (n - 1)) / 2
    });

    return success(res, { task: formatTask(task) }, `查重任务已创建：${n} 份提交，共 ${(n * (n - 1)) / 2} 对比对`);

  } catch (error) {
    next(error);
  }
};

/**
 * 查询作业最新查重任务状态（前端轮询）
 * GET /api/plagiarism/task/status/:assignmentId
 */
exports.getTaskStatus = async (req, res, next) => {
  try {
    const { assignmentId } = req.params;

    const assignment = await assertAssignmentOwner(req, res, assignmentId);
    if (!assignment) return;

    const task = await PlagiarismTask.findOne({
      where: { assignment_id: assignmentId },
      order: [['id', 'DESC']]
    });
    if (!task) {
      return success(res, { task: null });
    }

    const payload = { task: formatTask(task) };

    // 任务完成后附带汇总（可疑Top20、学生最高分等，与旧版同步接口返回结构一致）
    if (task.status === 'done') {
      payload.summary = await plagiarismService.buildAssignmentSummary(task.assignment_id);
      payload.summary.total = task.total_submissions;
    }

    return success(res, payload);

  } catch (error) {
    next(error);
  }
};

/**
 * 取消进行中的查重任务
 * POST /api/plagiarism/task/cancel/:assignmentId
 */
exports.cancelTask = async (req, res, next) => {
  try {
    const { assignmentId } = req.params;

    const assignment = await assertAssignmentOwner(req, res, assignmentId);
    if (!assignment) return;

    const [updated] = await PlagiarismTask.update(
      { status: 'cancelled', finished_at: new Date() },
      { where: { assignment_id: assignmentId, status: ['pending', 'processing'] } }
    );
    if (!updated) {
      return fail(res, '没有进行中的查重任务', 422);
    }
    // processing 中的任务由 worker 在下一轮比对前感知并停止
    return success(res, null, '查重任务已取消');

  } catch (error) {
    next(error);
  }
};

/**
 * 获取查重结果列表
 * GET /api/plagiarism/results/:assignmentId/:submissionId
 */
exports.getPlagiarismResults = async (req, res, next) => {
  try {
    const { assignmentId, submissionId } = req.params;

    const results = await PlagiarismResult.findAll({
      where: { assignment_id: assignmentId, submission_id: submissionId },
      include: [{
        model: Submission,
        as: 'comparedWith',
        include: [{
          model: User,
          as: 'student',
          attributes: ['id', 'real_name', 'username']
        }]
      }],
      order: [['similarity_score', 'DESC']]
    });

    const detailed = results.map(r => ({
      id: r.id,
      comparedWithId: r.compared_with_id,
      studentName: r.comparedWith?.student?.real_name || r.comparedWith?.student?.username || '未知',
      similarityScore: parseFloat(r.similarity_score),
      imageHashScore: parseFloat(r.image_hash_score),
      graphSimilarity: parseFloat(r.graph_similarity),
      textSimilarity: parseFloat(r.text_similarity),
      orbMatchCount: r.orb_match_count,
      isIsomorphic: r.is_isomorphic === 1,
      isSuspicious: r.is_suspicious === 1,
      status: r.status,
      checkedAt: r.checked_at
    }));

    return success(res, {
      assignmentId: parseInt(assignmentId),
      submissionId: parseInt(submissionId),
      results: detailed
    });

  } catch (error) {
    next(error);
  }
};

/**
 * 获取某次提交的最高相似度
 * GET /api/plagiarism/max-score/:assignmentId/:submissionId
 */
exports.getMaxPlagiarismScore = async (req, res, next) => {
  try {
    const { assignmentId, submissionId } = req.params;

    const result = await PlagiarismResult.findOne({
      where: { assignment_id: assignmentId, submission_id: submissionId, status: 'done' },
      order: [['similarity_score', 'DESC']]
    });

    if (!result) {
      return success(res, { maxSimilarity: 0, status: 'none' });
    }

    return success(res, {
      maxSimilarity: parseFloat(result.similarity_score),
      status: 'done'
    });

  } catch (error) {
    next(error);
  }
};

/**
 * 批量获取某作业所有提交的查重状态
 * GET /api/plagiarism/assignment-summary/:assignmentId
 */
exports.getAssignmentSummary = async (req, res, next) => {
  try {
    const { assignmentId } = req.params;

    const results = await PlagiarismResult.findAll({
      where: { assignment_id: assignmentId, status: 'done' },
      attributes: [
        'submission_id',
        [require('sequelize').fn('MAX', require('sequelize').col('similarity_score')), 'max_similarity']
      ],
      group: ['submission_id']
    });

    const summary = {};
    for (const r of results) {
      summary[r.submission_id] = parseFloat(r.getDataValue('max_similarity'));
    }

    return success(res, { summary });

  } catch (error) {
    next(error);
  }
};

/**
 * 删除查重结果
 * DELETE /api/plagiarism/results/:assignmentId/:submissionId
 */
exports.deleteResults = async (req, res, next) => {
  try {
    const { assignmentId, submissionId } = req.params;
    await PlagiarismResult.destroy({
      where: { assignment_id: assignmentId, submission_id: submissionId }
    });
    return success(res, null, '查重结果已删除');
  } catch (error) {
    next(error);
  }
};
