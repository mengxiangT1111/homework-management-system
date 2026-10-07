/**
 * Plagiarism Controller
 * 查重检测控制器
 * - 单份查重：同步执行（COS 文件先物化到本地）
 * - 全班查重：建任务 → 后台队列执行 → 前端轮询 /task/status 进度
 */

const { Op } = require('sequelize');
const ExcelJS = require('exceljs');
const {
  sequelize, Submission, SubmissionFile, Assignment, Course, Class, User, PlagiarismResult, PlagiarismTask
} = require('../models');
const { success, fail } = require('../utils/response');
const { formatCST } = require('../utils/formatCST');
const detectionService = require('../services/detectionService');
const { ensureLocalFile, isCOSPath } = require('../utils/fileStorage').helpers;
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
    // submissionId 必须属于该作业：否则教师可用自己的作业ID + 他人作业的提交ID
    // 把别的班学生文件拉进自己的查重（结果写入自己的作业下）
    if (targetSubmission.assignment_id !== parseInt(assignmentId, 10)) {
      return fail(res, '提交不属于该作业', 403);
    }

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

    // 多文件：目标提交与其余提交的全部未清理文件参与比对，每个被对比提交
    // 取跨文件组合的最高相似度（与全班查重口径一致；旧实现只取 files[0] 会漏检）
    const targetFiles = (targetSubmission.Files || targetSubmission.files || []).filter(f => !f.is_cleaned);
    if (targetFiles.length === 0) {
      return fail(res, '目标提交文件已被过期清理，无法查重', 422);
    }

    const tmpFilesToClean = [];
    const materialize = async (files) => {
      const out = [];
      for (const f of files) {
        const localPath = await ensureLocalFile(f.file_path);
        if (isCOSPath(f.file_path)) tmpFilesToClean.push(localPath);
        out.push({ name: f.original_name, localPath });
      }
      return out;
    };

    let sourceLocalFiles;
    try {
      sourceLocalFiles = await materialize(targetFiles);
    } catch (e) {
      return fail(res, `源文件获取失败：${e.message}`, 422);
    }

    const candidateEntries = [];
    try {
      for (const sub of otherSubmissions) {
        const files = (sub.Files || sub.files || []).filter(f => !f.is_cleaned);
        if (files.length === 0) continue;
        try {
          candidateEntries.push({
            submissionId: sub.id,
            studentName: sub.student?.real_name || sub.student?.username || '未知',
            files: await materialize(files)
          });
        } catch (e) {
          console.warn(`单份查重：提交 ${sub.id} 文件物化失败，跳过: ${e.message}`);
        }
      }
    } catch (e) {
      return fail(res, `候选文件获取失败：${e.message}`, 422);
    }

    if (candidateEntries.length === 0) {
      return success(res, { results: [] }, '其他提交均无可检测文件');
    }

    try {
      // 路径 → [(提交, 文件)] 多值反查：两名学生提交相同文件（秒传共享路径）时，
      // 同一个检测结果要同时归属两个提交；聚合每个被对比提交在所有文件组合中的最高相似度
      const pathToFiles = new Map();
      for (const e of candidateEntries) {
        for (const f of e.files) {
          const list = pathToFiles.get(f.localPath) || [];
          list.push({ entry: e, file: f });
          pathToFiles.set(f.localPath, list);
        }
      }
      const bestBySubmission = new Map();
      let topSimilarity = 0;
      for (const sf of sourceLocalFiles) {
        const detectionResult = await detectionService.detect({
          sourcePath: sf.localPath,
          candidatePaths: [...pathToFiles.keys()],
          assignmentId: parseInt(assignmentId),
          submissionId: parseInt(submissionId),
          timeout: plagiarismService.DETECT_CALL_TIMEOUT
        });
        for (const detResult of detectionResult.results || []) {
          if (detResult.error) continue;
          const score = Number(detResult.similarity_score) || 0;
          for (const hit of pathToFiles.get(detResult.candidate) || []) {
            let agg = bestBySubmission.get(hit.entry.submissionId);
            if (!agg) { agg = { best: null, filePairs: [] }; bestBySubmission.set(hit.entry.submissionId, agg); }
            agg.filePairs.push({ source_file: sf.name, candidate_file: hit.file.name, similarity_score: score });
            if (!agg.best || score > (Number(agg.best.similarity_score) || 0)) agg.best = detResult;
            if (score > topSimilarity) topSimilarity = score;
          }
        }
      }

      const savedResults = [];
      for (const [candidateId, agg] of bestBySubmission) {
        if (!agg.best) continue;
        const matchedEntry = candidateEntries.find(e => e.submissionId === candidateId);
        const detResult = {
          ...agg.best,
          details: { ...(agg.best.details || {}), file_pairs: agg.filePairs }
        };

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
          details: detResult.details,
          status: 'done',
          error_message: null,
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
          details: detResult.details
        });
      }

      return success(res, {
        assignmentId: parseInt(assignmentId),
        submissionId: parseInt(submissionId),
        studentName: targetSubmission.student?.real_name || targetSubmission.student?.username || '未知',
        topSimilarity,
        totalCompared: savedResults.length,
        results: savedResults
      }, '查重检测完成');
    } finally {
      // 清理 COS 物化的临时文件（旧实现漏删，单份查重会在 _detection_tmp 累积残留）
      for (const p of tmpFilesToClean) {
        require('fs').promises.unlink(p).catch(() => {});
      }
    }

  } catch (error) {
    try {
      // 只把本轮尚在处理中的行标记为 error：此前无条件按 submission+assignment
      // 全量更新，会把本轮已成功落库（done）的结果一并改写成 error，
      // 学生该提交的全部历史成功比对随之丢失
      await PlagiarismResult.update(
        { status: 'error', error_message: String(error.message || '').slice(0, 500), checked_at: new Date() },
        {
          where: {
            submission_id: req.params.submissionId,
            assignment_id: req.params.assignmentId,
            status: ['pending', 'processing']
          }
        }
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

    // 2-3. 检查进行中任务 + 建任务：用 MySQL 命名锁串行化（同一事务同一连接）。
    //     此前"先查后插"无原子性，双击/并发会建出两个任务把整班比对算两遍
    const task = await sequelize.transaction(async (trx) => {
      const lockName = `plag_batch:${assignmentId}`;
      const [lockRow] = await sequelize.query(
        'SELECT GET_LOCK(:lock, 5) AS got', { replacements: { lock: lockName }, transaction: trx }
      );
      const got = lockRow && lockRow[0] && lockRow[0].got;
      if (got !== 1) {
        throw Object.assign(new Error('查重任务创建中，请勿重复提交'), { status: 429 });
      }
      try {
        const running = await PlagiarismTask.findOne({
          where: { assignment_id: assignmentId, status: ['pending', 'processing'] },
          order: [['id', 'DESC']],
          transaction: trx
        });
        if (running) return { existing: running };

        // 3. 检查服务健康（提前给教师明确提示，避免建了任务全失败）
        const isHealthy = await detectionService.healthCheck();
        if (!isHealthy) {
          throw Object.assign(new Error('查重检测服务未启动，请联系管理员'), { status: 503 });
        }

        // 4. 统计可查重提交数
        const entries = await plagiarismService.loadValidSubmissionEntries(assignmentId);
        const n = entries.length;
        if (n < 2) return { insufficient: n };

        // 5. 建任务，后台队列执行（C(n,2) 组合去重 + 双向写入）
        return {
          created: await PlagiarismTask.create({
            assignment_id: parseInt(assignmentId),
            created_by: req.user.id,
            total_submissions: n,
            total_pairs: (n * (n - 1)) / 2
          }, { transaction: trx })
        };
      } finally {
        await sequelize.query('SELECT RELEASE_LOCK(:lock)', { replacements: { lock: lockName }, transaction: trx }).catch(() => {});
      }
    });

    if (task.existing) {
      return success(res, { task: formatTask(task.existing), alreadyRunning: true }, '该作业已有查重任务在进行中');
    }
    if (task.insufficient !== undefined) {
      return success(res, { total: task.insufficient, results: [] }, '提交人数不足，至少需要2人才能查重');
    }
    return success(res, { task: formatTask(task.created) }, `查重任务已创建：${task.created.total_submissions} 份提交，共 ${task.created.total_pairs} 对比对`);

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

    const assignment = await assertAssignmentOwner(req, res, assignmentId);
    if (!assignment) return;

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
      // C7：单维度检测失败标记（ORB/OCR/图结构异常置 0 会静默拉低综合分，显式提示）
      dimensionFailures: (r.details && Array.isArray(r.details.dimension_failures) && r.details.dimension_failures.length)
        ? r.details.dimension_failures : null,
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
 * 获取单对比对的双拓扑可视化数据
 * GET /api/plagiarism/results/:assignmentId/:submissionId/topology/:comparedWithId
 * 返回该对比对的图结构（节点+边）、匹配详情与各维度得分，供前端 TopologyComparison 渲染；
 * 旧数据（details 未存边列表）返回节点数据，前端自动降级为只画节点。
 */
exports.getTopologyComparison = async (req, res, next) => {
  try {
    const { assignmentId, submissionId, comparedWithId } = req.params;
    const assignment = await assertAssignmentOwner(req, res, assignmentId);
    if (!assignment) return;

    const result = await PlagiarismResult.findOne({
      where: {
        assignment_id: assignmentId,
        submission_id: submissionId,
        compared_with_id: comparedWithId
      },
      include: [
        {
          model: Submission, as: 'submission',
          include: [{ model: User, as: 'student', attributes: ['id', 'real_name', 'username'] }]
        },
        {
          model: Submission, as: 'comparedWith',
          include: [{ model: User, as: 'student', attributes: ['id', 'real_name', 'username'] }]
        }
      ]
    });
    if (!result) return fail(res, '该对比对的查重结果不存在', 404);
    if (result.status !== 'done') return fail(res, '该对比对尚未完成检测', 422);

    const d = result.details || {};
    return success(res, {
      assignmentId: parseInt(assignmentId),
      submissionId: parseInt(submissionId),
      comparedWithId: parseInt(comparedWithId),
      sourceName: result.submission?.student?.real_name || result.submission?.student?.username || '源图',
      candidateName: result.comparedWith?.student?.real_name || result.comparedWith?.student?.username || '对比图',
      similarityScore: parseFloat(result.similarity_score),
      graphSimilarity: parseFloat(result.graph_similarity),
      textSimilarity: parseFloat(result.text_similarity),
      imageHashScore: parseFloat(result.image_hash_score),
      orbMatchCount: result.orb_match_count,
      isIsomorphic: result.is_isomorphic === 1,
      // 图结构数据（旧数据可能缺 src_edges/cand_edges，前端只画节点）
      srcNodes: d.src_nodes || [],
      candNodes: d.cand_nodes || [],
      srcEdges: d.src_edges || [],
      candEdges: d.cand_edges || [],
      matchDetails: {
        commonNodes: d.common_nodes ?? null,
        commonEdges: d.common_edges ?? null,
        totalNodes: (d.src_nodes || []).length,
        totalEdges: (d.src_edges || []).length,
        nodeTypeSimilarities: d.node_type_similarities || null,
        isIsomorphic: d.structure?.is_isomorphic ?? result.is_isomorphic === 1
      },
      checkedAt: result.checked_at
    }, '获取成功');
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

    const assignment = await assertAssignmentOwner(req, res, assignmentId);
    if (!assignment) return;

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

    const assignment = await assertAssignmentOwner(req, res, assignmentId);
    if (!assignment) return;

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

    const assignment = await assertAssignmentOwner(req, res, assignmentId);
    if (!assignment) return;

    await PlagiarismResult.destroy({
      where: { assignment_id: assignmentId, submission_id: submissionId }
    });
    return success(res, null, '查重结果已删除');
  } catch (error) {
    next(error);
  }
};

/** 报告表格细边框（与未交名单导出样式一致） */
function reportThinBorder() {
  return {
    top: { style: 'thin', color: { argb: 'FFD9D9D9' } },
    left: { style: 'thin', color: { argb: 'FFD9D9D9' } },
    bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } },
    right: { style: 'thin', color: { argb: 'FFD9D9D9' } }
  };
}

/**
 * 导出作业查重报告 Excel（P5：概览 + 全量比对明细 + 学生最高相似度）
 * GET /api/plagiarism/report/:assignmentId
 */
exports.exportReport = async (req, res, next) => {
  try {
    const { assignmentId } = req.params;
    const owned = await assertAssignmentOwner(req, res, assignmentId);
    if (!owned) return;

    const report = await plagiarismService.buildAssignmentReport(assignmentId);
    if (report.totalComparisons === 0 && report.errorPairCount === 0) {
      return fail(res, '该作业暂无查重结果，请先执行查重检测', 422);
    }

    const assignment = await Assignment.findByPk(assignmentId, {
      include: [{ model: Course, as: 'course', include: [{ model: Class, as: 'class' }] }]
    });
    const classTitle = [assignment?.course?.class?.name, assignment?.course?.name]
      .filter(Boolean).join(' · ');

    const workbook = new ExcelJS.Workbook();
    workbook.creator = '信衡作业管理系统';
    workbook.created = new Date();

    // ===== Sheet1 概览 =====
    const ov = workbook.addWorksheet('概览');
    ov.mergeCells('A1:B1');
    ov.getCell('A1').value = `「${assignment?.title || assignmentId}」查重报告`;
    ov.getCell('A1').font = { size: 14, bold: true };
    ov.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
    ov.getRow(1).height = 26;

    const overviewRows = [
      ['班级 / 课程', classTitle || '—'],
      ['导出时间', formatCST(new Date())],
      ['参与比对提交数', report.students.length],
      ['比对总对数', report.totalComparisons],
      ['可疑对数（综合相似度 > 50）', report.suspiciousCount],
      ['高度可疑对数（综合相似度 > 75）', report.highRiskCount],
      ['失败对数', report.errorPairCount]
    ];
    overviewRows.forEach(([k, v]) => {
      const row = ov.addRow([k, v]);
      row.getCell(1).font = { bold: true };
      row.eachCell(cell => cell.border = reportThinBorder());
    });
    ov.getColumn(1).width = 30;
    ov.getColumn(2).width = 36;

    // ===== Sheet2 比对明细（按相似度降序，不截断） =====
    const dt = workbook.addWorksheet('比对明细');
    const dtHeaders = ['序号', '学生A', '学生B', '综合相似度%', '图片哈希%', '文本%', '拓扑结构%', 'ORB匹配数', '图同构', '可疑', '涉及文件对'];
    const dtHead = dt.addRow(dtHeaders);
    dtHead.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    dtHead.alignment = { horizontal: 'center', vertical: 'middle' };
    dtHead.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF52C4A0' } };
      cell.border = reportThinBorder();
    });
    report.pairs.forEach((p, i) => {
      const row = dt.addRow([
        i + 1, p.aName, p.bName,
        Math.round(p.score * 10) / 10,
        Math.round(p.imageHash * 10) / 10,
        Math.round(p.text * 10) / 10,
        Math.round(p.graph * 10) / 10,
        p.orb,
        p.isomorphic ? '是' : '否',
        p.score > 75 ? '高度可疑' : (p.suspicious ? '可疑' : '—'),
        p.filePairs
          ? p.filePairs.map(f => `${f.source_file} × ${f.candidate_file}（${Math.round(f.similarity_score)}%）`).join('；')
          : ''
      ]);
      row.alignment = { horizontal: 'center', vertical: 'middle', wrapText: false };
      row.eachCell(cell => cell.border = reportThinBorder());
      // 相似度列按风险着色（口径与网页端一致：>70 高危红 / >40 中危黄）
      const scoreCell = row.getCell(4);
      if (p.score > 70) scoreCell.font = { bold: true, color: { argb: 'FFC0392B' } };
      else if (p.score > 40) scoreCell.font = { color: { argb: 'FFE67E22' } };
    });
    [6, 12, 12, 13, 11, 9, 12, 11, 8, 10, 46].forEach((w, i) => { dt.getColumn(i + 1).width = w; });

    // ===== Sheet3 学生最高相似度 =====
    const st = workbook.addWorksheet('学生最高相似度');
    const stHeaders = ['序号', '姓名', '最高相似度%', '最相似同学'];
    const stHead = st.addRow(stHeaders);
    stHead.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    stHead.alignment = { horizontal: 'center', vertical: 'middle' };
    stHead.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF52C4A0' } };
      cell.border = reportThinBorder();
    });
    report.students.forEach((s, i) => {
      const row = st.addRow([i + 1, s.name, Math.round(s.score * 10) / 10, s.withName]);
      row.alignment = { horizontal: 'center', vertical: 'middle' };
      row.eachCell(cell => cell.border = reportThinBorder());
      const scoreCell = row.getCell(3);
      if (s.score > 70) scoreCell.font = { bold: true, color: { argb: 'FFC0392B' } };
      else if (s.score > 40) scoreCell.font = { color: { argb: 'FFE67E22' } };
    });
    [6, 14, 13, 14].forEach((w, i) => { st.getColumn(i + 1).width = w; });

    const fileName = `查重报告_${assignment?.title || assignmentId}_${Date.now()}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
};
