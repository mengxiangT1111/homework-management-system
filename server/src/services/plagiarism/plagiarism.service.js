/**
 * 全班查重任务执行服务
 * - COS 兼容：检测前用 ensureLocalFile 把 cos:// 文件物化到本地（每任务每文件仅下载一次）
 * - 对称去重：只算 C(n,2) 组合（源 i 与候选 i+1..n），一次计算双向 upsert
 * - 进度回写：每完成一个源的批量比对更新 completed_pairs，前端轮询展示
 */
const {
  Submission, SubmissionFile, User, PlagiarismResult, PlagiarismTask
} = require('../../models');
const detectionService = require('../detectionService');
const { ensureLocalFile } = require('../../utils/fileStorage').helpers;

// 单次 detect 调用（1 个源 vs 多个候选）的超时，默认 10 分钟
const DETECT_CALL_TIMEOUT = Number(process.env.PLAGIARISM_DETECT_TIMEOUT || '600000');

/**
 * 加载某作业下可参与查重的提交（有文件且未被过期清理）
 * @returns {Promise<Array<{submissionId, studentName, filePath}>>}
 */
async function loadValidSubmissionEntries(assignmentId) {
  const submissions = await Submission.findAll({
    where: { assignment_id: assignmentId },
    include: [
      { model: SubmissionFile, as: 'files' },
      { model: User, as: 'student', attributes: ['id', 'real_name', 'username'] }
    ],
    order: [['id', 'ASC']]
  });
  return submissions
    .filter(s => {
      const files = s.Files || s.files || [];
      return files.length > 0 && !files[0].is_cleaned;
    })
    .map(s => {
      const files = s.Files || s.files || [];
      return {
        submissionId: s.id,
        studentName: s.student?.real_name || s.student?.username || '未知',
        filePath: files[0].file_path
      };
    });
}

/**
 * 把一条检测结果转为 plagiarism_results 行数据（不含 submission_id/compared_with_id）
 */
function buildResultRow(assignmentId, detResult) {
  return {
    assignment_id: assignmentId,
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
  };
}

/** 双向 upsert：唯一键是 (submission_id, compared_with_id)，A→B 与 B→A 各写一行 */
async function upsertPairRows(assignmentId, sourceEntry, targetEntry, detResult) {
  const row = buildResultRow(assignmentId, detResult);
  await PlagiarismResult.upsert({
    ...row,
    submission_id: sourceEntry.submissionId,
    compared_with_id: targetEntry.submissionId
  });
  await PlagiarismResult.upsert({
    ...row,
    submission_id: targetEntry.submissionId,
    compared_with_id: sourceEntry.submissionId
  });
}

/** 失败对写 error 行（双向），保证每对都有状态可查，重跑时被 upsert 覆盖 */
async function upsertErrorPairRows(assignmentId, sourceEntry, targetEntry, message) {
  const row = {
    assignment_id: assignmentId,
    similarity_score: 0,
    image_hash_score: 0,
    graph_similarity: 0,
    text_similarity: 0,
    orb_match_count: 0,
    is_isomorphic: 0,
    is_suspicious: 0,
    details: null,
    status: 'error',
    error_message: String(message).slice(0, 900),
    checked_at: new Date()
  };
  await PlagiarismResult.upsert({
    ...row,
    submission_id: sourceEntry.submissionId,
    compared_with_id: targetEntry.submissionId
  });
  await PlagiarismResult.upsert({
    ...row,
    submission_id: targetEntry.submissionId,
    compared_with_id: sourceEntry.submissionId
  });
}

/** 条件更新任务（仅在 processing 状态下生效，避免覆盖用户取消） */
function finishTask(taskId, fields) {
  return PlagiarismTask.update(fields, { where: { id: taskId, status: 'processing' } });
}

/**
 * 执行一个查重任务（由队列 worker 调用）
 * @returns {Promise<{cancelled?: boolean, total?: number, totalComparisons?: number}>}
 */
async function processTask(task) {
  // 1. 检测服务健康（不可用按可重试错误抛出，走队列退避重试）
  const healthy = await detectionService.healthCheck();
  if (!healthy) {
    throw new Error('查重检测服务未启动（Python :8000）');
  }

  // 2. 加载提交并物化文件到本地（COS → 本地临时文件；每个文件只下载一次，
  //    后续所有比对复用同一路径，Python 侧指纹缓存才能命中）
  const entries = await loadValidSubmissionEntries(task.assignment_id);
  const localEntries = [];
  for (const entry of entries) {
    try {
      localEntries.push({ ...entry, localPath: await ensureLocalFile(entry.filePath) });
    } catch (e) {
      console.warn(`[查重队列] 作业${task.assignment_id} 提交${entry.submissionId} 文件物化失败，跳过: ${e.message}`);
    }
  }

  const n = localEntries.length;
  await PlagiarismTask.update(
    { total_submissions: n, total_pairs: (n * (n - 1)) / 2 },
    { where: { id: task.id } }
  );

  if (n < 2) {
    const finished = await finishTask(
      task.id,
      { status: 'done', finished_at: new Date(), result_summary: { note: '可检测文件不足 2 份，未执行比对' } }
    );
    if (!finished) {
      console.log(`[查重队列] 任务 ${task.id} 在收尾时已被取消，保留取消状态`);
    }
    return { total: n };
  }

  // 3. 上三角逐源检测：源 i 只与 i+1..n-1 比对 → 每对恰好计算一次
  const pathToEntry = new Map(localEntries.map(e => [e.localPath, e]));
  let completed = 0;
  let failed = 0;

  for (let i = 0; i < n - 1; i++) {
    // 每轮检查取消
    await task.reload();
    if (task.status === 'cancelled') {
      console.log(`[查重队列] 任务 ${task.id} 已取消（完成 ${completed}/${(n * (n - 1)) / 2} 对）`);
      return { cancelled: true, totalComparisons: completed };
    }

    const source = localEntries[i];
    const candidates = localEntries.slice(i + 1);
    try {
      const det = await detectionService.detect({
        sourcePath: source.localPath,
        candidatePaths: candidates.map(c => c.localPath),
        timeout: DETECT_CALL_TIMEOUT
      });
      for (const detResult of det.results || []) {
        const target = pathToEntry.get(detResult.candidate);
        if (!target) continue;
        await upsertPairRows(task.assignment_id, source, target, detResult);
        completed++;
      }
    } catch (e) {
      // 单个源整批失败不拖垮任务：记 error 行，继续下一源
      console.error(`[查重队列] 任务 ${task.id} 源提交${source.submissionId} 检测失败: ${e.message}`);
      for (const target of candidates) {
        await upsertErrorPairRows(task.assignment_id, source, target, e.message).catch(() => {});
        completed++;
        failed++;
      }
    }

    await PlagiarismTask.update(
      { completed_pairs: completed, failed_pairs: failed },
      { where: { id: task.id } }
    );
  }

  // 4. 汇总并完结（仅 processing → done，防止覆盖刚发生的取消）
  const summary = await buildAssignmentSummary(task.assignment_id);
  const finished = await finishTask(
    task.id,
    {
      status: 'done',
      finished_at: new Date(),
      suspicious_count: summary.suspiciousCount,
      result_summary: { totalComparisons: summary.totalComparisons }
    }
  );
  if (!finished) {
    console.log(`[查重队列] 任务 ${task.id} 在收尾时已被取消，保留取消状态`);
  }
  return { total: n, totalComparisons: summary.totalComparisons };
}

/**
 * 基于 plagiarism_results 聚合作业查重摘要（任务完成后的展示数据）
 * 行是双向存储的，统计时用 submission_id < compared_with_id 去重
 */
async function buildAssignmentSummary(assignmentId) {
  const rows = await PlagiarismResult.findAll({
    where: { assignment_id: assignmentId },
    include: [
      {
        model: Submission, as: 'submission',
        include: [{ model: User, as: 'student', attributes: ['id', 'real_name', 'username'] }]
      },
      {
        model: Submission, as: 'comparedWith',
        include: [{ model: User, as: 'student', attributes: ['id', 'real_name', 'username'] }]
      }
    ],
    order: [['similarity_score', 'DESC']]
  });

  const studentNameMap = {};
  const studentMaxScores = {};
  const suspiciousPairs = [];
  let totalComparisons = 0;
  const seenPairs = new Set();

  for (const r of rows) {
    const aId = r.submission_id;
    const bId = r.compared_with_id;
    const aName = r.submission?.student?.real_name || r.submission?.student?.username || '未知';
    const bName = r.comparedWith?.student?.real_name || r.comparedWith?.student?.username || '未知';
    studentNameMap[aId] = aName;
    studentNameMap[bId] = bName;

    if (r.status === 'error') continue;
    const score = parseFloat(r.similarity_score) || 0;

    if (!studentMaxScores[aId] || score > studentMaxScores[aId]) studentMaxScores[aId] = score;
    if (!studentMaxScores[bId] || score > studentMaxScores[bId]) studentMaxScores[bId] = score;

    // 无序对去重
    const pairKey = aId < bId ? `${aId}_${bId}` : `${bId}_${aId}`;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);
    totalComparisons++;

    if (r.is_suspicious === 1) {
      suspiciousPairs.push({
        pairKey,
        submissionId: aId,
        comparedWithId: bId,
        studentName: aName,
        comparedWithName: bName,
        similarityScore: score,
        isSuspicious: true
      });
    }
  }

  const suspiciousResults = suspiciousPairs
    .sort((a, b) => b.similarityScore - a.similarityScore)
    .slice(0, 20);

  return {
    totalComparisons,
    suspiciousCount: suspiciousPairs.length,
    suspiciousResults,
    studentMaxScores,
    studentNameMap
  };
}

module.exports = {
  loadValidSubmissionEntries,
  processTask,
  buildAssignmentSummary,
  DETECT_CALL_TIMEOUT
};
