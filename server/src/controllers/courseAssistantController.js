/**
 * 课代表作业收集控制器（与班级负责人功能对齐，但限定在单门课程内）
 */
const { Op } = require('sequelize');
const path = require('path');
const {
  Assignment, Course, Class, User, ClassStudent, Submission, Notification, SubmissionFile
} = require('../models');
const { success, fail } = require('../utils/response');
const { isOverdue, isValidFutureDate } = require('./assignmentController');

// 取作业并校验属于课代表负责的课程
async function loadOwnedAssignment(req, res, next) {
  const assignment = await Assignment.findByPk(req.params.id, {
    include: [{ model: Course, as: 'course' }]
  });
  if (!assignment) {
    fail(res, '作业不存在', 404);
    return null;
  }
  if (!assignment.course) {
    fail(res, '作业所属课程已不存在', 422);
    return null;
  }
  if (assignment.course_id !== req.courseAssistant.courseId) {
    fail(res, '该作业不属于你负责的课程', 403);
    return null;
  }
  return assignment;
}

// 课代表：发布作业（只能发布给自己任课代表的课程）
exports.assistantCreateAssignment = async (req, res, next) => {
  try {
    const courseId = req.courseAssistant.courseId;
    const { title, description, deadline, allowed_formats, max_files, max_size_mb, sample_files, need_grading } = req.body;

    if (!title || !deadline) {
      return fail(res, '作业标题、截止时间不能为空', 422);
    }
    const course = await Course.findByPk(courseId);
    if (!course) return fail(res, '课程不存在', 404);

    if (!isValidFutureDate(deadline)) {
      return fail(res, '截止时间必须晚于当前时间', 422);
    }

    const assignment = await Assignment.create({
      title,
      description: description || null,
      course_id: courseId,
      teacher_id: course.teacher_id || req.user.id,
      deadline,
      allowed_formats: allowed_formats || ['pdf', 'doc', 'docx', 'jpg', 'png', 'zip'],
      max_files: max_files || 5,
      max_size_mb: max_size_mb || 100,
      sample_files: sample_files || null,
      need_grading: need_grading !== undefined ? (need_grading ? 1 : 0) : 0
    });

    return success(res, assignment, '作业发布成功', 201);
  } catch (err) {
    next(err);
  }
};

// 课代表：查看本课程所有作业的提交情况
exports.assistantAssignmentsProgress = async (req, res, next) => {
  try {
    const courseId = req.courseAssistant.courseId;
    const course = await Course.findByPk(courseId, {
      include: [{ model: Class, as: 'class', attributes: ['id', 'name'] }]
    });
    if (!course) return fail(res, '课程不存在', 404);

    const classSize = await ClassStudent.count({ where: { class_id: course.class_id } });
    // 只统计本班在读学生 + 一次聚合替代循环逐个 count（N+1）
    const classStudentIds = (await ClassStudent.findAll({
      where: { class_id: course.class_id }, attributes: ['student_id']
    })).map(r => r.student_id);
    const assignments = await Assignment.findAll({
      where: { course_id: courseId },
      order: [['deadline', 'DESC']]
    });
    const counts = assignments.length ? await Submission.findAll({
      where: { assignment_id: { [Op.in]: assignments.map(a => a.id) }, student_id: { [Op.in]: classStudentIds } },
      attributes: ['assignment_id', [require('sequelize').fn('COUNT', require('sequelize').col('id')), 'cnt']],
      group: 'assignment_id'
    }) : [];
    const cntMap = new Map(counts.map(c => [c.assignment_id, Number(c.get('cnt'))]));

    const result = [];
    for (const a of assignments) {
      const submittedCount = cntMap.get(a.id) || 0;
      result.push({
        id: a.id,
        title: a.title,
        deadline: a.deadline,
        is_overdue: isOverdue(a),
        total_students: classSize,
        submitted_count: submittedCount,
        unsubmitted_count: Math.max(0, classSize - submittedCount),
        submit_rate: classSize > 0 ? Math.round((submittedCount / classSize) * 100) : 0
      });
    }
    return success(res, { course_id: courseId, course_name: course.name, class_name: course.class?.name, class_size: classSize, assignments: result }, '获取成功');
  } catch (err) {
    next(err);
  }
};

// 课代表：查看某作业的未交名单（只能看本课程）
exports.assistantUnsubmittedStudents = async (req, res, next) => {
  try {
    const assignment = await loadOwnedAssignment(req, res, next);
    if (!assignment) return;
    const classId = assignment.course.class_id;

    const students = await User.findAll({
      include: [{
        model: Class,
        as: 'classes',
        where: { id: classId },
        through: { attributes: ['position'] },
        required: true
      }],
      attributes: ['id', 'username', 'real_name', 'email'],
      order: [['username', 'ASC']]
    });

    const submittedIds = (await Submission.findAll({
      where: { assignment_id: assignment.id },
      attributes: ['student_id']
    })).map(s => s.student_id);
    const submittedSet = new Set(submittedIds);

    const unsubmitted = students
      .filter(s => !submittedSet.has(s.id))
      .map(s => ({
        id: s.id,
        username: s.username,
        real_name: s.real_name,
        email: s.email,
        position: s.classes[0]?.ClassStudent?.position || 'none'
      }));

    return success(res, {
      assignment_title: assignment.title,
      deadline: assignment.deadline,
      total_students: students.length,
      submitted_count: students.length - unsubmitted.length,
      unsubmitted_count: unsubmitted.length,
      list: unsubmitted
    }, '获取成功');
  } catch (err) {
    next(err);
  }
};

// 课代表：催交（向未交学生发通知）
exports.assistantRemindUnsubmitted = async (req, res, next) => {
  try {
    const assignment = await loadOwnedAssignment(req, res, next);
    if (!assignment) return;
    const classId = assignment.course.class_id;

    const students = await User.findAll({
      include: [{
        model: Class, as: 'classes',
        where: { id: classId },
        through: { attributes: [] }, required: true
      }],
      attributes: ['id']
    });
    const submittedIds = (await Submission.findAll({
      where: { assignment_id: assignment.id }, attributes: ['student_id']
    })).map(s => s.student_id);
    const submittedSet = new Set(submittedIds);
    const leaderName = req.user.real_name;

    const unsubmitted = students.filter(s => !submittedSet.has(s.id));
    if (unsubmitted.length === 0) {
      return success(res, { reminded: 0, skipped: 0 }, '当前没有未交同学');
    }
    // 1 小时内已催交过的不再重复发送（防连点轰炸学生通知）
    const recent = await Notification.findAll({
      where: {
        type: 'assignment',
        related_id: assignment.id,
        user_id: { [Op.in]: unsubmitted.map(s => s.id) },
        created_at: { [Op.gt]: new Date(Date.now() - 60 * 60 * 1000) }
      },
      attributes: ['user_id']
    });
    const recentSet = new Set(recent.map(n => n.user_id));
    const toRemind = unsubmitted.filter(s => !recentSet.has(s.id));
    if (toRemind.length === 0) {
      return success(res, { reminded: 0, skipped: unsubmitted.length }, '1 小时内已催交过，未重复发送');
    }
    // 注意 type 不能用 'deadline'：系统自动截止提醒按 type='deadline' 去重，
    // 手动催交若同类型会"顶掉"学生的官方 24 小时截止提醒
    await Notification.bulkCreate(toRemind.map(stu => ({
      user_id: stu.id,
      title: '同学催交：作业提醒',
      content: `课代表${leaderName}提醒你：课程「${assignment.course.name}」的作业「${assignment.title}」截止 ${new Date(assignment.deadline).toLocaleString('zh-CN')}，请尽快提交！`,
      type: 'assignment',
      related_id: assignment.id
    })));
    return success(res, { reminded: toRemind.length, skipped: unsubmitted.length - toRemind.length },
      `已催交 ${toRemind.length} 名同学${unsubmitted.length - toRemind.length > 0 ? `（${unsubmitted.length - toRemind.length} 人 1 小时内已催过，跳过）` : ''}`);
  } catch (err) {
    next(err);
  }
};

// 课代表：修改作业
exports.assistantUpdateAssignment = async (req, res, next) => {
  try {
    const assignment = await loadOwnedAssignment(req, res, next);
    if (!assignment) return;
    const { title, description, deadline, allowed_formats, max_files, max_size_mb, need_grading, sample_files } = req.body;
    if (deadline !== undefined && deadline !== null && deadline !== '' && !isValidFutureDate(deadline)) {
      return fail(res, '截止时间格式非法或早于当前时间', 422);
    }
    await assignment.update({
      title: title !== undefined ? title : assignment.title,
      description: description !== undefined ? description : assignment.description,
      deadline: deadline || assignment.deadline,
      allowed_formats: allowed_formats || assignment.allowed_formats,
      max_files: max_files || assignment.max_files,
      max_size_mb: max_size_mb || assignment.max_size_mb,
      need_grading: need_grading !== undefined ? (need_grading ? 1 : 0) : assignment.need_grading,
      sample_files: sample_files !== undefined ? sample_files : assignment.sample_files
    });
    return success(res, assignment, '修改成功');
  } catch (err) {
    next(err);
  }
};

// 课代表：删除作业（已有提交时不允许）
exports.assistantDeleteAssignment = async (req, res, next) => {
  try {
    const assignment = await loadOwnedAssignment(req, res, next);
    if (!assignment) return;
    const subCount = await Submission.count({ where: { assignment_id: assignment.id } });
    if (subCount > 0) {
      return fail(res, `该作业已有 ${subCount} 条提交记录，建议改为"关闭"状态而非删除`, 422);
    }
    await assignment.destroy();
    return success(res, null, '作业已删除');
  } catch (err) {
    next(err);
  }
};

// 课代表：打包下载本课程某作业的全部提交文件
exports.assistantDownloadAll = async (req, res, next) => {
  try {
    const assignment = await loadOwnedAssignment(req, res, next);
    if (!assignment) return;

    const submissions = await Submission.findAll({
      where: { assignment_id: assignment.id },
      include: [
        { model: SubmissionFile, as: 'files' },
        { model: User, as: 'student', attributes: ['username', 'real_name'] }
      ]
    });

    if (submissions.length === 0) {
      return fail(res, '暂无提交记录', 422);
    }

    const archiver = require('archiver');
    const zipName = `${assignment.title}_提交.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(zipName)}"`);

    const archive = archiver('zip', { zlib: { level: 5 } });
    // 响应头已发出，不能再走 next(err)（会触发 ERR_HTTP_HEADERS_SENT），直接断开连接
    archive.on('error', () => { res.destroy(); });
    res.on('close', () => { archive.abort(); });
    archive.pipe(res);

    const { ensureLocalFile } = require('../utils/fileStorage').helpers;
    const os = require('os');

    const tmpFiles = [];
    try {
      for (const sub of submissions) {
        const folderName = `${sub.student.real_name}_${sub.student.username}`.replace(/[\\/:*?"<>|]/g, '_');
        for (const file of sub.files) {
          if (file.is_cleaned) continue; // 已清理的文件不再打包
          try {
            const abs = await ensureLocalFile(file.file_path);
            if (abs.startsWith(os.tmpdir())) tmpFiles.push(abs);
            archive.file(abs, { name: `${folderName}/${path.basename(file.original_name)}` });
          } catch (e) {
            console.warn('[课代表打包] 文件获取失败，跳过:', file.file_path, e.message);
          }
        }
      }
      await archive.finalize();
    } finally {
      const fs = require('fs');
      for (const p of tmpFiles) fs.promises.unlink(p).catch(() => {});
    }
  } catch (err) {
    next(err);
  }
};
