/**
 * Office 文档 → PDF 转换服务（LibreOffice headless）
 *
 * 覆盖 mammoth/exceljs 处理不了的格式：.doc（旧版二进制 Word）、.xls（旧版 Excel）、
 * .ppt/.pptx（演示文稿）。统一用 LibreOffice 无头模式转成 PDF 后内联下发，
 * 前端复用 PDF 的 iframe 预览。docx/xlsx 的原生转换失败时也降级走这里。
 *
 * 部署要求：
 *   - Docker（server/Dockerfile 已内置）：apk 装 libreoffice-writer/calc/impress + font-noto-cjk
 *     （中文字体必须装，否则转出的 PDF 中文全是方框）
 *   - 裸机部署：安装 LibreOffice 后 soffice 在 PATH 即可；装在非标准位置时配 SOFFICE_PATH
 *
 * 缓存：转换产物落盘（系统临时目录），key = sha1(存储路径|文件大小)，
 * 同一文件重复预览直接命中；有数量上限淘汰，避免无限增长。
 */
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const MAX_OFFICE_BYTES = 50 * 1024 * 1024; // 参与转换的文件大小上限
const CONVERT_TIMEOUT_MS = 120 * 1000;     // 单次转换超时（LibreOffice 冷启动较慢）
const CACHE_MAX_FILES = 100;               // 转换产物最多保留份数（超出淘汰最旧）

const CACHE_DIR = path.join(os.tmpdir(), 'homework_preview_pdf');
// 独立用户配置目录：避免与机器上桌面版 LibreOffice 的实例锁冲突，也避免并发互踩
const PROFILE_DIR = path.join(os.tmpdir(), `homework_soffice_profile_${process.pid}`);

// ===== soffice 可执行文件定位（进程内缓存结果） =====
let sofficePromise = null;

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

async function findSoffice() {
  if (!sofficePromise) {
    sofficePromise = (async () => {
      const candidates = [];
      if (process.env.SOFFICE_PATH) {
        candidates.push(process.env.SOFFICE_PATH);
      } else if (process.platform === 'win32') {
        candidates.push(
          'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
          'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe'
        );
      } else {
        candidates.push('/usr/bin/soffice', '/usr/local/bin/soffice', '/opt/libreoffice/program/soffice');
      }
      for (const c of candidates) {
        if (await exists(c)) return c;
      }
      return null;
    })().catch(() => null);
  }
  return sofficePromise;
}

/** SOFFICE_PATH 指向 .js（测试用 mock）时经 node 执行；其余直接作为可执行文件 */
function buildSpawnArgs(sofficePath, args) {
  if (sofficePath.toLowerCase().endsWith('.js')) {
    return { file: process.execPath, args: [sofficePath, ...args] };
  }
  return { file: sofficePath, args };
}

function execFileP(file, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = String(stderr || '');
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
  });
}

// ===== 转换队列：LibreOffice 重量级，进程内串行防止内存/配置目录争用 =====
let queue = Promise.resolve();

/** 落盘缓存路径：sha1(存储路径|文件大小)，与原始扩展名无关（产物都是 pdf） */
function cachePathFor(storagePath, size) {
  const hash = crypto.createHash('sha1').update(`${storagePath}|${size}`).digest('hex');
  return path.join(CACHE_DIR, `${hash}.pdf`);
}

async function pruneCache() {
  try {
    const files = (await fsp.readdir(CACHE_DIR))
      .filter(f => f.endsWith('.pdf'))
      .map(async f => {
        const full = path.join(CACHE_DIR, f);
        const st = await fsp.stat(full);
        return { full, mtime: st.mtimeMs };
      });
    const list = await Promise.all(files);
    if (list.length <= CACHE_MAX_FILES) return;
    list.sort((a, b) => a.mtime - b.mtime);
    for (const item of list.slice(0, list.length - CACHE_MAX_FILES)) {
      fsp.rm(item.full, { force: true }).catch(() => {});
    }
  } catch { /* 缓存清理失败不影响主流程 */ }
}

/**
 * 将 Office 文档转换为 PDF（带落盘缓存）
 * @param {string} absPath 源文件本地绝对路径
 * @param {string} storagePath 数据库中的存储路径（作为缓存 key 的一部分）
 * @returns {Promise<string>} 转换后的 PDF 绝对路径
 */
function convertToPdf(absPath, storagePath) {
  // 串行排队：让并发请求共享同一次排队结果（缓存命中在任务开始时再查一次）
  const task = queue.then(() => doConvert(absPath, storagePath)).catch(err => {
    throw err;
  });
  // 队列断链防护：失败不影响后续任务
  queue = task.catch(() => {});
  return task;
}

async function doConvert(absPath, storagePath) {
  const st = await fsp.stat(absPath).catch(() => null);
  if (!st) {
    const e = new Error('文件不存在');
    e.status = 404;
    throw e;
  }
  if (st.size > MAX_OFFICE_BYTES) {
    const e = new Error('文件过大（超过 50MB），不支持在线预览，请下载查看');
    e.status = 422;
    throw e;
  }

  const finalPdf = cachePathFor(storagePath, st.size);
  if (await exists(finalPdf)) return finalPdf;

  const sofficePath = await findSoffice();
  if (!sofficePath) {
    const e = new Error('服务器未安装文档转换服务（LibreOffice），该格式暂不支持在线预览，请下载查看');
    e.status = 415;
    throw e;
  }

  await fsp.mkdir(CACHE_DIR, { recursive: true });
  const jobDir = path.join(CACHE_DIR, `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  await fsp.mkdir(jobDir, { recursive: true });

  try {
    const { file, args } = buildSpawnArgs(sofficePath, [
      '--headless', '--norestore', '--nolockcheck', '--invisible',
      `-env:UserInstallation=${PROFILE_DIR}`,
      '--convert-to', 'pdf', '--outdir', jobDir, absPath
    ]);
    try {
      await execFileP(file, args, CONVERT_TIMEOUT_MS);
    } catch (err) {
      const detail = String(err.stderr || err.message || '');
      const timedOut = err.killed || /ETIMEDOUT/i.test(detail);
      const e = new Error(timedOut
        ? '文档转换超时，请下载查看'
        : '文档转换失败，文件可能损坏或格式不受支持');
      e.status = timedOut ? 504 : 422;
      throw e;
    }

    const base = path.basename(absPath).replace(/\.[^.]+$/, '');
    let produced = path.join(jobDir, `${base}.pdf`);
    if (!await exists(produced)) {
      // LibreOffice 输出名与主文件名不完全一致时，找目录里唯一的 pdf 兜底
      const pdfs = (await fsp.readdir(jobDir)).filter(f => f.toLowerCase().endsWith('.pdf'));
      if (pdfs.length === 0) {
        const e = new Error('文档转换失败，未生成预览文件');
        e.status = 422;
        throw e;
      }
      produced = path.join(jobDir, pdfs[0]);
    }
    await fsp.mkdir(CACHE_DIR, { recursive: true });
    await fsp.rename(produced, finalPdf);
    pruneCache();
    return finalPdf;
  } finally {
    fsp.rm(jobDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { convertToPdf, findSoffice, cachePathFor };
