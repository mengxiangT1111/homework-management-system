/**
 * 进程级优雅停机协调器
 *
 * 背景：批改与查重两个队列 worker 此前各自注册 SIGINT/SIGTERM 并各自
 * process.exit(0)——批改 worker 空闲时瞬间退出，会把查重 worker 正在执行的
 * 大任务连进程一起杀掉。这里改为：worker 只注册停机回调（停轮询、等在途任务），
 * 信号到来后等全部回调完成再统一退出。
 */
const handlers = [];
let triggered = false;

function registerShutdownHandler(fn) {
  if (typeof fn === 'function') handlers.push(fn);
}

async function runShutdown(signal) {
  if (triggered) return;
  triggered = true;
  console.log(`[停机] 收到 ${signal}，等待各 worker 优雅停止（最多 30s）...`);
  const settled = await Promise.allSettled(handlers.map(fn => fn()));
  for (const r of settled) {
    if (r.status === 'rejected') console.error('[停机] worker 停止异常:', r.reason && r.reason.message);
  }
  process.exit(0);
}

process.once('SIGINT', () => runShutdown('SIGINT'));
process.once('SIGTERM', () => runShutdown('SIGTERM'));

module.exports = { registerShutdownHandler };
