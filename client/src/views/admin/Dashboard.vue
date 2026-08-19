<template>
  <div class="page-container">
    <div class="page-title">数据统计概览</div>

    <!-- 数据卡片 -->
    <el-row :gutter="20" style="margin-bottom:20px">
      <el-col :xs="12" :sm="6">
        <div class="stat-card">
          <div class="stat-label">用户总数</div>
          <div class="stat-value">{{ stats.userCount || 0 }}</div>
          <div class="stat-sub">学生 {{ stats.studentCount }} · 教师 {{ stats.teacherCount }}</div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="6">
        <div class="stat-card">
          <div class="stat-label">班级数</div>
          <div class="stat-value">{{ stats.classCount || 0 }}</div>
          <div class="stat-sub">课程 {{ stats.courseCount }} 门</div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="6">
        <div class="stat-card">
          <div class="stat-label">作业任务</div>
          <div class="stat-value">{{ stats.assignmentCount || 0 }}</div>
          <div class="stat-sub">总提交 {{ stats.submissionCount }} 次</div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="6">
        <div class="stat-card">
          <div class="stat-label">整体提交率</div>
          <div class="stat-value">{{ stats.submitRate || 0 }}%</div>
          <div class="stat-sub" :class="{ danger: stats.unsubmittedTotal > 0 }">
            未交 {{ stats.unsubmittedTotal }} 人次
          </div>
        </div>
      </el-col>
    </el-row>

    <!-- 提交率图表 -->
    <div class="card-section">
      <h3 style="margin-bottom:16px">📈 各作业提交率统计</h3>
      <div ref="chartRef" style="width:100%;height:360px"></div>
      <div v-if="rates.length === 0" class="empty-box">暂无数据</div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import * as echarts from 'echarts'
import { statsApi } from '@/api'

const stats = ref({})
const rates = ref([])
const chartRef = ref(null)
let chart = null
let resizeHandler = null

async function loadData() {
  try {
    const [s, r] = await Promise.all([statsApi.overview(), statsApi.assignmentRates()])
    stats.value = s.data
    rates.value = r.data
    await nextTick()
    renderChart()
  } catch (e) {}
}

function renderChart() {
  if (!chartRef.value || rates.value.length === 0) return
  // 复用单例，避免重复 init 泄漏 echarts 实例
  if (chart) chart.dispose()
  chart = echarts.init(chartRef.value)
  const data = rates.value.slice(0, 10)
  chart.setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { data: ['已交', '未交'], bottom: 0 },
    grid: { left: '3%', right: '4%', bottom: '12%', top: '5%', containLabel: true },
    xAxis: {
      type: 'category',
      data: data.map(d => d.title.length > 8 ? d.title.slice(0, 8) + '...' : d.title),
      axisLabel: { rotate: 20, fontSize: 11 }
    },
    yAxis: { type: 'value', name: '人数' },
    series: [
      {
        name: '已交', type: 'bar', stack: 'total', barWidth: '40%',
        itemStyle: { color: '#52c4a0', borderRadius: [0, 0, 0, 0] },
        data: data.map(d => d.submitted)
      },
      {
        name: '未交', type: 'bar', stack: 'total',
        itemStyle: { color: '#f56c6c', borderRadius: [4, 4, 0, 0] },
        data: data.map(d => d.unsubmitted)
      }
    ]
  })
  if (resizeHandler) window.removeEventListener('resize', resizeHandler)
  resizeHandler = () => chart && chart.resize()
  window.addEventListener('resize', resizeHandler)
}

onMounted(loadData)

// 组件卸载时释放 echarts 实例与 resize 监听，避免内存泄漏
onUnmounted(() => {
  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler)
    resizeHandler = null
  }
  if (chart) {
    chart.dispose()
    chart = null
  }
})
</script>

<style scoped>
.stat-sub { font-size: 12px; color: var(--text-light); margin-top: 4px; }
.stat-sub.danger { color: var(--danger); }
</style>
