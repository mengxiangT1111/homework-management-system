const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * 上传文件归属记录
 * 背景：此前提交作业只校验 file_path 在 uploads 内且存在，不校验是谁传的，
 * 拿到他人 file_path 即可"冒绑"他人文件并获得合法下载权。
 * 现在所有上传出口（分片合并/直传/小程序直传）落库 user_id + file_path，
 * 提交绑定时校验该文件确属当前用户上传。
 */
const UploadRecord = sequelize.define('UploadRecord', {
  id: {
    type: DataTypes.INTEGER.UNSIGNED,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '上传者用户ID'
  },
  file_path: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: '存储相对路径（uploads/xxx 或 cos://homeworks/xxx）'
  },
  original_name: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: '原始文件名'
  },
  file_size: {
    type: DataTypes.BIGINT,
    allowNull: true,
    comment: '文件字节数'
  }
}, {
  tableName: 'upload_records',
  indexes: [
    { unique: true, fields: ['user_id', 'file_path'] },
    { fields: ['file_path'] }
  ]
});

module.exports = UploadRecord;
