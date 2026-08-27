/**
 * MySQL 原生查重任务队列 worker（参照批改队列模式）
 * - 抢占：SELECT ... FOR UPDATE SKIP LOCKED（多worker安全，需 MySQL 8+）
 * - 并发 1：Python 检测服务为单进程 CPU 密集，多个任务并行只会互相拖慢
 * - 重试：指数退避（30s），最多 max_attempts 次
 * - 回收：processing 超 30 分钟视为僵死，自动重入队或判失败
 * 启动：server.js 中 startPlagiarismWorker()，随主进程运行（状态全在 MySQL，重启零丢失）
 */
const { Sequelize } = require('sequelize');
const { sequelize, PlagiarismTask } = require('../../models');
const plagiarismService = require('./plagiarism.service');

const WORKER_ID = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const CLAIM_BATCH = 1;         // 检测任务重，单轮只抢 1 个
// 僵死任务判定阈值：大班级（60人）合法执行可达数小时，阈值必须大于最坏合法时长，
// 否则正常任务被回收重跑（配合 processTask 每源续租 locked_at）
const STALLED_MINUTES = Number(process.env.PLAGIARISM_STALLED_MINUTES || 360);
const POLL_INTERVAL = Number(process.env.PLAGIARISM_POLL_INTERVAL || '2000');
let running = false;
let reaperTimer = null;
const activeTasks = new Set(); // 处理中的任务ID（并发控制）

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 事务内原子抢占：锁行 → 置 processing + attempt+1 → 返回任务实例 */
async function claimTasks(limit) {
  return sequelize.transaction(async (t) => {
    const rows = await sequelize.query(
      `SELECT id FROM plagiarism_tasks
        WHERE status = 'pending' AND next_run_at <= NOW()
        ORDER BY id ASC
        LIMIT :limit
        FOR UPDATE SKIP LOCKED`,
      { replacements: { limit }, type: Sequelize.QueryTypes.SELECT, transaction: t }
    );
    if (rows.length === 0) return [];

    const ids = rows.map(r => r.id);
    await sequelize.query(
      `UPDATE plagiarism_tasks
         SET status = 'processing', locked_by = :workerId, locked_at = NOW(), attempt = attempt + 1,
             started_at = COALESCE(started_at, NOW())
       WHERE id IN (:ids)`,
      { replacements: { workerId: WORKER_ID, ids }, transaction: t }
    );
    return PlagiarismTask.findAll({ where: { id: ids }, transaction: t });
  });
}

/** 失败处置：可重试→退避重入队；不可重试/超限→终态 failed */
async function markFailure(task, err) {
  const attempt = task.attempt; // claim 时已 +1，实例为最新值
  const message = String(err.message || '未知错误').slice(0, 1000);
  const canRetry = attempt < task.max_attempts;

  if (canRetry) {
    await sequelize.query(
      `UPDATE plagiarism_tasks
         SET status = 'pending', error_msg = :msg, locked_by = NULL, locked_at = NULL,
             next_run_at = DATE_ADD(NOW(), INTERVAL 30 SECOND)
       WHERE id = :id AND status = 'processing'`,
      { replacements: { msg: message, id: task.id } }
    );
    console.warn(`[查重队列] 任务 ${task.id} 第 ${attempt} 次失败（${message}），30s 后重试`);
  } else {
    await PlagiarismTask.update(
      { status: 'failed', error_msg: message, locked_by: null, locked_at: null, finished_at: new Date() },
      { where: { id: task.id, status: 'processing' } }
    );
    console.error(`[查重队列] 任务 ${task.id} 最终失败：${message}`);
  }
}

/** 僵死任务回收（worker 崩溃未释放的 processing 任务） */
async function reapStalled() {
  const [result] = await sequelize.query(
    `UPDATE plagiarism_tasks
       SET status = IF(attempt >= max_attempts, 'failed', 'pending'),
           error_msg = '任务执行超时（worker异常），自动回收',
           locked_by = NULL, locked_at = NULL
       WHERE status = 'processing'
         AND locked_at < DATE_SUB(NOW(), INTERVAL ${STALLED_MINUTES} MINUTE)`
  );
  if (result.affectedRows > 0) {
    console.warn(`[查重队列] 回收 ${result.affectedRows} 个僵死任务`);
  }
}

async function handleTask(task) {
  activeTasks.add(task.id);
  try {
    const outcome = await plagiarismService.processTask(task);
    if (outcome && outcome.cancelled) return;
    console.log(`[查重队列] 任务 ${task.id} 完成：比对 ${outcome.totalComparisons ?? 0} 对`);
  } catch (err) {
    await markFailure(task, err).catch(e => console.error('[查重队列] markFailure 异常:', e.message));
  } finally {
    activeTasks.delete(task.id);
  }
}

async function pollLoop() {
  while (running) {
    try {
      if (activeTasks.size === 0) {
        const claimed = await claimTasks(CLAIM_BATCH);
        for (const task of claimed) handleTask(task); // fire-and-forget，循环继续
        await sleep(claimed.length === 0 ? POLL_INTERVAL : 100);
      } else {
        await sleep(POLL_INTERVAL);
      }
    } catch (err) {
      console.error('[查重队列] 轮询异常:', err.message);
      await sleep(POLL_INTERVAL);
    }
  }
}

/** 启动 worker（幂等，随 server.js 主进程运行） */
function startPlagiarismWorker() {
  if (running) return;
  running = true;
  console.log(`[查重队列] worker ${WORKER_ID} 启动（并发 1，轮询 ${POLL_INTERVAL}ms）`);
  pollLoop();
  reaperTimer = setInterval(reapStalled, 60 * 1000);

  // 优雅停机：停止领新任务，等待在途任务完成（最多 30s）
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    running = false;
    clearInterval(reaperTimer);
    const deadline = Date.now() + 30000;
    while (activeTasks.size > 0 && Date.now() < deadline) await sleep(500);
    console.log(`[查重队列] worker ${WORKER_ID} 已停止（在途任务 ${activeTasks.size} 个）`);
  };
  process.on('SIGINT', () => shutdown().then(() => process.exit(0)));
  process.on('SIGTERM', () => shutdown().then(() => process.exit(0)));
}

module.exports = { startPlagiarismWorker, claimTasks, reapStalled };
