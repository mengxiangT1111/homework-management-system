/**
 * 作业创建/更新的服务端输入校验（createAssignment / 班委与课代表代发共用）
 */

// mergeChunks/simpleUpload 落库的 file_path 形态：
//   uploads/202609/<hash>_<ts>.<ext>  或  cos://homeworks/202609/<hash>_<ts>.<ext>
// 文件名部分是服务端生成（hex+时间戳+扩展名），据此收紧白名单，
// 防止把任意 cos://key / 穿越路径塞进 sample_files 借 /api/files/urls 换签名 URL
const SAMPLE_URL_RE = /^(?:uploads\/|cos:\/\/homeworks\/)\d{6}\/[A-Za-z0-9._-]{1,200}$/;
const MAX_SAMPLE_FILES = 20;

/**
 * 校验并净化 sample_files
 * @returns {{ok:boolean, data:Array|null, msg:string}}
 */
function sanitizeSampleFiles(input) {
  if (input === undefined || input === null) return { ok: true, data: null, msg: '' };
  if (!Array.isArray(input)) return { ok: false, data: null, msg: '样例文件必须是数组' };
  if (input.length === 0) return { ok: true, data: null, msg: '' };
  if (input.length > MAX_SAMPLE_FILES) {
    return { ok: false, data: null, msg: `样例文件最多 ${MAX_SAMPLE_FILES} 个` };
  }
  const cleaned = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') {
      return { ok: false, data: null, msg: '样例文件项格式非法' };
    }
    const name = String(item.name || '').trim().slice(0, 200);
    const url = String(item.url || '').trim();
    if (!name || !url) return { ok: false, data: null, msg: '样例文件缺少名称或地址' };
    if (url.includes('..') || !SAMPLE_URL_RE.test(url)) {
      return { ok: false, data: null, msg: '样例文件地址非法（仅允许本系统生成的作业文件路径）' };
    }
    cleaned.push({ name, url });
  }
  return { ok: true, data: cleaned, msg: '' };
}

const MAX_FILES_LIMIT = 20;      // 单次提交最多文件数
const MAX_SIZE_MB_LIMIT = 500;   // 与 uploadController.MAX_FILE_SIZE 对齐

/**
 * 校验 max_files / max_size_mb（非法值直接拒绝，不再静默兜底成默认值）
 * @returns {{ok:boolean, maxFiles:number|undefined, maxSizeMb:number|undefined, msg:string}}
 */
function parseAssignmentLimits(maxFilesRaw, maxSizeRaw) {
  const out = { ok: true, maxFiles: undefined, maxSizeMb: undefined, msg: '' };
  if (maxFilesRaw !== undefined && maxFilesRaw !== null && maxFilesRaw !== '') {
    const mf = Number(maxFilesRaw);
    if (!Number.isInteger(mf) || mf < 1 || mf > MAX_FILES_LIMIT) {
      return { ok: false, msg: `max_files 需为 1-${MAX_FILES_LIMIT} 的整数` };
    }
    out.maxFiles = mf;
  }
  if (maxSizeRaw !== undefined && maxSizeRaw !== null && maxSizeRaw !== '') {
    const ms = Number(maxSizeRaw);
    if (!Number.isInteger(ms) || ms < 1 || ms > MAX_SIZE_MB_LIMIT) {
      return { ok: false, msg: `max_size_mb 需为 1-${MAX_SIZE_MB_LIMIT} 的整数（MB）` };
    }
    out.maxSizeMb = ms;
  }
  return out;
}

module.exports = { sanitizeSampleFiles, parseAssignmentLimits };
