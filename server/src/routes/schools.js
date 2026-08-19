const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { sequelize, School, User } = require('../models');
const { success, fail, normalizePage } = require('../utils/response');
const { auth, requireRole } = require('../middleware/auth');

// 公开接口：所有学校列表（登录/注册页下拉用，无需登录）
router.get('/all', async (req, res, next) => {
  try {
    const schools = await School.findAll({
      attributes: ['id', 'name', 'code'],
      order: [['code', 'ASC']]
    });
    return success(res, schools, '获取成功');
  } catch (err) {
    next(err);
  }
});

// 以下为管理接口
router.use(auth);
router.use(requireRole('admin'));

// 学校列表（分页）
router.get('/', async (req, res, next) => {
  try {
    const { keyword } = req.query;
    const { page, pageSize } = normalizePage(req.query);
    const where = {};
    if (keyword) {
      where[Op.or] = [
        { name: { [Op.like]: `%${keyword}%` } },
        { code: { [Op.like]: `%${keyword}%` } }
      ];
    }
    const { rows, count } = await School.findAndCountAll({
      where,
      order: [['code', 'ASC']],
      limit: pageSize,
      offset: (page - 1) * pageSize
    });
    // 附带每校用户数（一次聚合查询替代逐行 count）
    const rowIds = rows.map(s => s.id);
    const userCountMap = new Map();
    if (rowIds.length > 0) {
      const userCounts = await User.findAll({
        where: { school_id: { [Op.in]: rowIds } },
        attributes: ['school_id', [sequelize.fn('COUNT', sequelize.col('id')), 'cnt']],
        group: 'school_id'
      });
      userCounts.forEach(u => userCountMap.set(u.school_id, Number(u.get('cnt'))));
    }
    const result = rows.map(s => ({ ...s.toJSON(), user_count: userCountMap.get(s.id) || 0 }));
    return res.json({
      code: 200, success: true, message: '查询成功',
      data: { list: result, total: count, page, pageSize }
    });
  } catch (err) {
    next(err);
  }
});

// 新增学校
router.post('/', async (req, res, next) => {
  try {
    const { name, code } = req.body;
    if (!name || !code) return fail(res, '学校名称和代码不能为空', 422);
    const exists = await School.findOne({ where: { code } });
    if (exists) return fail(res, `学校代码 ${code} 已存在`, 409);
    const school = await School.create({ name, code });
    return success(res, school, '学校创建成功', 201);
  } catch (err) {
    next(err);
  }
});

// 更新学校
router.put('/:id', async (req, res, next) => {
  try {
    const school = await School.findByPk(req.params.id);
    if (!school) return fail(res, '学校不存在', 404);
    const { name, code } = req.body;
    if (code && code !== school.code) {
      const exists = await School.findOne({ where: { code, id: { [Op.ne]: school.id } } });
      if (exists) return fail(res, `学校代码 ${code} 已存在`, 409);
    }
    await school.update({
      name: name || school.name,
      code: code || school.code
    });
    return success(res, school, '更新成功');
  } catch (err) {
    next(err);
  }
});

// 删除学校（有用户时不允许删除）
router.delete('/:id', async (req, res, next) => {
  try {
    const school = await School.findByPk(req.params.id);
    if (!school) return fail(res, '学校不存在', 404);
    const userCount = await User.count({ where: { school_id: school.id } });
    if (userCount > 0) {
      return fail(res, `该学校下还有 ${userCount} 个用户，无法删除`, 422);
    }
    await school.destroy();
    return success(res, null, '学校已删除');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
