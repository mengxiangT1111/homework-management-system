/**
 * ECharts 品牌主题：与设计令牌对齐（字体栈/轴线/分隔线/文字色/色板）
 * 用法：echarts.init(el, brandTheme())，首次调用时注册，后续复用主题名
 */
import * as echarts from 'echarts'

const theme = {
  color: ['#3da884', '#5ab3f0', '#e6a23c', '#f56c6c', '#909399', '#b37feb'],
  textStyle: {
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'HarmonyOS Sans SC', 'Microsoft YaHei', sans-serif"
  },
  categoryAxis: {
    axisLine: { lineStyle: { color: '#d3e0d9' } },
    axisTick: { lineStyle: { color: '#d3e0d9' } },
    axisLabel: { color: '#5f6f68' }
  },
  valueAxis: {
    splitLine: { lineStyle: { color: '#e8f0ec' } },
    axisLabel: { color: '#5f6f68' }
  },
  legend: { textStyle: { color: '#5f6f68' } }
}

let registered = false

export function brandTheme() {
  if (!registered) {
    echarts.registerTheme('brand', theme)
    registered = true
  }
  return 'brand'
}
