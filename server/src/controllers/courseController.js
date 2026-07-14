const { Op } = require('sequelize');
const { Course, Class, User, ClassStudent, Assignment } = require('../models');
const { success, fail, paginate } = require('../utils/response');

// 课程列表（分页）
exports.listCourses = async (req, res, next) => {
  try {
    const { page = 1, pageSize = 10, keyword, class_id, teacher_id } = req.query;
    const where = {};
    if (class_id) where.class_id = class_id;
    if (teacher_id) where.teacher_id = teacher_id;
    if (keyword) {
      where.name = { [Op.like]: `%${keyword}%` };
    }

    // 权限过滤
    if (req.user.role === 'teacher') {
      where.teacher_id = req.user.id;
    } else if (req.user.role === 'student') {
      // 学生只看自己班级的课程
      const myClasses = await ClassStudent.findAll({
        where: { student_id: req.user.id },
        attributes: ['class_id']
      });
      const classIds = myClasses.map(c => c.class_id);
      if (classIds.length === 0) return paginate(res, [], 0, page, pageSize);
      where.class_id = { [Op.in]: classIds };
    }

    const { rows, count } = await Course.findAndCountAll({
      where,
      include: [
        { model: Class, as: 'class', attributes: ['id', 'name', 'grade'] },
        { model: User, as: 'teacher', attributes: ['id', 'real_name'] }
      ],
      order: [['created_at', 'DESC']],
      limit: Number(pageSize),
      offset: (Number(page) - 1) * Number(pageSize),
      distinct: true
    });

    // 附带作业数量
    const result = [];
    for (const c of rows) {
      const assignmentCount = await Assignment.count({ where: { course_id: c.id } });
      result.push({ ...c.toJSON(), assignment_count: assignmentCount });
    }
    return paginate(res, result, count, page, pageSize);
  } catch (err) {
    next(err);
  }
};

// 所有课程（下拉）
exports.allCourses = async (req, res, next) => {
  try {
    const where = {};
    if (req.user.role === 'teacher') where.teacher_id = req.user.id;
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
        { model: User, as: 'teacher', attributes: ['id', 'real_name', 'email'] }
      ]
    });
    if (!course) return fail(res, '课程不存在', 404);
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

    // 教师只能为自己创建课程
    const teacher_id = req.user.role === 'teacher' ? req.user.id : (req.body.teacher_id || req.user.id);
    const teacher = await User.findByPk(teacher_id);
    if (!teacher || teacher.role !== 'teacher') return fail(res, '指定的任课教师无效', 422);

    const course = await Course.create({
      name, class_id, teacher_id, description: description || null,
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
    if (req.user.role === 'teacher' && course.teacher_id !== req.user.id) {
      return fail(res, '只能修改自己任课的课程', 403);
    }
    await course.update({
      name: name || course.name,
      class_id: class_id || course.class_id,
      teacher_id: teacher_id || course.teacher_id,
      description: description !== undefined ? description : course.description,
      semester: semester !== undefined ? semester : course.semester
    });
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
    if (req.user.role === 'teacher' && course.teacher_id !== req.user.id) {
      return fail(res, '只能删除自己任课的课程', 403);
    }
    const assignmentCount = await Assignment.count({ where: { course_id: course.id } });
    if (assignmentCount > 0) {
      return fail(res, `该课程下还有 ${assignmentCount} 个作业任务，无法删除`, 422);
    }
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
      include: [{ model: Class, as: 'class', attributes: ['id', 'name', 'grade'] }],
      order: [['created_at', 'DESC']]
    });
    return success(res, courses, '获取成功');
  } catch (err) {
    next(err);
  }
};
