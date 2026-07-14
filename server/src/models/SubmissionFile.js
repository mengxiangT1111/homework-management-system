const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const SubmissionFile = sequelize.define('SubmissionFile', {
  id: {
    type: DataTypes.INTEGER.UNSIGNED,
    primaryKey: true,
    autoIncrement: true
  },
  submission_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '所属提交记录ID'
  },
  original_name: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: '原始文件名'
  },
  file_path: {
    type: DataTypes.STRING(500),
    allowNull: false,
    comment: '服务器存储路径'
  },
  file_size: {
    type: DataTypes.BIGINT,
    allowNull: false,
    comment: '文件大小(字节)'
  },
  mime_type: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: 'MIME类型'
  },
  file_hash: {
    type: DataTypes.STRING(64),
    allowNull: true,
    comment: '文件MD5哈希，用于秒传校验'
  }
}, {
  tableName: 'submission_files'
});

module.exports = SubmissionFile;
