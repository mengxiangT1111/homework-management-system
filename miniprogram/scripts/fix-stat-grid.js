// 老机型兼容修复：全局盒模型 + 统计卡两列布局去 calc/gap 依赖
const fs = require('fs')
const path = require('path')
const src = path.join(__dirname, '../src')

// 1) 全局盒模型标准化（X5 等老内核默认 content-box，宽度+内边距会溢出换行）
let app = fs.readFileSync(path.join(src, 'App.vue'), 'utf8')
if (!app.includes('view, text, button, input, textarea, image, picker {')) {
  app = app.replace(
    'page {\n  background: #f7faf8;',
    'view, text, button, input, textarea, image, picker {\n  box-sizing: border-box;\n}\n\npage {\n  background: #f7faf8;'
  )
  fs.writeFileSync(path.join(src, 'App.vue'), app)
  console.log('App.vue: box-sizing reset added')
} else {
  console.log('App.vue: box-sizing reset already present')
}

// 2) 首页统计卡：space-between + 49% 宽度（不依赖 gap/calc，全部内核稳定两列）
const idxPath = path.join(src, 'pages/index/index.vue')
let idx = fs.readFileSync(idxPath, 'utf8')
const gridStart = idx.indexOf('/* 对齐网页端 stat-card')
const labelEnd = idx.indexOf('}', idx.indexOf('.stat-label {'))
if (gridStart === -1 || labelEnd === -1) throw new Error('stat style block not found')
const newBlock = `/* 对齐网页端 stat-card：两列网格（space-between + 49%，兼容老内核） */
.stat-grid {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  padding: 20rpx 20rpx 4rpx;
}
.stat-card {
  width: 49%;
  margin-bottom: 20rpx;
  background: #ffffff;
  border: 1rpx solid #f0f5f2;
  border-radius: 24rpx;
  padding: 30rpx 32rpx;
  box-shadow: 0 2rpx 8rpx rgba(30, 77, 68, 0.05);
  display: flex;
  flex-direction: column;
}
.stat-top {
  display: flex;
  align-items: center;
  gap: 18rpx;
  margin-bottom: 18rpx;
}
.stat-value {
  font-size: 52rpx;
  font-weight: 700;
  line-height: 1.2;
  color: #2c3e50;
  letter-spacing: -1rpx;
}
.stat-label {
  font-size: 24rpx;
  color: #5f6f68;
}`
idx = idx.slice(0, gridStart) + newBlock + idx.slice(labelEnd + 1)
fs.writeFileSync(idxPath, idx)
console.log('index.vue: stat-grid rewritten (49% + space-between)')
console.log('calc still in index:', idx.includes('calc('))
