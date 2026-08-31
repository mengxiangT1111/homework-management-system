/**
 * 批改核心服务：
 * 创建任务（HTTP 立即返回） → worker 调 processTask →
 * 加载模板快照 + 提示词版本（确定性灰度路由） → 调 LLM →
 * 解析校验 → 服务端算总分 → 结果入库 →
 * 置信度分流：高置信自动回写 submissions；低置信生成人工复核工单
 */
const path = require('path');
const fs = require('fs');
const mammoth = require('mammoth');
const config = require('../../config/ai');
const {
  sequelize, GradingTask, GradingResult, GradingReview,
  Submission, SubmissionFile, User, Assignment, Notification
} = require('../../models');
const llmClient = require('./llmClient');
const promptService = require('../prompt.service');
const templateService = require('./template.service');
const { isCOSPath, ensureLocalFile } = require('../../utils/fileStorage').helpers;
const {
  safeParseJSON, parseGradingOutput, computeTotalScore, evaluateConfidence
} = require('../../utils/gradingResultParser');

// 学生作答注入提示词的最大长度（防超大文本打爆 token / 烧钱）
const MAX_ANSWER_CHARS = 30000;

function permanentError(message) {
  const e = new Error(message);
  e.permanent = true; // 队列看到此标记直接失败，不再重试
  return e;
}
const r1 = x => Math.round(x * 10) / 10;

// ===== 学生作答文本提取（txt/docx；COS 文件先物化到本地临时目录） =====
// 返回 { text, tempFiles }：tempFiles 为本次物化产生的临时文件，调用方负责清理
async function extractSubmissionText(submission) {
  const tempFiles = [];
  if (!submission || !submission.files || submission.files.length === 0) {
    return { text: '', tempFiles };
  }
  for (const file of submission.files) {
    const ext = path.extname(file.original_name).toLowerCase();
    if (ext !== '.txt' && ext !== '.docx' && ext !== '.doc') continue;
    let absPath;
    try {
      absPath = await ensureLocalFile(file.file_path);
    } catch (e) { continue; } // 文件不存在/下载失败，尝试下一个
    if (isCOSPath(file.file_path)) tempFiles.push(absPath);
    try {
      if (ext === '.txt') {
        const text = fs.readFileSync(absPath, 'utf-8');
        if (text.trim()) return { text, tempFiles };
      }
      if (ext === '.docx' || ext === '.doc') {
        const result = await mammoth.extractRawText({ path: absPath });
        if (result.value.trim()) return { text: result.value, tempFiles };
      }
    } catch (e) { continue; } // 单文件失败继续尝试下一个
  }
  return { text: '', tempFiles };
}

// ===== 创建批量批改任务（异步，HTTP 立即返回） =====
async function createBatchTasks({ teacher, assignmentId, templateId, referenceAnswer, gradingCriteria, mode = 'balanced', force = false }) {
  const assignment = await Assignment.findByPk(assignmentId);
  if (!assignment) throw Object.assign(new Error('作业不存在'), { status: 404 });
  if (teacher.role === 'teacher' && assignment.teacher_id !== teacher.id) {
    throw Object.assign(new Error('只能批改自己发布的作业'), { status: 403 });
  }

  const template = await templateService.getDetail(templateId);
  if (!template) throw Object.assign(new Error('评分模板不存在'), { status: 404 });
  if (template.status !== 'published') throw Object.assign(new Error('模板未发布，不能用于批改'), { status: 422 });
  // 模板可见性：本人 / 同校 / 平台公共
  if (template.teacher_id !== teacher.id &&
      template.school_id !== null && template.school_id !== teacher.school_id) {
    throw Object.assign(new Error('无权使用该模板'), { status: 403 });
  }
  if (!referenceAnswer || !String(referenceAnswer).trim()) {
    throw Object.assign(new Error('参考答案不能为空'), { status: 422 });
  }

  const where = { assignment_id: assignmentId };
  where.status = force ? ['submitted', 'graded'] : 'submitted';
  const submissions = await Submission.findAll({ where, attributes: ['id'] });
  if (submissions.length === 0) throw Object.assign(new Error('没有待批改的提交'), { status: 422 });

  // 排除已有进行中任务的提交，防止重复批改
  const busy = await GradingTask.findAll({
    where: { submission_id: submissions.map(s => s.id), status: ['pending', 'processing'] },
    attributes: ['submission_id']
  });
  const busySet = new Set(busy.map(b => b.submission_id));
  const targets = submissions.filter(s => !busySet.has(s.id));
  if (targets.length === 0) throw Object.assign(new Error('所有提交均已有进行中的批改任务'), { status: 422 });

  const snapshot = templateService.buildTemplateJSON(template); // 快照固化，重试/审计用同一标准
  const tasks = await GradingTask.bulkCreate(targets.map(s => ({
    submission_id: s.id,
    assignment_id: assignmentId,
    template_id: templateId,
    template_snapshot: snapshot,
    prompt_key: 'grading.main',
    prompt_mode: ['balanced', 'strict', 'encouraging'].includes(mode) ? mode : 'balanced',
    reference_answer: String(referenceAnswer),
    grading_criteria: gradingCriteria || null,
    max_attempts: config.grading.maxAttempts,
    priority: 5,
    created_by: teacher.id
  })));

  return { count: tasks.length, task_ids: tasks.map(t => t.id) };
}

// ===== 单任务处理（worker 认领后调用） =====
async function processTask(task) {
  const t = await GradingTask.findByPk(task.id, {
    include: [{
      model: Submission,
      as: 'submission',
      include: [{ model: SubmissionFile, as: 'files' }]
    }]
  });
  if (!t) throw permanentError('任务不存在');
  if (t.status !== 'processing') return; // 已被取消/完成，幂等退出
  if (!t.submission) throw permanentError('提交记录不存在');

  const tempFiles = []; // COS 物化产生的本地临时文件，任务结束（含失败）后清理
  try {
    // 1. 提取学生作答（COS 文件物化到本地）
    const extracted = await extractSubmissionText(t.submission);
    tempFiles.push(...extracted.tempFiles);
    let studentAnswer = extracted.text;
    if (!studentAnswer || !studentAnswer.trim()) {
      throw permanentError('无法提取学生作答文本（仅支持 txt/docx 格式）');
    }
    if (studentAnswer.length > MAX_ANSWER_CHARS) {
      studentAnswer = studentAnswer.slice(0, MAX_ANSWER_CHARS) + '\n...（作答过长，已截断）';
    }

    // 2. 加载提示词（按 task.id 做确定性灰度路由）并渲染
    const templateJSON = t.template_snapshot;
    const prompt = await promptService.getActivePrompt(t.prompt_key, t.id);
    const systemPrompt = promptService.renderSystemPrompt(prompt, templateJSON);
    const userMessage = promptService.buildUserMessage(prompt, {
      fullScore: templateJSON.full_score,
      referenceAnswer: t.reference_answer,
      gradingCriteria: t.grading_criteria,
      studentAnswer,
      mode: t.prompt_mode
    });

    // 3. 调 LLM（进程内允许一次"解析失败即重调"，仍失败交给队列退避重试）
    let parsed = null;
    let llmResp = null;
    let parseRetries = 0;
    for (let i = 0; i < 2 && !parsed; i++) {
      parseRetries = i;
      llmResp = await llmClient.chatCompletion({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.1,
        maxTokens: 4096,
        jsonMode: true
      });
      // 心跳：LLM 单次调用最坏可耗时数分钟，续租防止被僵死回收器误判
      GradingTask.update({ locked_at: new Date() }, { where: { id: t.id, status: 'processing' } }).catch(() => {});
      try {
        parsed = parseGradingOutput(safeParseJSON(llmResp.content), templateJSON);
      } catch (e) {
        if (i === 1) throw new Error(`AI 返回解析失败：${e.message}`); // 可重试错误（非 permanent）
      }
    }

  // 4. 服务端权威算分 + 置信度
  const total = computeTotalScore(parsed.dimensions, templateJSON);
  const { confidence, reasons } = evaluateConfidence({
    parseRetries,
    clampCount: parsed.clampCount,
    missingCount: parsed.missingCount,
    total,
    fullScore: templateJSON.full_score,
    answerLength: studentAnswer.length
  });
  const needsReview = confidence < config.grading.reviewThreshold || parsed.missingCount > 0;

  // 5. 事务入库：结果 + 任务状态 + 复核工单
  let resultId = null;
  await sequelize.transaction(async (trx) => {
    const result = await GradingResult.create({
      task_id: t.id,
      submission_id: t.submission_id,
      template_id: t.template_id,
      prompt_key: t.prompt_key,
      prompt_version: prompt.version,
      total_score: total,
      full_score: templateJSON.full_score,
      dimension_scores: parsed.dimensions,
      overall_feedback: parsed.overall_feedback,
      improvement_advice: parsed.improvement_advice,
      deduction_summary: parsed.dimensions.flatMap(d =>
        d.deductions.map(x => ({ dimension: d.code, description: x.description, penalty: x.penalty }))
      ),
      knowledge_errors: parsed.knowledge_errors,
      confidence,
      needs_review: needsReview ? 1 : 0,
      review_reasons: needsReview ? reasons : [],
      raw_response: llmResp.content,
      llm_model: llmResp.model,
      tokens_used: llmResp.usage
    }, { transaction: trx });
    resultId = result.id;

    await t.update({ status: 'success', error_msg: null }, { transaction: trx });

    if (needsReview) {
      await GradingReview.create({
        result_id: result.id,
        task_id: t.id,
        submission_id: t.submission_id,
        original_score: total,
        status: 'pending'
      }, { transaction: trx });
    }
  });

  // 6. 分流：高置信自动回写并通知学生；低置信通知教师复核
  //    （通知失败不影响任务结果，故放在事务外且吞错）
  if (!needsReview && config.grading.autoApply) {
    await applyToSubmission(t, { total, parsed, templateJSON });
    await safeNotify(t.submission.student_id, '作业批改完成',
      `您的作业已由 AI 批改完成，得分 ${total}/${templateJSON.full_score}，可在"我的提交"中查看详情。`);
  } else if (needsReview) {
    await safeNotify(t.created_by, 'AI批改待人工复核',
      `一份提交的 AI 批改置信度较低（${reasons.join('；')}），已进入人工复核队列，请在"批改复核"页面处理。`);
  }

  return { total, confidence, needsReview, resultId };
  } finally {
    // 清理 COS 物化的临时文件（失败路径同样需要清理）
    for (const p of tempFiles) {
      fs.promises.unlink(p).catch(() => {});
    }
  }
}

// 高置信结果回写 submissions（沿用现有字段，现有页面无需改造即可看到分数）
async function applyToSubmission(task, { total, parsed, templateJSON }) {
  const dimLines = parsed.dimensions.map(d =>
    `${d.name} ${d.score === null ? '—' : d.score}/${d.max_score}${d.feedback ? '：' + d.feedback : ''}`
  ).join('\n');
  const comment = [
    `【AI批改 总分 ${total}/${templateJSON.full_score}】`,
    `【维度得分】\n${dimLines}`,
    parsed.overall_feedback ? `【总评】${parsed.overall_feedback}` : '',
    parsed.improvement_advice ? `【改进建议】${parsed.improvement_advice}` : '',
    parsed.knowledge_errors.length ? `【知识盲区】${parsed.knowledge_errors.join('；')}` : ''
  ].filter(Boolean).join('\n\n');

  // submissions.score 为 DECIMAL(5,2)（上限 999.99），模板满分最高 1000，
  // 越界值会导致 MySQL 拒绝写入、批改任务反复失败，这里钳到列上限
  const scoreToApply = Math.min(total, 999.9);

  await Submission.update({
    score: scoreToApply,
    comment,
    status: 'graded',
    graded_by: task.created_by,
    graded_at: new Date()
  }, { where: { id: task.submission_id } });
}

async function safeNotify(userId, title, content) {
  try {
    if (!userId) return;
    await Notification.create({ user_id: userId, title, content, type: 'grade' });
  } catch (e) {
    console.warn('[批改] 发送通知失败:', e.message);
  }
}

// ===== 查询辅助 =====

/** 按作业统计任务进度 + 每个任务的分数/学生（前端轮询用，避免 N+1） */
async function getAssignmentProgress(assignmentId) {
  const rows = await GradingTask.findAll({
    where: { assignment_id: assignmentId },
    attributes: ['id', 'status', 'attempt', 'error_msg', 'submission_id', 'created_at'],
    order: [['id', 'DESC']]
  });
  const progress = { total: rows.length, pending: 0, processing: 0, success: 0, failed: 0, cancelled: 0 };
  for (const r of rows) progress[r.status]++;

  const subIds = rows.map(r => r.submission_id);
  const results = subIds.length ? await GradingResult.findAll({
    where: { submission_id: subIds },
    order: [['created_at', 'DESC']]
  }) : [];
  const latestBySub = new Map();
  for (const r of results) {
    if (!latestBySub.has(r.submission_id)) latestBySub.set(r.submission_id, r);
  }
  const subs = subIds.length ? await Submission.findAll({
    where: { id: subIds },
    include: [{ model: User, as: 'student', attributes: ['id', 'real_name', 'username'] }]
  }) : [];
  const subMap = new Map(subs.map(s => [s.id, s]));

  return {
    progress,
    list: rows.map(r => {
      const res = latestBySub.get(r.submission_id);
      const sub = subMap.get(r.submission_id);
      return {
        id: r.id,
        status: r.status,
        attempt: r.attempt,
        error_msg: r.error_msg,
        submission_id: r.submission_id,
        student_name: sub && sub.student ? sub.student.real_name : '未知',
        score: res ? Number(res.total_score) : null,
        needs_review: res ? res.needs_review : null,
        created_at: r.created_at
      };
    })
  };
}

async function getLatestResult(submissionId) {
  const result = await GradingResult.findOne({
    where: { submission_id: submissionId },
    order: [['created_at', 'DESC']],
    include: [{ association: 'review' }]
  });
  if (result) {
    result.total_score = Number(result.total_score);
    result.full_score = Number(result.full_score);
    result.confidence = Number(result.confidence);
  }
  return result;
}

/** 复核结论落地：approve/adjust 回写 submissions（复核教师为评分责任人），reject 留给教师手动批阅 */
async function submitReview({ review, reviewer, action, finalScore, dimensionAdjustments, comment }) {
  const submission = await Submission.findByPk(review.submission_id);
  const result = await GradingResult.findByPk(review.result_id);

  let finalScoreVal = null;
  if (action === 'approve') {
    finalScoreVal = Number(review.original_score);
  } else if (action === 'adjust') {
    const fs = Number(finalScore);
    if (!Number.isFinite(fs) || fs < 0 || fs > Number(result.full_score)) {
      throw Object.assign(new Error(`最终分数必须是 0-${result.full_score} 之间的数字`), { status: 422 });
    }
    finalScoreVal = r1(fs);
  }

  await sequelize.transaction(async (trx) => {
    await review.update({
      status: action,
      reviewer_id: reviewer.id,
      reviewed_at: new Date(),
      final_score: finalScoreVal,
      dimension_adjustments: dimensionAdjustments || null,
      comment: comment || null
    }, { transaction: trx });

    if (action === 'approve' || action === 'adjust') {
      // 维度明细同步覆盖（adjust 时教师给的维度分优先）
      const dims = (result.dimension_scores || []).map(d => {
        const adj = (dimensionAdjustments || []).find(a => a.code === d.code);
        return adj && Number.isFinite(Number(adj.to)) ? { ...d, score: r1(Number(adj.to)) } : d;
      });
      await result.update({ dimension_scores: dims, total_score: finalScoreVal }, { transaction: trx });

      const dimLines = dims.map(d =>
        `${d.name} ${d.score === null ? '—' : d.score}/${d.max_score}${d.feedback ? '：' + d.feedback : ''}`
      ).join('\n');
      const comment2 = [
        `【AI批改+人工复核 总分 ${finalScoreVal}/${result.full_score}】`,
        `【维度得分】\n${dimLines}`,
        result.overall_feedback ? `【总评】${result.overall_feedback}` : '',
        comment ? `【复核意见】${comment}` : ''
      ].filter(Boolean).join('\n\n');

      await Submission.update({
        score: Math.min(finalScoreVal, 999.9), // submissions.score 为 DECIMAL(5,2)，钳到列上限
        comment: comment2,
        status: 'graded',
        graded_by: reviewer.id,
        graded_at: new Date()
      }, { where: { id: review.submission_id }, transaction: trx });
    }
    // reject：不改 submissions，AI 结果保留供教师批阅时参考
  });

  if ((action === 'approve' || action === 'adjust') && submission) {
    await safeNotify(submission.student_id, '作业批改完成',
      `您的作业已由 AI 批改并经教师复核，得分 ${finalScoreVal} 分，可在"我的提交"中查看详情。`);
  }
  return review;
}

module.exports = {
  createBatchTasks,
  processTask,
  getAssignmentProgress,
  getLatestResult,
  submitReview,
  applyToSubmission
};
