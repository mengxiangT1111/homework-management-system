#!/usr/bin/env node
/**
 * 一键注入微信小程序 AppID（上线前置步骤）
 *
 * 用法：
 *   npm run set-appid -- wx1234567890abcdef
 *
 * 做两件事：
 *   1. 写入 src/manifest.json → mp-weixin.appid（源头，之后每次构建自动带上）
 *   2. 若 dist 下已有构建产物，同步更新其中的 project.config.json（免重新构建）
 *
 * AppID 获取：mp.weixin.qq.com → 开发管理 → 开发设置 → AppID
 * （以 wx 开头、共 18 位；touristappid 为游客占位，无法上传/发布）
 */
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const APPID_RE = /^wx[0-9a-zA-Z]{16}$/

const input = (process.argv[2] || '').trim()
if (!input) {
  console.error('✗ 缺少 AppID 参数。用法：npm run set-appid -- wx1234567890abcdef')
  process.exit(1)
}
if (!APPID_RE.test(input)) {
  console.error(`✗ AppID 格式不正确：「${input}」应为 wx 开头、共 18 位（在 mp.weixin.qq.com 开发设置中复制）`)
  process.exit(1)
}

// 1. 源头：manifest.json
const manifestPath = path.join(root, 'src', 'manifest.json')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
manifest['mp-weixin'] = manifest['mp-weixin'] || {}
const oldAppid = manifest['mp-weixin'].appid
manifest['mp-weixin'].appid = input
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
console.log(`✓ src/manifest.json  mp-weixin.appid：${oldAppid || '(空)'} → ${input}`)

// 2. 产物：dist/{dev,build}/mp-weixin/project.config.json（存在才更新）
const distDirs = ['dist/dev/mp-weixin', 'dist/build/mp-weixin']
for (const dir of distDirs) {
  const cfgPath = path.join(root, dir, 'project.config.json')
  if (!fs.existsSync(cfgPath)) continue
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
  cfg.appid = input
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8')
  console.log(`✓ ${dir.replace(/\\/g, '/')}/project.config.json  appid → ${input}`)
}

console.log('\n下一步：')
console.log('  1. 微信开发者工具导入 miniprogram/dist/build/mp-weixin（或先 npm run build:mp-weixin）')
console.log('  2. 确认「详情 → 基本信息 → AppID」已显示为 ' + input)
console.log('  3. 按 docs/小程序上线清单.md 完成服务器域名、隐私指引等后台配置后上传提审')
