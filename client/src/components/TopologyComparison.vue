<template>
  <el-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    title="拓扑图结构对比"
    width="960px"
    top="3vh"
    class="topology-comparison-dialog"
  >
    <div v-if="loading" class="loading-wrapper">
      <el-skeleton :rows="6" animated />
    </div>

    <template v-else-if="comparisonData">
      <!-- 并排对比区 -->
      <div class="comparison-header">
        <div class="vs-badge">VS</div>
        <div class="comparison-info">
          <div class="info-item">
            <span class="label">源图：</span>
            <span class="value">{{ sourceName }}</span>
          </div>
          <div class="info-item">
            <span class="label">对比：</span>
            <span class="value">{{ candidateName }}</span>
          </div>
          <div class="info-item">
            <span class="label">综合相似度：</span>
            <span class="value" :class="scoreClass">{{ similarityScore }}%</span>
          </div>
        </div>
      </div>

      <!-- 可视化对比图 -->
      <div class="visualization-wrapper">
        <div class="side-by-side">
          <!-- 源图提取结果 -->
          <div class="side-panel">
            <div class="panel-title">源拓扑图</div>
            <div class="graph-canvas-wrapper" ref="srcCanvasRef">
              <canvas ref="srcCanvas" :width="canvasWidth" :height="canvasHeight" class="graph-canvas"></canvas>
            </div>
            <div class="graph-stats">
              <div class="stat-item">
                <span class="stat-label">节点：</span>
                <span class="stat-value">{{ srcNodes.length }}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">边：</span>
                <span class="stat-value">{{ srcEdges.length }}</span>
              </div>
            </div>
          </div>

          <!-- 对比图提取结果 -->
          <div class="side-panel">
            <div class="panel-title">对比拓扑图</div>
            <div class="graph-canvas-wrapper" ref="candCanvasRef">
              <canvas ref="candCanvas" :width="canvasWidth" :height="canvasHeight" class="graph-canvas"></canvas>
            </div>
            <div class="graph-stats">
              <div class="stat-item">
                <span class="stat-label">节点：</span>
                <span class="stat-value">{{ candNodes.length }}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">边：</span>
                <span class="stat-value">{{ candEdges.length }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <el-divider />

      <!-- 详细维度的分析 -->
      <div class="dimension-analysis">
        <h4 class="section-title">维度分析</h4>
        <div class="dimension-grid">
          <div v-for="dim in dimensions" :key="dim.label" class="dimension-card">
            <div class="dim-label">{{ dim.label }}</div>
            <el-progress
              :percentage="dim.score"
              :color="dim.color"
              :stroke-width="14"
              :text-inside="true"
            />
            <div class="dim-desc">{{ dim.desc }}</div>
          </div>
        </div>
      </div>

      <!-- 节点匹配详情 -->
      <div v-if="matchDetails" class="match-details">
        <el-divider />
        <h4 class="section-title">节点匹配详情</h4>
        <div class="match-grid">
          <div class="match-item">
            <span class="match-label">匹配节点数：</span>
            <span class="match-value">{{ matchDetails.commonNodes }}/{{ matchDetails.totalNodes }}</span>
          </div>
          <div class="match-item">
            <span class="match-label">匹配边数：</span>
            <span class="match-value">{{ matchDetails.commonEdges }}/{{ matchDetails.totalEdges }}</span>
          </div>
          <div class="match-item">
            <span class="match-label">节点类型：</span>
            <div class="type-tags">
              <el-tag v-for="(sim, type) in matchDetails.nodeTypeSimilarities" :key="type" size="small" :type="sim > 80 ? 'success' : 'warning'">
                {{ type }}: {{ sim.toFixed(0) }}%
              </el-tag>
            </div>
          </div>
          <div class="match-item">
            <span class="match-label">图同构：</span>
            <el-tag v-if="matchDetails.isIsomorphic" type="danger">完全同构</el-tag>
            <el-tag v-else type="info">非同构</el-tag>
          </div>
        </div>
      </div>
    </template>

    <EmptyState v-else description="暂无对比数据" />

    <template #footer>
      <el-button @click="closeDialog">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue'

const props = defineProps({
  modelValue: Boolean,
  assignmentId: Number,
  submissionId: Number,
  comparedWithId: Number,
  resultData: Object
})

const emit = defineEmits(['update:modelValue'])

// Canvas 绘制色板：与全局设计令牌对齐（assets/style.css，Canvas 无法直接读 CSS 变量故集中在此）
const PALETTE = {
  bg: '#f7faf8',           // --ink-50
  textMuted: '#7d918a',    // --ink-500
  textDark: '#2c3e50',     // --ink-800
  srcGraph: '#5ab3f0',     // --secondary 源图侧
  candGraph: '#3da884',    // --brand-600 对比图侧
  score: { high: '#f56c6c', mid: '#e6a23c', low: '#3da884' },
  nodeTypes: {
    router: '#f56c6c', switch: '#e6a23c', pc: '#5ab3f0',
    server: '#3da884', hub: '#909399', cloud: '#b37feb',
    unknown: '#7d918a'
  }
}

const loading = ref(false)
const comparisonData = ref(null)
const srcCanvas = ref(null)
const candCanvas = ref(null)
const canvasWidth = 360
const canvasHeight = 300

const sourceName = ref('')
const candidateName = ref('')
const similarityScore = ref(0)
const srcNodes = ref([])
const srcEdges = ref([])
const candNodes = ref([])
const candEdges = ref([])
const matchDetails = ref(null)

const scoreClass = computed(() => {
  const s = similarityScore.value
  if (s > 70) return 'score-danger'
  if (s > 40) return 'score-warning'
  return 'score-safe'
})

const dimensions = computed(() => {
  const data = props.resultData || comparisonData.value
  if (!data) return []
  return [
    { label: '综合相似度', score: Math.round(data.similarityScore || 0), color: scoreColor(data.similarityScore || 0), desc: '多维度加权综合评分' },
    { label: '图结构', score: Math.round(data.graphSimilarity || 0), color: scoreColor(data.graphSimilarity || 0), desc: '节点/边拓扑结构比对' },
    { label: '文本标签', score: Math.round(data.textSimilarity || 0), color: scoreColor(data.textSimilarity || 0), desc: 'OCR提取的设备名/IP' },
    { label: '感知哈希', score: Math.round(data.imageHashScore || 0), color: scoreColor(data.imageHashScore || 0), desc: '图像整体布局相似度' },
    { label: '特征匹配', score: Math.min(Math.round((data.orbMatchCount || 0) / 3), 100), color: '#909399', desc: `ORB关键点匹配 ${data.orbMatchCount || 0} 个` }
  ]
})

function scoreColor(score) {
  if (score > 70) return PALETTE.score.high
  if (score > 40) return PALETTE.score.mid
  return PALETTE.score.low
}

function loadComparison() {
  loading.value = true
  // 使用传入的resultData或从API获取
  const data = props.resultData
  if (data) {
    comparisonData.value = data
    similarityScore.value = data.similarityScore || 0
    sourceName.value = data.sourceName || '源图'
    candidateName.value = data.studentName || '对比图'
    srcNodes.value = data.srcNodes || []
    srcEdges.value = data.srcEdges || []
    candNodes.value = data.candNodes || []
    candEdges.value = data.candEdges || []
    matchDetails.value = data.matchDetails || null
    nextTick(() => {
      renderGraphs()
    })
  }
  loading.value = false
}

function renderGraphs() {
  renderGraph(srcCanvas.value, srcNodes.value, srcEdges.value, PALETTE.srcGraph, '源图')
  renderGraph(candCanvas.value, candNodes.value, candEdges.value, PALETTE.candGraph, '对比图')
}

function renderGraph(canvas, nodes, edges, color, label) {
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvasWidth, canvasHeight)

  // 背景
  ctx.fillStyle = PALETTE.bg
  ctx.fillRect(0, 0, canvasWidth, canvasHeight)

  if (nodes.length === 0 && edges.length === 0) {
    ctx.fillStyle = PALETTE.textMuted
    ctx.font = '14px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('暂无图结构数据', canvasWidth / 2, canvasHeight / 2)
    return
  }

  // 计算节点布局（简单力导向布局）
  const positions = computeLayout(nodes, edges, canvasWidth, canvasHeight)

  // 绘制边
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.globalAlpha = 0.6
  for (const edge of edges) {
    const src = positions[edge.source]
    const tgt = positions[edge.target]
    if (src && tgt) {
      ctx.beginPath()
      ctx.moveTo(src.x, src.y)
      ctx.lineTo(tgt.x, tgt.y)
      ctx.stroke()
    }
  }
  ctx.globalAlpha = 1

  // 绘制节点
  const typeColors = PALETTE.nodeTypes

  for (const node of nodes) {
    const pos = positions[node.id]
    if (!pos) continue

    const nodeColor = typeColors[node.type] || PALETTE.textMuted
    const radius = node.type === 'router' || node.type === 'cloud' ? 18 : 14

    // 阴影
    ctx.shadowColor = 'rgba(0,0,0,0.1)'
    ctx.shadowBlur = 4

    // 节点圆
    ctx.beginPath()
    ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2)
    ctx.fillStyle = nodeColor
    ctx.fill()
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    ctx.stroke()

    // 阴影重置
    ctx.shadowBlur = 0

    // 节点标签
    if (node.label) {
      ctx.fillStyle = PALETTE.textDark
      ctx.font = '11px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(node.label, pos.x, pos.y + radius + 14)
    }

    // 节点类型标记
    ctx.fillStyle = '#fff'
    ctx.font = '10px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const typeAbbr = { router: 'R', switch: 'SW', pc: 'PC', server: 'SV', hub: 'H', cloud: 'C' }
    ctx.fillText(typeAbbr[node.type] || '?', pos.x, pos.y)
    ctx.textBaseline = 'alphabetic'
  }
}

function computeLayout(nodes, edges, width, height) {
  // 简单力导向布局
  const positions = {}
  const padding = 40
  const centerX = width / 2
  const centerY = height / 2

  // 初始位置：按节点索引均匀分布在一个圆上
  nodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2
    const radius = Math.min(width, height) / 2.5
    positions[node.id] = {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle)
    }
  })

  // 简单迭代优化
  for (let iter = 0; iter < 50; iter++) {
    // 排斥力
    for (const node of nodes) {
      let fx = 0, fy = 0
      for (const other of nodes) {
        if (node.id === other.id) continue
        const dx = positions[node.id].x - positions[other.id].x
        const dy = positions[node.id].y - positions[other.id].y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const repulsion = 5000 / (dist * dist)
        fx += (dx / dist) * repulsion
        fy += (dy / dist) * repulsion
      }
      positions[node.id].x += fx
      positions[node.id].y += fy
    }

    // 吸引力（边）
    for (const edge of edges) {
      const src = positions[edge.source]
      const tgt = positions[edge.target]
      if (!src || !tgt) continue
      const dx = tgt.x - src.x
      const dy = tgt.y - src.y
      const dist = Math.sqrt(dx * dx + dy * dy) || 1
      const attraction = dist * 0.01
      src.x += (dx / dist) * attraction
      src.y += (dy / dist) * attraction
      tgt.x -= (dx / dist) * attraction
      tgt.y -= (dy / dist) * attraction
    }

    // 约束到画布内
    for (const node of nodes) {
      positions[node.id].x = Math.max(padding, Math.min(width - padding, positions[node.id].x))
      positions[node.id].y = Math.max(padding, Math.min(height - padding, positions[node.id].y))
    }
  }

  return positions
}

function closeDialog() {
  emit('update:modelValue', false)
}

watch(() => props.modelValue, (val) => {
  if (val) {
    nextTick(loadComparison)
  }
})

onMounted(() => {
  if (props.modelValue) loadComparison()
})
</script>

<style scoped>
.loading-wrapper {
  padding: 40px 0;
}
.comparison-header {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 12px 0;
}
.vs-badge {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--brand-500), var(--brand-700));
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: 18px;
  flex-shrink: 0;
  box-shadow: var(--shadow-sm);
}
.comparison-info {
  flex: 1;
}
.info-item {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  font-size: 13px;
}
.info-item .label {
  color: var(--text-light);
  min-width: 60px;
}
.info-item .value {
  font-weight: 500;
}
.score-danger { color: var(--el-color-danger); font-weight: 700; }
.score-warning { color: var(--el-color-warning); font-weight: 700; }
.score-safe { color: var(--el-color-success); font-weight: 700; }
.visualization-wrapper {
  border: 1px solid var(--ink-200);
  border-radius: 8px;
  overflow: hidden;
}
.side-by-side {
  display: flex;
  gap: 1px;
  background: var(--ink-200);
}
.side-panel {
  flex: 1;
  background: #fff;
  padding: 12px;
}
.panel-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--ink-600);
  text-align: center;
}
.graph-canvas-wrapper {
  display: flex;
  justify-content: center;
}
.graph-canvas {
  border: 1px solid var(--ink-200);
  border-radius: 4px;
  max-width: 100%;
}
.graph-stats {
  display: flex;
  justify-content: center;
  gap: 20px;
  margin-top: 8px;
  font-size: 12px;
}
.stat-item {}
.stat-label { color: var(--text-light); }
.stat-value { font-weight: 600; color: var(--ink-800); font-variant-numeric: tabular-nums; }
.section-title {
  margin: 0 0 12px 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.dimension-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.dimension-card {
  background: var(--ink-50);
  padding: 12px 16px;
  border-radius: 8px;
}
.dim-label {
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 8px;
}
.dim-desc {
  font-size: 11px;
  color: var(--text-light);
  margin-top: 4px;
}
.match-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.match-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.match-label {
  color: var(--text-light);
}
.match-value {
  font-weight: 600;
}
.type-tags {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
</style>