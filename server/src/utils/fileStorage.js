/**
 * COS 文件访问辅助
 * 数据库中文件路径两种格式：
 *   1. cos://homeworks/202607/xxx.pdf  → 腾讯云COS对象
 *   2. uploads/202607/xxx.pdf          → 本地存储
 */
const { isCOSConfigured, getCOSUrl, getSignedCOSUrl, downloadFromCOS } = require('../config/cos');
const path = require('path');
const fs = require('fs');
const os = require('os');

const COS_PREFIX = 'cos://';

// 判断是否是 COS 路径
function isCOSPath(filePath) {
  return typeof filePath === 'string' && filePath.startsWith(COS_PREFIX);
}

// 提取 COS Key
function extractCOSKey(filePath) {
  return filePath.substring(COS_PREFIX.length);
}

/**
 * 获取文件的可访问 URL（前端预览用）
 */
function resolveFileUrl(filePath) {
  if (isCOSPath(filePath)) {
    if (!isCOSConfigured) return null;
    return getCOSUrl(extractCOSKey(filePath));
  }
  // 本地文件走后端静态服务
  return '/' + filePath;
}

/**
 * 获取文件的本地绝对路径
 * COS 文件会先下载到临时目录
 * @returns {Promise<string>} 本地文件绝对路径
 */
async function ensureLocalFile(filePath) {
  if (!isCOSPath(filePath)) {
    // 本地文件
    let relativePath = filePath;
    if (relativePath.startsWith('uploads/') || relativePath.startsWith('uploads\\')) {
      relativePath = relativePath.substring(8);
    }
    const abs = path.join(__dirname, '../../', process.env.UPLOAD_DIR || 'uploads', relativePath);
    if (!fs.existsSync(abs)) throw new Error('本地文件不存在');
    return abs;
  }
  // COS 文件：下载到临时目录
  const key = extractCOSKey(filePath);
  const filename = path.basename(key);
  const tmpPath = path.join(os.tmpdir(), `cos_${Date.now()}_${filename}`);
  await downloadFromCOS(key, tmpPath);
  return tmpPath;
}

/**
 * 文件 URL 解析与授权下载接口已迁移至 controllers/fileController.js
 * （统一按提交/样例归属做授权，COS 走短时效签名 URL）
 */

module.exports.helpers = { isCOSPath, extractCOSKey, resolveFileUrl, ensureLocalFile };
