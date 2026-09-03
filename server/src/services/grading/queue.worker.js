/**
 * MySQL 原生异步批改队列 worker
 * - 抢占：SELECT ... FOR UPDATE SKIP LOCKED（多worker安全，需 MySQL 8+）
 * - 重试：指数退避（30s/60s/120s），permanent 错误不重试
 * - 回收：processing 超 10 分钟视为僵死，自动重入队或判失败
 * 启动：server.js 中 startQueueWorker()，随主进程运行（状态全在 MySQL，重启零丢失）
 */
const { Sequelize } = require('sequelize');
const { sequelize, GradingTask } = require('../../models');
const gradingService = require('./grading.service');
const config = require('../../config/ai');
const { registerShutdownHandler } = require('../../utils/processShutdown');

const WORKER_ID = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const CLAIM_BATCH = 5;        // 单轮最多抢占任务数
// 僵死任务判定阈值。须大于任务最坏合法执行时长（LLM 最坏约 12 分钟），
// 否则长任务会被误回收导致双跑/结果互相覆盖；可用环境变量覆盖。
// 环境变量填了非法值时回退默认（此前非数字拼进 SQL 会让回收器每分钟报语法错误）
const _stalledEnv = Number(process.env.GRADING_STALLED_MINUTES);
const STALLED_MINUTES = Number.isFinite(_stalledEnv) && _stalledEnv > 0 ? _stalledEnv : 30;
let running = false;
let reaperTimer = null;
const activeTasks = new Set(); // 处理中的任务ID（并发控制）

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 事务内原子抢占：锁行 → 置 processing + attempt+1 → 返回任务实例 */
async function claimTasks(limit) {
  return sequelize.transaction(async (t) => {
    const rows = await sequelize.query(
      `SELECT id FROM grading_tasks
        WHERE status = 'pending' AND next_run_at <= NOW()
        ORDER BY priority ASC, id ASC
        LIMIT :limit
        FOR UPDATE SKIP LOCKED`,
      { replacements: { limit }, type: Sequelize.QueryTypes.SELECT, transaction: t }
    );
    if (rows.length === 0) return [];

    const ids = rows.map(r => r.id);
    await sequelize.query(
      `UPDATE grading_tasks
         SET status = 'processing', locked_by = :workerId, locked_at = NOW(), attempt = attempt + 1
       WHERE id IN (:ids)`,
      { replacements: { workerId: WORKER_ID, ids }, transaction: t }
    );
    return GradingTask.findAll({ where: { id: ids }, transaction: t });
  });
}

/** 失败处置：可重试→退避重入队；不可重试/超限→终态 failed */
async function markFailure(task, err) {
  const attempt = task.attempt; // claim 时已 +1，实例为最新值
  const message = String(err.message || '未知错误').slice(0, 1000);
  const canRetry = !err.permanent && attempt < task.max_attempts;

  if (canRetry) {
    const delaySec = 30 * Math.pow(2, attempt - 1); // 30s, 60s, 120s...
    await sequelize.query(
      `UPDATE grading_tasks
         SET status = 'pending', error_msg = :msg, locked_by = NULL, locked_at = NULL,
             next_run_at = DATE_ADD(NOW(), INTERVAL :delay SECOND)
       WHERE id = :id AND status = 'processing'`,
      { replacements: { msg: message, delay: delaySec, id: task.id } }
    );
    console.warn(`[批改队列] 任务 ${task.id} 第 ${attempt} 次失败（${message}），${delaySec}s 后重试`);
  } else {
    await GradingTask.update(
      { status: 'failed', error_msg: message, locked_by: null, locked_at: null },
      { where: { id: task.id, status: 'processing' } }
    );
    console.error(`[批改队列] 任务 ${task.id} 最终失败：${message}`);
  }
}

/** 僵死任务回收（worker 崩溃未释放的 processing 任务） */
async function reapStalled() {
  const [result] = await sequelize.query(
    `UPDATE grading_tasks
       SET status = IF(attempt >= max_attempts, 'failed', 'pending'),
           error_msg = '任务执行超时（worker异常），自动回收',
           locked_by = NULL, locked_at = NULL
       WHERE status = 'processing'
         AND locked_at < DATE_SUB(NOW(), INTERVAL :minutes MINUTE)`,
    { replacements: { minutes: STALLED_MINUTES } }
  );
  if (result.affectedRows > 0) {
    console.warn(`[批改队列] 回收 ${result.affectedRows} 个僵死任务`);
  }
}

/** 启动恢复：进程重启后不会再有 worker 持有 processing 任务，直接重置入队。
 *  此前不恢复，崩溃时在途的任务要等僵死阈值（默认 30 分钟）才被回收重跑，
 *  前端轮询长时间卡在 processing。单实例部署下安全（无其他进程持有锁）。 */
async function recoverProcessingAtBoot() {
  const [result] = await sequelize.query(
    `UPDATE grading_tasks
       SET status = IF(attempt >= max_attempts, 'failed', 'pending'),
           error_msg = '服务重启，任务自动恢复',
           locked_by = NULL, locked_at = NULL
       WHERE status = 'processing'`
  );
  if (result.affectedRows > 0) {
    console.warn(`[批改队列] 启动恢复 ${result.affectedRows} 个重启前的在途任务`);
  }
}

async function handleTask(task) {
  activeTasks.add(task.id);
  try {
    const outcome = await gradingService.processTask(task);
    if (outcome) {
      console.log(`[批改队列] 任务 ${task.id} 完成：${outcome.total} 分，置信度 ${outcome.confidence}${outcome.needsReview ? '（转人工复核）' : ''}`);
    }
  } catch (err) {
    await markFailure(task, err).catch(e => console.error('[批改队列] markFailure 异常:', e.message));
  } finally {
    activeTasks.delete(task.id);
  }
}

async function pollLoop() {
  while (running) {
    try {
      const free = config.grading.concurrency - activeTasks.size;
      if (free > 0) {
        const claimed = await claimTasks(Math.min(free, CLAIM_BATCH));
        for (const task of claimed) handleTask(task); // fire-and-forget，循环继续
        await sleep(claimed.length === 0 ? config.grading.pollInterval : 100);
      } else {
        await sleep(config.grading.pollInterval);
      }
    } catch (err) {
      console.error('[批改队列] 轮询异常:', err.message);
      await sleep(config.grading.pollInterval);
    }
  }
}

/** 启动 worker（幂等，随 server.js 主进程运行） */
function startQueueWorker() {
  if (running) return;
  running = true;
  console.log(`[批改队列] worker ${WORKER_ID} 启动（并发 ${config.grading.concurrency}，轮询 ${config.grading.pollInterval}ms）`);
  recoverProcessingAtBoot().catch(e => console.error('[批改队列] 启动恢复失败:', e.message));
  pollLoop();
  reaperTimer = setInterval(reapStalled, 60 * 1000);

  // 优雅停机：停止领新任务，等待在途任务完成（最多 30s）。
  // 只注册回调不自行 process.exit——退出时机由 utils/processShutdown 统一协调，
  // 否则空闲的批改 worker 会瞬间退出，把查重 worker 正在跑的大任务连进程杀掉。
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    running = false;
    clearInterval(reaperTimer);
    const deadline = Date.now() + 30000;
    while (activeTasks.size > 0 && Date.now() < deadline) await sleep(500);
    console.log(`[批改队列] worker ${WORKER_ID} 已停止（在途任务 ${activeTasks.size} 个）`);
  };
  registerShutdownHandler(shutdown);
}

module.exports = { startQueueWorker, claimTasks, reapStalled };
