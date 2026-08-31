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

// multer/busboy 按 latin1 解码 multipart 文件名，中文会变成 mojibake；
// 重新按 utf8 解读一次。纯 ASCII 名往返不变；含无法还原字节时保持原值。
function fixMojibakeName(name) {
  if (!name) return name;
  const fixed = Buffer.from(name, 'latin1').toString('utf8');
  return fixed.includes('\uFFFD') ? name : fixed;
}

// 危险扩展名黑名单（禁止上传）
const DANGEROUS_EXTS = ['.html', '.htm', '.svg', '.js', '.exe', '.bat', '.cmd', '.sh', '.php', '.asp', '.aspx', '.jsp', '.war'];

// 文件大小限制（500MB）
const MAX_FILE_SIZE = 500 * 1024 * 1024;
// 单片 5MB，分片总数/序号上限据此推算（防伪造 total 无限传分片塞满磁盘）
const CHUNK_SIZE = 5 * 1024 * 1024;
const MAX_CHUNK_INDEX = Math.ceil(MAX_FILE_SIZE / CHUNK_SIZE) + 1;

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
      if (index > MAX_CHUNK_INDEX) {
        return fail(res, `分片序号超出上限（文件最大 ${MAX_FILE_SIZE / 1024 / 1024}MB）`, 422);
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
    if (totalNum > MAX_CHUNK_INDEX) {
      return fail(res, `分片总数超出上限（文件最大 ${MAX_FILE_SIZE / 1024 / 1024}MB）`, 422);
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
    let mergedSize = null; // 本次合并得到的磁盘真实大小（秒传路径为 null，下面 statSync 兜底）

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

      // 先写唯一临时名再原子改名：并发合并同一 hash 时两个请求写各自临时文件，
      // 互不干扰，也不会误删对方已完成的产物（原先两个流写同一路径会字节交错）
      const tmpPath = `${mergedPath}.${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.tmp`;
      const writeStream = fs.createWriteStream(tmpPath);
      for (let i = 0; i < totalNum; i++) {
        const chunkFile = path.join(chunkDir, `${hash}_${i}`);
        if (!fs.existsSync(chunkFile)) {
          writeStream.end();
          fs.promises.unlink(tmpPath).catch(() => {});
          return fail(res, `分片 ${i} 缺失，请续传`, 422);
        }
        const buf = fs.readFileSync(chunkFile);
        // 处理写缓冲背压：磁盘写入慢于读取时等待 drain，避免整个文件积压内存
        if (!writeStream.write(buf)) {
          await new Promise(resolve => writeStream.once('drain', resolve));
        }
      }
      writeStream.end();
      await new Promise((resolve) => writeStream.on('finish', resolve));

      // 校验合并后的文件 hash 是否与前端传入一致（防篡改）
      // 流式计算，避免大文件（上限 500MB）整体读入内存
      const actualHash = await new Promise((resolve, reject) => {
        const digest = crypto.createHash('md5');
        const rs = fs.createReadStream(tmpPath);
        rs.on('data', chunk => digest.update(chunk));
        rs.on('end', () => resolve(digest.digest('hex')));
        rs.on('error', reject);
      });
      if (actualHash !== hash) {
        fs.unlinkSync(tmpPath);
        return fail(res, '文件校验失败，请重新上传', 422);
      }

      // 以磁盘真实大小为准复核上限：body 里的 size 是客户端自报的，可伪造绕过
      const realSize = fs.statSync(tmpPath).size;
      if (realSize > MAX_FILE_SIZE) {
        fs.unlinkSync(tmpPath);
        return fail(res, `文件大小超出限制（最大 ${MAX_FILE_SIZE / 1024 / 1024}MB）`, 422);
      }
      mergedSize = realSize;

      // 原子落位；目标已存在（并发方先完成，内容同 hash 必一致）时保留现有文件
      try {
        fs.renameSync(tmpPath, mergedPath);
        // 合并完成，清理分片目录（仅由落位成功方清理）
        try {
          fs.rmSync(chunkDir, { recursive: true, force: true });
        } catch (e) { /* ignore */ }
      } catch (e) {
        fs.promises.unlink(tmpPath).catch(() => {});
      }
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
      file_size: mergedSize || fs.statSync(mergedPath).size,
      mime_type: String(mime_type || 'application/octet-stream').slice(0, 100),
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
      
      const originalName = fixMojibakeName(req.file.originalname);
      // 校验文件扩展名安全性
      if (!isExtSafe(originalName)) {
        // 删除已上传的文件（Windows 下可能被占用，删除失败不阻断响应）
        fs.promises.unlink(req.file.path).catch(() => {});
        return fail(res, `不支持的文件格式，禁止上传可执行或脚本文件`, 422);
      }

      // 存库路径与 mergeChunks 同规则：UPLOAD_DIR 前缀 + 年月子目录 + 文件名。
      // 不能用正则从绝对路径里截 "uploads"（贪婪匹配遇多级 uploads 目录会截错，
      // 自定义 UPLOAD_DIR 目录名时正则不匹配会把服务器绝对路径存进数据库）
      const finalName = path.basename(req.file.path);
      const monthDir = path.basename(path.dirname(req.file.path));
      const relativePath = path.join(process.env.UPLOAD_DIR || 'uploads', monthDir, finalName).replace(/\\/g, '/');
      return success(res, {
        original_name: originalName,
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

// 小程序端单文件直传（uni.uploadFile 一次传完整文件，替代 Web 端分片链路）。
// 落盘/COS 降级规则与 mergeChunks 一致，返回结构与 merge 一致，
// 供小程序提交接口直接组装 files 数组（file_hash 恒为 null，小程序不做全量 MD5）。
const mpSingleStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const now = new Date();
    const monthDir = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const dir = path.join(UPLOAD_DIR, monthDir);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '');
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 10)}${ext}`);
  }
});

const mpSingleUpload = multer({
  storage: mpSingleStorage,
  limits: { fileSize: 100 * 1024 * 1024 }
});

exports.singleUpload = [
  mpSingleUpload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) return fail(res, '未接收到文件', 422);

      // 真实文件名优先取 formData.filename（chooseMedia 的 originalname 常是临时路径名）；
      // multer 按 latin1 解码 multipart 文件名会乱码，统一 fixMojibakeName。
      const rawName = fixMojibakeName(req.body.filename || req.file.originalname) || 'unnamed';
      const originalName = path.basename(String(rawName)).replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 255) || 'unnamed';

      let ext = path.extname(originalName).toLowerCase();
      if (!ext) ext = path.extname(req.file.originalname || '').toLowerCase();
      if (!ext || DANGEROUS_EXTS.includes(ext)) {
        fs.promises.unlink(req.file.path).catch(() => {});
        return fail(res, ext ? `不支持的文件格式：${ext}，禁止上传可执行或脚本文件` : '无法识别文件扩展名，禁止上传', 422);
      }

      const finalName = path.basename(req.file.path);
      const monthDir = path.basename(path.dirname(req.file.path));
      let relativePath;

      if (isCOSConfigured) {
        const cosKey = `homeworks/${monthDir}/${finalName}`;
        try {
          await uploadToCOS(req.file.path, cosKey);
          relativePath = `cos://${cosKey}`;
          // COS 已接管存储，本地临时副本清理（删除失败不阻断响应）
          fs.promises.unlink(req.file.path).catch(() => {});
        } catch (cosErr) {
          console.error('[COS 上传失败，降级本地存储]', cosErr.message);
          relativePath = path.join(process.env.UPLOAD_DIR || 'uploads', monthDir, finalName).replace(/\\/g, '/');
        }
      } else {
        relativePath = path.join(process.env.UPLOAD_DIR || 'uploads', monthDir, finalName).replace(/\\/g, '/');
      }

      return success(res, {
        original_name: originalName,
        file_path: relativePath,
        file_size: req.file.size,
        mime_type: String(req.file.mimetype || 'application/octet-stream').slice(0, 100),
        file_hash: null,
        ext: ext.replace('.', '')
      }, '上传成功');
    } catch (err) {
      next(err);
    }
  }
];
