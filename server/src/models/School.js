const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const School = sequelize.define('School', {
  id: {
    type: DataTypes.INTEGER.UNSIGNED,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: '学校名称'
  },
  code: {
    type: DataTypes.STRING(10),
    allowNull: false,
    unique: 'uniq_school_code',
    comment: '学校代码，如 009'
  }
}, {
  tableName: 'schools',
  indexes: [
    { unique: true, fields: ['code'], name: 'uniq_school_code' }
  ]
});

module.exports = School;
