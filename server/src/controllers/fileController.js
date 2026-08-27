/**
 * 文件访问控制器（统一授权入口）
 * - 所有文件（本地 uploads/ 与 cos://）的预览/下载都必须经过 canAccessPath 归属校验：
 *   学生只能访问自己的提交文件与本班作业的样例文件；教师限本人作业；管理员全量。
 * - COS 文件通过 302 跳转到短时效签名 URL（比裸公共 URL 泄露面小）。
 */
const path = require('path');
const fs = require('fs');
const { Op, Sequelize } = require('sequelize');
const { SubmissionFile, Submission, Assignment, Course, ClassStudent } = require('../models');
const { success, fail } = require('../utils/response');
const {
  isCOSConfigured, getSignedCOSUrl, headObject
} = require('../config/cos');
const { isCOSPath, extractCOSKey } = require('../utils/fileStorage').helpers;

const UPLOAD_ROOT = path.resolve(path.join(__dirname, '../../', process.env.UPLOAD_DIR || 'uploads'));

/** 校验用户是否有权访问某 file_path（提交文件 或 作业样例文件） */
async function canAccessPath(user, filePath) {
  if (!user || typeof filePath !== 'string' || !filePath.trim()) return false;
  if (user.role === 'admin') return true;

  // 1) 提交文件：按 file_path 反查归属
  const subFile = await SubmissionFile.findOne({
    where: { file_path: filePath },
    include: [{
      model: Submission, as: 'submission',
      attributes: ['student_id'],
      include: [{ model: Assignment, as: 'assignment', attributes: ['teacher_id'] }]
    }]
  });
  if (subFile && subFile.submission) {
    if (user.role === 'teacher') {
      return !!(subFile.submission.assignment &&
        subFile.submission.assignment.teacher_id === user.id);
    }
    return subFile.submission.student_id === user.id;
  }

  // 2) 作业样例文件：学生须在本班，教师须是作业发布者
  // 注意：sample_files 是 JSON 列，直接 Op.like 会被 Sequelize 序列化成带引号的
  // JSON 字符串模式（LIKE '"%...%"'）导致永远匹配不到；必须先 CAST 成 CHAR 再 LIKE
  const candidates = await Assignment.findAll({
    where: Sequelize.where(
      Sequelize.cast(Sequelize.col('sample_files'), 'CHAR'),
      { [Op.like]: `%${filePath}%` }
    ),
    include: [{ model: Course, as: 'course', attributes: ['class_id', 'teacher_id'] }]
  });
  const matched = candidates.find(a =>
    Array.isArray(a.sample_files) &&
    a.sample_files.some(s => s && s.url === filePath)
  );
  if (matched && matched.course) {
    if (user.role === 'teacher') return matched.course.teacher_id === user.id;
    const inClass = await ClassStudent.findOne({
      where: { class_id: matched.course.class_id, student_id: user.id }
    });
    return !!inClass;
  }
  return false;
}

/**
 * 授权下载/预览：GET /api/files/download?path=xxx
 * 支持 URL query 传 token（iframe/img/video 标签无法带 Authorization 头）
 */
exports.download = async (req, res, next) => {
  try {
    const p = String(req.query.path || '').trim();
    if (!p) return fail(res, '缺少 path 参数', 422);
    if (p.includes('..')) return fail(res, '非法路径', 403);

    const allowed = await canAccessPath(req.user, p);
    if (!allowed) return fail(res, '无权访问该文件', 403);

    if (isCOSPath(p)) {
      if (!isCOSConfigured) return fail(res, '文件存储未配置', 404);
      const key = extractCOSKey(p);
      if (!key || key.includes('..') || !key.startsWith('homeworks/')) {
        return fail(res, '非法路径', 403);
      }
      try {
        await headObject(key); // 校验对象存在（404 提前暴露）
      } catch (e) {
        return fail(res, '文件不存在', 404);
      }
      // 短时效签名 URL（10 分钟），限制 URL 泄露后的可利用窗口
      return res.redirect(getSignedCOSUrl(key, 600));
    }

    // 本地文件：路径限定在 uploads 目录内
    let rel = p;
    if (rel.startsWith('uploads/') || rel.startsWith('uploads\\')) rel = rel.substring(8);
    const abs = path.resolve(path.join(UPLOAD_ROOT, rel));
    if (abs !== UPLOAD_ROOT && !abs.startsWith(UPLOAD_ROOT + path.sep)) {
      return fail(res, '禁止访问', 403);
    }
    if (!fs.existsSync(abs)) return fail(res, '文件不存在', 404);
    return res.sendFile(abs);
  } catch (err) {
    next(err);
  }
};

/**
 * 批量解析文件 URL（POST /api/files/urls { paths: [...] }）
 * 与 download 使用同一套归属校验，未授权的 path 返回 null。
 */
exports.resolveUrls = async (req, res, next) => {
  try {
    const { paths } = req.body;
    if (!Array.isArray(paths) || paths.length > 100) {
      return fail(res, '参数 paths 必须为不多于 100 项的数组', 422);
    }
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const result = {};
    for (const p of paths) {
      const allowed = await canAccessPath(req.user, p);
      if (!allowed) { result[p] = null; continue; }
      if (isCOSPath(p)) {
        const key = extractCOSKey(p);
        result[p] = (isCOSConfigured && key && !key.includes('..'))
          ? getSignedCOSUrl(key, 3600)
          : null;
      } else {
        result[p] = `/api/files/download?path=${encodeURIComponent(p)}` +
          (token ? `&token=${encodeURIComponent(token)}` : '');
      }
    }
    return success(res, result, '获取成功');
  } catch (err) {
    next(err);
  }
};
