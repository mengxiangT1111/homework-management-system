const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Class = sequelize.define('Class', {
  id: {
    type: DataTypes.INTEGER.UNSIGNED,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: '班级名称，如 计算机科学与技术1班'
  },
  school_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: true,
    comment: '所属学校ID'
  },
  grade: {
    type: DataTypes.STRING(20),
    allowNull: false,
    comment: '年级，如 2024级'
  },
  teacher_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: true,
    comment: '班主任ID'
  },
  description: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: '班级描述'
  }
}, {
  tableName: 'classes'
});

module.exports = Class;
