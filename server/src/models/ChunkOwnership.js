/**
 * 分片持有记录（P2-6 防秒传认领）
 * 记录「哪个用户真实上传过哪个文件 hash 的分片」，merge 时作为内容持有证明。
 * 持久化于数据库：服务重启后断点续传（磁盘残留分片）仍能通过校验，
 * 而从未上传过该文件的用户依然无法仅凭 MD5 认领他人文件。
 */
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ChunkOwnership = sequelize.define('ChunkOwnership', {
  user_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '上传分片的用户'
  },
  file_hash: {
    type: DataTypes.CHAR(32),
    allowNull: false,
    comment: '文件 MD5（分片所属文件）'
  },
  last_seen: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    comment: '最近一次分片上传时间（过期由 fileCleaner 清理）'
  }
}, {
  tableName: 'chunk_ownerships',
  timestamps: false,
  indexes: [
    { unique: true, fields: ['user_id', 'file_hash'] },
    { fields: ['last_seen'] }
  ]
});

module.exports = ChunkOwnership;
