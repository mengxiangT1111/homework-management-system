/**
 * 分片上传控制器
 * 流程：前端计算文件 hash → 检查已传分片(秒传/断点续传) → 逐片上传 → 合并
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { success, fail } = require('../utils/response');
const { isCOSConfigured, uploadToCOS } = require('../config/cos');

const UPLOAD_DIR = path.join(__dirname, '../../', process.env.UPLOAD_DIR || 'uploads');
const CHUNK_DIR = path.join(UPLOAD_DIR, 'chunks');
const MERGED_DIR = path.join(UPLOAD_DIR, 'merged');

// 危险扩展名黑名单（禁止上传）
const DANGEROUS_EXTS = ['.html', '.htm', '.svg', '.js', '.exe', '.bat', '.cmd', '.sh', '.php', '.asp', '.aspx', '.jsp', '.war'];

// 文件大小限制（500MB）
const MAX_FILE_SIZE = 500 * 1024 * 1024;

// 确保目录存在
[UPLOAD_DIR, CHUNK_DIR, MERGED_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

/**
 * 校验扩展名是否安全
 */
function isExtSafe(filename) {
  const ext = path.extname(filename).toLowerCase();
  return !DANGEROUS_EXTS.includes(ext);
}

/**
 * 校验 hash 是否为有效的 MD5 hex 字符串（防止路径穿越）
 */
function isValidHash(hash) {
  return /^[a-f0-9]{32}$/.test(hash);
}

/**
 * 校验路径是否在目标目录内（防止路径穿越）
 */
function isPathContained(targetDir, ...parts) {
  const resolvedTarget = path.resolve(targetDir);
  const resolved = path.resolve(path.join(targetDir, ...parts));
  return resolved === resolvedTarget || resolved.startsWith(resolvedTarget + path.sep);
}

// 分片存储配置
// 注意：multer 的 destination 执行时 req.body 还未解析，
// 所以 hash/index 必须通过 URL query 传入（req.query 在 multer 之前就可获取）
const chunkStorage = multer.diskStorage({
  destination: (req, res, cb) => {
    const hash = req.query.hash;
    // 校验 hash 格式防止路径穿越
    if (!hash || !isValidHash(hash)) {
      return cb(new Error('无效的文件标识'));
    }
    const dir = path.join(CHUNK_DIR, hash);
    // 双重校验：确保路径在 CHUNK_DIR 内
    if (!isPathContained(CHUNK_DIR, hash)) {
      return cb(new Error('非法路径'));
    }
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const hash = req.query.hash;
    const index = Number(req.query.index);
    // index 参与拼文件名，必须是合法非负整数，防止携带路径分隔符做目录穿越
    if (!isValidHash(hash) || !Number.isInteger(index) || index < 0) {
      return cb(new Error('无效的文件标识或分片序号'));
    }
    cb(null, `${hash}_${index}`);
  }
});

const upload = multer({
  storage: chunkStorage,
  limits: { fileSize: 5 * 1024 * 1024 } // 单片最大 5MB
});

// 上传单个分片
exports.uploadChunk = [
  upload.single('chunk'),
  async (req, res, next) => {
    try {
      const hash = req.query.hash;
      const index = Number(req.query.index);
      if (!isValidHash(hash)) {
        return fail(res, '无效的文件标识 hash', 422);
      }
      if (!Number.isInteger(index) || index < 0) {
        return fail(res, '无效的分片序号 index', 422);
      }
      return success(res, { hash, index }, `分片 ${index} 上传成功`);
    } catch (err) {
      next(err);
    }
  }
];

// 检查已上传的分片（断点续传）
exports.checkChunks = async (req, res, next) => {
  try {
    const { hash } = req.query;
    if (!hash) return fail(res, '缺少文件 hash', 422);
    
    // 校验 hash 格式防止路径穿越
    if (!isValidHash(hash)) {
      return fail(res, '无效的文件标识', 422);
    }

    const dir = path.join(CHUNK_DIR, hash);
    // 双重校验：确保路径在 CHUNK_DIR 内
    if (!isPathContained(CHUNK_DIR, hash)) {
      return fail(res, '非法路径', 403);
    }
    
    let uploaded = [];
    if (fs.existsSync(dir)) {
      uploaded = fs.readdirSync(dir).map(f => {
        const m = f.match(/_(\d+)$/);
        return m ? Number(m[1]) : null;
      }).filter(v => v !== null);
    }

    // 检查是否已合并过（秒传）
    const mergedPath = path.join(MERGED_DIR, hash);
    let mergedFile = null;
    if (fs.existsSync(mergedPath)) {
      // 看是否有对应文件记录
      mergedFile = true;
    }

    return success(res, {
      hash,
      uploaded_chunks: uploaded,
      file_exists: !!mergedFile
    }, '检查成功');
  } catch (err) {
    next(err);
  }
};

// 合并分片
exports.mergeChunks = async (req, res, next) => {
  try {
    const { hash, filename, total, mime_type, size } = req.body;
    if (!hash || !filename || !total) {
      return fail(res, '缺少必要参数 hash/filename/total', 422);
    }
    const totalNum = Number(total);
    if (!Number.isInteger(totalNum) || totalNum < 1) {
      return fail(res, '分片总数参数非法', 422);
    }

    // 校验 hash 格式防止路径穿越
    if (!isValidHash(hash)) {
      return fail(res, '无效的文件标识', 422);
    }

    // 校验文件扩展名安全性
    if (!isExtSafe(filename)) {
      return fail(res, `不支持的文件格式：${path.extname(filename)}，禁止上传可执行或脚本文件`, 422);
    }

    // 校验文件总大小
    const fileSize = Number(size) || 0;
    if (fileSize > MAX_FILE_SIZE) {
      return fail(res, `文件大小超出限制（最大 ${MAX_FILE_SIZE / 1024 / 1024}MB）`, 422);
    }

    const ext = path.extname(filename).toLowerCase();
    const mergedPath = path.join(MERGED_DIR, hash);
    const chunkDir = path.join(CHUNK_DIR, hash);

    // 双重校验：确保路径在目标目录内
    if (!isPathContained(MERGED_DIR, hash) || !isPathContained(CHUNK_DIR, hash)) {
      return fail(res, '非法路径', 403);
    }

    // 已合并过则直接返回
    if (!fs.existsSync(mergedPath)) {
      if (!fs.existsSync(chunkDir)) {
        return fail(res, '分片数据不存在，请重新上传', 422);
      }

      // 按序合并
      const files = fs.readdirSync(chunkDir);
      if (files.length < totalNum) {
        return fail(res, `分片不完整（${files.length}/${totalNum}），请续传缺失分片`, 422);
      }

      const writeStream = fs.createWriteStream(mergedPath);
      for (let i = 0; i < totalNum; i++) {
        const chunkFile = path.join(chunkDir, `${hash}_${i}`);
        if (!fs.existsSync(chunkFile)) {
          writeStream.end();
          return fail(res, `分片 ${i} 缺失，请续传`, 422);
        }
        const buf = fs.readFileSync(chunkFile);
        writeStream.write(buf);
      }
      writeStream.end();
      await new Promise((resolve) => writeStream.on('finish', resolve));

      // 校验合并后的文件 hash 是否与前端传入一致（防篡改）
      // 流式计算，避免大文件（上限 500MB）整体读入内存
      const actualHash = await new Promise((resolve, reject) => {
        const digest = crypto.createHash('md5');
        const rs = fs.createReadStream(mergedPath);
        rs.on('data', chunk => digest.update(chunk));
        rs.on('end', () => resolve(digest.digest('hex')));
        rs.on('error', reject);
      });
      if (actualHash !== hash) {
        fs.unlinkSync(mergedPath);
        return fail(res, '文件校验失败，请重新上传', 422);
      }

      // 合并完成，清理分片目录
      try {
        fs.rmSync(chunkDir, { recursive: true, force: true });
      } catch (e) { /* ignore */ }
    }

    // 生成最终存储路径（按年月分目录），保留原扩展名
    const now = new Date();
    const monthDir = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

    const finalName = `${hash}_${Date.now()}${ext}`;
    const cosKey = `homeworks/${monthDir}/${finalName}`;

    let relativePath;

    if (isCOSConfigured) {
      // 上传到腾讯云 COS
      try {
        await uploadToCOS(mergedPath, cosKey);
        relativePath = `cos://${cosKey}`;
      } catch (cosErr) {
        console.error('[COS 上传失败，降级本地存储]', cosErr.message);
        const finalDir = path.join(UPLOAD_DIR, monthDir);
        if (!fs.existsSync(finalDir)) fs.mkdirSync(finalDir, { recursive: true });
        fs.copyFileSync(mergedPath, path.join(finalDir, finalName));
        relativePath = path.join(process.env.UPLOAD_DIR || 'uploads', monthDir, finalName).replace(/\\/g, '/');
      }
    } else {
      // 未配置 COS，存本地
      const finalDir = path.join(UPLOAD_DIR, monthDir);
      if (!fs.existsSync(finalDir)) fs.mkdirSync(finalDir, { recursive: true });
      fs.copyFileSync(mergedPath, path.join(finalDir, finalName));
      relativePath = path.join(process.env.UPLOAD_DIR || 'uploads', monthDir, finalName).replace(/\\/g, '/');
    }

    return success(res, {
      original_name: filename,
      file_path: relativePath,
      file_size: size || fs.statSync(mergedPath).size,
      mime_type: mime_type || 'application/octet-stream',
      file_hash: hash,
      ext: ext.replace('.', '')
    }, '文件合并成功');
  } catch (err) {
    next(err);
  }
};

// 普通小文件直接上传（非分片，备选方案）
const simpleStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const now = new Date();
    const monthDir = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const dir = path.join(UPLOAD_DIR, monthDir);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 10)}${ext}`);
  }
});

const simpleUpload = multer({
  storage: simpleStorage,
  limits: { fileSize: 20 * 1024 * 1024 }
});

exports.simpleUpload = [
  simpleUpload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) return fail(res, '未接收到文件', 422);
      
      // 校验文件扩展名安全性
      if (!isExtSafe(req.file.originalname)) {
        // 删除已上传的文件（Windows 下可能被占用，删除失败不阻断响应）
        fs.promises.unlink(req.file.path).catch(() => {});
        return fail(res, `不支持的文件格式，禁止上传可执行或脚本文件`, 422);
      }
      
      const relativePath = req.file.path.replace(/\\/g, '/').replace(/^.*uploads/, 'uploads');
      return success(res, {
        original_name: req.file.originalname,
        file_path: relativePath,
        file_size: req.file.size,
        mime_type: req.file.mimetype,
        ext: path.extname(req.file.originalname).replace('.', '')
      }, '上传成功');
    } catch (err) {
      next(err);
    }
  }
];
