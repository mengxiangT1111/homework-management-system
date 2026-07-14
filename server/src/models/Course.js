const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Course = sequelize.define('Course', {
  id: {
    type: DataTypes.INTEGER.UNSIGNED,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: '课程名称'
  },
  class_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '所属班级ID'
  },
  teacher_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '任课教师ID'
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: '课程描述'
  },
  semester: {
    type: DataTypes.STRING(20),
    allowNull: true,
    comment: '学期，如 2024-2025-1'
  }
}, {
  tableName: 'courses'
});

module.exports = Course;
