const { Op } = require('sequelize');
const { sequelize, Course, Class, User, ClassStudent, Assignment, School, CourseAssistant, Notification } = require('../models');
const { success, fail, paginate, normalizePage } = require('../utils/response');

// 课程列表（分页）—— 管理员可按学校筛选；教师看自己任课的；学生看自己班级的
exports.listCourses = async (req, res, next) => {
  try {
    const { keyword, class_id, teacher_id, school_id } = req.query;
    const { page, pageSize } = normalizePage(req.query);
    const where = {};
    if (class_id) where.class_id = class_id;
    if (teacher_id) where.teacher_id = teacher_id;
    if (keyword) {
      where.name = { [Op.like]: `%${keyword}%` };
    }

    // 权限过滤
    if (req.user.role === 'teacher') {
      where.teacher_id = req.user.id;
      where.school_id = req.user.school_id;
    } else if (req.user.role === 'student') {
      // 学生只看自己班级的课程
      const myClasses = await ClassStudent.findAll({
        where: { student_id: req.user.id },
        attributes: ['class_id']
      });
      const classIds = myClasses.map(c => c.class_id);
      if (classIds.length === 0) return paginate(res, [], 0, page, pageSize);
      where.class_id = { [Op.in]: classIds };
      where.school_id = req.user.school_id;
    } else if (school_id) {
      where.school_id = school_id;
    }

    const { rows, count } = await Course.findAndCountAll({
      where,
      include: [
        { model: Class, as: 'class', attributes: ['id', 'name', 'grade'] },
        { model: User, as: 'teacher', attributes: ['id', 'real_name'] },
        { model: School, as: 'school', attributes: ['id', 'name'], required: false }
      ],
      order: [['created_at', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
      distinct: true
    });

    // 附带作业数量（一次聚合查询替代逐行 count）
    const rowIds = rows.map(c => c.id);
    const countMap = new Map();
    if (rowIds.length > 0) {
      const counts = await Assignment.findAll({
        where: { course_id: { [Op.in]: rowIds } },
        attributes: ['course_id', [sequelize.fn('COUNT', sequelize.col('id')), 'cnt']],
        group: 'course_id'
      });
      counts.forEach(c => countMap.set(c.course_id, Number(c.get('cnt'))));
    }
    const result = rows.map(c => ({ ...c.toJSON(), assignment_count: countMap.get(c.id) || 0 }));
    return paginate(res, result, count, page, pageSize);
  } catch (err) {
    next(err);
  }
};

// 所有课程（下拉）—— 教师/学生仅本校，管理员可按学校筛选
exports.allCourses = async (req, res, next) => {
  try {
    const where = {};
    if (req.user.role === 'teacher') {
      where.teacher_id = req.user.id;
      where.school_id = req.user.school_id;
    } else if (req.user.role === 'student') {
      where.school_id = req.user.school_id;
    } else if (req.query.school_id) {
      where.school_id = req.query.school_id;
    }
    const courses = await Course.findAll({
      where,
      include: [{ model: Class, as: 'class', attributes: ['id', 'name'] }],
      order: [['name', 'ASC']]
    });
    return success(res, courses, '获取成功');
  } catch (err) {
    next(err);
  }
};

// 课程详情
exports.getCourse = async (req, res, next) => {
  try {
    const course = await Course.findByPk(req.params.id, {
      include: [
        { model: Class, as: 'class' },
        // 教师邮箱不再下发（学生/其他教师可见此接口，属个人信息；
        // 与作业详情对学生剥离 email 的口径保持一致）
        { model: User, as: 'teacher', attributes: ['id', 'real_name'] }
      ]
    });
    if (!course) return fail(res, '课程不存在', 404);
    if (req.user.role !== 'admin' && course.school_id !== req.user.school_id) {
      return fail(res, '课程不存在', 404);
    }
    return success(res, course, '获取成功');
  } catch (err) {
    next(err);
  }
};

// 创建课程 —— 教师/管理员
exports.createCourse = async (req, res, next) => {
  try {
    const { name, class_id, description, semester } = req.body;
    if (!name || !class_id) return fail(res, '课程名称和所属班级不能为空', 422);
    const cls = await Class.findByPk(class_id);
    if (!cls) return fail(res, '所属班级不存在', 404);

    // 防重复：同班级下不允许同名课程
    const dup = await Course.findOne({ where: { name, class_id } });
    if (dup) return fail(res, `该班级下已存在同名课程「${name}」`, 422);

    // 教师只能为自己创建课程，且只能在本人学校的班级开课
    const teacher_id = req.user.role === 'teacher' ? req.user.id : (req.body.teacher_id || req.user.id);
    const teacher = await User.findByPk(teacher_id);
    if (!teacher || teacher.role !== 'teacher') return fail(res, '指定的任课教师无效', 422);
    if (teacher.school_id !== cls.school_id) return fail(res, '任课教师必须属于该班级所在学校', 422);

    const course = await Course.create({
      name, class_id, teacher_id, school_id: cls.school_id,
      description: description || null,
      semester: semester || null
    });
    return success(res, course, '课程创建成功', 201);
  } catch (err) {
    next(err);
  }
};

// 更新课程
exports.updateCourse = async (req, res, next) => {
  try {
    const { name, class_id, teacher_id, description, semester } = req.body;
    const course = await Course.findByPk(req.params.id);
    if (!course) return fail(res, '课程不存在', 404);
    if (req.user.role !== 'admin' && course.school_id !== req.user.school_id) {
      return fail(res, '课程不存在', 404);
    }
    if (req.user.role === 'teacher' && course.teacher_id !== req.user.id) {
      return fail(res, '只能修改自己任课的课程', 403);
    }

    // 班级变更后学校需同步，且任课教师必须与新班级同校
    const newClassId = class_id || course.class_id;
    let newSchoolId = course.school_id;
    if (class_id && class_id !== course.class_id) {
      const cls = await Class.findByPk(class_id);
      if (!cls) return fail(res, '所属班级不存在', 404);
      // 已有作业的课程换班会导致：原班学生无法重交、提交率统计口径错乱
      const cnt = await Assignment.count({ where: { course_id: course.id } });
      if (cnt > 0) {
        return fail(res, '该课程下已有作业，不能更换班级（如需调整请新建课程）', 422);
      }
      newSchoolId = cls.school_id;
    }
    const newTeacherId = teacher_id || course.teacher_id;
    if (newTeacherId !== course.teacher_id || newClassId !== course.class_id) {
      const teacher = await User.findByPk(newTeacherId);
      if (!teacher || teacher.role !== 'teacher') return fail(res, '指定的任课教师无效', 422);
      if (teacher.school_id !== newSchoolId) return fail(res, '任课教师必须属于该班级所在学校', 422);
    }

    const oldTeacherId = course.teacher_id;
    await course.update({
      name: name || course.name,
      class_id: newClassId,
      school_id: newSchoolId,
      teacher_id: newTeacherId,
      description: description !== undefined ? description : course.description,
      semester: semester !== undefined ? semester : course.semester
    });

    // 任课教师变更后同步该课程全部作业的 teacher_id：
    // 教师端作业/批改/查重权限全部按 assignment.teacher_id 判断，不同步会留下
    // 只有管理员能管的"无主作业"（配合删除教师时的阻断检查）
    if (newTeacherId !== oldTeacherId) {
      await Assignment.update({ teacher_id: newTeacherId }, { where: { course_id: course.id } });
    }
    return success(res, course, '更新成功');
  } catch (err) {
    next(err);
  }
};

// 删除课程
exports.deleteCourse = async (req, res, next) => {
  try {
    const course = await Course.findByPk(req.params.id);
    if (!course) return fail(res, '课程不存在', 404);
    if (req.user.role !== 'admin' && course.school_id !== req.user.school_id) {
      return fail(res, '课程不存在', 404);
    }
    if (req.user.role === 'teacher' && course.teacher_id !== req.user.id) {
      return fail(res, '只能删除自己任课的课程', 403);
    }
    const assignmentCount = await Assignment.count({ where: { course_id: course.id } });
    if (assignmentCount > 0) {
      return fail(res, `该课程下还有 ${assignmentCount} 个作业任务，无法删除`, 422);
    }
    // 清理课代表记录，避免悬挂数据
    await CourseAssistant.destroy({ where: { course_id: course.id } });
    await course.destroy();
    return success(res, null, '课程已删除');
  } catch (err) {
    next(err);
  }
};

// 教师任课列表
exports.myTeachingCourses = async (req, res, next) => {
  try {
    const courses = await Course.findAll({
      where: { teacher_id: req.user.id },
      include: [
        { model: Class, as: 'class', attributes: ['id', 'name', 'grade'] },
        {
          model: CourseAssistant,
          as: 'assistants',
          include: [{ model: User, as: 'student', attributes: ['id', 'username', 'real_name'] }]
        }
      ],
      order: [['created_at', 'DESC']]
    });
    const result = courses.map(c => {
      const json = c.toJSON();
      json.assistants = (json.assistants || []).map(a => a.student);
      return json;
    });
    return success(res, result, '获取成功');
  } catch (err) {
    next(err);
  }
};

// ===== 课代表管理（任课教师/管理员） =====

// 校验：仅任课教师本人或管理员可管理某课程的课代表
async function loadManagedCourse(req, res) {
  const course = await Course.findByPk(req.params.id);
  if (!course) {
    fail(res, '课程不存在', 404);
    return null;
  }
  if (req.user.role !== 'admin' && course.teacher_id !== req.user.id) {
    fail(res, '只有本课程的任课教师可以管理课代表', 403);
    return null;
  }
  return course;
}

// 查看某课程的课代表列表
exports.listAssistants = async (req, res, next) => {
  try {
    const course = await loadManagedCourse(req, res);
    if (!course) return;
    const assistants = await CourseAssistant.findAll({
      where: { course_id: course.id },
      include: [{ model: User, as: 'student', attributes: ['id', 'username', 'real_name', 'email'] }],
      order: [['created_at', 'ASC']]
    });
    return success(res, assistants.map(a => a.student), '获取成功');
  } catch (err) {
    next(err);
  }
};

// 设置课代表（学生必须属于该课程所在班级）
exports.addAssistant = async (req, res, next) => {
  try {
    const course = await loadManagedCourse(req, res);
    if (!course) return;
    const { student_id } = req.body;
    if (!student_id) return fail(res, '请指定学生', 422);

    const student = await User.findByPk(student_id);
    if (!student || student.role !== 'student') return fail(res, '指定的学生无效', 422);

    const inClass = await ClassStudent.findOne({
      where: { class_id: course.class_id, student_id }
    });
    if (!inClass) return fail(res, '该学生不在本课程所在班级中，无法设为课代表', 422);

    const exists = await CourseAssistant.findOne({
      where: { course_id: course.id, student_id }
    });
    if (exists) return fail(res, '该学生已是本课程课代表', 422);

    await CourseAssistant.create({ course_id: course.id, student_id });
    await Notification.create({
      user_id: student_id,
      title: '你被设置为课代表',
      content: `${req.user.real_name} 设置你为课程「${course.name}」的课代表，可在"课代表"页面协助老师收发作业。`,
      type: 'system',
      related_id: course.id
    });
    return success(res, null, '课代表设置成功', 201);
  } catch (err) {
    next(err);
  }
};

// 取消课代表
exports.removeAssistant = async (req, res, next) => {
  try {
    const course = await loadManagedCourse(req, res);
    if (!course) return;
    const { studentId } = req.params;
    const record = await CourseAssistant.findOne({
      where: { course_id: course.id, student_id: studentId }
    });
    if (!record) return fail(res, '该学生不是本课程课代表', 404);
    await record.destroy();
    await Notification.create({
      user_id: Number(studentId),
      title: '课代表职务已取消',
      content: `你已不再担任课程「${course.name}」的课代表。`,
      type: 'system',
      related_id: course.id
    });
    return success(res, null, '已取消课代表');
  } catch (err) {
    next(err);
  }
};

// 学生查询自己担任课代表的课程
exports.myAssistantships = async (req, res, next) => {
  try {
    const records = await CourseAssistant.findAll({
      where: { student_id: req.user.id },
      include: [{
        model: Course,
        as: 'course',
        attributes: ['id', 'name', 'semester'],
        include: [{
          model: Class, as: 'class', attributes: ['id', 'name', 'grade']
        }]
      }],
      order: [['created_at', 'DESC']]
    });
    const result = records.map(r => ({
      course_id: r.course_id,
      course: r.course
    }));
    return success(res, result, '获取成功');
  } catch (err) {
    next(err);
  }
};
