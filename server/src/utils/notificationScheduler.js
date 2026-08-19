/**
 * 通知定时任务
 * 每小时扫描一次即将截止(24h内)的作业，生成提醒通知
 */
const cron = require('node-cron');
const { generateDeadlineReminders } = require('../controllers/notificationController');
const { cleanAbandonedChunks } = require('./fileCleaner');

// 启动定时任务
function startScheduler() {
  // 每小时整点执行一次
  cron.schedule('0 * * * *', async () => {
    console.log('[定时任务] 扫描即将截止的作业...');
    await generateDeadlineReminders();
  });

  // 每天凌晨 3 点清理废弃分片（用户放弃上传后残留，48 小时未变更即删除）
  cron.schedule('0 3 * * *', async () => {
    try {
      const cleaned = await cleanAbandonedChunks(48);
      if (cleaned > 0) console.log(`[定时任务] 清理了 ${cleaned} 个废弃分片目录`);
    } catch (e) {
      console.error('[定时任务] 清理废弃分片失败:', e.message);
    }
  });

  // 启动时立即执行一次（延迟 10 秒，等数据库连接就绪）
  setTimeout(async () => {
    try {
      await generateDeadlineReminders();
    } catch (e) {
      // 启动时数据库可能未就绪，忽略
    }
  }, 10000);

  console.log('✓ 通知定时任务已启动（每小时扫描截止提醒）');
}

module.exports = { startScheduler };
