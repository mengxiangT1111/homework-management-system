const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * 查重结果模型
 * 存储作业查重检测结果
 */
const PlagiarismResult = sequelize.define('PlagiarismResult', {
  id: {
    type: DataTypes.INTEGER.UNSIGNED,
    primaryKey: true,
    autoIncrement: true
  },
  assignment_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '作业ID'
  },
  submission_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '被检测的提交ID'
  },
  compared_with_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    comment: '对比对象提交ID'
  },
  similarity_score: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    defaultValue: 0.00,
    comment: '综合相似度评分 (0-100)'
  },
  image_hash_score: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    defaultValue: 0.00,
    comment: '感知哈希相似度'
  },
  graph_similarity: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    defaultValue: 0.00,
    comment: '图结构相似度'
  },
  text_similarity: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    defaultValue: 0.00,
    comment: '文本(OCR标签)相似度'
  },
  orb_match_count: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: 'ORB特征匹配点数'
  },
  is_isomorphic: {
    type: DataTypes.TINYINT,
    allowNull: false,
    defaultValue: 0,
    comment: '是否图同构：0否 1是'
  },
  is_suspicious: {
    type: DataTypes.TINYINT,
    allowNull: false,
    defaultValue: 0,
    comment: '是否可疑：0否 1是'
  },
  details: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: '详细信息：节点列表、匹配结果等'
  },
  status: {
    type: DataTypes.ENUM('pending', 'processing', 'done', 'error'),
    allowNull: false,
    defaultValue: 'pending',
    comment: '检测状态'
  },
  error_message: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: '错误信息'
  },
  checked_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '检测完成时间'
  }
}, {
  tableName: 'plagiarism_results',
  indexes: [
    { fields: ['assignment_id'] },
    { fields: ['submission_id'] },
    { fields: ['compared_with_id'] },
    { 
      name: 'uk_submission_compare',
      unique: true,
      fields: ['submission_id', 'compared_with_id']
    }
  ]
});

module.exports = PlagiarismResult;