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
const { signTicket } = require('../utils/downloadTicket');

const UPLOAD_ROOT = path.resolve(path.join(__dirname, '../../', process.env.UPLOAD_DIR || 'uploads'));

// 允许浏览器内联预览的扩展名白名单；其余扩展名一律按附件下载（application/octet-stream
// + Content-Disposition: attachment），防止上传的 .xhtml/.xml 等被当页面渲染造成存储型 XSS
const INLINE_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8'
};

/** 样例文件 url 的合法前缀（与 download 端点的围栏口径一致）：
 *  cos:// 路径只允许 homeworks/ 前缀，防止 sample_files 被塞入任意桶内 key
 *  后经 /api/files/urls 换取预签名 URL 越权读取桶内其他对象 */
function isSampleUrlAllowed(p) {
  if (p.includes('..')) return false;
  if (p.startsWith('cos://')) return p.startsWith('cos://homeworks/');
  return true; // 本地路径由 download 端点的 UPLOAD_ROOT 包含性检查兜底
}

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
  if (matched && matched.course && isSampleUrlAllowed(filePath)) {
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
 * 鉴权：Authorization 头（走 canAccessPath 归属校验）或 ?st= 短时效票据
 */
exports.download = async (req, res, next) => {
  try {
    const p = String(req.query.path || '').trim();
    if (!p) return fail(res, '缺少 path 参数', 422);
    if (p.includes('..')) return fail(res, '非法路径', 403);

    const allowed = req.ticketAuthorized || await canAccessPath(req.user, p);
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

    // S4 防内联 XSS：非白名单类型强制 octet-stream + attachment；白名单类型也带
    // nosniff（helmet 全局有，这里显式兜底，防止反代/直连场景未过 helmet）
    const ext = path.extname(abs).toLowerCase();
    const displayName = encodeURIComponent(path.basename(abs));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (INLINE_TYPES[ext]) {
      res.setHeader('Content-Type', INLINE_TYPES[ext]);
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${displayName}`);
    } else {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${displayName}`);
    }
    return res.sendFile(abs);
  } catch (err) {
    next(err);
  }
};

/**
 * 批量解析文件 URL（POST /api/files/urls { paths: [...] }）
 * 与 download 使用同一套归属校验，未授权的 path 返回 null。
 * 本地文件返回带短时效票据（st）的下载 URL；COS 文件返回短时效签名 URL。
 * 均不再把长期 JWT 拼进 URL（避免 token 进日志/浏览器历史）。
 */
exports.resolveUrls = async (req, res, next) => {
  try {
    const { paths } = req.body;
    if (!Array.isArray(paths) || paths.length > 100) {
      return fail(res, '参数 paths 必须为不多于 100 项的数组', 422);
    }
    const result = {};
    for (const p of paths) {
      const allowed = await canAccessPath(req.user, p);
      if (!allowed) { result[p] = null; continue; }
      if (isCOSPath(p)) {
        const key = extractCOSKey(p);
        // 前缀围栏与 download 端点对齐：仅允许 homeworks/ 内的对象签名，
        // 防止对桶内其他前缀（备份、配置等）签发预签名 URL
        result[p] = (isCOSConfigured && key && !key.includes('..') && key.startsWith('homeworks/'))
          ? getSignedCOSUrl(key, 3600)
          : null;
      } else {
        result[p] = `/api/files/download?path=${encodeURIComponent(p)}&st=${encodeURIComponent(signTicket(p))}`;
      }
    }
    return success(res, result, '获取成功');
  } catch (err) {
    next(err);
  }
};
