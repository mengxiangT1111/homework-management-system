/**
 * 过期文件清理工具（支持本地 + 腾讯云COS）
 * 管理员可调用，清理截止时间超过 N 天的作业关联的物理文件
 */
const fs = require('fs');
const path = require('path');
const { Assignment, Submission, SubmissionFile } = require('../models');
const { isCOSPath, extractCOSKey } = require('./fileStorage').helpers;
const { isCOSConfigured, deleteFromCOS } = require('../config/cos');

/**
 * 清理过期文件
 * @param {number} retainDays 截止后保留天数
 * @returns {Object} { cleanedCount, totalSize, sizeFormatted, scannedAssignments, details }
 */
async function cleanExpiredFiles(retainDays = 30) {
  const retain = Number(retainDays) || 30;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retain);

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
    return { cleanedCount: 0, totalSize: 0, sizeFormatted: '0 B', scannedAssignments: 0, details: [] };
  }

  // 只处理未清理过的文件，重复执行不会重复统计
  const files = await SubmissionFile.findAll({
    where: { is_cleaned: 0 },
    include: [{
      model: Submission,
      as: 'submission',
      where: { assignment_id: assignmentIds },
      required: true
    }]
  });

  for (const file of files) {
    try {
      if (isCOSPath(file.file_path) && isCOSConfigured) {
        // 删除 COS 对象并标记已清理
        totalSize += Number(file.file_size) || 0;
        await deleteFromCOS(extractCOSKey(file.file_path));
        await file.update({ is_cleaned: 1 });
        cleanedCount++;
      } else {
        // 删除本地文件（file_path 形如 uploads/202607/xxx.pdf，统一走 UPLOAD_DIR 配置）
        let relPath = file.file_path;
        if (relPath.startsWith('uploads/') || relPath.startsWith('uploads\\')) {
          relPath = relPath.substring(8);
        }
        const absPath = path.join(__dirname, '../../', process.env.UPLOAD_DIR || 'uploads', relPath);
        if (fs.existsSync(absPath)) {
          const stat = fs.statSync(absPath);
          totalSize += stat.size;
          fs.unlinkSync(absPath);
          cleanedCount++;
        }
        // 物理文件已不存在（历史清理/手动删除）也标记为已清理，记录保留供前端展示
        await file.update({ is_cleaned: 1 });
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

/**
 * 清理废弃的分片目录（用户中途放弃上传后 chunks/<hash>/ 会永久残留，磁盘会被慢慢吃满）
 * @param {number} maxAgeHours 分片最后修改时间超过该小时数即删除
 * @returns {number} 清理的文件数
 */
async function cleanAbandonedChunks(maxAgeHours = 48) {
  const chunksDir = path.join(__dirname, '../../', process.env.UPLOAD_DIR || 'uploads', 'chunks');
  if (!fs.existsSync(chunksDir)) return 0;
  const cutoff = Date.now() - Number(maxAgeHours) * 60 * 60 * 1000;
  let cleaned = 0;
  for (const hashDir of fs.readdirSync(chunksDir)) {
    const dir = path.join(chunksDir, hashDir);
    let stat;
    try {
      stat = fs.statSync(dir);
    } catch (e) {
      continue;
    }
    if (!stat.isDirectory()) continue;
    if (stat.mtimeMs < cutoff) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        cleaned++;
      } catch (e) { /* 单个目录失败不影响整体 */ }
    }
  }
  return cleaned;
}

module.exports = { cleanExpiredFiles, cleanAbandonedChunks, formatBytes };
