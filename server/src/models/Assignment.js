const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Assignment = sequelize.define('Assignment', {
  id: {
    type: DataTypes.INTEGER.UNSIGNED,
    primaryKey: true,
    autoIncrement: true
  },
  title: {
    type: DataTypes.STRING(200),
    allowNull: false,
    comment: '作业标题'
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: '作业要求说明'
  },
  course_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '所属课程ID'
  },
  teacher_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '发布教师ID'
  },
  deadline: {
    type: DataTypes.DATE,
    allowNull: false,
    comment: '截止时间'
  },
  allowed_formats: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: ['pdf', 'doc', 'docx', 'jpg', 'png', 'zip'],
    comment: '允许的文件格式扩展名数组'
  },
  max_files: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 5,
    comment: '最多可上传文件数'
  },
  max_size_mb: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 100,
    comment: '单个文件最大体积(MB)'
  },
  status: {
    type: DataTypes.ENUM('active', 'closed'),
    allowNull: false,
    defaultValue: 'active',
    comment: '作业状态'
  },
  sample_files: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: null,
    comment: '提交样例文件列表 [{name, type, url}]'
  },
  need_grading: {
    type: DataTypes.TINYINT,
    allowNull: false,
    defaultValue: 0,
    comment: '是否需要批改：0不需要(提交即通过) 1需要(待批改)'
  },
  enable_plagiarism: {
    type: DataTypes.TINYINT,
    allowNull: false,
    defaultValue: 0,
    comment: '是否启用查重检测：0关闭 1开启'
  }
}, {
  tableName: 'assignments'
});

module.exports = Assignment;
