/**
 * Plagiarism Controller
 * 查重检测控制器 - 新增全班一键查重功能
 */

const path = require('path');
const { Op } = require('sequelize');
const {
  Submission, SubmissionFile, Assignment, Course, User, PlagiarismResult
} = require('../models');
const { success, fail } = require('../utils/response');
const detectionService = require('../services/detectionService');

const UPLOAD_DIR = path.resolve(path.join(__dirname, '../../', process.env.UPLOAD_DIR || 'uploads'));

/**
 * 教师手动触发查重检测
 * POST /api/plagiarism/check/:assignmentId/:submissionId
 */
exports.checkPlagiarism = async (req, res, next) => {
  try {
    const { assignmentId, submissionId } = req.params;
    
    const assignment = await Assignment.findByPk(assignmentId);
    if (!assignment) return fail(res, '作业不存在', 404);
    if (assignment.teacher_id !== req.user.id && req.user.role !== 'admin') {
      return fail(res, '仅作业发布教师可进行查重检测', 403);
    }
    
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
    
    const sourceFile = targetFiles[0];
    const sourcePath = sourceFile.file_path;
    
    const candidateEntries = [];
    for (const sub of otherSubmissions) {
      const files = sub.Files || sub.files || [];
      if (files.length > 0 && !files[0].is_cleaned) {
        candidateEntries.push({
          submissionId: sub.id,
          studentName: sub.student?.real_name || sub.student?.username || '未知',
          filePath: files[0].file_path
        });
      }
    }
    
    if (candidateEntries.length === 0) {
      return success(res, { results: [] }, '其他提交均无文件');
    }
    
    await PlagiarismResult.update(
      { status: 'processing' },
      { where: { submission_id: submissionId, assignment_id: assignmentId } }
    );
    
    const detectionResult = await detectionService.detect({
      sourcePath: sourcePath,
      candidatePaths: candidateEntries.map(e => e.filePath),
      assignmentId: parseInt(assignmentId),
      submissionId: parseInt(submissionId)
    });
    
    const savedResults = [];
    for (const detResult of detectionResult.results || []) {
      const matchedEntry = candidateEntries.find(e => e.filePath === detResult.candidate);
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
 * 全班一键查重
 * POST /api/plagiarism/batch-check/:assignmentId
 * 对该作业每份已提交作业，与同班其他已提交作业逐一比对
 */
exports.batchCheckAll = async (req, res, next) => {
  try {
    const { assignmentId } = req.params;
    
    // 1. 验证作业
    const assignment = await Assignment.findByPk(assignmentId);
    if (!assignment) return fail(res, '作业不存在', 404);
    if (assignment.teacher_id !== req.user.id && req.user.role !== 'admin') {
      return fail(res, '仅作业发布教师可操作', 403);
    }
    
    // 2. 检查服务健康
    const isHealthy = await detectionService.healthCheck();
    if (!isHealthy) {
      return fail(res, '查重检测服务未启动，请联系管理员', 503);
    }
    
    // 3. 获取所有已提交的作业（含文件）
    const submissions = await Submission.findAll({
      where: { assignment_id: assignmentId },
      include: [
        { model: SubmissionFile, as: 'files' },
        { model: User, as: 'student', attributes: ['id', 'real_name', 'username'] }
      ],
      order: [['id', 'ASC']]
    });
    
    // 只取有文件且未被清理的提交
    const validSubmissions = submissions.filter(s => {
      const files = s.Files || s.files || [];
      return files.length > 0 && !files[0].is_cleaned;
    });
    
    if (validSubmissions.length < 2) {
      return success(res, { total: 0, results: [] }, '提交人数不足，至少需要2人才能查重');
    }
    
    // 4. 构建所有文件路径映射
    const submissionMap = {};
    for (const sub of validSubmissions) {
      const files = sub.Files || sub.files || [];
      submissionMap[sub.id] = {
        studentName: sub.student?.real_name || sub.student?.username || '未知',
        filePath: files[0].file_path
      };
    }
    
    // 5. 逐对检测
    const allResults = [];
    const total = validSubmissions.length;
    let completed = 0;
    
    // 更新状态为处理中
    await PlagiarismResult.update(
      { status: 'processing' },
      { where: { assignment_id: assignmentId } }
    );
    
    for (const sourceSub of validSubmissions) {
      const sourcePath = submissionMap[sourceSub.id].filePath;
      const candidatePaths = validSubmissions
        .filter(s => s.id !== sourceSub.id)
        .map(s => submissionMap[s.id].filePath);
      
      if (candidatePaths.length === 0) continue;
      
      try {
        const detectionResult = await detectionService.detect({
          sourcePath: sourcePath,
          candidatePaths: candidatePaths,
          assignmentId: parseInt(assignmentId),
          submissionId: sourceSub.id
        });
        
        // 保存结果
        for (const detResult of detectionResult.results || []) {
          // 找到对应的 comparedWithId
          const matchedEntry = Object.entries(submissionMap).find(
            ([id, entry]) => entry.filePath === detResult.candidate
          );
          if (!matchedEntry) continue;
          
          const comparedWithId = parseInt(matchedEntry[0]);
          
          const [plagResult] = await PlagiarismResult.upsert({
            assignment_id: parseInt(assignmentId),
            submission_id: sourceSub.id,
            compared_with_id: comparedWithId,
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
          
          allResults.push({
            id: plagResult.id,
            submissionId: sourceSub.id,
            comparedWithId: comparedWithId,
            studentName: submissionMap[sourceSub.id].studentName,
            comparedWithName: submissionMap[comparedWithId].studentName,
            similarityScore: detResult.similarity_score || 0,
            isSuspicious: detResult.is_suspicious || false
          });
        }
      } catch (e) {
        console.error(`查重失败 submission=${sourceSub.id}: ${e.message}`);
      }
      
      completed++;
    }
    
    // 6. 按相似度降序排列，取前20条最可疑的
    const suspiciousResults = allResults
      .filter(r => r.isSuspicious)
      .sort((a, b) => b.similarityScore - a.similarityScore)
      .slice(0, 20);
    
    // 统计每个学生的最高相似度
    const studentMaxScores = {};
    for (const r of allResults) {
      if (!studentMaxScores[r.submissionId] || r.similarityScore > studentMaxScores[r.submissionId]) {
        studentMaxScores[r.submissionId] = r.similarityScore;
      }
    }
    
    // 构建学生姓名映射
    const studentNameMap = {};
    for (const [id, entry] of Object.entries(submissionMap)) {
      studentNameMap[id] = entry.studentName;
    }
    
    return success(res, {
      total: total,
      completed: completed,
      totalComparisons: allResults.length,
      suspiciousCount: allResults.filter(r => r.isSuspicious).length,
      suspiciousResults: suspiciousResults,
      studentMaxScores: studentMaxScores,
      studentNameMap: studentNameMap
    }, `全班查重完成，检测 ${completed} 份提交，发现 ${suspiciousResults.length} 条可疑结果`);
    
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
        model: require('../models/Submission'),
        as: 'comparedWith',
        include: [{
          model: User,
          as: 'student',
          attributes: ['id', 'real_name', 'username']
        }]
      }],
      order: [['similarity_score', 'DESC']]
    });
    
    const formattedResults = results.map(r => ({
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
      results: formattedResults
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