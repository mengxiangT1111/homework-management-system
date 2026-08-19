const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const User = sequelize.define('User', {
  id: {
    type: DataTypes.INTEGER.UNSIGNED,
    primaryKey: true,
    autoIncrement: true
  },
  username: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: 'uniq_school_username',
    comment: '登录账号（学号/工号，同校内唯一）'
  },
  school_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: true,
    unique: 'uniq_school_username',
    comment: '所属学校ID（管理员为空）'
  },
  password: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: '加密密码'
  },
  real_name: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: '真实姓名'
  },
  role: {
    type: DataTypes.ENUM('student', 'teacher', 'admin'),
    allowNull: false,
    defaultValue: 'student',
    comment: '角色：学生/教师/管理员'
  },
  email: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: '邮箱'
  },
  phone: {
    type: DataTypes.STRING(20),
    allowNull: true,
    comment: '手机号'
  },
  avatar: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: '头像URL'
  },
  status: {
    type: DataTypes.TINYINT,
    allowNull: false,
    defaultValue: 1,
    comment: '状态：1启用 0禁用'
  }
}, {
  tableName: 'users'
});

module.exports = User;
