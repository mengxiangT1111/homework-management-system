const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Notification = sequelize.define('Notification', {
  id: {
    type: DataTypes.INTEGER.UNSIGNED,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '接收用户ID'
  },
  title: {
    type: DataTypes.STRING(200),
    allowNull: false,
    comment: '通知标题'
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: '通知内容'
  },
  type: {
    type: DataTypes.ENUM('deadline', 'grade', 'system', 'assignment'),
    allowNull: false,
    defaultValue: 'system',
    comment: '通知类型'
  },
  is_read: {
    type: DataTypes.TINYINT,
    allowNull: false,
    defaultValue: 0,
    comment: '是否已读：0未读 1已读'
  },
  related_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: true,
    comment: '关联业务ID（如作业ID）'
  }
}, {
  tableName: 'notifications'
});

module.exports = Notification;
