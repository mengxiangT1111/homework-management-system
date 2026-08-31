// 给登录/注册页设置沉浸式导航（深翠绿底 + 白字），与品牌面板融为一体
const fs = require('fs')
const path = require('path')
const file = path.join(__dirname, '../src/pages.json')
const conf = JSON.parse(fs.readFileSync(file, 'utf8'))
const TARGETS = {
  'pages/login/login': '信衡',
  'pages/register/register': '注册 · 信衡'
}
for (const page of conf.pages) {
  if (TARGETS[page.path]) {
    page.style = {
      navigationBarTitleText: TARGETS[page.path],
      navigationBarBackgroundColor: '#0d4a37',
      navigationBarTextStyle: 'white'
    }
  }
}
fs.writeFileSync(file, JSON.stringify(conf, null, 2) + '\n')
console.log('done:', conf.pages.slice(0, 2).map((p) => p.style).map((s) => s.navigationBarBackgroundColor))
