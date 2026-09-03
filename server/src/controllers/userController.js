const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const path = require('path');
const fs = require('fs');
const {
  sequelize, User, School, Class, Course, ClassStudent, CourseAssistant,
  Submission, SubmissionFile, Notification, GradingTask, GradingResult, GradingReview,
  PlagiarismResult, UploadRecord, Assignment
} = require('../models');
const { success, fail, paginate, normalizePage } = require('../utils/response');
const { sanitizeUser } = require('../utils/auth');
const { isCOSConfigured, deleteFromCOS } = require('../config/cos');
const { isCOSPath, extractCOSKey } = require('../utils/fileStorage').helpers;

// 用户列表（分页+筛选）—— 管理员
exports.listUsers = async (req, res, next) => {
  try {
    const { role, keyword, status, school_id } = req.query;
    const { page, pageSize } = normalizePage(req.query);
    const where = {};
    if (role) where.role = role;
    if (school_id) where.school_id = school_id;
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
      include: [{ model: School, as: 'school', attributes: ['id', 'name', 'code'], required: false }],
      order: [['created_at', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
      distinct: true
    });
    return paginate(res, rows, count, page, pageSize);
  } catch (err) {
    next(err);
  }
};

// 获取用户详情
exports.getUser = async (req, res, next) => {
  try {
    const user = await User.findByPk(req.params.id, {
      attributes: { exclude: ['password'] },
      include: [{ model: School, as: 'school', attributes: ['id', 'name', 'code'], required: false }]
    });
    if (!user) return fail(res, '用户不存在', 404);
    return success(res, user, '获取成功');
  } catch (err) {
    next(err);
  }
};

// 新增教师账号 —— 管理员
exports.createTeacher = async (req, res, next) => {
  try {
    const { username, password, real_name, email, phone, school_id } = req.body;
    if (!username || !password || !real_name) {
      return fail(res, '学号/工号、密码、真实姓名不能为空', 422);
    }
    if (!school_id) return fail(res, '请选择学校', 422);
    if (password.length < 6) {
      return fail(res, '密码长度不能少于 6 位', 422);
    }
    const school = await School.findByPk(school_id);
    if (!school) return fail(res, '所选学校不存在', 422);
    const exists = await User.findOne({ where: { username, school_id } });
    if (exists) return fail(res, `该工号已在「${school.name}」存在`, 409);

    const user = await User.create({
      username,
      password: await bcrypt.hash(password, 10),
      real_name,
      role: 'teacher',
      school_id,
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
    const { username, password, real_name, email, phone, school_id } = req.body;
    if (!username || !password || !real_name) {
      return fail(res, '学号/工号、密码、真实姓名不能为空', 422);
    }
    if (!school_id) return fail(res, '请选择学校', 422);
    if (password.length < 6) {
      return fail(res, '密码长度不能少于 6 位', 422);
    }
    const school = await School.findByPk(school_id);
    if (!school) return fail(res, '所选学校不存在', 422);
    const exists = await User.findOne({ where: { username, school_id } });
    if (exists) return fail(res, `该学号已在「${school.name}」存在`, 409);

    const user = await User.create({
      username,
      password: await bcrypt.hash(password, 10),
      real_name,
      role: 'student',
      school_id,
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
    const { new_password } = req.body;
    const user = await User.findByPk(id);
    if (!user) return fail(res, '用户不存在', 404);
    // 不再提供固定默认密码：学号可枚举 + 固定弱密码 = 任何人可冒名登录
    if (!new_password || typeof new_password !== 'string') {
      return fail(res, '请提供新密码', 422);
    }
    if (new_password.length < 6 || new_password.length > 64) {
      return fail(res, '新密码长度需为 6-64 位', 422);
    }
    if (/^\d+$/.test(new_password)) {
      return fail(res, '新密码不能为纯数字', 422);
    }
    await User.update(
      { password: await bcrypt.hash(new_password, 10) },
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
    // 教师名下还有课程/作业/仍任班主任时禁止删除，避免产生悬挂外键
    if (user.role === 'teacher') {
      const courseCount = await Course.count({ where: { teacher_id: user.id } });
      if (courseCount > 0) {
        return fail(res, `该教师名下还有 ${courseCount} 门课程，请先删除或调整课程`, 422);
      }
      // 课程换教师后 assignments.teacher_id 会同步，这里兜底检查
      // （此前不查作业：课程转移后删除原教师，其历史作业对任何教师都不可管理）
      const assignmentCount = await Assignment.count({ where: { teacher_id: user.id } });
      if (assignmentCount > 0) {
        return fail(res, `该教师名下还有 ${assignmentCount} 个作业，请先在课程管理中转移或删除`, 422);
      }
      const headClassCount = await Class.count({ where: { teacher_id: user.id } });
      if (headClassCount > 0) {
        return fail(res, `该教师仍是 ${headClassCount} 个班级的班主任，请先调整班主任`, 422);
      }
    }

    // 级联清理（事务化：此前无事务且遗漏批改/查重/通知，删被批改过的学生
    // 会因外键约束 500 删不掉，或留下悬挂行导致列表/复核页出错）
    const UPLOAD_DIR = path.resolve(path.join(__dirname, '../../', process.env.UPLOAD_DIR || 'uploads'));
    let deletedFilePaths = [];
    await sequelize.transaction(async (t) => {
      await ClassStudent.destroy({ where: { student_id: user.id }, transaction: t });
      await CourseAssistant.destroy({ where: { student_id: user.id }, transaction: t });
      await Notification.destroy({ where: { user_id: user.id }, transaction: t });

      if (user.role === 'student') {
        const subs = await Submission.findAll({ where: { student_id: user.id }, attributes: ['id'], transaction: t });
        if (subs.length > 0) {
          const subIds = subs.map(s => s.id);
          // 批改链路：工单 → 结果 → 任务（按外键依赖逆序）
          await GradingReview.destroy({ where: { submission_id: { [Op.in]: subIds } }, transaction: t });
          await GradingResult.destroy({ where: { submission_id: { [Op.in]: subIds } }, transaction: t });
          await GradingTask.destroy({ where: { submission_id: { [Op.in]: subIds } }, transaction: t });
          // 查重结果：双向引用（本人提交 与 被比对对象）
          await PlagiarismResult.destroy({
            where: { [Op.or]: [{ submission_id: { [Op.in]: subIds } }, { compared_with_id: { [Op.in]: subIds } }] },
            transaction: t
          });
          // 物理文件路径先记下，事务提交后统一清理
          const files = await SubmissionFile.findAll({
            where: { submission_id: { [Op.in]: subIds } }, attributes: ['file_path'], transaction: t
          });
          deletedFilePaths = files.map(f => f.file_path);
          await SubmissionFile.destroy({ where: { submission_id: { [Op.in]: subIds } }, transaction: t });
          await Submission.destroy({ where: { student_id: user.id }, transaction: t });
        }
      }
      await user.destroy({ transaction: t });
    });

    // 事务已提交：清理物理文件与上传归属记录（失败不影响删除结果）
    for (const raw of deletedFilePaths) {
      try {
        if (isCOSPath(raw)) {
          if (isCOSConfigured) {
            const key = extractCOSKey(raw);
            if (key && !key.includes('..')) await deleteFromCOS(key);
          }
        } else {
          let rel = raw;
          if (rel.startsWith('uploads/') || rel.startsWith('uploads\\')) rel = rel.substring(8);
          const abs = path.join(UPLOAD_DIR, rel);
          const resolved = path.resolve(abs);
          if (resolved.startsWith(UPLOAD_DIR + path.sep) && fs.existsSync(resolved)) fs.unlinkSync(resolved);
        }
        await UploadRecord.destroy({ where: { file_path: raw } }).catch(() => {});
      } catch (e) { /* 单文件失败不影响整体 */ }
    }
    return success(res, null, '用户已删除');
  } catch (err) {
    next(err);
  }
};

// 获取所有教师列表（下拉选择用）—— 非管理员仅本校，管理员可按学校筛选
exports.listTeachers = async (req, res, next) => {
  try {
    const where = { role: 'teacher', status: 1 };
    if (req.user.role === 'admin') {
      if (req.query.school_id) where.school_id = req.query.school_id;
    } else {
      where.school_id = req.user.school_id;
    }
    const teachers = await User.findAll({
      where,
      attributes: ['id', 'username', 'real_name', 'school_id'],
      order: [['real_name', 'ASC']]
    });
    return success(res, teachers, '获取成功');
  } catch (err) {
    next(err);
  }
};

// 获取所有学生列表（下拉/分配班级用）—— 非管理员仅本校，管理员可按学校筛选
exports.listStudents = async (req, res, next) => {
  try {
    const { keyword, school_id } = req.query;
    const where = { role: 'student', status: 1 };
    if (req.user.role === 'admin') {
      if (school_id) where.school_id = school_id;
    } else {
      where.school_id = req.user.school_id;
    }
    if (keyword) {
      where[Op.or] = [
        { username: { [Op.like]: `%${keyword}%` } },
        { real_name: { [Op.like]: `%${keyword}%` } }
      ];
    }
    const students = await User.findAll({
      where,
      attributes: ['id', 'username', 'real_name', 'school_id'],
      order: [['real_name', 'ASC']],
      limit: 100
    });
    return success(res, students, '获取成功');
  } catch (err) {
    next(err);
  }
};
