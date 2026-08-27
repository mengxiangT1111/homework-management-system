/**
 * 文件路径转可访问 URL
 * 统一走后端授权下载接口 /api/files/download：
 *   - 后端先校验文件归属（学生仅本人提交文件/本班样例，教师限本人作业），
 *     未授权的 path 返回 403，不再依赖"路径不可猜"做安全防线；
 *   - COS 文件由后端 302 到短时效签名 URL（比裸公共 URL 泄露面小）；
 *   - 本地文件由后端流式返回。
 * iframe/img/video 标签无法带 Authorization 头，因此 URL 上追加 ?token=。
 */

/**
 * 解析文件路径为可访问的 URL
 * @param {string} filePath 数据库中的 file_path（cos://homeworks/xxx 或 uploads/xxx）
 * @returns {string} 可访问的 URL
 */
export function fileUrl(filePath) {
  if (!filePath) return ''
  let p = String(filePath).trim()
  // 已是完整 URL 直接返回
  if (p.startsWith('http://') || p.startsWith('https://')) return p
  // 归一化历史数据中误拼的前导斜杠（如 '/cos://...'、'//uploads/...'），
  // 否则浏览器会把 '//xxx' 当协议相对 URL，误将 uploads 解析为域名
  p = p.replace(/^\/+/, '')
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : ''
  return `/api/files/download?path=${encodeURIComponent(p)}${token ? `&token=${encodeURIComponent(token)}` : ''}`
}

/**
 * 判断是否是 COS 路径
 */
export function isCOS(filePath) {
  return typeof filePath === 'string' && filePath.startsWith('cos://')
}
