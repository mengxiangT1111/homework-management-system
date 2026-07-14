const { app, sequelize } = require('./app');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    // 测试数据库连接
    await sequelize.authenticate();
    console.log('✓ 数据库连接成功');

    // 同步表结构（开发环境，alter 保留数据）
    await sequelize.sync({ alter: true });
    console.log('✓ 数据库表结构已同步');

    // 确保上传目录存在
    const uploadDir = path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');
    const chunksDir = path.join(uploadDir, 'chunks');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    if (!fs.existsSync(chunksDir)) fs.mkdirSync(chunksDir, { recursive: true });

    // 启动通知定时任务
    const { startScheduler } = require('./utils/notificationScheduler');
    startScheduler();

    app.listen(PORT, () => {
      console.log(`\n========================================`);
      console.log(`  在线作业提交管理系统 - 后端服务`);
      console.log(`  服务地址: http://localhost:${PORT}`);
      console.log(`  健康检查: http://localhost:${PORT}/api/health`);
      console.log(`========================================\n`);
    });
  } catch (err) {
    console.error('✗ 启动失败:', err.message);
    console.error('\n请检查：');
    console.error('  1. MySQL 是否已启动（docker compose up -d）');
    console.error('  2. .env 数据库配置是否正确');
    console.error('  3. 数据库 homework_db 是否存在');
    process.exit(1);
  }
}

start();
