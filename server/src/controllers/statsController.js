const { Op } = require('sequelize');
const {
  sequelize, User, Class, ClassStudent, Course, Assignment, Submission, SubmissionFile
} = require('../models');
const { success, fail } = require('../utils/response');

// 管理员全局统计概览
exports.overview = async (req, res, next) => {
  try {
    const userCount = await User.count();
    const studentCount = await User.count({ where: { role: 'student' } });
    const teacherCount = await User.count({ where: { role: 'teacher' } });
    const classCount = await Class.count();
    const courseCount = await Course.count();
    const assignmentCount = await Assignment.count();
    const submissionCount = await Submission.count();

    // 全局未交人数统计：聚合查询替代逐作业两次 count（避免 N+1）
    const activeAssignments = (await Assignment.findAll({
      where: { status: 'active' },
      include: [{ model: Course, as: 'course' }]
    })).filter(a => a.course);
    let totalShouldSubmit = 0;
    let totalSubmitted = 0;
    if (activeAssignments.length > 0) {
      const classIds = [...new Set(activeAssignments.map(a => a.course.class_id))];
      const [classCounts, subCounts] = await Promise.all([
        ClassStudent.findAll({
          where: { class_id: { [Op.in]: classIds } },
          attributes: ['class_id', [sequelize.fn('COUNT', sequelize.col('id')), 'cnt']],
          group: 'class_id'
        }),
        Submission.findAll({
          where: { assignment_id: { [Op.in]: activeAssignments.map(a => a.id) } },
          attributes: ['assignment_id', [sequelize.fn('COUNT', sequelize.col('id')), 'cnt']],
          group: 'assignment_id'
        })
      ]);
      const classSizeMap = new Map(classCounts.map(c => [c.class_id, Number(c.get('cnt'))]));
      const subCountMap = new Map(subCounts.map(s => [s.assignment_id, Number(s.get('cnt'))]));
      for (const a of activeAssignments) {
        totalShouldSubmit += classSizeMap.get(a.course.class_id) || 0;
        totalSubmitted += subCountMap.get(a.id) || 0;
      }
    }
    const submitRate = totalShouldSubmit > 0
      ? ((totalSubmitted / totalShouldSubmit) * 100).toFixed(1)
      : '100.0';
    const unsubmittedTotal = totalShouldSubmit - totalSubmitted;

    return success(res, {
      userCount, studentCount, teacherCount,
      classCount, courseCount, assignmentCount, submissionCount,
      submitRate: Number(submitRate),
      unsubmittedTotal,
      totalShouldSubmit, totalSubmitted
    }, '获取成功');
  } catch (err) {
    next(err);
  }
};

// 各作业提交率（图表用）
exports.assignmentSubmitRates = async (req, res, next) => {
  try {
    // 教师只看自己的作业
    const teacherWhere = {};
    if (req.user.role === 'teacher') teacherWhere.teacher_id = req.user.id;

    const assignments = await Assignment.findAll({
      where: teacherWhere,
      include: [{ model: Course, as: 'course', include: [{ model: Class, as: 'class' }] }],
      order: [['deadline', 'DESC']],
      limit: 10
    });

    // 聚合查询替代逐作业两次 count（避免 N+1），并容忍课程被删的悬挂作业
    const validAssignments = assignments.filter(a => a.course);
    const result = [];
    if (validAssignments.length > 0) {
      const classIds = [...new Set(validAssignments.map(a => a.course.class_id))];
      const [classCounts, subCounts] = await Promise.all([
        ClassStudent.findAll({
          where: { class_id: { [Op.in]: classIds } },
          attributes: ['class_id', [sequelize.fn('COUNT', sequelize.col('id')), 'cnt']],
          group: 'class_id'
        }),
        Submission.findAll({
          where: { assignment_id: { [Op.in]: validAssignments.map(a => a.id) } },
          attributes: ['assignment_id', [sequelize.fn('COUNT', sequelize.col('id')), 'cnt']],
          group: 'assignment_id'
        })
      ]);
      const classSizeMap = new Map(classCounts.map(c => [c.class_id, Number(c.get('cnt'))]));
      const subCountMap = new Map(subCounts.map(s => [s.assignment_id, Number(s.get('cnt'))]));
      for (const a of validAssignments) {
        const classSize = classSizeMap.get(a.course.class_id) || 0;
        const subCnt = subCountMap.get(a.id) || 0;
        const rate = classSize > 0 ? Math.round((subCnt / classSize) * 100) : 0;
        result.push({
          id: a.id,
          title: a.title,
          class_name: a.course.class ? a.course.class.name : '-',
          deadline: a.deadline,
          total: classSize,
          submitted: subCnt,
          unsubmitted: classSize - subCnt,
          rate
        });
      }
    }
    return success(res, result, '获取成功');
  } catch (err) {
    next(err);
  }
};

// 教师个人统计
exports.teacherOverview = async (req, res, next) => {
  try {
    const userId = req.user.role === 'teacher' ? req.user.id : req.query.teacher_id;
    // 管理员未指定 teacher_id 时不做全表统计，避免口径错乱
    if (!userId) return fail(res, '缺少 teacher_id 参数', 422);
    const courseCount = await Course.count({ where: { teacher_id: userId } });
    const assignmentCount = await Assignment.count({ where: { teacher_id: userId } });

    const assignments = await Assignment.findAll({
      where: { teacher_id: userId },
      attributes: ['id']
    });
    const assignmentIds = assignments.map(a => a.id);

    let submissionCount = 0;
    let gradedCount = 0;
    let ungradedCount = 0;
    if (assignmentIds.length > 0) {
      submissionCount = await Submission.count({ where: { assignment_id: { [Op.in]: assignmentIds } } });
      gradedCount = await Submission.count({ where: { assignment_id: { [Op.in]: assignmentIds }, status: 'graded' } });
      ungradedCount = await Submission.count({ where: { assignment_id: { [Op.in]: assignmentIds }, status: 'submitted' } });
    }

    return success(res, {
      courseCount, assignmentCount,
      submissionCount, gradedCount, ungradedCount
    }, '获取成功');
  } catch (err) {
    next(err);
  }
};

// 学生个人统计
exports.studentOverview = async (req, res, next) => {
  try {
    const myClasses = await ClassStudent.findAll({
      where: { student_id: req.user.id },
      attributes: ['class_id']
    });
    const classIds = myClasses.map(c => c.class_id);
    const courses = await Course.findAll({
      where: { class_id: { [Op.in]: classIds } },
      attributes: ['id']
    });
    const courseIds = courses.map(c => c.id);

    const totalAssignments = courseIds.length > 0
      ? await Assignment.count({ where: { course_id: { [Op.in]: courseIds }, status: 'active' } })
      : 0;

    const mySubmissions = await Submission.count({ where: { student_id: req.user.id } });
    const graded = await Submission.count({ where: { student_id: req.user.id, status: 'graded' } });

    // 待提交作业数（未提交且未逾期）
    const allAssignments = courseIds.length > 0
      ? await Assignment.findAll({
          where: { course_id: { [Op.in]: courseIds }, status: 'active', deadline: { [Op.gt]: new Date() } },
          attributes: ['id']
        })
      : [];
    const allAssignmentIds = allAssignments.map(a => a.id);
    const submittedIds = (await Submission.findAll({
      where: { student_id: req.user.id, assignment_id: { [Op.in]: allAssignmentIds } },
      attributes: ['assignment_id']
    })).map(s => s.assignment_id);
    const pending = allAssignmentIds.filter(id => !submittedIds.includes(id)).length;

    return success(res, {
      classCount: classIds.length,
      courseCount: courseIds.length,
      totalAssignments,
      mySubmissions,
      graded,
      pendingSubmit: pending
    }, '获取成功');
  } catch (err) {
    next(err);
  }
};
