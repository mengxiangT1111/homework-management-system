const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Todo = sequelize.define('Todo', {
  id: {
    type: DataTypes.INTEGER.UNSIGNED,
    primaryKey: true,
    autoIncrement: true
  },
  class_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '所属班级ID'
  },
  title: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: '待办标题'
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: '待办详细说明'
  },
  due_date: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '截止时间（可选）'
  },
  status: {
    type: DataTypes.ENUM('active', 'closed'),
    allowNull: false,
    defaultValue: 'active',
    comment: '待办状态：active进行中 / closed已结束'
  },
  created_by: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '发布者用户ID（教师或学委），与 Assignment.created_by 同范式：删改仅限本人'
  },
  creator_identity: {
    type: DataTypes.STRING(20),
    allowNull: true,
    comment: '发布时身份（老师/班长/学委/课代表），冗余存储保证历史署名不随职务变动漂移；NULL=旧数据'
  }
}, {
  tableName: 'todos',
  indexes: [
    { fields: ['class_id'] },
    { fields: ['created_by'] }
  ]
});

module.exports = Todo;
