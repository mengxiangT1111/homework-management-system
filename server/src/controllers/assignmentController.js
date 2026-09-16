const { Op } = require('sequelize');
const {
  sequelize, Assignment, Course, User, Class, Submission, SubmissionFile, ClassStudent,
  PlagiarismResult, PlagiarismTask, GradingTask, GradingResult, GradingReview
} = require('../models');
const { success, fail, paginate, normalizePage } = require('../utils/response');
const { sanitizeSampleFiles, parseAssignmentLimits } = require('../utils/assignmentInput');

// 判断作业是否逾期
function isOverdue(assignment) {
  return new Date() > new Date(assignment.deadline);
}

// 校验截止时间：必须存在、可解析且晚于当前时间（new Date('乱填') 为 Invalid Date，
// InvalidDate <= now 结果为 false，会绕过原本的比较校验，故先判 isNaN）
function isValidFutureDate(deadline) {
  const d = new Date(deadline);
  return !!deadline && !isNaN(d.getTime()) && d > new Date();
}

// 作业列表
exports.listAssignments = async (req, res, next) => {
  try {
    const { keyword, course_id, status } = req.query;
    const { page, pageSize } = normalizePage(req.query);
    const where = {};
    if (course_id) where.course_id = course_id;
    if (status) where.status = status;
    if (keyword) {
      where[Op.or] = [
        { title: { [Op.like]: `%${keyword}%` } },
        { description: { [Op.like]: `%${keyword}%` } }
      ];
    }

    // 权限过滤
    if (req.user.role === 'teacher') {
      where.teacher_id = req.user.id;
    } else if (req.user.role === 'student') {
      // 学生只看自己班级的课程作业
      const myClasses = await ClassStudent.findAll({
        where: { student_id: req.user.id },
        attributes: ['class_id']
      });
      const classIds = myClasses.map(c => c.class_id);
      if (classIds.length === 0) return paginate(res, [], 0, page, pageSize);
      const courses = await Course.findAll({
        where: { class_id: { [Op.in]: classIds } },
        attributes: ['id']
      });
      const courseIds = courses.map(c => c.id);
      if (courseIds.length === 0) return paginate(res, [], 0, page, pageSize);
      where.course_id = { [Op.in]: courseIds };
    }

    const { rows, count } = await Assignment.findAndCountAll({
      where,
      include: [
        { model: Course, as: 'course', include: [{ model: Class, as: 'class', attributes: ['id', 'name', 'grade'] }] },
        { model: User, as: 'teacher', attributes: ['id', 'real_name'] }
      ],
      order: [['deadline', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
      distinct: true
    });

    // 附加状态计算（是否逾期、是否已提交）—— 一到两次聚合查询替代逐行查询，避免 N+1
    const rowIds = rows.map(a => a.id);
    let mySubMap = new Map();
    let subCountMap = new Map();
    if (rowIds.length > 0) {
      if (req.user.role === 'student') {
        const mySubs = await Submission.findAll({
          where: { assignment_id: { [Op.in]: rowIds }, student_id: req.user.id }
        });
        mySubMap = new Map(mySubs.map(s => [s.assignment_id, s]));
      } else if (req.user.role === 'teacher') {
        const counts = await Submission.findAll({
          where: { assignment_id: { [Op.in]: rowIds } },
          attributes: ['assignment_id', [sequelize.fn('COUNT', sequelize.col('id')), 'cnt']],
          group: 'assignment_id'
        });
        subCountMap = new Map(counts.map(c => [c.assignment_id, Number(c.get('cnt'))]));
      }
    }
    const result = rows.map(a => {
      const item = a.toJSON();
      item.is_overdue = isOverdue(a);
      if (req.user.role === 'student') {
        item.my_submission = mySubMap.get(a.id) || null;
      } else if (req.user.role === 'teacher') {
        item.submit_count = subCountMap.get(a.id) || 0;
      }
      return item;
    });
    return paginate(res, result, count, page, pageSize);
  } catch (err) {
    next(err);
  }
};

// 作业详情
exports.getAssignment = async (req, res, next) => {
  try {
    const assignment = await Assignment.findByPk(req.params.id, {
      include: [
        { model: Course, as: 'course', include: [{ model: Class, as: 'class' }] },
        { model: User, as: 'teacher', attributes: ['id', 'real_name', 'email'] }
      ]
    });
    if (!assignment) return fail(res, '作业不存在', 404);
    if (!assignment.course) return fail(res, '作业所属课程已不存在', 422);

    // 学生只能查看本班课程的作业（防遍历 id 拉取全校作业内容与样例文件）
    if (req.user.role === 'student') {
      const inClass = await ClassStudent.findOne({
        where: { class_id: assignment.course.class_id, student_id: req.user.id }
      });
      if (!inClass) return fail(res, '无权查看该作业', 403);
    }

    const item = assignment.toJSON();
    item.is_overdue = isOverdue(assignment);

    // 学生附带自己提交记录
    if (req.user.role === 'student') {
      const sub = await Submission.findOne({
        where: { assignment_id: assignment.id, student_id: req.user.id },
        include: [{ model: SubmissionFile, as: 'files' }]
      });
      item.my_submission = sub;
      // 教师邮箱属于联系方式，只对教师/管理员暴露
      if (item.teacher) {
        item.teacher = { id: item.teacher.id, real_name: item.teacher.real_name };
      }
    }

    return success(res, item, '获取成功');
  } catch (err) {
    next(err);
  }
};

// 创建作业 —— 教师
exports.createAssignment = async (req, res, next) => {
  try {
    let { title, description, course_id, deadline, allowed_formats, max_files, max_size_mb, sample_files, need_grading } = req.body;
    if (title) title = String(title).slice(0, 200); // 列宽 STRING(200)，超长会被 MySQL 严格模式拒绝
    if (!title || !course_id || !deadline) {
      return fail(res, '作业标题、所属课程、截止时间不能为空', 422);
    }
    const course = await Course.findByPk(course_id);
    if (!course) return fail(res, '所属课程不存在', 404);

    // 教师只能在自己的课程下创建作业
    if (req.user.role === 'teacher' && course.teacher_id !== req.user.id) {
      return fail(res, '只能在自己任课的课程下创建作业', 403);
    }
    if (!isValidFutureDate(deadline)) {
      return fail(res, '截止时间必须晚于当前时间', 422);
    }
    const limits = parseAssignmentLimits(max_files, max_size_mb);
    if (!limits.ok) return fail(res, limits.msg, 422);
    const samples = sanitizeSampleFiles(sample_files);
    if (!samples.ok) return fail(res, samples.msg, 422);

    const teacher_id = req.user.role === 'teacher' ? req.user.id : (course.teacher_id);
    const assignment = await Assignment.create({
      title,
      description: description || null,
      course_id,
      teacher_id,
      created_by: req.user.id,
      deadline,
      allowed_formats: allowed_formats || ['pdf', 'doc', 'docx', 'jpg', 'png', 'zip'],
      max_files: limits.maxFiles || 5,
      max_size_mb: limits.maxSizeMb || 100,
      sample_files: samples.data,
      need_grading: need_grading !== undefined ? (need_grading ? 1 : 0) : 0
    });
    return success(res, assignment, '作业创建成功', 201);
  } catch (err) {
    next(err);
  }
};

// 更新作业 —— 教师
exports.updateAssignment = async (req, res, next) => {
  try {
    const assignment = await Assignment.findByPk(req.params.id, {
      include: [{ model: Course, as: 'course' }]
    });
    if (!assignment) return fail(res, '作业不存在', 404);
    if (req.user.role === 'teacher' && assignment.teacher_id !== req.user.id) {
      return fail(res, '只能修改自己发布的作业', 403);
    }
    const { title, description, deadline, allowed_formats, max_files, max_size_mb, status, need_grading, sample_files } = req.body;
    if (deadline !== undefined && deadline !== null && deadline !== '' && !isValidFutureDate(deadline)) {
      return fail(res, '截止时间格式非法或早于当前时间', 422);
    }
    if (status !== undefined && status !== null && status !== '' && !['active', 'closed'].includes(status)) {
      return fail(res, '作业状态参数非法', 422);
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
      status: status || assignment.status,
      need_grading: need_grading !== undefined ? (need_grading ? 1 : 0) : assignment.need_grading,
      sample_files: samples.data === null && sample_files === undefined ? assignment.sample_files : samples.data
    });
    return success(res, assignment, '更新成功');
  } catch (err) {
    next(err);
  }
};

// 删除作业 —— 教师/管理员
// 默认拒绝删除已有提交的作业（422 + force_deletable 标记，前端据此引导二次强确认）；
// 携带 ?force=true 时级联删除提交、文件记录、查重与批阅等全部关联数据。
// 行记录在同一事务内按"子表先删"顺序清理；物理文件在事务提交后删除，失败不回滚删除结果。
exports.deleteAssignment = async (req, res, next) => {
  // 惰性 require：submissionController 顶层已反向引用本模块（isOverdue），
  // 顶层互相 require 会因循环依赖拿到未初始化完成的导出，运行期才取则双方均已加载完毕
  const { deletePhysicalFiles } = require('./submissionController');
  try {
    const assignment = await Assignment.findByPk(req.params.id, {
      include: [{ model: Course, as: 'course' }]
    });
    if (!assignment) return fail(res, '作业不存在', 404);
    if (req.user.role === 'teacher' && assignment.teacher_id !== req.user.id) {
      return fail(res, '只能删除自己发布的作业', 403);
    }
    const force = ['true', '1'].includes(String(req.query.force || '').toLowerCase());
    const subCount = await Submission.count({ where: { assignment_id: assignment.id } });
    if (subCount > 0 && !force) {
      return fail(res, `该作业已有 ${subCount} 条提交记录，建议改为"关闭"状态而非删除`, 422, {
        force_deletable: true,
        submission_count: subCount
      });
    }

    // 事务前先取提交ID与文件路径：行记录事务内删，物理文件事务提交后删
    const submissionIds = (await Submission.findAll({
      where: { assignment_id: assignment.id },
      attributes: ['id']
    })).map(s => s.id);
    const filePaths = submissionIds.length === 0 ? [] : (await SubmissionFile.findAll({
      where: { submission_id: { [Op.in]: submissionIds } },
      attributes: ['file_path']
    })).map(f => f.file_path);

    await sequelize.transaction(async (t) => {
      if (submissionIds.length > 0) {
        // grading_reviews.result_id / grading_results.task_id 均有唯一约束指向上游，必须先删复核与结果再删任务
        await GradingReview.destroy({ where: { submission_id: { [Op.in]: submissionIds } }, transaction: t });
        await GradingResult.destroy({ where: { submission_id: { [Op.in]: submissionIds } }, transaction: t });
      }
      await GradingTask.destroy({ where: { assignment_id: assignment.id }, transaction: t });
      await PlagiarismResult.destroy({
        where: {
          [Op.or]: [
            { assignment_id: assignment.id },
            // 兜底：其他作业的比对结果若引用了本作业的提交（compared_with_id），一并清掉避免悬挂引用
            ...(submissionIds.length > 0 ? [
              { submission_id: { [Op.in]: submissionIds } },
              { compared_with_id: { [Op.in]: submissionIds } }
            ] : [])
          ]
        },
        transaction: t
      });
      await PlagiarismTask.destroy({ where: { assignment_id: assignment.id }, transaction: t });
      if (submissionIds.length > 0) {
        await SubmissionFile.destroy({ where: { submission_id: { [Op.in]: submissionIds } }, transaction: t });
        await Submission.destroy({ where: { assignment_id: assignment.id }, transaction: t });
      }
      await assignment.destroy({ transaction: t });
    });

    // 事务提交后清理物理文件（本地 + COS + 上传记录），单文件失败不影响删除结果
    if (filePaths.length > 0) await deletePhysicalFiles(filePaths);

    return success(res, null,
      subCount > 0 ? `作业已强制删除（含 ${subCount} 条提交、其文件及查重/批阅记录）` : '作业已删除');
  } catch (err) {
    next(err);
  }
};

// 查看某作业下所有学生的提交情况（教师批阅用）
exports.listAssignmentSubmissions = async (req, res, next) => {
  try {
    const { id } = req.params;
    const assignment = await Assignment.findByPk(id, {
      include: [{ model: Course, as: 'course', include: [{ model: Class, as: 'class' }] }]
    });
    if (!assignment) return fail(res, '作业不存在', 404);
    if (!assignment.course) return fail(res, '作业所属课程已不存在', 422);
    if (req.user.role === 'teacher' && assignment.teacher_id !== req.user.id) {
      return fail(res, '无权查看该作业', 403);
    }

    // 获取班级所有学生
    const students = await User.findAll({
      include: [{
        model: Class,
        as: 'classes',
        where: { id: assignment.course.class_id },
        through: { attributes: [] },
        required: true
      }],
      attributes: ['id', 'username', 'real_name', 'email'],
      order: [['username', 'ASC']]
    });

    // 获取所有提交
    const submissions = await Submission.findAll({
      where: { assignment_id: id },
      include: [{ model: SubmissionFile, as: 'files' }]
    });
    const subMap = new Map(submissions.map(s => [s.student_id, s]));

    // 组合：每个学生 + 是否提交 + 提交详情
    const result = students.map(stu => {
      const sub = subMap.get(stu.id);
      return {
        student_id: stu.id,
        username: stu.username,
        real_name: stu.real_name,
        email: stu.email,
        submitted: !!sub,
        submission: sub || null
      };
    });

    const submittedCount = result.filter(r => r.submitted).length;
    return success(res, {
      assignment: {
        id: assignment.id,
        title: assignment.title,
        deadline: assignment.deadline,
        is_overdue: isOverdue(assignment),
        allowed_formats: assignment.allowed_formats,
        max_files: assignment.max_files,
        course_name: assignment.course.name,
        class_name: assignment.course.class ? assignment.course.class.name : ''
      },
      students: result,
      total_students: result.length,
      submitted_count: submittedCount,
      unsubmitted_count: result.length - submittedCount
    }, '获取成功');
  } catch (err) {
    next(err);
  }
};

// 获取未交学生名单（导出 Excel 用）
exports.getUnsubmittedList = async (req, res, next) => {
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
        model: Class,
        as: 'classes',
        where: { id: assignment.course.class_id },
        through: { attributes: [] },
        required: true
      }],
      attributes: ['id', 'username', 'real_name', 'email', 'phone'],
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
        student_id: s.id,
        username: s.username,
        real_name: s.real_name,
        email: s.email,
        phone: s.phone
      }));

    return success(res, {
      assignment_title: assignment.title,
      class_name: assignment.course.class.name,
      deadline: assignment.deadline,
      total: students.length,
      unsubmitted_count: unsubmitted.length,
      list: unsubmitted
    }, '获取成功');
  } catch (err) {
    next(err);
  }
};

module.exports.isOverdue = isOverdue;
module.exports.isValidFutureDate = isValidFutureDate;
