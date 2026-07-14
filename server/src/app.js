const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { sequelize } = require('./models');

const app = express();

// ===== 中间件 =====
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('dev'));

// ===== 静态文件（上传文件预览） =====
const uploadDir = path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');
app.use('/uploads', express.static(uploadDir, {
  setHeaders: (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
}));

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
  res.status(err.status || 500).json({
    code: err.status || 500,
    success: false,
    message: err.message || '服务器内部错误',
    data: null
  });
});

module.exports = { app, sequelize };
