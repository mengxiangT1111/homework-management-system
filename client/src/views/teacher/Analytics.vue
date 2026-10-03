<template>
  <div class="page-container">
    <div class="analytics-header">
      <div>
        <div class="page-title">学情分析</div>
        <div class="page-desc">基于提交行为、成绩与查重记录的班级学情画像与学习风险预警</div>
      </div>
      <el-select
        v-if="courses.length > 0"
        v-model="courseId" placeholder="选择课程" style="width: 260px"
        :loading="courseLoading" @change="loadProfile"
      >
        <el-option v-for="c in courses" :key="c.id" :value="c.id"
          :label="`${c.name}（${c.class_name || '未知班级'}）`" />
      </el-select>
    </div>

    <!-- 无课程 / 加载失败 -->
    <EmptyState v-if="!courseLoading && courses.length === 0" type="error" title="暂无可分析的课程"
      description="请先在「我的课程」中创建课程并发布作业，再使用学情分析" />
    <EmptyState v-else-if="loadError" type="error" description="学情数据加载失败，请检查网络后重试" @retry="loadProfile" />

    <!-- 加载中：骨架屏 -->
    <template v-else-if="loading">
      <el-row :gutter="20" style="margin-bottom:20px">
        <el-col v-for="i in 4" :key="i" :xs="12">
          <div class="stat-card">
            <el-skeleton animated>
              <template #template>
                <el-skeleton-item variant="text" style="width:45%;height:14px" />
                <el-skeleton-item variant="h1" style="width:55%;height:28px;margin-top:10px" />
              </template>
            </el-skeleton>
          </div>
        </el-col>
      </el-row>
      <div class="card-section"><el-skeleton animated :rows="6" /></div>
    </template>

    <template v-else-if="profile">
      <!-- KPI 概览 -->
      <el-row :gutter="16" class="stagger" style="margin-bottom:20px">
        <el-col :xs="12" :md="6">
          <StatCard label="总提交率" :value="`${kpi.submit_rate}%`" :icon="DataLine"
            :sub="`${kpi.student_count} 名学生 · ${kpi.assignment_count} 次作业`" />
        </el-col>
        <el-col :xs="12" :md="6">
          <StatCard label="班级平均分" :value="kpi.avg_score != null ? `${kpi.avg_score}` : '—'"
            :icon="TrendCharts" :sub="kpi.ungraded_count > 0 ? `${kpi.ungraded_count} 份待批改` : '无待批改'" />
        </el-col>
        <el-col :xs="12" :md="6">
          <StatCard label="高风险学生" :value="kpi.high_risk_count" :icon="WarningFilled"
            :tone="kpi.high_risk_count > 0 ? 'danger' : 'brand'" :sub="`中风险 ${kpi.medium_risk_count} 人`" />
        </el-col>
        <el-col :xs="12" :md="6">
          <StatCard label="查重风险对" :value="kpi.plagiarism_risk_count" :icon="CopyDocument"
            :tone="kpi.plagiarism_risk_count > 0 ? 'warning' : 'brand'" sub="相似度 ≥60% 或标记可疑" />
        </el-col>
      </el-row>

      <!-- 未交催办（行动区，有未交才显示） -->
      <div v-if="profile.unsubmitted.length > 0" class="card-section">
        <h3 style="margin-bottom:12px"><el-icon><Bell /></el-icon>未交催办</h3>
        <div v-for="item in profile.unsubmitted" :key="item.assignment_id" class="remind-item">
          <div class="remind-info">
            <div class="remind-title">
              {{ item.title }}
              <el-tag v-if="item.overdue" type="danger" size="small" effect="plain">已截止</el-tag>
            </div>
            <div class="remind-meta">
              <span>{{ item.unsubmitted_count }} 人未交</span>
              <span v-if="item.sample_names.length" class="remind-names">
                （{{ item.sample_names.join('、') }}{{ item.unsubmitted_count > item.sample_names.length ? ' 等' : '' }}）
              </span>
              <span>截止：{{ formatTime(item.deadline) }}</span>
            </div>
          </div>
          <el-button type="primary" size="small" :loading="remindingId === item.assignment_id"
            @click="handleRemind(item.assignment_id)">
            一键催办
          </el-button>
        </div>
      </div>

      <!-- 班级成绩趋势 -->
      <div class="card-section">
        <h3 style="margin-bottom:16px"><el-icon><TrendCharts /></el-icon>班级成绩趋势</h3>
        <EmptyState v-if="trendData.length === 0" size="compact" description="该课程暂无作业数据" />
        <div v-else ref="trendChartRef" class="trend-chart"></div>
      </div>

      <!-- 学生学情画像 -->
      <div class="card-section">
        <div class="table-toolbar">
          <h3><el-icon><User /></el-icon>学生学情画像</h3>
          <div class="table-tools">
            <el-radio-group v-model="riskFilter" size="small">
              <el-radio-button value="all">全部（{{ profile.students.length }}）</el-radio-button>
              <el-radio-button value="high">高风险（{{ riskCount('high') }}）</el-radio-button>
              <el-radio-button value="medium">中风险（{{ riskCount('medium') }}）</el-radio-button>
              <el-radio-button value="low">良好（{{ riskCount('low') }}）</el-radio-button>
            </el-radio-group>
            <el-input v-model="keyword" placeholder="搜索学生姓名/学号" clearable style="width:180px" :prefix-icon="Search" />
          </div>
        </div>
        <el-table :data="filteredStudents" style="width:100%">
          <el-table-column label="学生" min-width="130">
            <template #default="{ row }">
              <div class="stu-name">{{ row.real_name }}</div>
              <div class="stu-no">{{ row.username }}</div>
            </template>
          </el-table-column>
          <el-table-column label="提交率" width="150">
            <template #default="{ row }">
              <div class="rate-cell">
                <el-progress :percentage="row.submit_rate" :color="rateColor(row.submit_rate)"
                  :stroke-width="8" :show-text="false" style="flex:1" />
                <span class="rate-num">{{ row.submit_rate }}%</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="漏交" width="90" sortable prop="missing_count">
            <template #default="{ row }">
              <span :class="{ 'miss-hot': row.missing_count > 0 }">{{ row.missing_count }}</span>
              <span class="dim"> / {{ row.total }}</span>
            </template>
          </el-table-column>
          <el-table-column label="逾期" width="70" sortable prop="late_count">
            <template #default="{ row }">
              <span :class="{ 'miss-hot': row.late_count >= 3 }">{{ row.late_count }}</span>
            </template>
          </el-table-column>
          <el-table-column label="平均分" width="90" sortable prop="avg_score">
            <template #default="{ row }">
              <span v-if="row.avg_score != null" :style="{ color: scoreColor(row.avg_score) }">{{ row.avg_score }}</span>
              <span v-else class="dim">—</span>
            </template>
          </el-table-column>
          <el-table-column label="成绩趋势" width="130">
            <template #default="{ row }">
              <el-tooltip v-if="row.score_trend.length >= 2"
                :content="row.score_trend.map(p => `${p.t}：${p.v} 分`).join('　')"
                placement="top">
                <SparkLine :values="row.score_trend.map(p => p.v)"
                  :tone="row.trend_direction === 'down' ? 'down' : 'brand'" />
              </el-tooltip>
              <span v-else class="dim">样本不足</span>
            </template>
          </el-table-column>
          <el-table-column label="查重最高" width="100" sortable prop="plagiarism_max">
            <template #default="{ row }">
              <span v-if="row.plagiarism_max != null" :style="{ color: plagColor(row) }">
                {{ row.plagiarism_max }}%
              </span>
              <span v-else class="dim">—</span>
            </template>
          </el-table-column>
          <el-table-column label="风险等级" width="110">
            <template #default="{ row }">
              <el-tooltip :content="row.risk_reasons.length ? row.risk_reasons.join('；') : '暂无风险信号'"
                placement="top">
                <el-tag :type="riskTagType(row.risk_level)" effect="light">
                  {{ riskText(row.risk_level) }}
                </el-tag>
              </el-tooltip>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="100" fixed="right">
            <template #default="{ row }">
              <el-button v-if="row.risk_level !== 'low'" type="warning" size="small" plain
                :loading="warningId === row.student_id" @click="handleWarn(row)">
                发预警
              </el-button>
              <span v-else class="dim">—</span>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <!-- 共性错误 + 查重风险 -->
      <el-row :gutter="16" style="margin-top:20px">
        <el-col :xs="24" :md="12">
          <div class="card-section full-height">
            <h3 style="margin-bottom:12px"><el-icon><InfoFilled /></el-icon>共性错误归纳</h3>
            <EmptyState v-if="profile.common_errors.length === 0" size="compact"
              description="暂无共性错误（同一错误需 ≥2 名学生出现）" />
            <div v-for="(e, i) in profile.common_errors" :key="i" class="error-item">
              <el-tag :type="e.kind === 'knowledge' ? 'danger' : 'warning'" size="small" effect="plain" class="error-kind">
                {{ e.kind === 'knowledge' ? '知识盲区' : '扣分项' }}
              </el-tag>
              <div class="error-body">
                <div class="error-text">{{ e.text }}</div>
                <div class="error-meta">{{ e.count }} 名学生：{{ e.students.join('、') }}{{ e.count > e.students.length ? ' 等' : '' }}</div>
              </div>
            </div>
          </div>
        </el-col>
        <el-col :xs="24" :md="12">
          <div class="card-section full-height">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
              <h3 style="margin:0"><el-icon><CopyDocument /></el-icon>查重风险监控</h3>
              <el-button type="primary" link @click="$router.push('/teacher/plagiarism')">前往查重中心</el-button>
            </div>
            <EmptyState v-if="profile.plagiarism_risks.length === 0" size="compact"
              description="暂无查重风险记录（相似度均低于 60%）" />
            <el-table v-else :data="profile.plagiarism_risks" size="small">
              <el-table-column label="作业" prop="assignment_title" show-overflow-tooltip min-width="110" />
              <el-table-column label="相似学生" min-width="130">
                <template #default="{ row }">{{ row.student_name }} ↔ {{ row.other_name }}</template>
              </el-table-column>
              <el-table-column label="相似度" width="80">
                <template #default="{ row }">
                  <span :style="{ color: row.similarity >= 80 ? 'var(--el-color-danger)' : 'var(--el-color-warning)' }"
                    style="font-weight:600">{{ row.similarity }}%</span>
                </template>
              </el-table-column>
              <el-table-column label="标记" width="70">
                <template #default="{ row }">
                  <el-tag v-if="row.is_suspicious" type="danger" size="small" effect="plain">可疑</el-tag>
                  <span v-else class="dim">—</span>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-col>
      </el-row>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import * as echarts from 'echarts'
import {
  DataLine, TrendCharts, WarningFilled, CopyDocument, Bell, User, InfoFilled, Search
} from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { analyticsApi, courseApi, submissionApi } from '@/api'
import { rateColor, formatTime } from '@/utils/format'
import { brandTheme } from '@/utils/chartTheme'
import StatCard from '@/components/StatCard.vue'
import EmptyState from '@/components/EmptyState.vue'
import SparkLine from '@/components/SparkLine.vue'

const authStore = useAuthStore()

const courses = ref([])
const courseId = ref(null)
const courseLoading = ref(true)
const profile = ref(null)
const loading = ref(true)
const loadError = ref(false)
const remindingId = ref(null)
const warningId = ref(null)
const riskFilter = ref('all')
const keyword = ref('')

// 图表
const trendChartRef = ref(null)
let chart = null

const kpi = computed(() => profile.value?.kpi || {})
const trendData = computed(() => profile.value?.trend || [])

const RISK_ORDER = { high: 0, medium: 1, low: 2 }

const filteredStudents = computed(() => {
  const list = profile.value?.students || []
  const kw = keyword.value.trim()
  return list
    .filter(s => riskFilter.value === 'all' || s.risk_level === riskFilter.value)
    .filter(s => !kw || s.real_name.includes(kw) || String(s.username).includes(kw))
    .sort((a, b) =>
      (RISK_ORDER[a.risk_level] - RISK_ORDER[b.risk_level]) ||
      (a.submit_rate - b.submit_rate))
})

function riskCount(level) {
  return (profile.value?.students || []).filter(s => s.risk_level === level).length
}
function riskText(level) {
  return { high: '高风险', medium: '中风险', low: '良好' }[level] || level
}
function riskTagType(level) {
  return { high: 'danger', medium: 'warning', low: 'success' }[level] || 'info'
}
function scoreColor(v) {
  if (v < 60) return 'var(--el-color-danger)'
  if (v < 70) return 'var(--el-color-warning)'
  return 'var(--text)'
}
function plagColor(row) {
  if (row.plagiarism_flagged || row.plagiarism_max >= 80) return 'var(--el-color-danger)'
  if (row.plagiarism_max >= 60) return 'var(--el-color-warning)'
  return 'var(--text)'
}

// ===== 课程列表：教师看本学期任课，管理员看全校 =====
async function loadCourses() {
  courseLoading.value = true
  try {
    const res = authStore.role === 'admin'
      ? await courseApi.all()
      : await courseApi.myTeaching()
    const list = res.data || []
    courses.value = list.map(c => ({
      id: c.id,
      name: c.name,
      class_name: c.class?.name || ''
    }))
    if (courses.value.length > 0) {
      courseId.value = courses.value[0].id
      await loadProfile()
    }
  } catch (e) {
    courses.value = []
  } finally {
    courseLoading.value = false
  }
}

async function loadProfile() {
  if (!courseId.value) return
  loading.value = true
  loadError.value = false
  try {
    const res = await analyticsApi.courseProfile(courseId.value)
    profile.value = res.data
    await nextTick()
    renderChart()
  } catch (e) {
    loadError.value = true
    profile.value = null
  } finally {
    loading.value = false
  }
}

// ===== 班级成绩趋势图：柱=提交率，线=已批改均分（双 y 轴均为百分制） =====
function renderChart() {
  if (!trendChartRef.value || trendData.value.length === 0) return
  // 切换课程时 v-if 可能重建了容器节点，统一销毁重建，避免往已脱离文档的实例写图
  if (chart) {
    chart.dispose()
    chart = null
  }
  chart = echarts.init(trendChartRef.value, brandTheme())
  const titles = trendData.value.map(t =>
    t.title.length > 10 ? `${t.title.slice(0, 10)}…` : t.title)
  chart.setOption({
    tooltip: {
      trigger: 'axis',
      formatter(params) {
        const i = params[0].dataIndex
        const d = trendData.value[i]
        return `<b>${d.title}</b><br/>提交率：${d.submit_rate}%` +
          (d.avg_score != null ? `<br/>已批改均分：${d.avg_score}` : '<br/>已批改均分：暂无')
      }
    },
    legend: { data: ['提交率', '已批改均分'], top: 0 },
    grid: { left: 40, right: 40, top: 36, bottom: 40 },
    xAxis: {
      type: 'category',
      data: titles,
      axisLabel: { rotate: titles.length > 6 ? 30 : 0, interval: 0 }
    },
    yAxis: [
      { type: 'value', name: '提交率', min: 0, max: 100, axisLabel: { formatter: '{value}%' } },
      { type: 'value', name: '均分', min: 0, max: 100, axisLabel: { formatter: '{value}' } }
    ],
    series: [
      {
        name: '提交率', type: 'bar', yAxisIndex: 0, barMaxWidth: 32,
        data: trendData.value.map(t => t.submit_rate),
        itemStyle: { color: '#5ab3f0', borderRadius: [4, 4, 0, 0] }
      },
      {
        name: '已批改均分', type: 'line', yAxisIndex: 1, smooth: true,
        connectNulls: true,
        data: trendData.value.map(t => t.avg_score),
        itemStyle: { color: '#3da884' }, lineStyle: { width: 2.5 }
      }
    ]
  }, true)
}

function handleResize() {
  if (chart) chart.resize()
}

// ===== 未交催办（复用既有催交通知接口，后端自带 1 小时防重复） =====
async function handleRemind(assignmentId) {
  remindingId.value = assignmentId
  try {
    const res = await submissionApi.remind(assignmentId)
    ElMessage.success(res.message || '催办已发送')
  } finally {
    remindingId.value = null
  }
}

// ===== 学习风险预警（风险原因由服务端实时计算） =====
async function handleWarn(row) {
  const reasonText = row.risk_reasons.length
    ? row.risk_reasons.join('；')
    : '暂无明显风险信号'
  try {
    await ElMessageBox.confirm(
      `将向 ${row.real_name} 发送学习风险预警通知，风险原因：${reasonText}`,
      '发送学习预警', { type: 'warning', confirmButtonText: '发送', cancelButtonText: '取消' }
    )
  } catch (e) {
    return
  }
  warningId.value = row.student_id
  try {
    const res = await analyticsApi.sendWarning(courseId.value, row.student_id)
    ElMessage.success(res.message || '预警已发送')
  } finally {
    warningId.value = null
  }
}

watch(trendData, () => nextTick(renderChart))

onMounted(() => {
  loadCourses()
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  if (chart) {
    chart.dispose()
    chart = null
  }
})
</script>

<style scoped>
.analytics-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}

.table-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.table-tools { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }

.stu-name { font-weight: 500; }
.stu-no { font-size: 12px; color: var(--text-light); }

.rate-cell { display: flex; align-items: center; gap: 8px; }
.rate-num { font-size: 12px; color: var(--text-light); white-space: nowrap; }

.dim { color: var(--text-light); font-size: 12px; }
.miss-hot { color: var(--el-color-danger); font-weight: 600; }

.remind-item {
  display: flex; justify-content: space-between; align-items: center; gap: 12px;
  padding: 12px 14px; border-radius: 8px; background: var(--bg);
  margin-bottom: 10px;
}
.remind-title { font-weight: 500; margin-bottom: 4px; display: flex; align-items: center; gap: 8px; }
.remind-meta { font-size: 12px; color: var(--text-light); display: flex; gap: 10px; flex-wrap: wrap; }
.remind-names { color: var(--el-color-warning); }

.error-item {
  display: flex; gap: 10px; padding: 10px 0;
  border-bottom: 1px dashed var(--border);
}
.error-item:last-child { border-bottom: none; }
.error-kind { flex-shrink: 0; height: fit-content; }
.error-text { font-size: 14px; line-height: 1.5; word-break: break-all; }
.error-meta { font-size: 12px; color: var(--text-light); margin-top: 2px; }

.full-height { height: 100%; box-sizing: border-box; }
.trend-chart { width: 100%; height: 320px; }

@media (max-width: 768px) {
  .trend-chart { height: 240px; }
  .table-tools { width: 100%; }
}
</style>
