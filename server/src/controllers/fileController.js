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
  isCOSConfigured, headObject, cosClient, cosConfig
} = require('../config/cos');
const { isCOSPath, extractCOSKey, ensureLocalFile } = require('../utils/fileStorage').helpers;
const { signTicket } = require('../utils/downloadTicket');
const previewService = require('../utils/previewService');
const officeConverter = require('../utils/officeConverter');

// 需要 LibreOffice 转 PDF 才能预览的格式（响应为 application/pdf 二进制流）
const OFFICE_EXTS = new Set(['.doc', '.xls', '.ppt', '.pptx']);

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
        await headObject(key); // 校验对象存在（404 提前暴露），顺带拿到大小
      } catch (e) {
        return fail(res, '文件不存在', 404);
      }
      // 服务端代理流式转发，不再 302 到 COS 签名 URL：
      // 桶开启"强制下载"后 COS 会对 GET 强加 Content-Disposition: attachment
      // （x-cos-force-download: true，且 response-content-disposition 覆盖参数压不过它），
      // 302 会让 iframe 预览一律变成下载。代理时头部由本服务决定，与本地文件同一套
      // 白名单口径；预签名 URL 也不再暴露给浏览器，泄露面更小。
      // 代价是流量经服务器转发（视频拖动进度条不支持 Range，从头缓冲）。
      const ext = path.extname(key).toLowerCase();
      const inlineType = INLINE_TYPES[ext];
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', inlineType || 'application/octet-stream');
      res.setHeader('Content-Disposition',
        `${inlineType ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(path.basename(key))}`);
      return proxyCOSObject(key, res);
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
 * 在线预览（文档转换）：GET /api/files/preview?path=xxx
 * 鉴权与 download 完全同构（Authorization 头或 ?st= 短时效票据 + 同一套归属校验）。
 * 响应按格式分流：
 *   - docx/xlsx/txt 等：JSON { kind, html/text }（原生转换，快）
 *   - doc/xls/ppt/pptx：直接流式下发转换出的 PDF（LibreOffice，首次较慢），
 *     前端按 blob 读取后塞进 iframe（axios 需 responseType:'blob'）
 * 图片/PDF/音视频由 download 端点以 inline 方式直接下发，不走本端点。
 */
exports.preview = async (req, res, next) => {
  try {
    const p = String(req.query.path || '').trim();
    if (!p) return fail(res, '缺少 path 参数', 422);
    if (p.includes('..')) return fail(res, '非法路径', 403);

    const allowed = req.ticketAuthorized || await canAccessPath(req.user, p);
    if (!allowed) return fail(res, '无权访问该文件', 403);

    const extLower = path.extname(p).toLowerCase();
    // COS 文件：先物化到本地临时目录再转换，用完即删
    let absPath = null;
    let tempFile = null;
    try {
      if (isCOSPath(p)) {
        if (!isCOSConfigured) return fail(res, '文件存储未配置', 404);
        const key = extractCOSKey(p);
        if (!key || key.includes('..') || !key.startsWith('homeworks/')) {
          return fail(res, '非法路径', 403);
        }
        absPath = await ensureLocalFile(p);
        tempFile = absPath;
      } else {
        let rel = p;
        if (rel.startsWith('uploads/') || rel.startsWith('uploads\\')) rel = rel.substring(8);
        absPath = path.resolve(path.join(UPLOAD_ROOT, rel));
        if (absPath !== UPLOAD_ROOT && !absPath.startsWith(UPLOAD_ROOT + path.sep)) {
          return fail(res, '禁止访问', 403);
        }
        if (!fs.existsSync(absPath)) return fail(res, '文件不存在', 404);
      }

      // Office 旧格式：LibreOffice 转 PDF 后内联流式下发
      if (OFFICE_EXTS.has(extLower)) {
        const pdfPath = await officeConverter.convertToPdf(absPath, p);
        return streamPdfFile(res, pdfPath);
      }

      try {
        const data = await previewService.getPreview(
          absPath, extLower, `${p}|${extLower}`
        );
        return success(res, data, '转换成功');
      } catch (err) {
        // docx/xlsx 原生解析崩溃（损坏/特殊排版）时降级走 LibreOffice 转 PDF，
        // 有转换服务就能预览；没有则明确提示
        if ((!err.status || err.status >= 500) && (extLower === '.docx' || extLower === '.xlsx')) {
          try {
            const pdfPath = await officeConverter.convertToPdf(absPath, p);
            return streamPdfFile(res, pdfPath);
          } catch (e2) {
            return fail(res, '文档解析失败，请下载查看', 422);
          }
        }
        throw err;
      }
    } finally {
      if (tempFile) previewService.removeTempFile(tempFile);
    }
  } catch (err) {
    if (err.code === 'ENOENT') return fail(res, '文件不存在', 404);
    if (err.status) return fail(res, err.message, err.status);
    next(err);
  }
};

/** 以 application/pdf inline 方式流式下发转换产物 */
function streamPdfFile(res, pdfPath) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline');
  const stream = fs.createReadStream(pdfPath);
  stream.on('error', () => {
    if (!res.headersSent) return fail(res, '读取转换结果失败', 500);
    res.end();
  });
  return stream.pipe(res);
}

/** COS 对象代理转发：SDK 直接把对象流写进响应，失败时尽早回错 */
function proxyCOSObject(key, res) {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    const { PassThrough } = require('stream');
    const proxy = new PassThrough();
    cosClient.getObject({
      Bucket: cosConfig.Bucket,
      Region: cosConfig.Region,
      Key: key,
      Output: proxy
    }, (err) => {
      if (err && !res.headersSent) {
        fail(res, '文件读取失败', 502);
      }
      if (err) done(); // 已开始响应后出错只能截断
    });
    proxy.on('error', () => {
      if (!res.headersSent) fail(res, '文件读取失败', 502);
      else res.end();
      done();
    });
    res.on('close', done);
    proxy.pipe(res).on('finish', done);
  });
}

/**
 * 批量解析文件 URL（POST /api/files/urls { paths: [...] }）
 * 与 download 使用同一套归属校验，未授权的 path 返回 null。
 * 本地与 COS 文件统一返回带短时效票据（st）的下载 URL：iframe/img/video 标签
 * 直接加载本站代理地址（COS 桶开启"强制下载"后签名 URL 会强加 attachment，
 * 预览必挂，见 download 内注释），不再把 COS 签名 URL 或长期 JWT 暴露给浏览器。
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
      let ok = true;
      if (isCOSPath(p)) {
        const key = extractCOSKey(p);
        // 前缀围栏与 download 端点对齐：仅允许 homeworks/ 内的对象，
        // 防止对桶内其他前缀（备份、配置等）签发访问凭证
        ok = isCOSConfigured && key && !key.includes('..') && key.startsWith('homeworks/');
      }
      result[p] = ok
        ? `/api/files/download?path=${encodeURIComponent(p)}&st=${encodeURIComponent(signTicket(p))}`
        : null;
    }
    return success(res, result, '获取成功');
  } catch (err) {
    next(err);
  }
};
