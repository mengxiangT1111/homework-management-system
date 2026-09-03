/**
 * 限流中间件（express-rate-limit 封装）
 *
 * keyGenerator 优先按已登录用户 id 计数（避免 nginx 反代场景下全体用户共享
 * 代理 IP 被误锁），未登录请求退回按 IP。
 */
const rateLimit = require('express-rate-limit');

function message(msg) {
  return { code: 429, success: false, message: msg, data: null };
}

function createLimiter({ windowMs, max, msg }) {
  return rateLimit({
    windowMs,
    max,
    message: message(msg),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => (req.user && req.user.id ? `u${req.user.id}` : req.ip)
  });
}

// AI 批改（单份/批量创建）：LLM 调用费用高，严格限流
const aiLimiter = createLimiter({
  windowMs: 60 * 1000, max: 20, msg: 'AI 批改请求过于频繁，请稍后再试'
});

// 全班查重：一次任务比对整班文件，CPU/IO 代价高
const plagiarismLimiter = createLimiter({
  windowMs: 60 * 1000, max: 10, msg: '查重请求过于频繁，请稍后再试'
});

// 打包下载（zip 流式压缩，带宽/CPU 放大）
const downloadLimiter = createLimiter({
  windowMs: 60 * 1000, max: 15, msg: '下载请求过于频繁，请稍后再试'
});

// 上传分片：单片 5MB，正常 100MB 文件 20 片即可传完
const chunkLimiter = createLimiter({
  windowMs: 60 * 1000, max: 240, msg: '上传请求过于频繁，请稍后再试'
});

// 上传合并/直传
const uploadLimiter = createLimiter({
  windowMs: 60 * 1000, max: 60, msg: '上传请求过于频繁，请稍后再试'
});

module.exports = { aiLimiter, plagiarismLimiter, downloadLimiter, chunkLimiter, uploadLimiter, createLimiter };
