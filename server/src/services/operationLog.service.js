/**
 * 操作审计日志服务
 *
 * 职责：
 * 1. 写入审计记录（失败只打错误日志，绝不影响业务请求）
 * 2. 存储保护——防止审计表把数据库撑爆：
 *    - 保留期：超过 OPLOG_RETENTION_DAYS（默认 180 天）的记录自动删除
 *    - 行数上限：超过 OPLOG_MAX_ROWS（默认 20 万行）时从最旧开始删
 *    清理通过 node-cron 每天执行 + 启动时执行一次；考虑到登录失败等
 *    高频写入可能在一天内堆积，每写入 256 条做一次行数抽检兜底。
 *    删除分批进行（每批 5000 行），避免大事务长时间锁表。
 */
const cron = require('node-cron');
const { Op } = require('sequelize');
const { OperationLog } = require('../models');

// 环境变量解析：无效值回退默认，范围钳制防止误配置（如 0 天把日志全删光）
function clampInt(raw, min, max, def) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

const RETENTION_DAYS = clampInt(process.env.OPLOG_RETENTION_DAYS, 7, 3650, 180);
const MAX_ROWS = clampInt(process.env.OPLOG_MAX_ROWS, 10000, 50000000, 200000);
const TRIM_BATCH = 5000;
const CAP_CHECK_INTERVAL = 256; // 每 N 次写入做一次行数上限抽检

let writeCounter = 0;
let capCheckRunning = false;

/**
 * 写入一条操作日志（fire-and-forget，调用方无需 await）
 * @param {object} entry 见 OperationLog 模型字段
 */
async function recordOperation(entry) {
  try {
    await OperationLog.create(entry);
  } catch (e) {
    console.error('[操作日志] 写入失败:', e.message);
    return;
  }
  // 高频写入兜底：登录失败刷屏等场景下，一天一次的定时清理不够快，
  // 按写入次数抽样触发行数上限检查（防并发重复执行）
  if (++writeCounter % CAP_CHECK_INTERVAL === 0 && !capCheckRunning) {
    capCheckRunning = true;
    enforceOpLogLimits({ capOnly: true, silent: true })
      .catch(() => {})
      .finally(() => { capCheckRunning = false; });
  }
}

/**
 * 执行存储保护清理：保留期删除 + 行数上限裁剪
 * @param {object} opts capOnly: 只查行数上限（抽检场景，保留期交给每日定时任务）
 * @returns {deletedByRetention, deletedByCap, remaining}
 */
async function enforceOpLogLimits(opts = {}) {
  const { capOnly = false, silent = false } = opts;
  let deletedByRetention = 0;
  let deletedByCap = 0;

  // 1) 保留期：删除创建时间早于 cutoff 的记录（分批）
  if (!capOnly) {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    for (;;) {
      const deleted = await OperationLog.destroy({
        where: { created_at: { [Op.lt]: cutoff } },
        limit: TRIM_BATCH,
        order: [['created_at', 'ASC'], ['id', 'ASC']]
      });
      deletedByRetention += deleted;
      if (deleted < TRIM_BATCH) break;
    }
  }

  // 2) 行数上限：超出部分从最旧开始删（分批）
  let remaining = await OperationLog.count();
  if (remaining > MAX_ROWS) {
    const excess = remaining - MAX_ROWS;
    for (let i = 0; i < excess; i += TRIM_BATCH) {
      const batch = Math.min(TRIM_BATCH, excess - i);
      // 先找出本批最旧的 id 再按 id 删，避免 offset 在并发写入下漂移
      const oldest = await OperationLog.findAll({
        attributes: ['id'],
        order: [['created_at', 'ASC'], ['id', 'ASC']],
        limit: batch
      });
      if (oldest.length === 0) break;
      const ids = oldest.map(o => o.id);
      await OperationLog.destroy({ where: { id: { [Op.in]: ids } } });
      deletedByCap += ids.length;
    }
    remaining = await OperationLog.count();
  }

  if (!silent && (deletedByRetention > 0 || deletedByCap > 0)) {
    console.log(`[操作日志] 存储保护清理完成：保留期删除 ${deletedByRetention} 条，行数上限删除 ${deletedByCap} 条，剩余 ${remaining} 条`);
  }
  return { deletedByRetention, deletedByCap, remaining };
}

/**
 * 定时清理：每天凌晨 3:30（错开 3:00 的文件/分片清理任务）+ 启动后 20 秒执行一次
 */
function scheduleOpLogCleanup() {
  cron.schedule('30 3 * * *', async () => {
    try {
      await enforceOpLogLimits();
    } catch (e) {
      console.error('[操作日志] 定时清理失败:', e.message);
    }
  });

  setTimeout(() => {
    enforceOpLogLimits().catch(e => console.error('[操作日志] 启动清理失败:', e.message));
  }, 20000);

  console.log(`✓ 操作日志定时清理已启动（保留 ${RETENTION_DAYS} 天 / 上限 ${MAX_ROWS} 条）`);
}

function getOpLogConfig() {
  return { retentionDays: RETENTION_DAYS, maxRows: MAX_ROWS };
}

module.exports = { recordOperation, enforceOpLogLimits, scheduleOpLogCleanup, getOpLogConfig };
