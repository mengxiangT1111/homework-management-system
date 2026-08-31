const { app, sequelize } = require('./app');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

async function start() {
  try {
    // 测试数据库连接
    await sequelize.authenticate();
    console.log('✓ 数据库连接成功');

    // 同步表结构
    // 生产环境：只同步模型定义，不自动修改表结构（避免数据丢失）
    // 开发环境：允许 alter 自动同步表结构变更
    if (isProduction) {
      await sequelize.sync();
      console.log('✓ 数据库表结构已验证（生产模式，不自动修改）');
    } else {
      await sequelize.sync({ alter: false });
      console.log('✓ 数据库表结构已同步（开发模式）');
    }

    // 确保上传目录存在
    const uploadDir = path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');
    const chunksDir = path.join(uploadDir, 'chunks');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    if (!fs.existsSync(chunksDir)) fs.mkdirSync(chunksDir, { recursive: true });

    // 启动通知定时任务
    const { startScheduler } = require('./utils/notificationScheduler');
    startScheduler();

    // AI 智能批改：提示词版本库播种 + 异步队列 worker 启动
    const promptService = require('./services/prompt.service');
    await promptService.ensureSeeded();
    require('./services/grading/queue.worker').startQueueWorker();

    // 全班查重：异步任务队列 worker 启动
    require('./services/plagiarism/queue.worker').startPlagiarismWorker();

    app.listen(PORT, () => {
      console.log(`\n========================================`);
      console.log(`  信衡 XINHENG · 校园作业与 AI 批改平台 - 后端服务`);
      console.log(`  服务地址: http://localhost:${PORT}`);
      console.log(`  健康检查: http://localhost:${PORT}/api/health`);
      console.log(`  运行模式: ${isProduction ? '生产环境' : '开发环境'}`);
      console.log(`========================================\n`);
    });
  } catch (err) {
    console.error('✗ 启动失败:', err.message);
    console.error('\n请检查：');
    console.error('  1. MySQL 是否已启动（docker compose up -d）');
    console.error('  2. .env 数据库配置是否正确');
    console.error('  3. 数据库 homework_db 是否存在');
    console.error('  4. JWT_SECRET 是否已设置');
    process.exit(1);
  }
}

start();
