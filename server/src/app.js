const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { sequelize } = require('./models');

const app = express();

// 反向代理（nginx）场景下按 X-Forwarded-For 取真实客户端 IP，
// 否则速率限制会把所有请求算成同一个代理 IP（全局误锁）。
// 直连部署时不要开启（客户端可伪造该头绕过限流）。
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
}

// ===== 中间件 =====
// CORS 配置：生产环境应限制 origin
const corsOptions = {
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*',
  credentials: true
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('dev'));

// ===== 上传文件鉴权下载接口（支持 Header 或 URL Token） =====
const auth = require('./middleware/auth').auth;

app.get('/uploads/:yearMonth/:filename', (req, res, next) => {
  // 支持 URL 参数传 token（iframe/img 预览用）
  const urlToken = req.query.token;
  if (urlToken) {
    req.headers.authorization = `Bearer ${urlToken}`;
  }
  next();
}, auth, (req, res, next) => {
  try {
    const { yearMonth, filename } = req.params;
    // 安全校验：防止路径穿越
    if (yearMonth.includes('..') || filename.includes('..')) {
      return res.status(400).json({ code: 400, success: false, message: '非法路径', data: null });
    }

    const uploadDir = path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');
    const filePath = path.join(uploadDir, yearMonth, filename);
    const resolvedPath = path.resolve(filePath);
    const resolvedUploadDir = path.resolve(uploadDir);

    // 确保文件路径在 uploads 目录内（必须带分隔符，防止 uploads-xxx 兄弟目录绕过前缀判断）
    if (!resolvedPath.startsWith(resolvedUploadDir + path.sep)) {
      return res.status(403).json({ code: 403, success: false, message: '禁止访问', data: null });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ code: 404, success: false, message: '文件不存在', data: null });
    }

    // 发送文件
    res.sendFile(resolvedPath);
  } catch (err) {
    next(err);
  }
});

// ===== 路由挂载 =====
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/classes', require('./routes/classes'));
app.use('/api/courses', require('./routes/courses'));
app.use('/api/assignments', require('./routes/assignments'));
app.use('/api/submissions', require('./routes/submissions'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/stats', require('./routes/stats'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/files', require('./routes/files'));
app.use('/api/schools', require('./routes/schools'));
app.use('/api/plagiarism', require('./routes/plagiarism'));
app.use('/api/grading', require('./routes/grading'));

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ code: 200, success: true, message: '服务运行正常', data: { time: new Date().toISOString() } });
});

// ===== 404 处理 =====
app.use((req, res) => {
  res.status(404).json({ code: 404, success: false, message: '接口不存在: ' + req.originalUrl, data: null });
});

// ===== 全局错误处理 =====
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ code: 400, success: false, message: '请求体格式错误', data: null });
  }
  // 文件上传错误
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ code: 400, success: false, message: '文件大小超出限制', data: null });
  }
  // 生产环境不回显 5xx 内部错误细节（表名/SQL/绝对路径），避免信息泄露
  const isProd = process.env.NODE_ENV === 'production';
  const isInternal = !err.status || err.status >= 500;
  res.status(err.status || 500).json({
    code: err.status || 500,
    success: false,
    message: isProd && isInternal ? '服务器内部错误' : (err.message || '服务器内部错误'),
    data: null
  });
});

module.exports = { app, sequelize };
