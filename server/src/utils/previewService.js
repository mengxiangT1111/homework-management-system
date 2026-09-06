/**
 * 文档在线预览转换服务
 *
 * 浏览器原生能内联渲染的格式（图片/PDF/音视频）由 download 端点直接以
 * Content-Type: inline 下发，前端用 iframe/img/video 加载即可；
 * 本服务负责需要"转换"才能预览的格式，统一转成安全 HTML/文本返回：
 *   - .docx → mammoth 转 HTML（图片转 base64 内联），经白名单清理
 *   - .xlsx → exceljs 读取后转 HTML 表格（行/列/工作表数超限截断）
 *   - .txt/.md/.csv/.log/.json → 按 UTF-8 文本返回
 * 其余格式（.doc/.ppt/.pptx/.zip 等）无法无损转换，明确返回不支持。
 *
 * 安全考量：
 *   - canAccessPath 归属校验在调用方（fileController.preview）完成，
 *     缓存以"路径+大小"为 key——同一文件对同一用户集合的授权结果相同，缓存可共享；
 *   - mammoth 的 HTML 输出再过一遍标签/属性白名单（纵深防御），
 *     前端最终在 sandbox iframe（禁脚本）内渲染；
 *   - 转换有文件大小/输出长度上限，防止超大文件拖垮 Node 进程。
 */
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const mammoth = require('mammoth');
const ExcelJS = require('exceljs');

// ===== 限额 =====
const MAX_FILE_BYTES = 20 * 1024 * 1024;      // 参与转换的文件大小上限
const MAX_TEXT_CHARS = 200 * 1000;            // 文本预览最大字符数
const MAX_HTML_CHARS = 2 * 1000 * 1000;       // 转换 HTML 最大字符数（含 base64 图片）
const XLSX_MAX_ROWS = 200;                    // 每工作表最多渲染行数
const XLSX_MAX_COLS = 30;                     // 每工作表最多渲染列数
const XLSX_MAX_SHEETS = 5;                    // 最多渲染工作表数

// 文本类扩展名（按 UTF-8 直接读）
const TEXT_EXTS = new Set(['.txt', '.md', '.csv', '.log', '.json']);

// ===== 转换结果缓存（uploads/ 文件名含内容哈希、不可变，TTL 兜底） =====
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 30;
const cache = new Map(); // key -> { data, exp }

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.exp < Date.now()) { cache.delete(key); return null; }
  return hit.data;
}

function cacheSet(key, data) {
  if (cache.size >= CACHE_MAX) {
    cache.delete(cache.keys().next().value); // FIFO 淘汰（够用，且 TTL 已兜底）
  }
  cache.set(key, { data, exp: Date.now() + CACHE_TTL_MS });
}

// ===== HTML 工具 =====
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 超长 HTML 在标签边界截断，避免截出半截标签 */
function truncateHtml(html, max) {
  if (html.length <= max) return { html, truncated: false };
  let cut = html.lastIndexOf('>', max);
  if (cut < max * 0.5) cut = max; // 找不到合理边界就硬截
  return { html: html.slice(0, cut), truncated: true };
}

// ===== docx：mammoth 输出的标签/属性白名单清理 =====
const ALLOWED_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tfoot', 'caption', 'colgroup', 'col', 'tr', 'th', 'td',
  'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'u', 's', 'del', 'ins', 'sup', 'sub',
  'br', 'hr', 'img', 'a', 'span', 'div', 'blockquote', 'pre', 'code', 'figure', 'figcaption'
]);
const VOID_TAGS = new Set(['br', 'hr', 'img', 'col']);
const DANGEROUS_BLOCK = /<(script|style|iframe|object|embed|link|meta|form|base)\b[^>]*>[\s\S]*?<\/\1>|<(script|style|iframe|object|embed|link|meta|form|base)\b[^>]*\/?>/gi;

function matchAttr(attrs, name) {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  if (!m) return null;
  return m[2] ?? m[3] ?? m[4] ?? '';
}

function sanitizeDocxHtml(raw) {
  let html = raw.replace(/<!--[\s\S]*?-->/g, '').replace(DANGEROUS_BLOCK, '');
  return html.replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g, (m, tag, attrs) => {
    const t = tag.toLowerCase();
    if (!ALLOWED_TAGS.has(t)) return '';
    if (m.startsWith('</')) return `</${t}>`;
    let out = `<${t}`;
    if (t === 'img') {
      const src = matchAttr(attrs, 'src');
      // 只放行 base64 图片（mammoth 默认内联产物），杜绝外链图片跟踪/混合内容
      if (src && /^data:image\/(png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=]+$/i.test(src)) {
        out += ` src="${src}"`;
      }
      const alt = matchAttr(attrs, 'alt');
      if (alt) out += ` alt="${escapeHtml(alt)}"`;
    } else if (t === 'a') {
      const href = matchAttr(attrs, 'href');
      if (href && /^(https?:|mailto:)/i.test(href)) {
        out += ` href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"`;
      }
    } else if (t === 'td' || t === 'th') {
      for (const an of ['colspan', 'rowspan']) {
        const v = matchAttr(attrs, an);
        if (v && /^\d+$/.test(v)) out += ` ${an}="${v}"`;
      }
    }
    return VOID_TAGS.has(t) ? `${out} />` : `${out}>`;
  });
}

async function convertDocx(absPath) {
  const { value } = await mammoth.convertToHtml({ path: absPath });
  const { html, truncated } = truncateHtml(sanitizeDocxHtml(value || ''), MAX_HTML_CHARS);
  return { kind: 'docx', html, truncated };
}

// ===== xlsx：exceljs → HTML 表格 =====
function cellToText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toLocaleString('zh-CN', { hour12: false });
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(t => t && t.text).join('');
    if (v.text !== undefined) return String(v.text);          // 超链接单元格
    if (v.result !== undefined) return String(v.result);      // 公式缓存结果
    if (v.error) return `#${v.error}`;
    return '';
  }
  return String(v);
}

async function convertXlsx(absPath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(absPath);
  const sheets = wb.worksheets.slice(0, XLSX_MAX_SHEETS);
  let html = '';
  let truncated = false;

  sheets.forEach((ws, i) => {
    if (wb.worksheets.length > XLSX_MAX_SHEETS && i === 0) truncated = true;
    html += `<section class="sheet"><h3>${escapeHtml(ws.name)}</h3><table>`;
    let rowCount = 0;
    const colLimit = Math.min(ws.columnCount || 0, XLSX_MAX_COLS);
    // exceljs eachRow 是回调式 API；先收集再遍历，超限即停
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row) => rows.push(row));
    for (const row of rows) {
      rowCount++;
      if (rowCount > XLSX_MAX_ROWS) { truncated = true; break; }
      html += '<tr>';
      for (let c = 1; c <= colLimit; c++) {
        const tag = rowCount === 1 ? 'th' : 'td';
        html += `<${tag}>${escapeHtml(cellToText(row.getCell(c).value))}</${tag}>`;
      }
      html += '</tr>';
    }
    if ((ws.columnCount || 0) > XLSX_MAX_COLS) truncated = true;
    html += '</table></section>';
  });

  if (wb.worksheets.length === 0) html = '<p>（工作簿没有工作表）</p>';
  const out = truncateHtml(html, MAX_HTML_CHARS);
  return { kind: 'xlsx', html: out.html, truncated: truncated || out.truncated };
}

// ===== 文本 =====
async function convertText(absPath) {
  const buf = await fsp.readFile(absPath);
  if (buf.subarray(0, 8000).includes(0)) {
    const e = new Error('文件为二进制格式，不支持文本预览，请下载查看');
    e.status = 415;
    throw e;
  }
  let text = buf.toString('utf8');
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  // UTF-8 误读非 UTF-8 文件（常见 GBK 中文）会出现替换符：仍返回内容，但提示可能乱码。
  // 按占比判断（占比高即标记），短文件个别替换符也不漏报
  const bad = (text.match(/\uFFFD/g) || []).length;
  const encodingSuspect = bad >= 2 && bad / Math.max(text.length, 1) > 0.005;
  let truncated = false;
  if (text.length > MAX_TEXT_CHARS) {
    text = text.slice(0, MAX_TEXT_CHARS);
    truncated = true;
  }
  return { kind: 'text', text, truncated, encoding_suspect: encodingSuspect };
}

// ===== 入口：按扩展名分发 =====
async function buildPreview(absPath, extLower) {
  if (extLower === '.docx') return convertDocx(absPath);
  if (extLower === '.xlsx') return convertXlsx(absPath);
  if (TEXT_EXTS.has(extLower)) return convertText(absPath);
  const e = new Error('该格式暂不支持在线预览，请下载查看');
  e.status = 415;
  throw e;
}

/**
 * 生成文件预览数据（带缓存）。
 * @param {string} absPath 本地绝对路径（COS 文件由调用方先物化）
 * @param {string} extLower 小写扩展名（含点）
 * @param {string} cacheKey 缓存键（存储路径 + 文件大小）
 */
async function getPreview(absPath, extLower, cacheKey) {
  const hit = cacheGet(cacheKey);
  if (hit) return hit;

  const stat = await fsp.stat(absPath);
  if (stat.size > MAX_FILE_BYTES) {
    const e = new Error('文件过大（超过 20MB），不支持在线预览，请下载查看');
    e.status = 422;
    throw e;
  }

  const data = await buildPreview(absPath, extLower);
  data.file_size = stat.size;
  cacheSet(cacheKey, data);
  return data;
}

/** 清理 COS 物化的临时文件（仅允许删系统临时目录内的文件） */
function removeTempFile(absPath) {
  const tmp = os.tmpdir();
  if (absPath && absPath.startsWith(tmp) && !absPath.slice(tmp.length).includes('..')) {
    fsp.rm(absPath, { force: true }).catch(() => {});
  }
}

module.exports = { getPreview, removeTempFile, TEXT_EXTS, isPathResolve: path.resolve };
