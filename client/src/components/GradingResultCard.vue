<template>
  <div v-if="result" class="grading-result-card">
    <!-- 总分区 -->
    <div class="score-header">
      <div class="score-main">
        <span class="score-num" :class="scoreLevel">{{ result.total_score }}</span>
        <span class="score-max">/ {{ result.full_score }}</span>
      </div>
      <div class="score-badges">
        <el-tag size="small" type="info">AI批改 v{{ result.prompt_version }}</el-tag>
        <el-tag v-if="result.llm_model" size="small" type="info" effect="plain">{{ result.llm_model }}</el-tag>
        <el-tag v-if="result.needs_review" size="small" type="warning">{{ reviewStatusText }}</el-tag>
        <el-tag v-else size="small" type="success">已确认</el-tag>
      </div>
    </div>

    <el-divider />

    <!-- 雷达图 + 维度进度条 -->
    <div class="chart-row">
      <div ref="radarEl" class="radar-box"></div>
      <div class="dim-list">
        <div v-for="d in result.dimension_scores" :key="d.code" class="dim-item">
          <div class="dim-head">
            <span class="dim-name">{{ d.name }}</span>
            <el-tag v-if="d.level" size="small" :type="levelType(d.level)">{{ d.level }} 档</el-tag>
            <span class="dim-score">{{ d.score ?? '—' }} / {{ d.max_score }}</span>
          </div>
          <el-progress
            :percentage="dimPercent(d)"
            :color="progressColor(dimPercent(d))"
            :stroke-width="10"
          />
        </div>
      </div>
    </div>

    <el-divider />

    <!-- 维度详情折叠 -->
    <el-collapse v-if="hasDimensionDetail">
      <el-collapse-item
        v-for="d in result.dimension_scores"
        :key="d.code"
        :title="`${d.name}：${d.score ?? '—'}/${d.max_score}${d.level ? '（' + d.level + '档）' : ''}`"
      >
        <div v-if="d.evidence" class="dim-detail"><b>评分依据：</b>{{ d.evidence }}</div>
        <div v-if="d.deductions && d.deductions.length" class="dim-detail">
          <b>扣分明细：</b>
          <div v-for="(x, i) in d.deductions" :key="i" class="deduction-line">- {{ x.description }}（扣 {{ x.penalty }} 分）</div>
        </div>
        <div v-if="d.feedback" class="dim-detail"><b>点评：</b>{{ d.feedback }}</div>
      </el-collapse-item>
    </el-collapse>

    <!-- 总评与建议 -->
    <div v-if="result.overall_feedback" class="feedback-section">
      <div class="section-title"><el-icon><ChatDotRound /></el-icon>总评</div>
      <div class="section-body">{{ result.overall_feedback }}</div>
    </div>
    <div v-if="result.improvement_advice" class="feedback-section">
      <div class="section-title"><el-icon><MagicStick /></el-icon>改进建议</div>
      <div class="section-body">{{ result.improvement_advice }}</div>
    </div>
    <div v-if="result.knowledge_errors && result.knowledge_errors.length" class="feedback-section">
      <div class="section-title"><el-icon><WarningFilled /></el-icon>知识盲区</div>
      <el-tag v-for="(e, i) in result.knowledge_errors" :key="i" type="danger" style="margin:0 6px 6px 0">{{ e }}</el-tag>
    </div>

    <!-- 复核意见（复核完成后展示） -->
    <div v-if="result.review && result.review.status && result.review.status !== 'pending'" class="feedback-section">
      <div class="section-title"><el-icon><Checked /></el-icon>教师复核</div>
      <div class="section-body">
        {{ reviewResultText }}
        <span v-if="result.review.comment">（{{ result.review.comment }}）</span>
      </div>
    </div>

    <!-- 复核原因（待复核时展示给教师看） -->
    <div v-if="result.needs_review && result.review_reasons && result.review_reasons.length && showReviewReasons" class="feedback-section">
      <div class="section-title"><el-icon><Search /></el-icon>触发复核原因</div>
      <div class="section-body">{{ result.review_reasons.join('；') }}</div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import * as echarts from 'echarts'
import { ChatDotRound, MagicStick, WarningFilled, Checked, Search } from '@element-plus/icons-vue'

const props = defineProps({
  result: { type: Object, required: true },
  // 是否展示"触发复核原因"（教师端复核时需要，学生端隐藏）
  showReviewReasons: { type: Boolean, default: false }
})

const radarEl = ref(null)
let chart = null

const scoreLevel = computed(() => {
  const p = Number(props.result.total_score) / Number(props.result.full_score)
  return p >= 0.85 ? 'excellent' : p >= 0.7 ? 'good' : p >= 0.6 ? 'pass' : 'poor'
})

const reviewStatusText = computed(() => {
  const s = props.result.review && props.result.review.status
  if (s === 'approved') return '教师已确认'
  if (s === 'adjusted') return '教师已调整分数'
  if (s === 'rejected') return '待教师重新批阅'
  return '待教师复核'
})

const reviewResultText = computed(() => {
  const s = props.result.review && props.result.review.status
  if (s === 'approved') return 'AI 评分已由教师复核确认'
  if (s === 'adjusted') return `教师调整为 ${props.result.review.final_score} 分`
  if (s === 'rejected') return 'AI 评分被教师否决，以教师批阅为准'
  return ''
})

const hasDimensionDetail = computed(() =>
  (props.result.dimension_scores || []).some(d => d.evidence || (d.deductions && d.deductions.length) || d.feedback)
)

const dimPercent = (d) => {
  if (d.score == null || !d.max_score) return 0
  return Math.min(100, Math.round(Number(d.score) / Number(d.max_score) * 100))
}
const progressColor = (p) => p >= 85 ? '#3da884' : p >= 70 ? '#52c4a0' : p >= 60 ? '#e6a23c' : '#f56c6c'
const levelType = (level) => {
  const l = String(level).toUpperCase()
  return l === 'A' ? 'success' : l === 'B' ? '' : l === 'C' ? 'warning' : 'danger'
}

function renderRadar() {
  if (!radarEl.value || !props.result || !props.result.dimension_scores || !props.result.dimension_scores.length) return
  if (!chart) chart = echarts.init(radarEl.value)
  const dims = props.result.dimension_scores
  chart.setOption({
    radar: {
      indicator: dims.map(d => ({ name: d.name, max: Number(d.max_score) })),
      radius: '65%',
      splitArea: { areaStyle: { color: ['#f7faf8', '#ebf6f2'] } }
    },
    series: [{
      type: 'radar',
      data: [{
        value: dims.map(d => (d.score == null ? 0 : Number(d.score))),
        name: '得分',
        areaStyle: { color: 'rgba(61, 168, 132, 0.25)' },
        lineStyle: { color: '#3da884' },
        itemStyle: { color: '#3da884' }
      }]
    }]
  })
}

onMounted(async () => { await nextTick(); renderRadar() })
watch(() => props.result, async () => { await nextTick(); renderRadar() }, { deep: true })
onBeforeUnmount(() => { if (chart) { chart.dispose(); chart = null } })
</script>

<style scoped>
.grading-result-card { padding: 8px; }
.score-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
.score-main { text-align: center; flex: 1; }
.score-num { font-size: 46px; font-weight: 700; }
.score-num.excellent { color: #3da884; }
.score-num.good { color: #2f8065; }
.score-num.pass { color: #e6a23c; }
.score-num.poor { color: #f56c6c; }
.score-max { font-size: 18px; color: var(--ink-500); margin-left: 4px; }
.score-badges { display: flex; gap: 6px; flex-wrap: wrap; }
.chart-row { display: flex; gap: 16px; flex-wrap: wrap; }
.radar-box { width: 260px; height: 240px; flex-shrink: 0; }
.dim-list { flex: 1; min-width: 240px; display: flex; flex-direction: column; gap: 12px; justify-content: center; }
.dim-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.dim-name { font-weight: 600; font-size: 14px; }
.dim-score { margin-left: auto; color: var(--ink-700); font-size: 13px; }
.dim-detail { font-size: 13px; line-height: 1.8; color: var(--ink-700); padding: 2px 0; }
.deduction-line { color: var(--color-danger); padding-left: 8px; }
.feedback-section { margin-top: 14px; }
.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-size: 14px;
  margin-bottom: 6px;
  color: var(--ink-800);
}
.section-title .el-icon { color: var(--brand-600); }
.section-body { font-size: 14px; line-height: 1.9; white-space: pre-wrap; background: var(--ink-50); padding: 10px; border-radius: 6px; }
</style>
