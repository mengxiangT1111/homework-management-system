const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * 全班查重任务模型
 * 状态与进度存 MySQL，后台队列 worker 消费，前端轮询进度
 */
const PlagiarismTask = sequelize.define('PlagiarismTask', {
  id: {
    type: DataTypes.INTEGER.UNSIGNED,
    primaryKey: true,
    autoIncrement: true
  },
  assignment_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '作业ID'
  },
  created_by: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '创建任务的教师ID'
  },
  status: {
    type: DataTypes.ENUM('pending', 'processing', 'done', 'failed', 'cancelled'),
    allowNull: false,
    defaultValue: 'pending',
    comment: '任务状态：待处理/处理中/完成/失败/已取消'
  },
  total_submissions: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: '参与查重的提交数'
  },
  total_pairs: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: '需比对的组合对数 C(n,2)'
  },
  completed_pairs: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: '已完成的对数（进度）'
  },
  failed_pairs: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: '检测失败的对数'
  },
  suspicious_count: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: '可疑对数（去重后）'
  },
  attempt: {
    type: DataTypes.TINYINT.UNSIGNED,
    allowNull: false,
    defaultValue: 0,
    comment: '已尝试次数（入队抢占时+1）'
  },
  max_attempts: {
    type: DataTypes.TINYINT.UNSIGNED,
    allowNull: false,
    defaultValue: 2,
    comment: '最大尝试次数（含首次）'
  },
  next_run_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    comment: '下次可执行时间（退避重试靠它延迟）'
  },
  locked_by: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: '占用该任务的worker标识'
  },
  locked_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '占用时间（僵死任务回收依据）'
  },
  error_msg: {
    type: DataTypes.STRING(1000),
    allowNull: true,
    comment: '最近一次失败原因'
  },
  started_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '开始执行时间'
  },
  finished_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '完成/终止时间'
  },
  result_summary: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: '完成时的摘要 { totalComparisons, note }'
  }
}, {
  tableName: 'plagiarism_tasks',
  indexes: [
    { fields: ['status', 'next_run_at'] },
    { fields: ['assignment_id', 'status'] },
    { fields: ['created_by'] }
  ]
});

module.exports = PlagiarismTask;
