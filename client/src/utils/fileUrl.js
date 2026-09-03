/**
 * 文件路径转可访问 URL
 * 统一走后端授权下载接口 /api/files/download：
 *   - 先经 POST /api/files/urls（Header 鉴权 + 归属校验）换取与 path 绑定的
 *     短时效票据（st，10 分钟），再用于 iframe/img/video 标签加载；
 *   - 后端对 COS 文件返回短时效签名 URL；
 *   - 未授权的 path 解析结果为空串。
 *
 * 安全说明：此前把 7 天有效期的完整 JWT 拼进 ?token=，会进入访问日志、浏览器
 * 历史与 Referrer，泄露后可冒用整 7 天；票据方案泄露窗口仅 10 分钟且不可复用
 * 于其他接口。
 */
import request from '@/api/request'

// 票据本地缓存：服务端票据 10 分钟有效，这里缓存 8 分钟（提前 2 分钟失效，
// 避免临界点上屏后立即过期）。key 为归一化后的 path。
const cache = new Map()
const CACHE_MS = 8 * 60 * 1000

function normalize(filePath) {
  // 归一化历史数据中误拼的前导斜杠（如 '/cos://...'、'//uploads/...'）
  return String(filePath || '').trim().replace(/^\/+/, '')
}

/**
 * 批量解析文件路径为可访问 URL（样例列表等一次解析多个的场景，单次请求）
 * @param {string[]} paths
 * @returns {Promise<Object>} { [原path]: url }，解析失败/未授权的为空串
 */
export async function resolveFileUrls(paths) {
  const list = [...new Set((paths || []).filter(Boolean).map(normalize))]
  const result = {}
  const need = []
  for (const p of list) {
    if (/^https?:\/\//i.test(p)) { result[p] = p; continue }
    const hit = cache.get(p)
    if (hit && hit.exp > Date.now()) { result[p] = hit.url; continue }
    need.push(p)
  }
  if (need.length > 0) {
    try {
      const res = await request.post('/files/urls', { paths: need })
      const map = (res && res.data) || {}
      const now = Date.now()
      for (const p of need) {
        const url = map[p] || ''
        if (url) { cache.set(p, { url, exp: now + CACHE_MS }); result[p] = url }
      }
    } catch (e) { /* 批量解析失败：调用方拿到空串自行兜底 */ }
  }
  return result
}

/**
 * 解析单个文件路径为可访问的 URL（带缓存）
 * @param {string} filePath 数据库中的 file_path（cos://homeworks/xxx 或 uploads/xxx）
 * @returns {Promise<string>} 可访问的 URL；未授权/失败返回 ''
 */
export async function resolveFileUrl(filePath) {
  if (!filePath) return ''
  const p = normalize(filePath)
  if (/^https?:\/\//i.test(p)) return p
  const map = await resolveFileUrls([p])
  return map[p] || ''
}

/**
 * 判断是否是 COS 路径
 */
export function isCOS(filePath) {
  return typeof filePath === 'string' && filePath.startsWith('cos://')
}
