const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const TodoCompletion = sequelize.define('TodoCompletion', {
  id: {
    type: DataTypes.INTEGER.UNSIGNED,
    primaryKey: true,
    autoIncrement: true
  },
  todo_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '待办ID'
  },
  student_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '完成学生ID'
  },
  completed_at: {
    type: DataTypes.DATE,
    allowNull: false,
    comment: '完成时间'
  }
}, {
  tableName: 'todo_completions',
  indexes: [
    // 一人对待办只一条完成记录（完成/取消完成复用同一行，数据库层兜底并发点击）
    { unique: true, fields: ['todo_id', 'student_id'] },
    { fields: ['student_id'] }
  ]
});

module.exports = TodoCompletion;
