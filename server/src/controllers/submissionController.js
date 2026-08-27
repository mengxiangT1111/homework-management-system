const path = require('path');
const fs = require('fs');
const os = require('os');
const { Op } = require('sequelize');
const archiver = require('archiver');
const ExcelJS = require('exceljs');
const {
  sequelize, Submission, SubmissionFile, Assignment, Course, Class, User, ClassStudent, Notification
} = require('../models');
const { success, fail, paginate, normalizePage } = require('../utils/response');
const { isOverdue } = require('./assignmentController');
const { isCOSConfigured, headObject } = require('../config/cos');

// 上传目录绝对路径
const UPLOAD_DIR = path.resolve(path.join(__dirname, '../../', process.env.UPLOAD_DIR || 'uploads'));
const { isCOSPath, extractCOSKey, ensureLocalFile } = require('../utils/fileStorage').helpers;

// 获取扩展名
function getExt(filename) {
  return path.extname(filename).replace('.', '').toLowerCase();
}

// 文件名只保留 basename 并限长，防止 original_name 携带 ../ 造成打包下载时的 zip 路径穿越
function sanitizeFileName(name) {
  const base = path.basename(String(name)).replace(/[\\/:*?"<>|]/g, '_').trim();
  return base.slice(0, 255) || 'unnamed';
}

// 校验文件路径是否在 uploads 目录内（防路径穿越）
function isPathSafe(relativePath) {
  // 移除可能存在的 uploads/ 前缀
  let cleanPath = relativePath;
  if (cleanPath.startsWith('uploads/') || cleanPath.startsWith('uploads\\')) {
    cleanPath = cleanPath.substring(8);
  }
  const absPath = path.resolve(path.join(UPLOAD_DIR, cleanPath));
  return absPath === UPLOAD_DIR || absPath.startsWith(UPLOAD_DIR + path.sep);
}

// 学生提交作业（创建/更新提交记录，绑定已上传的文件）
exports.submitAssignment = async (req, res, next) => {
  try {
    const { id } = req.params; // assignment id
    const { files, remark } = req.body; // files: [{original_name, file_path, file_size, mime_type, file_hash}]

    const assignment = await Assignment.findByPk(id, {
      include: [{ model: Course, as: 'course' }]
    });
    if (!assignment) return fail(res, '作业不存在', 404);
    if (!assignment.course) return fail(res, '作业所属课程已不存在，无法提交', 422);

    // 教师显式关闭的作业禁止提交（此前只查逾期，关闭状态被绕过）
    if (assignment.status === 'closed') {
      return fail(res, '作业已关闭，禁止提交', 422);
    }

    // 逾期禁止提交
    if (isOverdue(assignment)) {
      return fail(res, '作业已逾期，禁止提交', 422);
    }

    // 校验学生是否属于该作业所在班级
    const inClass = await ClassStudent.findOne({
      where: { class_id: assignment.course.class_id, student_id: req.user.id }
    });
    if (!inClass) return fail(res, '你不属于该作业所在班级，无法提交', 403);

    if (!Array.isArray(files) || files.length === 0) {
      return fail(res, '请至少上传一份作业文件', 422);
    }
    if (files.length > assignment.max_files) {
      return fail(res, `最多只能上传 ${assignment.max_files} 份文件`, 422);
    }

    // 校验文件格式 + 单文件大小上限（教师设置的 max_size_mb 此前仅前端生效）
    const allowed = assignment.allowed_formats || [];
    for (const f of files) {
      if (!f.original_name || typeof f.original_name !== 'string') {
        return fail(res, '文件名不能为空', 422);
      }
      f.original_name = sanitizeFileName(f.original_name);
      const ext = getExt(f.original_name);
      if (allowed.length > 0 && !allowed.includes(ext)) {
        return fail(res, `文件 ${f.original_name} 格式不被允许（仅支持：${allowed.join(', ')}）`, 422);
      }
      const declaredSize = Number(f.file_size) || 0;
      if (declaredSize > assignment.max_size_mb * 1024 * 1024) {
        return fail(res, `文件 ${f.original_name} 超过单文件上限 ${assignment.max_size_mb}MB`, 422);
      }
    }

    // 校验文件真实存在 + 路径安全检查（防止路径穿越）
    for (const f of files) {
      // COS 路径：格式 cos://homeworks/xxx。用 headObject 校验对象存在并取真实大小，
      // 不能只信客户端自报的 file_size（否则可伪造大小绕过教师设置的单文件上限）
      if (isCOSPath(f.file_path)) {
        const key = extractCOSKey(f.file_path);
        if (!key || key.includes('..') || !key.startsWith('homeworks/')) {
          return fail(res, `文件路径不合法`, 403);
        }
        if (isCOSConfigured) {
          let head;
          try {
            head = await headObject(key);
          } catch (e) {
            return fail(res, `文件 ${f.original_name} 在对象存储中不存在，请重新上传`, 422);
          }
          const realSize = Number(head && head['content-length']) || 0;
          if (realSize > assignment.max_size_mb * 1024 * 1024) {
            return fail(res, `文件 ${f.original_name} 超过单文件上限 ${assignment.max_size_mb}MB`, 422);
          }
          f.file_size = realSize;
        }
        continue;
      }
      if (!isPathSafe(f.file_path)) {
        return fail(res, `文件路径不合法`, 403);
      }
      // file_path 格式: "uploads/202607/xxx.docx" 或 "202607/xxx.docx"
      // 需要移除可能存在的 uploads/ 前缀
      let relativePath = f.file_path;
      if (relativePath.startsWith('uploads/') || relativePath.startsWith('uploads\\')) {
        relativePath = relativePath.substring(8); // 移除 "uploads/"
      }
      const abs = path.join(UPLOAD_DIR, relativePath);
      if (!fs.existsSync(abs)) {
        return fail(res, `文件 ${f.original_name} 不存在，请重新上传`, 422);
      }
      // 以磁盘真实大小为准再校验一次，防止客户端伪造 file_size 绕过
      const realSize = fs.statSync(abs).size;
      if (realSize > assignment.max_size_mb * 1024 * 1024) {
        return fail(res, `文件 ${f.original_name} 超过单文件上限 ${assignment.max_size_mb}MB`, 422);
      }
      f.file_size = realSize;
    }

    // 已被批改（教师/AI 打过分的）提交禁止覆盖重交；教师"退回重做"(returned)除外。
    // need_grading=false 的作业提交即 graded 但从未有人打分（score/graded_by 均为空），允许重交。
    const existing = await Submission.findOne({
      where: { assignment_id: id, student_id: req.user.id }
    });
    if (existing && existing.status !== 'returned' &&
        (existing.score !== null || existing.graded_by !== null)) {
      return fail(res, '该作业已批改，不允许重新提交；如确需重交请联系老师退回', 422);
    }

    // 提交主流程事务化：避免"旧文件已删、新文件写入失败"产生零文件的已提交记录
    const fileRecords = files.map(f => ({
      submission_id: null, // 事务内回填
      original_name: f.original_name,
      file_path: f.file_path,
      file_size: f.file_size,
      mime_type: String(f.mime_type || 'application/octet-stream').slice(0, 100),
      file_hash: f.file_hash || null
    }));
    let submissionId = null;
    let created = false;
    await sequelize.transaction(async (t) => {
      const [submission, wasCreated] = await Submission.findOrCreate({
        where: { assignment_id: id, student_id: req.user.id },
        defaults: {
          assignment_id: id,
          student_id: req.user.id,
          status: assignment.need_grading ? 'submitted' : 'graded',
          submitted_at: new Date(),
          remark: remark || null
        },
        transaction: t
      });
      created = wasCreated;
      submissionId = submission.id;

      if (!wasCreated) {
        // 重新提交：删除旧文件记录
        await SubmissionFile.destroy({ where: { submission_id: submission.id }, transaction: t });
        submission.status = assignment.need_grading ? 'submitted' : 'graded';
        submission.score = null;
        submission.comment = null;
        submission.graded_by = null;
        submission.submitted_at = new Date();
        submission.remark = remark || null;
        await submission.save({ transaction: t });
      }
      await SubmissionFile.bulkCreate(
        fileRecords.map(r => ({ ...r, submission_id: submission.id })),
        { transaction: t }
      );
    });

    // 通知教师有新提交
    await Notification.create({
      user_id: assignment.teacher_id,
      title: '新的作业提交',
      content: `${req.user.real_name} 提交了作业「${assignment.title}」`,
      type: 'assignment',
      related_id: assignment.id
    });

    const result = await Submission.findByPk(submissionId, {
      include: [{ model: SubmissionFile, as: 'files' }]
    });
    return success(res, result, created ? '提交成功' : '已重新提交', created ? 201 : 200);
  } catch (err) {
    // (assignment_id, student_id) 唯一索引兜底并发提交，转成友好提示而非 500
    if (err.name === 'SequelizeUniqueConstraintError') {
      return fail(res, '操作过于频繁，请刷新后查看提交记录', 429);
    }
    next(err);
  }
};

// 学生查看自己的提交记录列表
exports.mySubmissions = async (req, res, next) => {
  try {
    const { page, pageSize } = normalizePage(req.query);
    const { rows, count } = await Submission.findAndCountAll({
      where: { student_id: req.user.id },
      include: [
        {
          model: Assignment, as: 'assignment',
          include: [{ model: Course, as: 'course', attributes: ['id', 'name'] }]
        },
        { model: SubmissionFile, as: 'files' }
      ],
      order: [['submitted_at', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
      distinct: true
    });
    return paginate(res, rows, count, page, pageSize);
  } catch (err) {
    next(err);
  }
};

// 学生查看某次作业的提交详情
exports.getMySubmission = async (req, res, next) => {
  try {
    const { id } = req.params; // assignment id
    const sub = await Submission.findOne({
      where: { assignment_id: id, student_id: req.user.id },
      include: [{ model: SubmissionFile, as: 'files' }, { model: Assignment, as: 'assignment' }]
    });
    return success(res, sub, '获取成功');
  } catch (err) {
    next(err);
  }
};

// 教师查看单个提交详情（含文件）
exports.getSubmission = async (req, res, next) => {
  try {
    const { id } = req.params;
    const sub = await Submission.findByPk(id, {
      include: [
        { model: SubmissionFile, as: 'files' },
        { model: Assignment, as: 'assignment' },
        { model: User, as: 'student', attributes: ['id', 'username', 'real_name', 'email'] }
      ]
    });
    if (!sub) return fail(res, '提交记录不存在', 404);
    if (req.user.role === 'teacher' && sub.assignment.teacher_id !== req.user.id) {
      return fail(res, '无权查看', 403);
    }
    return success(res, sub, '获取成功');
  } catch (err) {
    next(err);
  }
};

// 教师打分 + 写评语
exports.gradeSubmission = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { score, comment, status } = req.body;

    const sub = await Submission.findByPk(id, {
      include: [{ model: Assignment, as: 'assignment' }]
    });
    if (!sub) return fail(res, '提交记录不存在', 404);
    if (req.user.role === 'teacher' && sub.assignment.teacher_id !== req.user.id) {
      return fail(res, '无权操作', 403);
    }
    let normalizedScore = sub.score;
    if (score !== undefined && score !== null) {
      const s = Number(score);
      if (isNaN(s) || s < 0 || s > 100) {
        return fail(res, '分数需在 0-100 之间', 422);
      }
      normalizedScore = s;
    }
    if (status !== undefined && status !== null && !['submitted', 'graded', 'returned'].includes(status)) {
      return fail(res, '状态参数非法', 422);
    }
    await sub.update({
      score: normalizedScore,
      comment: comment !== undefined ? comment : sub.comment,
      status: status || (score !== undefined ? 'graded' : sub.status),
      graded_by: req.user.id,
      graded_at: new Date()
    });

    // 通知学生成绩已出
    await Notification.create({
      user_id: sub.student_id,
      title: '作业成绩已公布',
      content: `你的作业「${sub.assignment.title}」已被批改，得分：${score !== undefined ? normalizedScore : '未评分'}`,
      type: 'grade',
      related_id: sub.assignment_id
    });

    const updated = await Submission.findByPk(id, { include: [{ model: SubmissionFile, as: 'files' }] });
    return success(res, updated, '批改成功');
  } catch (err) {
    next(err);
  }
};

// 教师标记未交学生（发送催交通知）
exports.remindUnsubmitted = async (req, res, next) => {
  try {
    const { id } = req.params; // assignment id
    const assignment = await Assignment.findByPk(id, {
      include: [{ model: Course, as: 'course' }]
    });
    if (!assignment) return fail(res, '作业不存在', 404);
    if (!assignment.course) return fail(res, '作业所属课程已不存在', 422);
    if (req.user.role === 'teacher' && assignment.teacher_id !== req.user.id) {
      return fail(res, '无权操作', 403);
    }

    const students = await User.findAll({
      include: [{
        model: Class, as: 'classes',
        where: { id: assignment.course.class_id },
        through: { attributes: [] }, required: true
      }],
      attributes: ['id', 'real_name']
    });
    const submittedIds = (await Submission.findAll({
      where: { assignment_id: id }, attributes: ['student_id']
    })).map(s => s.student_id);
    const submittedSet = new Set(submittedIds);

    const unsubmitted = students.filter(s => !submittedSet.has(s.id));
    if (unsubmitted.length > 0) {
      // 注意 type 不能用 'deadline'：系统自动截止提醒按 type='deadline' 去重，
      // 手动催交若同类型会"顶掉"学生的官方 24 小时截止提醒
      await Notification.bulkCreate(unsubmitted.map(stu => ({
        user_id: stu.id,
        title: '作业催交通知',
        content: `你尚未提交作业「${assignment.title}」，截止时间：${new Date(assignment.deadline).toLocaleString('zh-CN')}，请尽快提交！`,
        type: 'assignment',
        related_id: assignment.id
      })));
    }
    return success(res, { reminded: unsubmitted.length }, `已向 ${unsubmitted.length} 名未交学生发送催交通知`);
  } catch (err) {
    next(err);
  }
};

// 打包下载某作业的全部提交文件（zip）
exports.downloadAll = async (req, res, next) => {
  try {
    const { id } = req.params;
    const assignment = await Assignment.findByPk(id, {
      include: [{ model: Course, as: 'course', include: [{ model: Class, as: 'class' }] }]
    });
    if (!assignment) return fail(res, '作业不存在', 404);
    if (req.user.role === 'teacher' && assignment.teacher_id !== req.user.id) {
      return fail(res, '无权操作', 403);
    }

    const submissions = await Submission.findAll({
      where: { assignment_id: id },
      include: [
        { model: SubmissionFile, as: 'files' },
        { model: User, as: 'student', attributes: ['username', 'real_name'] }
      ]
    });

    if (submissions.length === 0) {
      return fail(res, '暂无提交记录', 422);
    }

    const zipName = `${assignment.title}_提交_${Date.now()}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(zipName)}"`);

    const archive = archiver('zip', { zlib: { level: 5 } });
    // 响应头已发出，不能再走 next(err)（会触发 ERR_HTTP_HEADERS_SENT），直接断开连接让客户端感知失败
    archive.on('error', () => { res.destroy(); });
    // 客户端取消下载时终止打包，避免服务端空转
    res.on('close', () => { archive.abort(); });
    archive.pipe(res);

    const tmpFiles = []; // COS 物化产生的临时文件，打包完成后清理
    try {
      // 按学生建文件夹（兼容 COS 与本地文件）
      for (const sub of submissions) {
        const folderName = sanitizeFileName(`${sub.student.real_name}_${sub.student.username}`);
        for (const file of sub.files) {
          if (file.is_cleaned) continue; // 已清理的文件不再打包
          try {
            const abs = await ensureLocalFile(file.file_path);
            if (abs.startsWith(os.tmpdir())) tmpFiles.push(abs);
            archive.file(abs, { name: `${folderName}/${sanitizeFileName(file.original_name)}` });
          } catch (e) {
            console.warn('[打包下载] 文件获取失败，跳过:', file.file_path, e.message);
          }
        }
      }
      await archive.finalize();
    } finally {
      for (const p of tmpFiles) fs.promises.unlink(p).catch(() => {});
    }
  } catch (err) {
    next(err);
  }
};

// 导出未交名单 Excel
exports.exportUnsubmittedExcel = async (req, res, next) => {
  try {
    const { id } = req.params;
    const assignment = await Assignment.findByPk(id, {
      include: [{ model: Course, as: 'course', include: [{ model: Class, as: 'class' }] }]
    });
    if (!assignment) return fail(res, '作业不存在', 404);
    if (!assignment.course) return fail(res, '作业所属课程已不存在', 422);
    if (req.user.role === 'teacher' && assignment.teacher_id !== req.user.id) {
      return fail(res, '无权操作', 403);
    }

    const students = await User.findAll({
      include: [{
        model: Class, as: 'classes',
        where: { id: assignment.course.class_id },
        through: { attributes: [] }, required: true
      }],
      attributes: ['id', 'username', 'real_name', 'email', 'phone'],
      order: [['username', 'ASC']]
    });
    const submittedIds = (await Submission.findAll({
      where: { assignment_id: id }, attributes: ['student_id']
    })).map(s => s.student_id);
    const submittedSet = new Set(submittedIds);
    const unsubmitted = students.filter(s => !submittedSet.has(s.id));

    // 构建 Excel
    const workbook = new ExcelJS.Workbook();
    workbook.creator = '作业管理系统';
    workbook.created = new Date();
    const ws = workbook.addWorksheet('未交名单');

    // 标题行
    ws.mergeCells('A1:E1');
    ws.getCell('A1').value = `${assignment.course.class.name} - 「${assignment.title}」未交学生名单`;
    ws.getCell('A1').font = { size: 14, bold: true };
    ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 26;

    ws.mergeCells('A2:E2');
    ws.getCell('A2').value = `截止时间：${new Date(assignment.deadline).toLocaleString('zh-CN')}    ｜    总人数：${students.length}    已交：${students.length - unsubmitted.length}    未交：${unsubmitted.length}`;
    ws.getCell('A2').font = { size: 11, color: { argb: 'FF888888' } };
    ws.getCell('A2').alignment = { horizontal: 'center' };

    // 表头
    const headers = ['序号', '学号', '姓名', '邮箱', '联系电话'];
    const headerRow = ws.addRow(headers);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
    headerRow.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF52C4A0' } };
      cell.border = thinBorder();
    });

    unsubmitted.forEach((s, i) => {
      const row = ws.addRow([i + 1, s.username, s.real_name, s.email || '', s.phone || '']);
      row.alignment = { horizontal: 'center', vertical: 'middle' };
      row.eachCell(cell => cell.border = thinBorder());
    });

    // 列宽
    ws.columns.forEach((col, i) => {
      col.width = [8, 18, 14, 28, 16][i];
    });

    const fileName = `未交名单_${assignment.title}_${Date.now()}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
};

function thinBorder() {
  return {
    top: { style: 'thin', color: { argb: 'FFD0D0D0' } },
    left: { style: 'thin', color: { argb: 'FFD0D0D0' } },
    bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } },
    right: { style: 'thin', color: { argb: 'FFD0D0D0' } }
  };
}
