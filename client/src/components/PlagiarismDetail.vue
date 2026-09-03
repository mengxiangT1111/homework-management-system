<template>
  <el-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    title="查重检测详情"
    width="800px"
    top="5vh"
    class="plagiarism-detail-dialog"
  >
    <div v-if="loading" class="loading-wrapper">
      <el-skeleton :rows="5" animated />
    </div>

    <div v-else-if="error" class="error-wrapper">
      <el-result icon="error" title="查重结果加载失败" :sub-title="error">
        <template #extra>
          <el-button type="primary" @click="loadResults">重新加载</el-button>
        </template>
      </el-result>
    </div>

    <template v-else-if="results.length > 0">
      <!-- 最高相似度概览 -->
      <div class="similarity-overview">
        <div class="similarity-hero" :class="heroClass">
          <span class="score-number">{{ maxSimilarity }}%</span>
          <span class="score-label">最高相似度</span>
        </div>
        <div class="similarity-badges">
          <el-tag :type="maxSimilarity > 70 ? 'danger' : maxSimilarity > 40 ? 'warning' : 'success'" size="large">
            {{ maxSimilarity > 70 ? '高度可疑' : maxSimilarity > 40 ? '中度可疑' : '低风险' }}
          </el-tag>
          <el-tag type="info" effect="plain">共检测 {{ results.length }} 份提交</el-tag>
        </div>
      </div>

      <el-divider />

      <!-- 雷达图：各维度评分 -->
      <div class="radar-wrapper">
        <h4 class="section-title">多维相似度分析</h4>
        <div ref="radarChartRef" style="height: 280px; width: 100%"></div>
      </div>

      <el-divider />

      <!-- 详细对比列表 -->
      <div class="result-list">
        <h4 class="section-title">对比详情</h4>
        <el-table :data="sortedResults" stripe size="small" @row-click="viewComparison">
          <el-table-column label="对比对象" min-width="120">
            <template #default="{ row }">
              <div class="student-name">
                <el-icon v-if="row.isSuspicious" :color="row.similarityScore > 70 ? 'var(--el-color-danger)' : 'var(--el-color-warning)'">
                  <WarningFilled />
                </el-icon>
                {{ row.studentName || '未知' }}
              </div>
            </template>
          </el-table-column>
          <el-table-column label="综合相似度" width="150">
            <template #default="{ row }">
              <el-progress
                :percentage="Math.round(row.similarityScore)"
                :color="scoreColor(row.similarityScore)"
                :stroke-width="16"
                :text-inside="true"
              />
            </template>
          </el-table-column>
          <el-table-column label="图片" width="90" align="center">
            <template #default="{ row }">
              <span :style="{ color: row.imageHashScore > 60 ? 'var(--el-color-danger)' : 'inherit' }">
                {{ row.imageHashScore.toFixed(1) }}%
              </span>
            </template>
          </el-table-column>
          <el-table-column label="文本" width="90" align="center">
            <template #default="{ row }">
              <span>{{ row.textSimilarity.toFixed(1) }}%</span>
            </template>
          </el-table-column>
          <el-table-column label="拓扑结构" width="90" align="center">
            <template #default="{ row }">
              <span :style="{ color: row.graphSimilarity > 60 ? 'var(--el-color-danger)' : 'inherit' }">
                {{ row.graphSimilarity.toFixed(1) }}%
              </span>
            </template>
          </el-table-column>
          <el-table-column label="同构" width="70" align="center">
            <template #default="{ row }">
              <el-tag v-if="row.isIsomorphic" type="danger" size="small">是</el-tag>
              <span v-else class="placeholder-text">否</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="100" align="center">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click.stop="viewComparison(row)">查看对比</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </template>

    <EmptyState v-else description="暂无查重结果" />

    <template #footer>
      <el-button @click="recheck" :loading="recheckLoading" type="warning" plain>
        重新检测
      </el-button>
      <el-button @click="closeDialog">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import { WarningFilled } from '@element-plus/icons-vue'
import { plagiarismApi } from '@/api'
import * as echarts from 'echarts'

const props = defineProps({
  modelValue: Boolean,
  assignmentId: Number,
  submissionId: Number
})

const emit = defineEmits(['update:modelValue', 'refresh'])

const loading = ref(false)
const error = ref('')
const results = ref([])
const recheckLoading = ref(false)
const radarChartRef = ref(null)
let radarChart = null

const maxSimilarity = computed(() => {
  if (results.value.length === 0) return 0
  return Math.max(...results.value.map(r => r.similarityScore))
})

const heroClass = computed(() => {
  if (maxSimilarity.value > 70) return 'hero-danger'
  if (maxSimilarity.value > 40) return 'hero-warning'
  return 'hero-safe'
})

const sortedResults = computed(() => {
  return [...results.value].sort((a, b) => b.similarityScore - a.similarityScore)
})

function scoreColor(score) {
  if (score > 70) return '#f56c6c'
  if (score > 40) return '#e6a23c'
  return '#67c23a'
}

// 竞态守卫：快速切换不同学生的详情弹窗时，旧响应晚到不得覆盖新数据
// （弹窗标题是 B、表格显示 A 的查重结果，会误导教师判抄袭）
let loadSeq = 0

async function loadResults() {
  if (!props.submissionId) return
  const seq = ++loadSeq
  loading.value = true
  error.value = ''
  try {
    const res = await plagiarismApi.results(props.assignmentId, props.submissionId)
    if (seq !== loadSeq) return // 已被更新的请求取代，丢弃本次结果
    results.value = (res.data?.results || []).map(r => ({
      ...r,
      similarityScore: parseFloat(r.similarityScore) || 0,
      imageHashScore: parseFloat(r.imageHashScore) || 0,
      graphSimilarity: parseFloat(r.graphSimilarity) || 0,
      textSimilarity: parseFloat(r.textSimilarity) || 0,
      orbMatchCount: r.orbMatchCount || 0
    }))
    // 等待DOM更新后渲染图表
    setTimeout(() => {
      if (seq === loadSeq) renderRadarChart()
    }, 100)
  } catch (e) {
    if (seq === loadSeq) error.value = e.message || '加载失败'
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

function renderRadarChart() {
  if (!radarChartRef.value) return
  if (results.value.length === 0) return

  if (radarChart) {
    radarChart.dispose()
  }

  radarChart = echarts.init(radarChartRef.value)
  const topResults = results.value.slice(0, 5) // 最多显示5条

  const option = {
    radar: {
      indicator: [
        { name: '综合相似度', max: 100 },
        { name: '图结构', max: 100 },
        { name: '文本标签', max: 100 },
        { name: '感知哈希', max: 100 },
        { name: '特征匹配', max: 100 }
      ],
      center: ['50%', '50%'],
      radius: '70%',
      axisName: { color: '#666', fontSize: 11 }
    },
    series: [{
      type: 'radar',
      data: topResults.map(r => ({
        name: r.studentName || '未知',
        value: [
          Math.round(r.similarityScore) || 0,
          Math.round(r.graphSimilarity) || 0,
          Math.round(r.textSimilarity) || 0,
          Math.round(r.imageHashScore) || 0,
          Math.min(Math.round((r.orbMatchCount || 0) / 5), 100)
        ],
        lineStyle: { width: 2 },
        areaStyle: { opacity: 0.1 }
      }))
    }],
    legend: {
      data: topResults.map(r => r.studentName || '未知'),
      type: 'scroll',
      orient: 'horizontal',
      bottom: 0,
      textStyle: { fontSize: 11 }
    }
  }

  radarChart.setOption(option)
}

async function recheck() {
  recheckLoading.value = true
  try {
    await plagiarismApi.check(props.assignmentId, props.submissionId)
    ElMessage.success('重新检测完成')
    await loadResults()
    emit('refresh')
  } catch (e) {
    ElMessage.error(e.message || '检测失败')
  } finally {
    recheckLoading.value = false
  }
}

function viewComparison(row) {
  // 跳转到可视化对比（后续扩展）
  ElMessage.info(`对比对象: ${row.studentName}，相似度 ${row.similarityScore.toFixed(1)}%`)
}

function closeDialog() {
  emit('update:modelValue', false)
}

watch(() => props.modelValue, (val) => {
  if (val) {
    loadResults()
  }
})

onMounted(() => {
  if (props.modelValue) loadResults()
})

onUnmounted(() => {
  if (radarChart) radarChart.dispose()
})
</script>

<style scoped>
.loading-wrapper, .error-wrapper {
  padding: 40px 0;
}
.similarity-overview {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 16px 0;
}
.similarity-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 120px;
}
.score-number {
  font-size: 48px;
  font-weight: 800;
  line-height: 1;
}
.score-label {
  font-size: 13px;
  color: var(--text-light);
  margin-top: 4px;
}
.placeholder-text { color: var(--ink-400); }
.hero-danger .score-number { color: var(--el-color-danger); }
.hero-warning .score-number { color: var(--el-color-warning); }
.hero-safe .score-number { color: var(--el-color-success); }
.similarity-badges {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.section-title {
  margin: 0 0 12px 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.student-name {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}
.student-name:hover {
  color: var(--el-color-primary);
}
.radar-wrapper {
  padding: 8px 0;
}
.result-list {
  padding: 8px 0;
}
:deep(.el-table__row) {
  cursor: pointer;
}
</style>