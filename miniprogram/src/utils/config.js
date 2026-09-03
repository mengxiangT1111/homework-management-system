// ===== 环境配置 =====
// 按微信运行环境自动切换，无需在开发/发布之间手动改代码：
//   - develop（开发者工具）        → DEV_BASE_URL（本机后端）
//   - trial（体验版/真机预览）      → PROD_BASE_URL
//   - release（正式版）            → PROD_BASE_URL
//
// ⚠️ 上线前必做：
//   1. 把 PROD_BASE_URL 替换为已备案的 HTTPS 域名（微信不允许正式版请求 http/内网地址）
//   2. 在微信公众平台「开发管理-服务器域名」把该域名加入
//      request / uploadFile / downloadFile 三组合法域名
//   3. manifest.json 的 appid 替换为真实小程序 appid（当前 touristappid 无法发布）
const DEV_BASE_URL = 'http://127.0.0.1:3000'
const PROD_BASE_URL = 'https://your-domain.com' // TODO: 上线前替换

function resolveBaseUrl() {
  // H5 端没有 getAccountInfoSync，走开发地址（H5 仅用于本地调试）
  // #ifdef MP-WEIXIN
  try {
    const info = uni.getAccountInfoSync()
    const env = info && info.miniProgram && info.miniProgram.envVersion
    if (env === 'release' || env === 'trial') return PROD_BASE_URL
  } catch (e) { /* 取不到环境信息时保守用开发地址 */ }
  // #endif
  return DEV_BASE_URL
}

export const BASE_URL = resolveBaseUrl()
