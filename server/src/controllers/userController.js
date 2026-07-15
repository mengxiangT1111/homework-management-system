const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { User } = require('../models');
const { success, fail, paginate } = require('../utils/response');
const { sanitizeUser } = require('../utils/auth');

// 用户列表（分页+筛选）—— 管理员
exports.listUsers = async (req, res, next) => {
  try {
    const { page = 1, pageSize = 10, role, keyword, status } = req.query;
    const where = {};
    if (role) where.role = role;
    if (status !== undefined && status !== '') where.status = Number(status);
    if (keyword) {
      where[Op.or] = [
        { username: { [Op.like]: `%${keyword}%` } },
        { real_name: { [Op.like]: `%${keyword}%` } },
        { email: { [Op.like]: `%${keyword}%` } }
      ];
    }
    const { rows, count } = await User.findAndCountAll({
      where,
      attributes: { exclude: ['password'] },
      order: [['created_at', 'DESC']],
      limit: Number(pageSize),
      offset: (Number(page) - 1) * Number(pageSize)
    });
    return paginate(res, rows, count, page, pageSize);
  } catch (err) {
    next(err);
  }
};

// 获取用户详情
exports.getUser = async (req, res, next) => {
  try {
    const user = await User.findByPk(req.params.id, { attributes: { exclude: ['password'] } });
    if (!user) return fail(res, '用户不存在', 404);
    return success(res, user, '获取成功');
  } catch (err) {
    next(err);
  }
};

// 新增教师账号 —— 管理员
exports.createTeacher = async (req, res, next) => {
  try {
    const { username, password, real_name, email, phone } = req.body;
    if (!username || !password || !real_name) {
      return fail(res, '学号/工号、密码、真实姓名不能为空', 422);
    }
    if (password.length < 6) {
      return fail(res, '密码长度不能少于 6 位', 422);
    }
    const exists = await User.findOne({ where: { username } });
    if (exists) return fail(res, '该学号/工号已存在', 409);

    const user = await User.create({
      username,
      password: bcrypt.hashSync(password, 10),
      real_name,
      role: 'teacher',
      email: email || null,
      phone: phone || null,
      status: 1
    });
    return success(res, sanitizeUser(user), '教师账号创建成功', 201);
  } catch (err) {
    next(err);
  }
};

// 新增学生账号 —— 管理员
exports.createStudent = async (req, res, next) => {
  try {
    const { username, password, real_name, email, phone } = req.body;
    if (!username || !password || !real_name) {
      return fail(res, '学号/工号、密码、真实姓名不能为空', 422);
    }
    if (password.length < 6) {
      return fail(res, '密码长度不能少于 6 位', 422);
    }
    const exists = await User.findOne({ where: { username } });
    if (exists) return fail(res, '该学号/工号已存在', 409);

    const user = await User.create({
      username,
      password: bcrypt.hashSync(password, 10),
      real_name,
      role: 'student',
      email: email || null,
      phone: phone || null,
      status: 1
    });
    return success(res, sanitizeUser(user), '学生账号创建成功', 201);
  } catch (err) {
    next(err);
  }
};

// 重置用户密码 —— 管理员
exports.resetPassword = async (req, res, next) => {
  try {
    const { id } = req.params;
    let { new_password } = req.body;
    const user = await User.findByPk(id);
    if (!user) return fail(res, '用户不存在', 404);
    if (!new_password) {
      // 默认重置为固定默认密码
      new_password = '123456';
    }
    if (new_password.length < 6) {
      return fail(res, '新密码长度不能少于 6 位', 422);
    }
    await User.update(
      { password: bcrypt.hashSync(new_password, 10) },
      { where: { id } }
    );
    // 不返回新密码，避免敏感信息泄露
    return success(res, null, '密码已重置，请告知用户新密码');
  } catch (err) {
    next(err);
  }
};

// 启用/禁用用户 —— 管理员
exports.toggleStatus = async (req, res, next) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return fail(res, '用户不存在', 404);
    // 不能对自己执行此操作
    if (user.id === req.user.id) {
      return fail(res, '不能对自己执行此操作', 422);
    }
    if (user.role === 'admin' && user.status === 1) {
      return fail(res, '不能禁用管理员账号', 422);
    }
    const newStatus = user.status === 1 ? 0 : 1;
    await User.update({ status: newStatus }, { where: { id: user.id } });
    return success(res, { status: newStatus }, newStatus === 1 ? '已启用' : '已禁用');
  } catch (err) {
    next(err);
  }
};

// 删除用户 —— 管理员
exports.deleteUser = async (req, res, next) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return fail(res, '用户不存在', 404);
    // 不能对自己执行此操作
    if (user.id === req.user.id) {
      return fail(res, '不能对自己执行此操作', 422);
    }
    if (user.role === 'admin') {
      return fail(res, '不能删除管理员账号', 422);
    }
    await user.destroy();
    return success(res, null, '用户已删除');
  } catch (err) {
    next(err);
  }
};

// 获取所有教师列表（下拉选择用）
exports.listTeachers = async (req, res, next) => {
  try {
    const teachers = await User.findAll({
      where: { role: 'teacher', status: 1 },
      attributes: ['id', 'username', 'real_name'],
      order: [['real_name', 'ASC']]
    });
    return success(res, teachers, '获取成功');
  } catch (err) {
    next(err);
  }
};

// 获取所有学生列表（下拉/分配班级用）
exports.listStudents = async (req, res, next) => {
  try {
    const { keyword } = req.query;
    const where = { role: 'student', status: 1 };
    if (keyword) {
      where[Op.or] = [
        { username: { [Op.like]: `%${keyword}%` } },
        { real_name: { [Op.like]: `%${keyword}%` } }
      ];
    }
    const students = await User.findAll({
      where,
      attributes: ['id', 'username', 'real_name'],
      order: [['real_name', 'ASC']],
      limit: 100
    });
    return success(res, students, '获取成功');
  } catch (err) {
    next(err);
  }
};
