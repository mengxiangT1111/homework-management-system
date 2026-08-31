// 小程序视觉静态审计：类名引用完整性 / 非规范色值 / 固定底栏遮挡风险
const fs = require('fs')
const path = require('path')

const SRC = path.join(__dirname, '../src')
const pagesDir = path.join(SRC, 'pages')

// ---- 1. 收集全局类（App.vue）----
const appVue = fs.readFileSync(path.join(SRC, 'App.vue'), 'utf8')
const globalClasses = new Set()
for (const m of appVue.matchAll(/\.([a-zA-Z][\w-]*)/g)) globalClasses.add(m[1])
// 组件类
const emptyVue = fs.readFileSync(path.join(SRC, 'components/empty-state.vue'), 'utf8')
for (const m of emptyVue.matchAll(/\.([a-zA-Z][\w-]*)/g)) globalClasses.add('empty-' + m[1].replace(/^empty-/, ''))

// ---- 2. 审计每个页面 ----
const problems = []
const offPalette = []
const PALETTE = new Set([
  '#ffffff', '#fff', '#f7faf8', '#f0f5f2', '#e8f0ec', '#d3e0d9', '#a8bdb4', '#7d918a',
  '#5f6f68', '#47544e', '#2c3e50', '#52c4a0', '#3da884', '#2f8065', '#2d6a5f', '#1e4d44',
  '#e1f5ec', '#edf9f5', '#ecf5fe', '#fcf5eb', '#fef0f0', '#f3f3f3', '#419d80', '#308669',
  '#b88130', '#c45656', '#73757a', '#e6a23c', '#f56c6c', '#909399', '#6fcda9', '#97dbc2',
  '#093426', '#072a1e', '#0d4a37', '#00e18f', '#00b867', '#06dc8b', '#4de8ae', '#00794e',
  '#fbfdfc', '#e1f5ec', '#c3eadb', '#f2faf7', '#fde1e1', '#f2d09d', '#47544e'
])

function extractTemplateClasses(tpl) {
  const used = new Set()
  for (const m of tpl.matchAll(/(?:^|s)class="([^"]+)"/g)) {
    m[1].split(/\s+/).forEach((c) => { if (c && !c.includes('{') && !c.includes('(')) used.add(c) })
  }
  // :class="'tag-' + x" 动态前缀
  for (const m of tpl.matchAll(/:class="'([a-zA-Z][\w-]*)-'\s*\+/g)) used.add(m[1] + '-*')
  return used
}

const pageFiles = []
function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f)
    if (fs.statSync(p).isDirectory()) walk(p)
    else if (f.endsWith('.vue')) pageFiles.push(p)
  }
}
walk(pagesDir)

for (const file of pageFiles) {
  const rel = path.relative(SRC, file)
  const src = fs.readFileSync(file, 'utf8')
  const tplMatch = src.match(/<template>([\s\S]*)<\/template>/)
  const styleMatch = src.match(/<style[^>]*>([\s\S]*?)<\/style>/)
  const tpl = tplMatch ? tplMatch[1] : ''
  const style = styleMatch ? styleMatch[1] : ''

  // 页面本地定义的类
  const localClasses = new Set()
  for (const m of style.matchAll(/\.([a-zA-Z][\w-]*)/g)) localClasses.add(m[1])

  // A. 模板用到但未定义的类
  const used = extractTemplateClasses(tpl)
  for (const c of used) {
    if (c.endsWith('-*')) {
      const prefix = c.slice(0, -2)
      const hasPrefix = [...globalClasses, ...localClasses].some((k) => k.startsWith(prefix + '-'))
      if (!hasPrefix) problems.push(`${rel}: 动态类前缀 "${prefix}-*" 无任何定义`)
      continue
    }
    if (!localClasses.has(c) && !globalClasses.has(c)) {
      problems.push(`${rel}: 类 ".${c}" 在模板中使用但未定义（页面/全局均无）`)
    }
  }

  // B. 非规范色值
  for (const m of style.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    const c = m[0].toLowerCase()
    if (!PALETTE.has(c)) offPalette.push(`${rel}: 非规范色值 ${c}`)
  }

  // C. 固定底栏遮挡：模板含 fixbar 但页面样式无 padding-bottom 兜底
  if (tpl.includes('fixbar') && !/padding-bottom/.test(style)) {
    problems.push(`${rel}: 使用 fixbar 但内容区无 padding-bottom，底部内容会被遮挡`)
  }
}

console.log('=== 类名引用问题 ===')
console.log(problems.length ? problems.join('\n') : '（无）')
console.log('\n=== 非规范色值 ===')
console.log(offPalette.length ? [...new Set(offPalette)].join('\n') : '（无）')
