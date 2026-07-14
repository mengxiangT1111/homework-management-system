const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Submission = sequelize.define('Submission', {
  id: {
    type: DataTypes.INTEGER.UNSIGNED,
    primaryKey: true,
    autoIncrement: true
  },
  assignment_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '作业任务ID'
  },
  student_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '提交学生ID'
  },
  status: {
    type: DataTypes.ENUM('submitted', 'graded', 'returned'),
    allowNull: false,
    defaultValue: 'submitted',
    comment: '提交状态：已提交/已评分/已退回'
  },
  score: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: true,
    comment: '分数'
  },
  comment: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: '教师评语'
  },
  graded_by: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: true,
    comment: '评分教师ID'
  },
  graded_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '评分时间'
  },
  submitted_at: {
    type: DataTypes.DATE,
    allowNull: false,
    comment: '提交时间'
  },
  remark: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: '学生提交备注'
  }
}, {
  tableName: 'submissions',
  indexes: [
    { unique: true, fields: ['assignment_id', 'student_id'] }
  ]
});

module.exports = Submission;
