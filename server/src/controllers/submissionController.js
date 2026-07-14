const path = require('path');
const fs = require('fs');
const { Op } = require('sequelize');
const archiver = require('archiver');
const ExcelJS = require('exceljs');
const {
  Submission, SubmissionFile, Assignment, Course, Class, User, ClassStudent, Notification
} = require('../models');
const { success, fail, paginate } = require('../utils/response');
const { isOverdue } = require('./assignmentController');

// 获取扩展名
function getExt(filename) {
  return path.extname(filename).replace('.', '').toLowerCase();
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

    // 校验文件格式
    const allowed = assignment.allowed_formats || [];
    for (const f of files) {
      const ext = getExt(f.original_name);
      if (allowed.length > 0 && !allowed.includes(ext)) {
        return fail(res, `文件 ${f.original_name} 格式不被允许（仅支持：${allowed.join(', ')}）`, 422);
      }
    }

    // 校验文件真实存在
    for (const f of files) {
      const abs = path.join(__dirname, '../../', f.file_path);
      if (!fs.existsSync(abs)) {
        return fail(res, `文件 ${f.original_name} 不存在，请重新上传`, 422);
      }
    }

    // 创建或更新提交记录
    const [submission, created] = await Submission.findOrCreate({
      where: { assignment_id: id, student_id: req.user.id },
      defaults: {
        assignment_id: id,
        student_id: req.user.id,
        status: 'submitted',
        submitted_at: new Date(),
        remark: remark || null
      }
    });

    if (!created) {
      // 重新提交：删除旧文件记录
      await SubmissionFile.destroy({ where: { submission_id: submission.id } });
      submission.status = 'submitted';
      submission.score = null;
      submission.comment = null;
      submission.submitted_at = new Date();
      submission.remark = remark || null;
      await submission.save();
    }

    // 批量创建文件记录
    const fileRecords = files.map(f => ({
      submission_id: submission.id,
      original_name: f.original_name,
      file_path: f.file_path,
      file_size: f.file_size,
      mime_type: f.mime_type || 'application/octet-stream',
      file_hash: f.file_hash || null
    }));
    await SubmissionFile.bulkCreate(fileRecords);

    // 通知教师有新提交
    await Notification.create({
      user_id: assignment.teacher_id,
      title: '新的作业提交',
      content: `${req.user.real_name} 提交了作业「${assignment.title}」`,
      type: 'assignment',
      related_id: assignment.id
    });

    const result = await Submission.findByPk(submission.id, {
      include: [{ model: SubmissionFile, as: 'files' }]
    });
    return success(res, result, created ? '提交成功' : '已重新提交', created ? 201 : 200);
  } catch (err) {
    next(err);
  }
};

// 学生查看自己的提交记录列表
exports.mySubmissions = async (req, res, next) => {
  try {
    const { page = 1, pageSize = 10 } = req.query;
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
      limit: Number(pageSize),
      offset: (Number(page) - 1) * Number(pageSize),
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
    if (score !== undefined && score !== null) {
      const s = Number(score);
      if (isNaN(s) || s < 0 || s > 100) {
        return fail(res, '分数需在 0-100 之间', 422);
      }
    }
    await sub.update({
      score: score !== undefined ? score : sub.score,
      comment: comment !== undefined ? comment : sub.comment,
      status: status || (score !== undefined ? 'graded' : sub.status),
      graded_by: req.user.id,
      graded_at: new Date()
    });

    // 通知学生成绩已出
    await Notification.create({
      user_id: sub.student_id,
      title: '作业成绩已公布',
      content: `你的作业「${sub.assignment.title}」已被批改，得分：${score !== undefined ? score : '未评分'}`,
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
    for (const stu of unsubmitted) {
      await Notification.create({
        user_id: stu.id,
        title: '作业催交通知',
        content: `你尚未提交作业「${assignment.title}」，截止时间：${new Date(assignment.deadline).toLocaleString('zh-CN')}，请尽快提交！`,
        type: 'deadline',
        related_id: assignment.id
      });
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
    archive.on('error', (err) => next(err));
    archive.pipe(res);

    // 按学生建文件夹
    for (const sub of submissions) {
      const folderName = `${sub.student.real_name}_${sub.student.username}`;
      for (const file of sub.files) {
        const abs = path.join(__dirname, '../../', file.file_path);
        if (fs.existsSync(abs)) {
          archive.file(abs, { name: `${folderName}/${file.original_name}` });
        }
      }
    }
    archive.finalize();
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
