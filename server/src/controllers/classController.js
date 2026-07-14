const { Op } = require('sequelize');
const { Class, User, ClassStudent, Course } = require('../models');
const { success, fail, paginate } = require('../utils/response');

// 班级列表（分页）—— 管理员看全部；教师看自己任课/班主任的；学生看自己的
exports.listClasses = async (req, res, next) => {
  try {
    const { page = 1, pageSize = 10, keyword } = req.query;
    const where = {};
    if (keyword) {
      where[Op.or] = [
        { name: { [Op.like]: `%${keyword}%` } },
        { grade: { [Op.like]: `%${keyword}%` } }
      ];
    }

    // 权限过滤
    let classIds = null;
    if (req.user.role === 'teacher') {
      // 教师看：班主任的班级 + 自己任课的班级
      const asHead = await Class.findAll({ where: { teacher_id: req.user.id }, attributes: ['id'] });
      const courses = await Course.findAll({ where: { teacher_id: req.user.id }, attributes: ['class_id'] });
      const ids = new Set([...asHead.map(c => c.id), ...courses.map(c => c.class_id)]);
      classIds = [...ids];
      if (classIds.length === 0) return paginate(res, [], 0, page, pageSize);
      where.id = { [Op.in]: classIds };
    } else if (req.user.role === 'student') {
      const myClasses = await ClassStudent.findAll({ where: { student_id: req.user.id }, attributes: ['class_id'] });
      classIds = myClasses.map(c => c.class_id);
      if (classIds.length === 0) return paginate(res, [], 0, page, pageSize);
      where.id = { [Op.in]: classIds };
    }

    const { rows, count } = await Class.findAndCountAll({
      where,
      include: [
        { model: User, as: 'headTeacher', attributes: ['id', 'real_name'], required: false }
      ],
      order: [['grade', 'DESC'], ['name', 'ASC']],
      limit: Number(pageSize),
      offset: (Number(page) - 1) * Number(pageSize),
      distinct: true
    });

    // 附加每班学生数
    const result = [];
    for (const cls of rows) {
      const studentCount = await ClassStudent.count({ where: { class_id: cls.id } });
      const courseCount = await Course.count({ where: { class_id: cls.id } });
      result.push({ ...cls.toJSON(), student_count: studentCount, course_count: courseCount });
    }

    return paginate(res, result, count, page, pageSize);
  } catch (err) {
    next(err);
  }
};

// 所有班级（下拉用，不分页）
exports.allClasses = async (req, res, next) => {
  try {
    const classes = await Class.findAll({
      include: [{ model: User, as: 'headTeacher', attributes: ['id', 'real_name'], required: false }],
      order: [['grade', 'DESC'], ['name', 'ASC']]
    });
    return success(res, classes, '获取成功');
  } catch (err) {
    next(err);
  }
};

// 班级详情
exports.getClass = async (req, res, next) => {
  try {
    const cls = await Class.findByPk(req.params.id, {
      include: [{ model: User, as: 'headTeacher', attributes: ['id', 'real_name'], required: false }]
    });
    if (!cls) return fail(res, '班级不存在', 404);
    const studentCount = await ClassStudent.count({ where: { class_id: cls.id } });
    return success(res, { ...cls.toJSON(), student_count: studentCount }, '获取成功');
  } catch (err) {
    next(err);
  }
};

// 创建班级 —— 管理员
exports.createClass = async (req, res, next) => {
  try {
    const { name, grade, teacher_id, description } = req.body;
    if (!name || !grade) return fail(res, '班级名称和年级不能为空', 422);
    const cls = await Class.create({
      name, grade,
      teacher_id: teacher_id || null,
      description: description || null
    });
    return success(res, cls, '班级创建成功', 201);
  } catch (err) {
    next(err);
  }
};

// 更新班级 —— 管理员
exports.updateClass = async (req, res, next) => {
  try {
    const { name, grade, teacher_id, description } = req.body;
    const cls = await Class.findByPk(req.params.id);
    if (!cls) return fail(res, '班级不存在', 404);
    await cls.update({
      name: name || cls.name,
      grade: grade || cls.grade,
      teacher_id: teacher_id !== undefined ? teacher_id : cls.teacher_id,
      description: description !== undefined ? description : cls.description
    });
    return success(res, cls, '更新成功');
  } catch (err) {
    next(err);
  }
};

// 删除班级 —— 管理员
exports.deleteClass = async (req, res, next) => {
  try {
    const cls = await Class.findByPk(req.params.id);
    if (!cls) return fail(res, '班级不存在', 404);
    const courseCount = await Course.count({ where: { class_id: cls.id } });
    if (courseCount > 0) {
      return fail(res, `该班级下还有 ${courseCount} 门课程，无法删除`, 422);
    }
    await ClassStudent.destroy({ where: { class_id: cls.id } });
    await cls.destroy();
    return success(res, null, '班级已删除');
  } catch (err) {
    next(err);
  }
};

// 查看班级学生列表
exports.getClassStudents = async (req, res, next) => {
  try {
    const cls = await Class.findByPk(req.params.id);
    if (!cls) return fail(res, '班级不存在', 404);
    const students = await User.findAll({
      include: [{
        model: Class,
        as: 'classes',
        where: { id: cls.id },
        through: { attributes: ['position'] },
        required: true
      }],
      attributes: ['id', 'username', 'real_name', 'email', 'phone', 'status'],
      order: [['username', 'ASC']]
    });
    return success(res, { class: cls, students, count: students.length }, '获取成功');
  } catch (err) {
    next(err);
  }
};

// 设置/修改学生在班级中的职务（班长/学委） —— 管理员/教师
exports.setStudentPosition = async (req, res, next) => {
  try {
    const { id, studentId } = req.params;
    const { position } = req.body;
    if (!['none', 'monitor', 'commissary'].includes(position)) {
      return fail(res, '职务参数无效（可选：none/monitor/commissary）', 422);
    }
    const record = await ClassStudent.findOne({
      where: { class_id: id, student_id: studentId }
    });
    if (!record) return fail(res, '该学生不在此班级中', 404);
    await record.update({ position });
    const positionText = { none: '普通学生', monitor: '班长', commissary: '学委' }[position];
    return success(res, { position, position_text: positionText }, `已设置为${positionText}`);
  } catch (err) {
    next(err);
  }
};

// 查询某用户担任的所有班级职务（前端判断是否显示"作业收集"菜单）
exports.myPositions = async (req, res, next) => {
  try {
    const records = await ClassStudent.findAll({
      where: { student_id: req.user.id, position: { [Op.ne]: 'none' } }
    });
    const classIds = records.map(r => r.class_id);
    const classes = classIds.length > 0
      ? await Class.findAll({ where: { id: { [Op.in]: classIds } }, attributes: ['id', 'name', 'grade'] })
      : [];
    const classMap = new Map(classes.map(c => [c.id, c]));
    const result = records.map(r => ({
      class_id: r.class_id,
      position: r.position,
      position_text: r.position === 'monitor' ? '班长' : (r.position === 'commissary' ? '学委' : '普通学生'),
      class: classMap.get(r.class_id)
    }));
    return success(res, result, '获取成功');
  } catch (err) {
    next(err);
  }
};

// 批量为班级添加学生 —— 管理员
exports.addStudents = async (req, res, next) => {
  try {
    const { student_ids } = req.body;
    if (!Array.isArray(student_ids) || student_ids.length === 0) {
      return fail(res, '请选择要添加的学生', 422);
    }
    const cls = await Class.findByPk(req.params.id);
    if (!cls) return fail(res, '班级不存在', 404);

    const existing = await ClassStudent.findAll({
      where: { class_id: cls.id, student_id: { [Op.in]: student_ids } },
      attributes: ['student_id']
    });
    const existSet = new Set(existing.map(e => e.student_id));
    const toAdd = student_ids.filter(id => !existSet.has(id));

    if (toAdd.length === 0) return fail(res, '所选学生已全部在该班级中', 422);

    const records = toAdd.map(sid => ({ class_id: cls.id, student_id: sid }));
    await ClassStudent.bulkCreate(records);
    return success(res, { added: toAdd.length, skipped: existSet.size }, `成功添加 ${toAdd.length} 名学生`);
  } catch (err) {
    next(err);
  }
};

// 从班级移除学生 —— 管理员
exports.removeStudent = async (req, res, next) => {
  try {
    const { id, studentId } = req.params;
    await ClassStudent.destroy({ where: { class_id: id, student_id: studentId } });
    return success(res, null, '学生已移出班级');
  } catch (err) {
    next(err);
  }
};

// 学生选择班级（加入班级） —— 学生
exports.joinClass = async (req, res, next) => {
  try {
    if (req.user.role !== 'student') return fail(res, '仅学生可加入班级', 403);
    const { id } = req.params;
    const cls = await Class.findByPk(id);
    if (!cls) return fail(res, '班级不存在', 404);
    const exists = await ClassStudent.findOne({ where: { class_id: id, student_id: req.user.id } });
    if (exists) return fail(res, '你已加入该班级', 422);
    await ClassStudent.create({ class_id: id, student_id: req.user.id });
    return success(res, null, '加入班级成功');
  } catch (err) {
    next(err);
  }
};

// 学生查看自己已加入的班级
exports.myClasses = async (req, res, next) => {
  try {
    const classes = await Class.findAll({
      include: [{
        model: User,
        as: 'students',
        where: { id: req.user.id },
        through: { attributes: [] },
        required: true
      }, {
        model: User, as: 'headTeacher', attributes: ['id', 'real_name'], required: false
      }]
    });
    return success(res, classes, '获取成功');
  } catch (err) {
    next(err);
  }
};
