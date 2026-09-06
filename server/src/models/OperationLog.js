const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// 操作审计日志：记录"谁在何时对什么做了什么"。
// 操作人字段做快照冗余（而非仅存外键）：用户被删除后历史审计仍可读。
// 存储保护见 services/operationLog.service.js（保留期 + 行数上限自动清理）。
const OperationLog = sequelize.define('OperationLog', {
  id: {
    type: DataTypes.BIGINT.UNSIGNED,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: true,
    comment: '操作人ID（登录失败等场景可能为空）'
  },
  username: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: '操作人账号快照'
  },
  real_name: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: '操作人姓名快照'
  },
  role: {
    type: DataTypes.STRING(20),
    allowNull: true,
    comment: '操作人角色快照（student/teacher/admin）'
  },
  action: {
    type: DataTypes.STRING(120),
    allowNull: false,
    comment: '动作标识，如 DELETE /api/users/:id'
  },
  action_label: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: '',
    comment: '动作中文名'
  },
  method: {
    type: DataTypes.STRING(10),
    allowNull: false,
    comment: 'HTTP 方法'
  },
  path: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: '实际请求路径（不含 query）'
  },
  target_id: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: '操作目标对象ID（取路由参数）'
  },
  detail: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: '请求参数摘要（已脱敏并截断）'
  },
  result: {
    type: DataTypes.TINYINT,
    allowNull: false,
    defaultValue: 1,
    comment: '结果：1成功 0失败'
  },
  status_code: {
    type: DataTypes.SMALLINT.UNSIGNED,
    allowNull: false,
    defaultValue: 200,
    comment: 'HTTP 响应状态码'
  },
  ip: {
    type: DataTypes.STRING(45),
    allowNull: true,
    comment: '客户端IP（兼容 IPv6）'
  },
  user_agent: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'User-Agent（截断）'
  }
}, {
  tableName: 'operation_logs',
  // 审计日志只插入不更新，无 updated_at
  updatedAt: false,
  indexes: [
    // 保留期清理与时间排序
    { fields: ['created_at'] },
    // 按操作人检索
    { fields: ['user_id'] },
    // 按动作类型筛选
    { fields: ['action'] }
  ]
});

module.exports = OperationLog;
