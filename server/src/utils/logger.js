/**
 * 运行日志落盘与自动清理（零依赖，替代 winston 等日志框架）
 *
 * 行为：
 * - 拦截 console.log/info/warn/error：内容照常打到控制台（Docker json-file
 *   驱动采集，容量由 compose 的 max-size 限制），同时按行追加到日志文件
 * - HTTP 访问日志（morgan）经 accessStream 同样双写
 * - 日志文件为 logs/app-YYYY-MM-DD.log，跨天或单文件超限自动轮转
 *
 * 存储保护（防止日志堆满磁盘，三重上限）：
 * - 单文件超过 LOG_MAX_FILE_MB（默认 20MB）立即轮转新文件
 * - 超过 LOG_RETENTION_DAYS（默认 14 天）的旧日志自动删除
 * - logs 目录总大小超过 LOG_MAX_MB（默认 200MB）时从最旧文件开始删
 *
 * 兜底：文件系统不可写（只读容器/磁盘满）时自动降级为仅控制台输出，
 * 日志系统任何故障都不影响业务进程。
 */
const fs = require('fs');
const path = require('path');
const util = require('util');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

function clampInt(raw, min, max, def) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

const ENABLED = process.env.LOG_FILE_ENABLED !== '0';
const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '../../logs');
const RETENTION_DAYS = clampInt(process.env.LOG_RETENTION_DAYS, 1, 365, 14);
const MAX_TOTAL_BYTES = clampInt(process.env.LOG_MAX_MB, 10, 10240, 200) * 1024 * 1024;
const MAX_FILE_BYTES = clampInt(process.env.LOG_MAX_FILE_MB, 1, 2048, 20) * 1024 * 1024;

let stream = null;
let streamDate = '';
let streamSeq = -1;
let streamFile = null;
let streamSize = 0;
let fileBroken = false;
let cleaning = false;

function pad(n) { return String(n).padStart(2, '0'); }
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function ts() {
  const d = new Date();
  return `${todayStr()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function openStream(forceNewSeq) {
  const date = todayStr();
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    // 文件名：当天首个为 app-日期.log，同一天内按大小轮转时递增序号（.1/.2…）。
    // forceNewSeq（尺寸轮转）取当前序号+1；普通打开（启动/跨天）续写当天已有的
    // 最高序号文件，避免每次进程重启都产生一个新文件
    let seq;
    if (forceNewSeq && streamSeq >= 0) {
      seq = streamSeq + 1;
    } else {
      seq = -1;
      for (let s = 0; ; s++) {
        if (fs.existsSync(path.join(LOG_DIR, logFileName(date, s)))) seq = s;
        else break;
      }
      if (seq < 0) seq = 0;
    }
    const file = path.join(LOG_DIR, logFileName(date, seq));
    streamSize = fs.existsSync(file) ? fs.statSync(file).size : 0;
    streamSeq = seq;
    streamFile = file;
    stream = fs.createWriteStream(file, { flags: 'a' });
    stream.on('error', () => {
      // 目录被删/磁盘满/只读文件系统：降级为仅控制台，不再尝试写文件
      fileBroken = true;
      try { stream.destroy(); } catch (e) { /* 忽略 */ }
    });
    streamDate = date;
  } catch (e) {
    fileBroken = true;
  }
}

function logFileName(date, seq) {
  return seq === 0 ? `app-${date}.log` : `app-${date}.${seq}.log`;
}

// 清理旧文件：先按保留天数删，再看目录总大小是否超限
function cleanupOldFiles() {
  if (!ENABLED || fileBroken || cleaning) return;
  cleaning = true;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const now = Date.now();
    const entries = fs.readdirSync(LOG_DIR)
      .filter(f => /^app-\d{4}-\d{2}-\d{2}(\.\d+)?\.log$/.test(f))
      .map(f => {
        const p = path.join(LOG_DIR, f);
        const st = fs.statSync(p);
        return { p, mtime: st.mtimeMs, size: st.size };
      })
      .sort((a, b) => a.mtime - b.mtime);

    let total = 0;
    const keep = [];
    for (const it of entries) {
      if (now - it.mtime > RETENTION_DAYS * 86400000) {
        fs.unlinkSync(it.p);
        continue;
      }
      keep.push(it);
      total += it.size;
    }
    // 总量超限：从最旧开始删，至少保留当前正在写的文件
    while (total > MAX_TOTAL_BYTES && keep.length > 1) {
      const oldest = keep.shift();
      if (streamFile && oldest.p === streamFile) break;
      try { fs.unlinkSync(oldest.p); total -= oldest.size; } catch (e) { break; }
    }
  } catch (e) {
    // 清理失败不影响运行，下次轮转再试
  } finally {
    cleaning = false;
  }
}

function writeLine(line) {
  if (!ENABLED || fileBroken) return;
  if (!stream) openStream(false);
  if (fileBroken || !stream) return;
  // 跨天 → 按新日期开文件（forceNewSeq=false）；同天超限 → 尺寸轮转递增序号
  const today = todayStr();
  if (today !== streamDate || streamSize >= MAX_FILE_BYTES) {
    try { stream.end(); } catch (e) { /* 忽略 */ }
    openStream(today === streamDate);
    if (fileBroken || !stream) return;
    cleanupOldFiles();
  }
  stream.write(line + '\n');
  streamSize += Buffer.byteLength(line) + 1;
}

// morgan 双写流：控制台行为保持不变，额外落盘
const accessStream = {
  write(chunk) {
    const line = String(chunk).replace(/\s+$/, '');
    if (line) writeLine(`[${ts()}] [ACCESS] ${line}`);
    process.stdout.write(chunk);
  }
};

// 拦截 console.*：控制台输出保持原样，文件侧加时间戳与级别
function patchConsole() {
  const levels = [
    ['log', 'INFO'],
    ['info', 'INFO'],
    ['warn', 'WARN'],
    ['error', 'ERROR']
  ];
  for (const [name, level] of levels) {
    const orig = console[name].bind(console);
    console[name] = (...args) => {
      try { writeLine(`[${ts()}] [${level}] ${util.format(...args)}`); } catch (e) { /* 忽略 */ }
      orig(...args);
    };
  }
}

function init() {
  if (!ENABLED) return;
  patchConsole();
  // 空闲时也要清理旧文件（轮转本身在下次写入时自动发生）：每小时检查一次
  setInterval(cleanupOldFiles, 60 * 60 * 1000).unref();
  // 启动清理延迟执行，不阻塞启动
  setTimeout(cleanupOldFiles, 5000);
}

init();

module.exports = { accessStream, cleanupOldFiles };
