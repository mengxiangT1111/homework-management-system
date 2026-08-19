const bcrypt = require('bcryptjs');
const { User, ClassStudent, Class, School, Notification } = require('../models');
const { success, fail } = require('../utils/response');
const { generateToken, sanitizeUser } = require('../utils/auth');

// 注册
exports.register = async (req, res, next) => {
  try {
    const { username, password, real_name, role, email, phone, school_id } = req.body;

    if (!username || !password || !real_name) {
      return fail(res, '学号/工号、密码、真实姓名不能为空', 422);
    }
    if (!school_id) {
      return fail(res, '请选择学校', 422);
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

    // 校验学校存在
    const school = await School.findByPk(school_id);
    if (!school) {
      return fail(res, '所选学校不存在', 422);
    }

    // 同一学校内学号唯一
    const exists = await User.findOne({ where: { username, school_id } });
    if (exists) {
      return fail(res, `该学号/工号已在「${school.name}」注册`, 409);
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    // 教师注册需管理员审核：先以停用状态创建，管理员在「用户管理」中通过审核后才能登录
    const needsReview = finalRole === 'teacher';
    const user = await User.create({
      username,
      password: hashedPassword,
      real_name,
      role: finalRole,
      school_id,
      email: email || null,
      phone: phone || null,
      status: needsReview ? 0 : 1
    });

    if (needsReview) {
      // 通知所有管理员有教师注册待审核（通知失败不应阻断注册本身）
      try {
        const admins = await User.findAll({ where: { role: 'admin', status: 1 }, attributes: ['id'] });
        if (admins.length > 0) {
          await Notification.bulkCreate(admins.map(a => ({
            user_id: a.id,
            title: '教师注册待审核',
            content: `${real_name}（工号 ${username}）注册了教师账号，请在「用户管理」中搜索该工号并点击「通过审核」启用。`,
            type: 'system',
            related_id: user.id
          })));
        }
      } catch (e) {
        console.error('[注册] 教师待审核通知发送失败:', e.message);
      }
      return success(res, { pending_review: true }, '注册成功！教师账号需管理员审核通过后才能登录');
    }

    const token = generateToken(user.id);
    return success(res, { token, user: sanitizeUser(user) }, '注册成功');
  } catch (err) {
    next(err);
  }
};

// 登录
exports.login = async (req, res, next) => {
  try {
    const { username, password, school_id } = req.body;
    if (!username || !password) {
      return fail(res, '学号/工号和密码不能为空', 422);
    }

    // 管理员登录：不选学校（school_id 为空），查无学校的账号
    // 师生登录：必须选学校，按 学校+学号 查询
    const where = school_id
      ? { username, school_id }
      : { username, school_id: null };

    const user = await User.findOne({ where });
    if (!user) {
      return fail(res, '学号/工号或密码错误（请确认学校选择是否正确）', 401);
    }
    if (user.status !== 1) {
      if (user.role === 'teacher') {
        return fail(res, '教师账号尚未通过审核或已被禁用，请联系管理员', 403);
      }
      return fail(res, '账号已被禁用，请联系管理员', 403);
    }
    const valid = await bcrypt.compare(password, user.password);
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
        include: [
          { model: Class, as: 'classes', through: { attributes: [] } },
          { model: School, as: 'school', attributes: ['id', 'name', 'code'], required: false }
        ]
      });
      return success(res, sanitizeUser(user), '获取成功');
    }
    const user = await User.findByPk(req.user.id, {
      include: [{ model: School, as: 'school', attributes: ['id', 'name', 'code'], required: false }]
    });
    return success(res, sanitizeUser(user), '获取成功');
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
    if (!(await bcrypt.compare(old_password, user.password))) {
      return fail(res, '原密码错误', 422);
    }
    await User.update(
      { password: await bcrypt.hash(new_password, 10) },
      { where: { id: req.user.id } }
    );
    return success(res, null, '密码修改成功');
  } catch (err) {
    next(err);
  }
};
