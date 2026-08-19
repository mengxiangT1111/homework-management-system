/**
 * 腾讯云 COS 客户端
 */
const COS = require('cos-nodejs-sdk-v5');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const cosConfig = {
  SecretId: process.env.COS_SECRET_ID,
  SecretKey: process.env.COS_SECRET_KEY,
  Bucket: process.env.COS_BUCKET || 'mengxiang-1405756754',
  Region: process.env.COS_REGION || 'ap-beijing'
};

// 检查是否配置了有效密钥（未配置时降级为本地存储）
const isCOSConfigured = cosConfig.SecretId &&
  cosConfig.SecretKey &&
  !cosConfig.SecretId.includes('在这里填') &&
  !cosConfig.SecretKey.includes('在这里填');

const cosClient = new COS({
  SecretId: cosConfig.SecretId,
  SecretKey: cosConfig.SecretKey
});

/**
 * 上传本地文件到 COS
 * @param {string} localFilePath 本地文件绝对路径
 * @param {string} key COS 对象键（如 homeworks/202607/xxx.pdf）
 * @returns {Promise<string>} COS Key
 */
function uploadToCOS(localFilePath, key) {
  return new Promise((resolve, reject) => {
    cosClient.sliceUploadFile({
      Bucket: cosConfig.Bucket,
      Region: cosConfig.Region,
      Key: key,
      FilePath: localFilePath
    }, (err, data) => {
      if (err) return reject(err);
      resolve(key);
    });
  });
}

/**
 * 获取 COS 文件的访问 URL
 * 公共读桶直接返回 URL；私有桶用签名 URL
 * @param {string} key COS 对象键
 * @param {number} expires 签名有效期（秒），仅私有桶生效
 */
function getCOSUrl(key, expires = 3600) {
  // 公共读桶直接返回固定 URL
  return `https://${cosConfig.Bucket}.cos.${cosConfig.Region}.myqcloud.com/${key}`;
}

/**
 * 获取 COS 文件的临时签名 URL（私有读桶用）
 */
function getSignedCOSUrl(key, expires = 3600) {
  const url = cosClient.getObjectUrl({
    Bucket: cosConfig.Bucket,
    Region: cosConfig.Region,
    Key: key,
    Sign: true,
    Expires: expires
  });
  return typeof url === 'string' ? url : url.Url;
}

/**
 * 删除 COS 上的文件
 */
function deleteFromCOS(key) {
  return new Promise((resolve, reject) => {
    cosClient.deleteObject({
      Bucket: cosConfig.Bucket,
      Region: cosConfig.Region,
      Key: key
    }, (err, data) => {
      if (err) return reject(err);
      resolve(true);
    });
  });
}

/**
 * 批量删除 COS 上的文件
 */
function deleteMultipleFromCOS(keys) {
  return new Promise((resolve, reject) => {
    cosClient.deleteMultipleObject({
      Bucket: cosConfig.Bucket,
      Region: cosConfig.Region,
      Objects: keys.map(k => ({ Key: k }))
    }, (err, data) => {
      if (err) return reject(err);
      resolve(true);
    });
  });
}

/**
 * 下载 COS 文件到本地（用于打包 zip 等）
 * 使用官方 downloadFile 分块下载，回调时文件已完整写入
 */
function downloadFromCOS(key, localPath) {
  return new Promise((resolve, reject) => {
    cosClient.downloadFile({
      Bucket: cosConfig.Bucket,
      Region: cosConfig.Region,
      Key: key,
      FilePath: localPath,
      ChunkSize: 1024 * 1024 * 5
    }, (err, data) => {
      if (err) return reject(err);
      resolve(localPath);
    });
  });
}

module.exports = {
  cosClient,
  cosConfig,
  isCOSConfigured,
  uploadToCOS,
  getCOSUrl,
  getSignedCOSUrl,
  deleteFromCOS,
  deleteMultipleFromCOS,
  downloadFromCOS
};
