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
const { UploadRecord, ChunkOwnership } = require('../models');

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
// 覆盖：可被浏览器当页面/脚本渲染的类型（xhtml/shtml/xml/mjs/cjs/pht 等，配合
// 下载侧 nosniff+attachment 双重防线）、服务端脚本（php/jsp 等）、Windows 可执行与
// 脚本（exe/bat/vbs/ps1/lnk 等）。.svg 自带脚本执行面，同样拒绝。
const DANGEROUS_EXTS = [
  // 浏览器可渲染/可执行脚本的文档类型
  '.html', '.htm', '.xhtml', '.xht', '.shtml', '.svg', '.xml', '.xsl', '.xslt', '.mht',
  // 前后端脚本
  '.js', '.mjs', '.cjs', '.ts',
  // 服务端脚本（若静态目录被误挂到带解析的服务器上会变 RCE）
  '.php', '.phtml', '.pht', '.phps', '.asp', '.aspx', '.asa', '.cer', '.jsp', '.jspx', '.war', '.cgi',
  // Windows 可执行/脚本/快捷方式
  '.exe', '.com', '.bat', '.cmd', '.ps1', '.psm1', '.vbs', '.vbe', '.jse', '.wsf', '.wsh', '.scr', '.cpl', '.msi', '.hta', '.lnk', '.pif', '.reg',
  // Shell 脚本与其他可执行容器
  '.sh', '.bash', '.zsh', '.jar', '.dll', '.so', '.bin', '.elf'
];

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

// ===== S14：每用户并发分片 hash 数上限（防磁盘填充 DoS） =====
// 任意登录用户原本可对无限个 hash 各写分片塞满磁盘；现限制单用户同时进行中的
// 分片上传（不同 hash）不超过 10 个。进程内存计数，重启清零（仅损失计数，不损失数据）。
const MAX_ACTIVE_HASHES_PER_USER = 10;
const activeHashes = new Map(); // userId -> Map(hash -> lastSeen)
const ACTIVE_HASH_TTL = 2 * 60 * 60 * 1000; // 2 小时无活动视为放弃

function touchActiveHash(userId, hash) {
  const until = Date.now() + ACTIVE_HASH_TTL;
  let m = activeHashes.get(userId);
  if (!m) { m = new Map(); activeHashes.set(userId, m); }
  if (!m.has(hash) && m.size >= MAX_ACTIVE_HASHES_PER_USER) {
    // 先淘汰过期项再判定超限
    sweepInactiveHashes();
    if (m.size >= MAX_ACTIVE_HASHES_PER_USER) return false;
  }
  m.set(hash, until);
  return true;
}

function releaseActiveHash(userId, hash) {
  const m = activeHashes.get(userId);
  if (m) { m.delete(hash); if (m.size === 0) activeHashes.delete(userId); }
}

function sweepInactiveHashes() {
  const now = Date.now();
  for (const [userId, m] of activeHashes) {
    for (const [hash, until] of m) {
      if (until < now) m.delete(hash);
    }
    if (m.size === 0) activeHashes.delete(userId);
  }
  // 同步清理过期的分片持有记录
  for (const [key, seen] of chunkUploader) {
    if (seen + ACTIVE_HASH_TTL < now) chunkUploader.delete(key);
  }
}
// 定期清扫（不阻断进程退出）
setInterval(sweepInactiveHashes, 30 * 60 * 1000).unref();

// 「分片持有证明」：记录哪个用户真实上传过哪个 hash 的分片。
// merge 必须核对本人持有分片，不能只依赖磁盘分片内容——分片目录删除在
// Windows/OneDrive 等环境会静默失败（实测 rmSync 报成功但目录仍在），
// 且并发窗口内他人分片残留磁盘，仅凭内容校验无法证明请求者持有文件。
// 双层存储：内存 Map（快路径）+ chunk_ownerships 表（重启后断点续传仍可识别本人）。
const chunkUploader = new Map(); // `${userId}:${hash}` -> lastSeen(ms)

/** 分片上传成功后记录持有（内存 + 数据库；DB 失败不阻断上传，merge 时会兜底要求重传） */
function recordChunkOwnership(userId, hash) {
  const key = `${userId}:${hash}`;
  chunkUploader.set(key, Date.now());
  ChunkOwnership.upsert({ user_id: userId, file_hash: hash, last_seen: new Date() })
    .catch(e => console.warn('[分片持有记录写入失败]', e.message));
}

/** 持有校验：本人曾上传过该 hash 的至少一个分片 */
async function ownsChunksOf(userId, hash) {
  if (chunkUploader.has(`${userId}:${hash}`)) return true;
  const row = await ChunkOwnership.findOne({ where: { user_id: userId, file_hash: hash } });
  return !!row;
}

/**
 * S6：上传归属落库（提交绑定时校验 file_path 确属当前用户上传）
 */
async function recordUpload(userId, filePath, originalName, fileSize) {
  try {
    await UploadRecord.findOrCreate({
      where: { user_id: userId, file_path: filePath },
      defaults: { user_id: userId, file_path: filePath, original_name: String(originalName || '').slice(0, 255), file_size: fileSize || null }
    });
  } catch (e) {
    // 记录失败不阻断上传响应，但提交绑定校验会兜底拒绝（宁可重传不可冒绑）
    console.warn('[上传归属记录失败]', e.message);
  }
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
// 注意：所有针对 query 参数的校验必须在 multer 解析 body 之前完成（前置中间件）。
// 此前 index 上限/并发 hash 上限在 multer 落盘之后才检查且拒绝时不删除已写文件，
// 任意登录用户可循环换 index/hash 绕过全部磁盘防护（每次写满 5MB 分片）。
exports.uploadChunk = [
  function preValidateChunk(req, res, next) {
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
    // S14：限制单用户同时进行的分片上传（不同 hash）数量，防磁盘填充
    if (!touchActiveHash(req.user.id, hash)) {
      return fail(res, `并发上传的文件过多（最多 ${MAX_ACTIVE_HASHES_PER_USER} 个），请先完成或稍后再传`, 429);
    }
    next();
  },
  upload.single('chunk'),
  async (req, res, next) => {
    try {
      // 幂等复核（真正的拦截在 preValidateChunk，落盘前已拒绝）
      const hash = req.query.hash;
      const index = Number(req.query.index);
      if (!isValidHash(hash) || !Number.isInteger(index) || index < 0 || index > MAX_CHUNK_INDEX) {
        return fail(res, '无效的文件标识或分片序号', 422);
      }
      // 分片已真实落盘（multer 走到 handler 即写入成功），记录持有证明供 merge 核对
      recordChunkOwnership(req.user.id, hash);
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

    // 安全修复：不再提供「已合并过则直接返回」的秒传捷径。
    // 此前任何人只要拿到文件 MD5（如从作业提交列表的 file_hash 字段）即可在未持有
    // 文件内容的情况下调 merge 认领一份副本并获得合法下载权。现在所有调用方都
    // 必须真实上传分片并通过内容 hash 校验——正常用户本就会重传全部分片
    // （merge 成功后 chunk 目录即被清理，前端也从不依赖 file_exists 跳过上传），
    // 行为不变；仅凭 hash 的认领路径被彻底关闭。
    if (!fs.existsSync(chunkDir)) {
      return fail(res, '分片数据不存在，请重新上传', 422);
    }
    // 持有证明：请求者本人必须上传过该文件至少一个分片。磁盘上的分片可能来自
    // 他人（目录删除失败或并发窗口），仅凭内容校验无法证明请求者持有文件内容。
    // 内存 Map 服务重启即清零，数据库记录保证断点续传（磁盘残留自己的分片）仍放行。
    if (!(await ownsChunksOf(req.user.id, hash))) {
      return fail(res, '请先上传该文件的全部分片后再合并（检测到未持有该文件）', 403);
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

    // S6：归属落库（谁上传的，提交绑定时校验）
    await recordUpload(req.user.id, relativePath, filename, mergedSize || fs.statSync(mergedPath).size);
    releaseActiveHash(req.user.id, hash);

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
      await recordUpload(req.user.id, relativePath, originalName, req.file.size);
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

      await recordUpload(req.user.id, relativePath, originalName, req.file.size);

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
