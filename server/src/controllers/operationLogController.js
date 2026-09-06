// 操作审计日志查询 —— 管理员
const { Op } = require('sequelize');
const { OperationLog } = require('../models');
const { success, paginate, normalizePage } = require('../utils/response');
const { enforceOpLogLimits, getOpLogConfig } = require('../services/operationLog.service');

// 日志列表（分页 + 筛选）
exports.list = async (req, res, next) => {
  try {
    const { keyword, action, result, start_date, end_date } = req.query;
    const { page, pageSize } = normalizePage(req.query);
    const where = {};
    if (action) where.action = action;
    if (result !== undefined && result !== '') where.result = Number(result);
    if (start_date || end_date) {
      where.created_at = {};
      // 只传日期时按当天 00:00:00 ~ 23:59:59 闭区间处理
      if (start_date) where.created_at[Op.gte] = new Date(`${start_date}T00:00:00`);
      if (end_date) where.created_at[Op.lte] = new Date(`${end_date}T23:59:59`);
    }
    if (keyword) {
      where[Op.or] = [
        { username: { [Op.like]: `%${keyword}%` } },
        { real_name: { [Op.like]: `%${keyword}%` } },
        { path: { [Op.like]: `%${keyword}%` } },
        { ip: { [Op.like]: `%${keyword}%` } }
      ];
    }
    const { rows, count } = await OperationLog.findAndCountAll({
      where,
      order: [['id', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize
    });
    return paginate(res, rows, count, page, pageSize);
  } catch (err) {
    next(err);
  }
};

// 可选动作列表（筛选下拉用）+ 存储概况（总条数/最早记录/保留策略）
exports.meta = async (req, res, next) => {
  try {
    const actions = await OperationLog.findAll({
      attributes: ['action', 'action_label'],
      group: ['action', 'action_label'],
      order: [['action', 'ASC']]
    });
    const total = await OperationLog.count();
    let oldest = null;
    if (total > 0) {
      const first = await OperationLog.findOne({ order: [['created_at', 'ASC']] });
      oldest = first ? first.created_at : null;
    }
    const config = getOpLogConfig();
    return success(res, { actions, total, oldest, ...config }, '获取成功');
  } catch (err) {
    next(err);
  }
};

// 立即执行存储保护清理（保留期 + 行数上限）
exports.cleanup = async (req, res, next) => {
  try {
    const result = await enforceOpLogLimits();
    return success(res, result, `清理完成：共删除 ${result.deletedByRetention + result.deletedByCap} 条日志`);
  } catch (err) {
    next(err);
  }
};
