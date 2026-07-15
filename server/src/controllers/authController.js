const bcrypt = require('bcryptjs');
const { User, ClassStudent, Class } = require('../models');
const { success, fail } = require('../utils/response');
const { generateToken, sanitizeUser } = require('../utils/auth');

// 注册
exports.register = async (req, res, next) => {
  try {
    const { username, password, real_name, role, email, phone } = req.body;

    if (!username || !password || !real_name) {
      return fail(res, '学号/工号、密码、真实姓名不能为空', 422);
    }
    if (username.length < 3 || username.length > 50) {
      return fail(res, '学号/工号长度需在 3-50 个字符之间', 422);
    }
    if (password.length < 6) {
      return fail(res, '密码长度不能少于 6 位', 422);
    }
    // 校验邮箱格式
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return fail(res, '邮箱格式不正确', 422);
    }
    // 校验手机号格式（中国大陆）
    if (phone && !/^1[3-9]\d{9}$/.test(phone)) {
      return fail(res, '手机号格式不正确', 422);
    }
    // 注册角色仅允许 student / teacher，admin 由系统创建
    const finalRole = ['student', 'teacher'].includes(role) ? role : 'student';

    const exists = await User.findOne({ where: { username } });
    if (exists) {
      return fail(res, '该学号/工号已被注册', 409);
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const user = await User.create({
      username,
      password: hashedPassword,
      real_name,
      role: finalRole,
      email: email || null,
      phone: phone || null,
      status: 1
    });

    const token = generateToken(user.id);
    return success(res, { token, user: sanitizeUser(user) }, '注册成功');
  } catch (err) {
    next(err);
  }
};

// 登录
exports.login = async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return fail(res, '学号/工号和密码不能为空', 422);
    }

    const user = await User.findOne({ where: { username } });
    if (!user) {
      return fail(res, '学号/工号或密码错误', 401);
    }
    if (user.status !== 1) {
      return fail(res, '账号已被禁用，请联系管理员', 403);
    }
    const valid = bcrypt.compareSync(password, user.password);
    if (!valid) {
      return fail(res, '学号/工号或密码错误', 401);
    }

    const token = generateToken(user.id);
    return success(res, { token, user: sanitizeUser(user) }, '登录成功');
  } catch (err) {
    next(err);
  }
};

// 获取当前登录用户信息
exports.getProfile = async (req, res, next) => {
  try {
    // 学生附带班级信息
    if (req.user.role === 'student') {
      const user = await User.findByPk(req.user.id, {
        include: [{ model: Class, as: 'classes', through: { attributes: [] } }]
      });
      return success(res, sanitizeUser(user), '获取成功');
    }
    return success(res, sanitizeUser(req.user), '获取成功');
  } catch (err) {
    next(err);
  }
};

// 修改个人信息
exports.updateProfile = async (req, res, next) => {
  try {
    const { real_name, email, phone } = req.body;
    
    // 校验邮箱格式
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return fail(res, '邮箱格式不正确', 422);
    }
    // 校验手机号格式（中国大陆）
    if (phone && !/^1[3-9]\d{9}$/.test(phone)) {
      return fail(res, '手机号格式不正确', 422);
    }
    
    const updateFields = {};
    if (real_name) updateFields.real_name = real_name;
    if (email !== undefined) updateFields.email = email;
    if (phone !== undefined) updateFields.phone = phone;

    await User.update(updateFields, { where: { id: req.user.id } });
    const user = await User.findByPk(req.user.id);
    return success(res, sanitizeUser(user), '修改成功');
  } catch (err) {
    next(err);
  }
};

// 修改密码
exports.changePassword = async (req, res, next) => {
  try {
    const { old_password, new_password } = req.body;
    if (!old_password || !new_password) {
      return fail(res, '请输入原密码和新密码', 422);
    }
    if (new_password.length < 6) {
      return fail(res, '新密码长度不能少于 6 位', 422);
    }
    const user = await User.findByPk(req.user.id);
    if (!bcrypt.compareSync(old_password, user.password)) {
      return fail(res, '原密码错误', 422);
    }
    await User.update(
      { password: bcrypt.hashSync(new_password, 10) },
      { where: { id: req.user.id } }
    );
    return success(res, null, '密码修改成功');
  } catch (err) {
    next(err);
  }
};
