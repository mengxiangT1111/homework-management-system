/**
 * 班级负责人（班长/学委）作业收集控制器
 */
const { Op } = require('sequelize');
const {
  Assignment, Course, Class, User, ClassStudent, Submission, Notification
} = require('../models');
const { success, fail } = require('../utils/response');
const { isOverdue } = require('./assignmentController');

// 班级负责人：发布作业（只能发布给自己负责的班级课程）
exports.createClassAssignment = async (req, res, next) => {
  try {
    const classId = req.classLeader.classId;
    const { title, description, course_id, deadline, allowed_formats, max_files, max_size_mb } = req.body;

    if (!title || !course_id || !deadline) {
      return fail(res, '作业标题、所属课程、截止时间不能为空', 422);
    }

    // 验证课程属于自己负责的班级
    const course = await Course.findByPk(course_id);
    if (!course) return fail(res, '所属课程不存在', 404);
    if (course.class_id !== classId) {
      return fail(res, '只能为所在班级的课程发布作业', 403);
    }

    if (new Date(deadline) <= new Date()) {
      return fail(res, '截止时间必须晚于当前时间', 422);
    }

    // 使用班级的任课教师ID作为作业发布者（或者用学生自己的ID）
    const assignment = await Assignment.create({
      title,
      description: description || null,
      course_id,
      teacher_id: course.teacher_id || req.user.id,
      deadline,
      allowed_formats: allowed_formats || ['pdf', 'doc', 'docx', 'jpg', 'png', 'zip'],
      max_files: max_files || 5,
      max_size_mb: max_size_mb || 100,
      sample_files: req.body.sample_files || null
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
    const result = [];
    for (const a of assignments) {
      const submittedCount = await Submission.count({ where: { assignment_id: a.id } });
      const overdue = isOverdue(a);
      result.push({
        id: a.id,
        title: a.title,
        course_name: a.course.name,
        deadline: a.deadline,
        is_overdue: overdue,
        total_students: classSize,
        submitted_count: submittedCount,
        unsubmitted_count: classSize - submittedCount,
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

    let count = 0;
    for (const stu of students) {
      if (submittedSet.has(stu.id)) continue;
      await Notification.create({
        user_id: stu.id,
        title: '同学催交：作业提醒',
        content: `${leaderPos}${leaderName}提醒你：作业「${assignment.title}」截止 ${new Date(assignment.deadline).toLocaleString('zh-CN')}，请尽快提交！`,
        type: 'deadline',
        related_id: assignment.id
      });
      count++;
    }
    return success(res, { reminded: count }, `已催交 ${count} 名同学`);
  } catch (err) {
    next(err);
  }
};

// 班级负责人：删除作业（只能删除自己发布的或本班负责的作业）
exports.classDeleteAssignment = async (req, res, next) => {
  try {
    const classId = req.classLeader.classId;
    const { id } = req.params;
    const assignment = await Assignment.findByPk(id, {
      include: [{ model: Course, as: 'course' }]
    });
    if (!assignment) return fail(res, '作业不存在', 404);
    if (assignment.course.class_id !== classId) {
      return fail(res, '该作业不属于你负责的班级', 403);
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

    const zipName = `${assignment.title}_提交.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(zipName)}"`);

    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.on('error', (err) => next(err));
    archive.pipe(res);

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
