/**
 * 全班查重任务执行服务
 * - COS 兼容：检测前用 ensureLocalFile 把 cos:// 文件物化到本地（每任务每文件仅下载一次）
 * - 对称去重：只算 C(n,2) 组合（源 i 与候选 i+1..n），一次计算双向 upsert
 * - 多文件：提交的全部未清理文件参与比对，提交对取跨文件组合的最高相似度
 * - 进度回写：每完成一个源的批量比对更新 completed_pairs，前端轮询展示
 */
const {
  Submission, SubmissionFile, User, PlagiarismResult, PlagiarismTask
} = require('../../models');
const detectionService = require('../detectionService');
const { isCOSPath, ensureLocalFile } = require('../../utils/fileStorage').helpers;

// 单次 detect 调用（1 个源 vs 多个候选）的超时，默认 10 分钟
const DETECT_CALL_TIMEOUT = Number(process.env.PLAGIARISM_DETECT_TIMEOUT || '600000');

/**
 * 加载某作业下可参与查重的提交（未被过期清理的文件全部参与——
 * 多文件提交原先只取第一个文件比对会漏检，现按提交级聚合全部文件）
 * @returns {Promise<Array<{submissionId, studentName, files: Array<{path, name}>}>>}
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
    .map(s => {
      const files = (s.Files || s.files || []).filter(f => !f.is_cleaned);
      if (files.length === 0) return null;
      return {
        submissionId: s.id,
        studentName: s.student?.real_name || s.student?.username || '未知',
        files: files.map(f => ({ path: f.file_path, name: f.original_name }))
      };
    })
    .filter(Boolean);
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
  const tmpFilesToClean = []; // COS 物化产生的本地临时文件，结束时统一清理
  try {
    // 1. 检测服务健康（不可用按可重试错误抛出，走队列退避重试）
    const healthy = await detectionService.healthCheck();
    if (!healthy) {
      throw new Error('查重检测服务未启动（Python :8000）');
    }

    // 2. 加载提交并物化文件到本地（COS → uploads/_detection_tmp；每个文件只下载一次，
    //    后续所有比对复用同一路径，Python 侧指纹缓存才能命中）
    const entries = await loadValidSubmissionEntries(task.assignment_id);
    const localEntries = [];
    for (const entry of entries) {
      const files = [];
      for (const f of entry.files) {
        try {
          const localPath = await ensureLocalFile(f.path);
          if (isCOSPath(f.path)) tmpFilesToClean.push(localPath);
          files.push({ ...f, localPath });
        } catch (e) {
          console.warn(`[查重队列] 作业${task.assignment_id} 提交${entry.submissionId} 文件 ${f.name} 物化失败，跳过: ${e.message}`);
        }
      }
      if (files.length > 0) localEntries.push({ ...entry, files });
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

  // 3. 上三角逐源检测：源 i 只与 i+1..n-1 比对 → 每对提交恰好计算一次。
  //    多文件聚合：源提交的每个文件与目标提交的全部文件各比对一次，
  //    提交对取所有文件组合中的最高相似度（details.file_pairs 留全量分解）。
  //    注意路径反查必须多值：两名学生提交相同文件（秒传共享同一路径）时，
  //    同一个检测结果要同时归属两个提交
  const pathToFiles = new Map(); // localPath -> [{ entry, file }]
  for (const e of localEntries) {
    for (const f of e.files) {
      const list = pathToFiles.get(f.localPath) || [];
      list.push({ entry: e, file: f });
      pathToFiles.set(f.localPath, list);
    }
  }
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
    const targets = localEntries.slice(i + 1);
    // targetSubmissionId → { best: 最高相似度的成功结果, filePairs: 全部文件组合分解 }
    const bestByTarget = new Map();
    const errorsByTarget = new Map();

    const addError = (targetId, msg) => {
      const list = errorsByTarget.get(targetId) || [];
      list.push(String(msg).slice(0, 200));
      errorsByTarget.set(targetId, list);
    };

    for (const sf of source.files) {
      // 候选去重：相同物理文件只送检一次（结果按多值反查同时归属各提交）
      const candidatePaths = [...new Set(targets.flatMap(t => t.files.map(f => f.localPath)))];
      if (candidatePaths.length === 0) continue;
      try {
        const det = await detectionService.detect({
          sourcePath: sf.localPath,
          candidatePaths,
          timeout: DETECT_CALL_TIMEOUT
        });
        for (const detResult of det.results || []) {
          const hits = pathToFiles.get(detResult.candidate) || [];
          for (const hit of hits) {
            if (hit.entry.submissionId === source.submissionId) continue; // 只归属目标
            const targetId = hit.entry.submissionId;
            const score = Number(detResult.similarity_score) || 0;
            let agg = bestByTarget.get(targetId);
            if (!agg) { agg = { best: null, filePairs: [] }; bestByTarget.set(targetId, agg); }
            agg.filePairs.push({
              source_file: sf.name,
              candidate_file: hit.file.name,
              similarity_score: score,
              ...(detResult.error ? { error: detResult.error } : {})
            });
            if (detResult.error) {
              addError(targetId, `文件对 ${sf.name} × ${hit.file.name}: ${detResult.error}`);
            } else if (!agg.best || score > (Number(agg.best.similarity_score) || 0)) {
              agg.best = detResult;
            }
          }
        }
      } catch (e) {
        // 单个源文件整批失败不拖垮任务：记入涉及目标的错误信息，继续下一个源文件
        console.error(`[查重队列] 任务 ${task.id} 源提交${source.submissionId} 文件 ${sf.name} 检测失败: ${e.message}`);
        for (const t of targets) addError(t.submissionId, `源文件 ${sf.name} 检测失败: ${e.message}`);
      }
    }

    // 每个目标提交 upsert 一次：有成功文件对则取最高相似度结果，否则写 error 行
    for (const target of targets) {
      completed++;
      const agg = bestByTarget.get(target.submissionId);
      if (agg && agg.best) {
        const detResult = {
          ...agg.best,
          details: { ...(agg.best.details || {}), file_pairs: agg.filePairs }
        };
        await upsertPairRows(task.assignment_id, source, target, detResult);
      } else {
        const errs = errorsByTarget.get(target.submissionId) || [];
        await upsertErrorPairRows(
          task.assignment_id, source, target, errs.join('；') || '未产生检测结果'
        ).catch(() => {});
        failed++;
      }
    }

    // 进度回写同时续租 locked_at：单源检测最坏可达 10 分钟，
    // 不续租会被僵死回收器（阈值 60 分钟内）误判重跑
    await PlagiarismTask.update(
      { completed_pairs: completed, failed_pairs: failed, locked_at: new Date() },
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
  } finally {
    // 清理 COS 物化的临时文件（取消/失败路径同样需要清理，否则磁盘随查重线性泄漏）
    const fs = require('fs');
    for (const p of tmpFilesToClean) {
      fs.promises.unlink(p).catch(() => {});
    }
  }
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

/**
 * 查重报告导出数据（P5）：与 buildAssignmentSummary 的区别——
 * 明细不截断（全部比对对，非 Top20）且带分维分数与文件对分解，
 * 学生侧附带"最相似同学"姓名；error 对单独计数不入明细
 */
async function buildAssignmentReport(assignmentId) {
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

  const nameOf = (r, side) => {
    const s = side === 'a' ? r.submission?.student : r.comparedWith?.student;
    return s?.real_name || s?.username || '未知';
  };

  const seen = new Set();
  const pairs = [];
  let errorPairCount = 0;
  const bestByStudent = {}; // submissionId -> { name, score, withName }
  for (const r of rows) {
    const aId = r.submission_id;
    const bId = r.compared_with_id;
    const key = aId < bId ? `${aId}_${bId}` : `${bId}_${aId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (r.status === 'error') { errorPairCount++; continue; }
    const aName = nameOf(r, 'a');
    const bName = nameOf(r, 'b');
    const score = parseFloat(r.similarity_score) || 0;
    const details = r.details || {};
    pairs.push({
      aName, bName, score,
      imageHash: parseFloat(r.image_hash_score) || 0,
      text: parseFloat(r.text_similarity) || 0,
      graph: parseFloat(r.graph_similarity) || 0,
      orb: r.orb_match_count || 0,
      isomorphic: r.is_isomorphic === 1,
      suspicious: r.is_suspicious === 1,
      filePairs: Array.isArray(details.file_pairs) ? details.file_pairs : null
    });
    for (const [id, name, other] of [[aId, aName, bName], [bId, bName, aName]]) {
      if (!bestByStudent[id] || score > bestByStudent[id].score) {
        bestByStudent[id] = { name, score, withName: other };
      }
    }
  }

  pairs.sort((x, y) => y.score - x.score);
  return {
    totalComparisons: pairs.length,
    errorPairCount,
    suspiciousCount: pairs.filter(p => p.suspicious).length,
    highRiskCount: pairs.filter(p => p.score > 75).length,
    pairs,
    students: Object.values(bestByStudent).sort((x, y) => y.score - x.score)
  };
}

module.exports = {
  loadValidSubmissionEntries,
  processTask,
  buildAssignmentSummary,
  buildAssignmentReport,
  DETECT_CALL_TIMEOUT
};
