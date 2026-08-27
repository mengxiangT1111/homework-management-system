const { Op } = require('sequelize');
const { sequelize, Class, User, ClassStudent, Course, CourseAssistant, School } = require('../models');
const { success, fail, paginate, normalizePage } = require('../utils/response');

// 学校隔离条件：非管理员强制本校，管理员可按 school_id 参数筛选
function schoolWhere(req, where = {}) {
  if (req.user.role === 'admin') {
    if (req.query.school_id) where.school_id = req.query.school_id;
  } else {
    where.school_id = req.user.school_id;
  }
  return where;
}

// 非管理员访问其他学校的资源时视为不存在
function foreignSchool(resource, req) {
  return req.user.role !== 'admin' && resource.school_id !== req.user.school_id;
}

// 班级列表（分页）—— 管理员看全部（可按学校筛）；教师看自己任课/班主任的；学生看自己的
exports.listClasses = async (req, res, next) => {
  try {
    const { keyword } = req.query;
    const { page, pageSize } = normalizePage(req.query);
    const where = {};
    if (keyword) {
      where[Op.or] = [
        { name: { [Op.like]: `%${keyword}%` } },
        { grade: { [Op.like]: `%${keyword}%` } }
      ];
    }
    schoolWhere(req, where);

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
        { model: User, as: 'headTeacher', attributes: ['id', 'real_name'], required: false },
        { model: School, as: 'school', attributes: ['id', 'name'], required: false }
      ],
      order: [['grade', 'DESC'], ['name', 'ASC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
      distinct: true
    });

    // 附加每班学生数/课程数（两次聚合查询替代逐行 count，避免 N+1）
    const rowIds = rows.map(c => c.id);
    const studentCountMap = new Map();
    const courseCountMap = new Map();
    if (rowIds.length > 0) {
      const [studentCounts, courseCounts] = await Promise.all([
        ClassStudent.findAll({
          where: { class_id: { [Op.in]: rowIds } },
          attributes: ['class_id', [sequelize.fn('COUNT', sequelize.col('id')), 'cnt']],
          group: 'class_id'
        }),
        Course.findAll({
          where: { class_id: { [Op.in]: rowIds } },
          attributes: ['class_id', [sequelize.fn('COUNT', sequelize.col('id')), 'cnt']],
          group: 'class_id'
        })
      ]);
      studentCounts.forEach(r => studentCountMap.set(r.class_id, Number(r.get('cnt'))));
      courseCounts.forEach(r => courseCountMap.set(r.class_id, Number(r.get('cnt'))));
    }
    const result = rows.map(cls => ({
      ...cls.toJSON(),
      student_count: studentCountMap.get(cls.id) || 0,
      course_count: courseCountMap.get(cls.id) || 0
    }));

    return paginate(res, result, count, page, pageSize);
  } catch (err) {
    next(err);
  }
};

// 所有班级（下拉用，不分页）—— 非管理员仅本校
exports.allClasses = async (req, res, next) => {
  try {
    const where = {};
    schoolWhere(req, where);
    const classes = await Class.findAll({
      where,
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
    if (!cls || foreignSchool(cls, req)) return fail(res, '班级不存在', 404);
    const studentCount = await ClassStudent.count({ where: { class_id: cls.id } });
    return success(res, { ...cls.toJSON(), student_count: studentCount }, '获取成功');
  } catch (err) {
    next(err);
  }
};

// 创建班级 —— 管理员
exports.createClass = async (req, res, next) => {
  try {
    const { name, grade, teacher_id, description, school_id } = req.body;
    if (!name || !grade) return fail(res, '班级名称和年级不能为空', 422);
    if (!school_id) return fail(res, '请选择所属学校', 422);
    const school = await School.findByPk(school_id);
    if (!school) return fail(res, '所属学校不存在', 404);

    let headTeacherId = teacher_id || null;
    if (headTeacherId) {
      const teacher = await User.findByPk(headTeacherId);
      if (!teacher || teacher.role !== 'teacher') return fail(res, '指定的班主任无效', 422);
      if (teacher.school_id !== Number(school_id)) return fail(res, '班主任必须属于该班级所在学校', 422);
    }

    const cls = await Class.create({
      name, grade, school_id,
      teacher_id: headTeacherId,
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
    const { name, grade, teacher_id, description, school_id } = req.body;
    const cls = await Class.findByPk(req.params.id);
    if (!cls) return fail(res, '班级不存在', 404);

    const newSchoolId = school_id || cls.school_id;
    if (school_id && school_id !== cls.school_id) {
      const school = await School.findByPk(school_id);
      if (!school) return fail(res, '目标学校不存在', 404);
    }

    let headTeacherId = teacher_id !== undefined ? teacher_id : cls.teacher_id;
    if (headTeacherId) {
      const teacher = await User.findByPk(headTeacherId);
      if (!teacher || teacher.role !== 'teacher') return fail(res, '指定的班主任无效', 422);
      if (teacher.school_id !== Number(newSchoolId)) return fail(res, '班主任必须属于该班级所在学校', 422);
    }

    const oldSchoolId = cls.school_id;
    await cls.update({
      name: name || cls.name,
      grade: grade || cls.grade,
      school_id: newSchoolId,
      teacher_id: headTeacherId,
      description: description !== undefined ? description : cls.description
    });

    // 课程表冗余了 school_id（教师/学生端按校过滤），班级转校时必须同步，否则课程在新校"消失"
    if (newSchoolId !== oldSchoolId) {
      await Course.update({ school_id: newSchoolId }, { where: { class_id: cls.id } });
    }
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
    if (!cls || foreignSchool(cls, req)) return fail(res, '班级不存在', 404);

    // 学生只能看本班名单，且不返回联系方式（防同校任意学生遍历 class_id 批量拉取手机号/邮箱）
    let isMember = false;
    if (req.user.role === 'student') {
      isMember = !!(await ClassStudent.findOne({
        where: { class_id: cls.id, student_id: req.user.id }
      }));
      if (!isMember) return fail(res, '班级不存在', 404);
    }
    const attributes = req.user.role === 'student'
      ? ['id', 'username', 'real_name', 'status']
      : ['id', 'username', 'real_name', 'email', 'phone', 'status'];

    const students = await User.findAll({
      include: [{
        model: Class,
        as: 'classes',
        where: { id: cls.id },
        through: { attributes: ['position'] },
        required: true
      }],
      attributes,
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
    const cls = await Class.findByPk(id);
    if (!cls || foreignSchool(cls, req)) return fail(res, '班级不存在', 404);
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
    if (!cls || foreignSchool(cls, req)) return fail(res, '班级不存在', 404);

    const existing = await ClassStudent.findAll({
      where: { class_id: cls.id, student_id: { [Op.in]: student_ids } },
      attributes: ['student_id']
    });
    const existSet = new Set(existing.map(e => e.student_id));
    const toAdd = student_ids.filter(id => !existSet.has(id));

    // 学生必须与班级同校
    if (toAdd.length > 0) {
      const students = await User.findAll({
        where: { id: { [Op.in]: toAdd } },
        attributes: ['id', 'school_id']
      });
      const studentMap = new Map(students.map(s => [s.id, s]));
      const wrongSchool = toAdd.filter(sid => {
        const s = studentMap.get(sid);
        return !s || s.school_id !== cls.school_id;
      });
      if (wrongSchool.length > 0) {
        return fail(res, `有 ${wrongSchool.length} 名学生不属于该班级所在学校，无法添加`, 422);
      }

      // 检查学生是否已在其他班级
      const alreadyInOther = await ClassStudent.findAll({
        where: { student_id: { [Op.in]: toAdd } },
        attributes: ['student_id']
      });
      if (alreadyInOther.length > 0) {
        return fail(res, `有 ${alreadyInOther.length} 名学生已在其他班级中，一个学生只能加入一个班级`, 422);
      }
    }
    if (toAdd.length === 0) return fail(res, '所选学生已全部在该班级中', 422);

    const records = toAdd.map(sid => ({ class_id: cls.id, student_id: sid }));
    await ClassStudent.bulkCreate(records);
    return success(res, { added: toAdd.length, skipped: existSet.size }, `成功添加 ${toAdd.length} 名学生`);
  } catch (err) {
    // 唯一索引兜底并发场景（同一学生被并发加入两个班）
    if (err.name === 'SequelizeUniqueConstraintError') {
      return fail(res, '有学生刚被加入其他班级，请刷新后重试', 422);
    }
    next(err);
  }
};

// 从班级移除学生 —— 管理员
exports.removeStudent = async (req, res, next) => {
  try {
    const { id, studentId } = req.params;
    const record = await ClassStudent.findOne({ where: { class_id: id, student_id: studentId } });
    if (!record) return fail(res, '该学生不在此班级中', 404);
    await record.destroy();
    // 同步清理该班所有课程下的课代表身份，否则退班学生仍可访问全班作业数据
    const courseIds = (await Course.findAll({ where: { class_id: id }, attributes: ['id'] })).map(c => c.id);
    if (courseIds.length) {
      await CourseAssistant.destroy({ where: { student_id: studentId, course_id: { [Op.in]: courseIds } } });
    }
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
    if (!cls || cls.school_id !== req.user.school_id) return fail(res, '班级不存在', 404);

    // 检查是否已加入该班级
    const exists = await ClassStudent.findOne({ where: { class_id: id, student_id: req.user.id } });
    if (exists) return fail(res, '你已加入该班级', 422);

    // 检查是否已加入其他班级
    const inOther = await ClassStudent.findOne({ where: { student_id: req.user.id } });
    if (inOther) {
      return fail(res, '你已在其他班级中，一个学生只能加入一个班级', 422);
    }

    await ClassStudent.create({ class_id: id, student_id: req.user.id });
    return success(res, null, '加入班级成功');
  } catch (err) {
    // 唯一索引兜底并发加入班级（双端同时点击绕过先查后插检查）
    if (err.name === 'SequelizeUniqueConstraintError') {
      return fail(res, '你已加入班级，一个学生只能加入一个班级', 422);
    }
    next(err);
  }
};

// 学生退出班级
exports.leaveClass = async (req, res, next) => {
  try {
    if (req.user.role !== 'student') return fail(res, '仅学生可退出班级', 403);
    const { id } = req.params;
    const record = await ClassStudent.findOne({ where: { class_id: id, student_id: req.user.id } });
    if (!record) return fail(res, '你不在该班级中', 404);
    await record.destroy();
    // 退出班级即失去课代表身份，防止退班后仍能访问该班课程作业
    const courseIds = (await Course.findAll({ where: { class_id: id }, attributes: ['id'] })).map(c => c.id);
    if (courseIds.length) {
      await CourseAssistant.destroy({ where: { student_id: req.user.id, course_id: { [Op.in]: courseIds } } });
    }
    return success(res, null, '已退出班级');
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
