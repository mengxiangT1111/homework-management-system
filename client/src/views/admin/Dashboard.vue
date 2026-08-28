<template>
  <div class="page-container">
    <div class="page-title">数据统计概览</div>
    <div class="page-desc">全校用户、班级与提交数据总览</div>

    <!-- 加载失败（全部请求失败才进入错误态，带重试） -->
    <EmptyState v-if="loadError" type="error" description="统计数据加载失败，请检查网络后重试" @retry="loadData" />

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
      <div class="card-section">
        <el-skeleton animated :rows="6" />
      </div>
    </template>

    <template v-else>
      <!-- 数据卡片 -->
      <el-row :gutter="16" class="stagger" style="margin-bottom:20px">
        <el-col :xs="12" :md="6">
          <StatCard label="用户总数" :value="stats.userCount || 0" :icon="User" to="/admin/users"
            :sub="`学生 ${stats.studentCount} · 教师 ${stats.teacherCount}`" />
        </el-col>
        <el-col :xs="12" :md="6">
          <StatCard label="班级数" :value="stats.classCount || 0" :icon="School" to="/admin/classes"
            :sub="`课程 ${stats.courseCount} 门`" />
        </el-col>
        <el-col :xs="12" :md="6">
          <StatCard label="作业任务" :value="stats.assignmentCount || 0" :icon="Document"
            :sub="`总提交 ${stats.submissionCount} 次`" />
        </el-col>
        <el-col :xs="12" :md="6">
          <StatCard label="整体提交率" :value="`${stats.submitRate || 0}%`" :icon="DataAnalysis"
            :sub="stats.unsubmittedTotal > 0 ? `未交 ${stats.unsubmittedTotal} 人次` : '全部已交'" />
        </el-col>
      </el-row>

      <!-- 提交率图表 -->
      <div class="card-section">
        <h3 style="margin-bottom:16px"><el-icon><TrendCharts /></el-icon>各作业提交率统计</h3>
        <div v-if="rates.length > 0" ref="chartRef" style="width:100%;height:360px"></div>
        <EmptyState v-else size="compact" description="暂无作业提交数据" />
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import * as echarts from 'echarts'
import { TrendCharts, User, School, Document, DataAnalysis } from '@element-plus/icons-vue'
import { statsApi } from '@/api'
import { brandTheme } from '@/utils/chartTheme'

const stats = ref({})
const rates = ref([])
const chartRef = ref(null)
const loading = ref(true)
const loadError = ref(false)
let chart = null
let resizeHandler = null

async function loadData() {
  loading.value = true
  loadError.value = false
  // allSettled 保留部分成功：仅全部失败才进入错误态
  const [s, r] = await Promise.allSettled([statsApi.overview(), statsApi.assignmentRates()])
  if (s.status === 'fulfilled') stats.value = s.value.data
  if (r.status === 'fulfilled') rates.value = r.value.data
  loadError.value = s.status === 'rejected' && r.status === 'rejected'
  loading.value = false
  if (!loadError.value) {
    await nextTick()
    renderChart()
  }
}

function renderChart() {
  if (!chartRef.value || rates.value.length === 0) return
  // 复用单例，避免重复 init 泄漏 echarts 实例
  if (chart) chart.dispose()
  chart = echarts.init(chartRef.value, brandTheme())
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
        itemStyle: { color: '#3da884', borderRadius: [0, 0, 0, 0] },
        data: data.map(d => d.submitted)
      },
      {
        name: '未交', type: 'bar', stack: 'total',
        itemStyle: { color: '#f56c6c', borderRadius: [6, 6, 0, 0] },
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
