/**
 * 班级负责人（班长/学委）作业收集控制器
 */
const { Op } = require('sequelize');
const {
  sequelize, Assignment, Course, Class, User, ClassStudent, Submission, Notification
} = require('../models');
const { success, fail } = require('../utils/response');
const { formatCST } = require('../utils/formatCST');
const { isOverdue, isValidFutureDate } = require('./assignmentController');
const { sanitizeSampleFiles, parseAssignmentLimits } = require('../utils/assignmentInput');

// 班级负责人：发布作业（只能发布给自己负责的班级课程）
exports.createClassAssignment = async (req, res, next) => {
  try {
    const classId = req.classLeader.classId;
    const { title, description, course_id, deadline, allowed_formats, max_files, max_size_mb, sample_files, need_grading } = req.body;

    if (!title || !course_id || !deadline) {
      return fail(res, '作业标题、所属课程、截止时间不能为空', 422);
    }

    // 验证课程属于自己负责的班级
    const course = await Course.findByPk(course_id);
    if (!course) return fail(res, '所属课程不存在', 404);
    if (course.class_id !== classId) {
      return fail(res, '只能为所在班级的课程发布作业', 403);
    }

    if (!isValidFutureDate(deadline)) {
      return fail(res, '截止时间必须晚于当前时间', 422);
    }
    const limits = parseAssignmentLimits(max_files, max_size_mb);
    if (!limits.ok) return fail(res, limits.msg, 422);
    const samples = sanitizeSampleFiles(sample_files);
    if (!samples.ok) return fail(res, samples.msg, 422);

    // 使用班级的任课教师ID作为作业发布者（或者用学生自己的ID）
    const assignment = await Assignment.create({
      title: String(title).slice(0, 200), // STRING(200) 列宽保护
      description: description || null,
      course_id,
      teacher_id: course.teacher_id || req.user.id,
      created_by: req.user.id,
      deadline,
      allowed_formats: allowed_formats || ['pdf', 'doc', 'docx', 'jpg', 'png', 'zip'],
      max_files: limits.maxFiles || 5,
      max_size_mb: limits.maxSizeMb || 100,
      sample_files: samples.data,
      need_grading: need_grading !== undefined ? (need_grading ? 1 : 0) : 0
    });

    return success(res, assignment, '作业发布成功', 201);
  } catch (err) {
    next(err);
  }
};

// 班级负责人：查看本班所有未完成作业的提交情况
exports.classAssignmentsProgress = async (req, res, next) => {
  try {
    if (!req.classLeader || !req.classLeader.classId) {
      return fail(res, '权限校验失败：缺少班级信息', 403);
    }
    const classId = req.classLeader.classId;
    const courses = await Course.findAll({
      where: { class_id: classId },
      attributes: ['id', 'name']
    });
    const courseIds = courses.map(c => c.id);
    if (courseIds.length === 0) {
      return success(res, { class_id: classId, class_size: 0, assignments: [] }, '本班暂无课程');
    }

    const assignments = await Assignment.findAll({
      where: { course_id: { [Op.in]: courseIds } },
      include: [{ model: Course, as: 'course', attributes: ['id', 'name'] }],
      order: [['deadline', 'DESC']]
    });

    const classSize = await ClassStudent.count({ where: { class_id: classId } });
    // 只统计本班在读学生的提交（退班学生的历史提交不再计入，避免未交数为负/提交率超100%）
    const classStudentIds = (await ClassStudent.findAll({
      where: { class_id: classId }, attributes: ['student_id']
    })).map(r => r.student_id);
    // 一次聚合查询替代循环逐个 count（N+1）
    const counts = assignments.length ? await Submission.findAll({
      where: { assignment_id: { [Op.in]: assignments.map(a => a.id) }, student_id: { [Op.in]: classStudentIds } },
      attributes: ['assignment_id', [sequelize.fn('COUNT', sequelize.col('id')), 'cnt']],
      group: 'assignment_id'
    }) : [];
    const cntMap = new Map(counts.map(c => [c.assignment_id, Number(c.get('cnt'))]));
    const result = [];
    for (const a of assignments) {
      const submittedCount = cntMap.get(a.id) || 0;
      const overdue = isOverdue(a);
      result.push({
        id: a.id,
        title: a.title,
        course_name: a.course.name,
        deadline: a.deadline,
        is_overdue: overdue,
        total_students: classSize,
        submitted_count: submittedCount,
        unsubmitted_count: Math.max(0, classSize - submittedCount),
        submit_rate: classSize > 0 ? Math.round((submittedCount / classSize) * 100) : 0
      });
    }
    return success(res, { class_id: classId, class_size: classSize, assignments: result }, '获取成功');
  } catch (err) {
    next(err);
  }
};

// 班级负责人：查看某作业的未交名单（只能看本班）
exports.classUnsubmittedStudents = async (req, res, next) => {
  try {
    const classId = req.classLeader.classId;
    const { id } = req.params; // assignment_id
    const assignment = await Assignment.findByPk(id, {
      include: [{ model: Course, as: 'course' }]
    });
    if (!assignment) return fail(res, '作业不存在', 404);
    if (!assignment.course) return fail(res, '作业所属课程已不存在', 422);
    if (assignment.course.class_id !== classId) {
      return fail(res, '该作业不属于你负责的班级', 403);
    }

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
      where: { assignment_id: id },
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

// 班级负责人：催交（向未交学生发通知）
exports.classRemindUnsubmitted = async (req, res, next) => {
  try {
    const classId = req.classLeader.classId;
    const { id } = req.params;
    const assignment = await Assignment.findByPk(id, {
      include: [{ model: Course, as: 'course' }]
    });
    if (!assignment) return fail(res, '作业不存在', 404);
    if (!assignment.course) return fail(res, '作业所属课程已不存在', 422);
    if (assignment.course.class_id !== classId) {
      return fail(res, '无权操作该作业', 403);
    }

    const students = await User.findAll({
      include: [{
        model: Class, as: 'classes',
        where: { id: classId },
        through: { attributes: [] }, required: true
      }],
      attributes: ['id']
    });
    const submittedIds = (await Submission.findAll({
      where: { assignment_id: id }, attributes: ['student_id']
    })).map(s => s.student_id);
    const submittedSet = new Set(submittedIds);
    const leaderName = req.user.real_name;
    const leaderPos = req.classLeader.position === 'monitor' ? '班长' : '学委';

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
      content: `${leaderPos}${leaderName}提醒你：作业「${assignment.title}」截止 ${formatCST(assignment.deadline)}，请尽快提交！`,
      type: 'assignment',
      related_id: assignment.id
    })));
    return success(res, { reminded: toRemind.length, skipped: unsubmitted.length - toRemind.length },
      `已催交 ${toRemind.length} 名同学${unsubmitted.length - toRemind.length > 0 ? `（${unsubmitted.length - toRemind.length} 人 1 小时内已催过，跳过）` : ''}`);
  } catch (err) {
    next(err);
  }
};

// 班级负责人：删除作业（只能删除自己发布的作业；教师发布的作业只能由教师/管理员处理）
exports.classDeleteAssignment = async (req, res, next) => {
  try {
    const classId = req.classLeader.classId;
    const { id } = req.params;
    const assignment = await Assignment.findByPk(id, {
      include: [{ model: Course, as: 'course' }]
    });
    if (!assignment) return fail(res, '作业不存在', 404);
    if (!assignment.course) return fail(res, '作业所属课程已不存在', 422);
    if (assignment.course.class_id !== classId) {
      return fail(res, '该作业不属于你负责的班级', 403);
    }
    if (assignment.created_by !== req.user.id) {
      return fail(res, '只能删除自己代发的作业；教师发布的作业请联系任课教师处理', 403);
    }
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

// 班级负责人：打包下载本班某作业的全部提交文件
exports.classDownloadAll = async (req, res, next) => {
  try {
    const classId = req.classLeader.classId;
    const { id } = req.params;
    const assignment = await Assignment.findByPk(id, {
      include: [{ model: Course, as: 'course', include: [{ model: Class, as: 'class' }] }]
    });
    if (!assignment) return fail(res, '作业不存在', 404);
    if (!assignment.course) return fail(res, '作业所属课程已不存在', 422);
    if (assignment.course.class_id !== classId) {
      return fail(res, '该作业不属于你负责的班级', 403);
    }

    const SubmissionFile = require('./../models').SubmissionFile;
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

    const archiver = require('archiver');
    const fs = require('fs');
    const path = require('path');
    const os = require('os');

    const zipName = `${assignment.title}_提交.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(zipName)}"`);

    const archive = archiver('zip', { zlib: { level: 5 } });
    // 响应头已发出，不能再走 next(err)（会触发 ERR_HTTP_HEADERS_SENT），直接断开连接
    archive.on('error', () => { res.destroy(); });
    res.on('close', () => { archive.abort(); });
    archive.pipe(res);

    const { ensureLocalFile } = require('../utils/fileStorage').helpers;

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
            console.warn('[负责人打包] 文件获取失败，跳过:', file.file_path, e.message);
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

// 班级负责人：修改作业
exports.classUpdateAssignment = async (req, res, next) => {
  try {
    const classId = req.classLeader.classId;
    const { id } = req.params;
    const assignment = await Assignment.findByPk(id, {
      include: [{ model: Course, as: 'course' }]
    });
    if (!assignment) return fail(res, '作业不存在', 404);
    if (!assignment.course) return fail(res, '作业所属课程已不存在', 422);
    if (assignment.course.class_id !== classId) {
      return fail(res, '该作业不属于你负责的班级', 403);
    }
    if (assignment.created_by !== req.user.id) {
      return fail(res, '只能修改自己代发的作业；教师发布的作业请联系任课教师处理', 403);
    }
    const { title, description, deadline, allowed_formats, max_files, max_size_mb, need_grading, sample_files } = req.body;
    if (deadline !== undefined && deadline !== null && deadline !== '' && !isValidFutureDate(deadline)) {
      return fail(res, '截止时间格式非法或早于当前时间', 422);
    }
    const limits = parseAssignmentLimits(max_files, max_size_mb);
    if (!limits.ok) return fail(res, limits.msg, 422);
    const samples = sanitizeSampleFiles(sample_files);
    if (!samples.ok) return fail(res, samples.msg, 422);
    await assignment.update({
      title: title !== undefined ? String(title).slice(0, 200) : assignment.title, // STRING(200) 列宽保护
      description: description !== undefined ? description : assignment.description,
      deadline: deadline || assignment.deadline,
      allowed_formats: allowed_formats || assignment.allowed_formats,
      max_files: limits.maxFiles || assignment.max_files,
      max_size_mb: limits.maxSizeMb || assignment.max_size_mb,
      need_grading: need_grading !== undefined ? (need_grading ? 1 : 0) : assignment.need_grading,
      sample_files: samples.data === null && sample_files === undefined ? assignment.sample_files : samples.data
    });
    return success(res, assignment, '修改成功');
  } catch (err) {
    next(err);
  }
};
