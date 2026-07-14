/**
 * 过期文件清理工具
 * 管理员可调用，清理截止时间超过 N 天的作业关联的物理文件
 */
const fs = require('fs');
const path = require('path');
const { Assignment, Submission, SubmissionFile } = require('../models');

/**
 * 清理过期文件
 * @param {number} retainDays 截止后保留天数
 * @returns {Object} { cleanedCount, totalSize, details }
 */
async function cleanExpiredFiles(retainDays = 30) {
  const retain = Number(retainDays) || 30;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retain);

  // 查找截止时间已超过保留期的作业
  const expiredAssignments = await Assignment.findAll({
    where: {
      deadline: { [require('sequelize').Op.lt]: cutoffDate }
    },
    attributes: ['id', 'title', 'deadline']
  });

  const assignmentIds = expiredAssignments.map(a => a.id);
  let cleanedCount = 0;
  let totalSize = 0;
  const details = [];

  if (assignmentIds.length === 0) {
    return { cleanedCount: 0, totalSize: 0, details: [], scannedAssignments: 0 };
  }

  // 查找这些作业下的所有文件
  const files = await SubmissionFile.findAll({
    include: [{
      model: Submission,
      as: 'submission',
      where: { assignment_id: assignmentIds },
      required: true
    }]
  });

  for (const file of files) {
    const absPath = path.join(__dirname, '../../', file.file_path);
    try {
      if (fs.existsSync(absPath)) {
        const stat = fs.statSync(absPath);
        totalSize += stat.size;
        fs.unlinkSync(absPath);
        cleanedCount++;
      }
    } catch (e) {
      // 单个文件删除失败不影响整体
      details.push({ file: file.original_name, error: e.message });
    }
  }

  return {
    cleanedCount,
    totalSize,
    sizeFormatted: formatBytes(totalSize),
    scannedAssignments: assignmentIds.length,
    details
  };
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = { cleanExpiredFiles, formatBytes };
