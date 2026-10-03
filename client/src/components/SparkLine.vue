<template>
  <!-- 成绩迷你趋势线：纯 SVG 实现，表格内每行一个实例，避免引入整棵 ECharts -->
  <svg
    v-if="points.length >= 2"
    :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`"
    class="sparkline" role="img"
  >
    <polyline :points="polylineStr" fill="none" :stroke="color" stroke-width="1.6"
      stroke-linecap="round" stroke-linejoin="round" />
    <circle :cx="lastPoint.x" :cy="lastPoint.y" r="2.2" :fill="color" />
  </svg>
  <span v-else class="spark-empty">—</span>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  // 数值序列（按时间升序），少于 2 个点无法成线
  values: { type: Array, default: () => [] },
  width: { type: Number, default: 92 },
  height: { type: Number, default: 26 },
  // down=红线（最新值明显走低），其余品牌绿
  tone: { type: String, default: 'brand' }
})

const nums = computed(() => props.values.filter(v => typeof v === 'number' && isFinite(v)))
const color = computed(() => (props.tone === 'down' ? '#f56c6c' : '#3da884'))

const PAD = 3
const points = computed(() => {
  const vs = nums.value
  if (vs.length < 2) return []
  const min = Math.min(...vs)
  const max = Math.max(...vs)
  const span = max - min || 1
  const stepX = (props.width - PAD * 2) / (vs.length - 1)
  return vs.map((v, i) => ({
    x: PAD + i * stepX,
    // y 轴翻转：高分在上
    y: PAD + (1 - (v - min) / span) * (props.height - PAD * 2)
  }))
})

const polylineStr = computed(() => points.value.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '))
const lastPoint = computed(() => points.value[points.value.length - 1] || { x: 0, y: 0 })
</script>

<style scoped>
.sparkline { display: block; }
.spark-empty { color: var(--text-light); }
</style>
