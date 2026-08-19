/**
 * 文件路径转可访问 URL
 * 兼容两种格式：
 *   cos://homeworks/xxx → 腾讯云COS URL
 *   uploads/xxx         → 后端静态服务
 */

// COS 公共读 URL 前缀（与 server/src/config/cos.js 保持一致）
const COS_BASE = 'https://mengxiang-1405756754.cos.ap-beijing.myqcloud.com'

/**
 * 解析文件路径为可访问的 URL
 * @param {string} filePath 数据库中的 file_path
 * @returns {string} 可访问的完整 URL
 */
export function fileUrl(filePath) {
  if (!filePath) return ''
  let p = String(filePath).trim()
  // 已是完整 URL 直接返回
  if (p.startsWith('http://') || p.startsWith('https://')) return p
  // 归一化历史数据中误拼的前导斜杠（如 '/cos://...'、'//uploads/...'），
  // 否则浏览器会把 '//xxx' 当协议相对 URL，误将 uploads 解析为域名
  p = p.replace(/^\/+/, '')
  // COS 路径（公共读，无需认证）
  if (p.startsWith('cos://')) {
    return COS_BASE + '/' + p.substring(6)
  }
  // 本地路径（走 vite 代理到后端）：
  // 后端 /uploads 接口需要登录，img/iframe 标签不会带 Authorization 头，
  // 因此统一追加 ?token= 供直接引用
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : ''
  return '/' + p + (token ? `?token=${encodeURIComponent(token)}` : '')
}

/**
 * 判断是否是 COS 路径
 */
export function isCOS(filePath) {
  return typeof filePath === 'string' && filePath.startsWith('cos://')
}
