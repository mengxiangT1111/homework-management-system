const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const path = require('path');
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
// 安全响应头（nosniff 等）；CSP 由前端 nginx 负责（API 返回 JSON，无脚本执行面），
// CORP 放开为 cross-origin 以允许开发态下 5173 端口页面内联加载 3000 端口文件
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// CORS：配置了白名单才允许携带凭证；未配置时退化为通配源且不带凭证
// （通配源 + credentials 组合不符合 CORS 规范，浏览器会拒绝凭据请求）
const corsOptions = process.env.CORS_ORIGIN
  ? { origin: process.env.CORS_ORIGIN.split(','), credentials: true }
  : { origin: '*' };
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 访问日志：对 query 中的凭证参数（token/st）脱敏，防止 JWT/票据进日志文件
app.use(morgan((tokens, req, res) => {
  const url = (tokens.url(req, res) || '')
    .replace(/([?&])(token|st)=[^&]*/gi, '$1$2=***');
  return [
    tokens.method(req, res),
    url,
    tokens.status(req, res),
    tokens['response-time'](req, res), 'ms -',
    tokens.res(req, res, 'content-length')
  ].join(' ');
}));

// ===== 上传文件鉴权下载 =====
// 原 /uploads/:yearMonth/:filename 静态路由只验证登录不校验文件归属（任意登录用户
// 拿到/猜到 URL 即可下载他人作业）。已统一收敛到 /api/files/download：
// 按 file_path 反查提交/样例归属后放行，COS 文件 302 到短时效签名 URL。
// （query token 供 iframe/img/video 标签使用，见 routes/files.js）

// ===== 路由挂载 =====
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/classes', require('./routes/classes'));
app.use('/api/courses', require('./routes/courses'));
app.use('/api/assignments', require('./routes/assignments'));
app.use('/api/todos', require('./routes/todos'));
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
  res.status(404).json({ code: 404, success: false, message: '接口不存在', data: null });
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
