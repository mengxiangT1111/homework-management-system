<template>
  <div class="page-container">
    <div class="page-title">教师工作台</div>

    <!-- 加载失败（全部请求失败才进入错误态，带重试） -->
    <EmptyState v-if="loadError" type="error" description="工作台数据加载失败，请检查网络后重试" @retry="loadData" />

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
        <el-skeleton animated :rows="4" />
      </div>
    </template>

    <template v-else>
      <el-row :gutter="20" style="margin-bottom:20px">
        <el-col :xs="12" :md="6">
          <div class="stat-card">
            <div class="stat-label">我的课程</div>
            <div class="stat-value">{{ stats.courseCount || 0 }}</div>
          </div>
        </el-col>
        <el-col :xs="12" :md="6">
          <div class="stat-card">
            <div class="stat-label">作业任务</div>
            <div class="stat-value">{{ stats.assignmentCount || 0 }}</div>
          </div>
        </el-col>
        <el-col :xs="12" :md="6">
          <div class="stat-card">
            <div class="stat-label">待批改</div>
            <div class="stat-value" style="color:var(--warning)">{{ stats.ungradedCount || 0 }}</div>
          </div>
        </el-col>
        <el-col :xs="12" :md="6">
          <div class="stat-card">
            <div class="stat-label">总提交数</div>
            <div class="stat-value">{{ stats.submissionCount || 0 }}</div>
          </div>
        </el-col>
      </el-row>

      <!-- 提交率图表 -->
      <div class="card-section">
        <h3 style="margin-bottom:16px"><el-icon><TrendCharts /></el-icon>最近作业提交率</h3>
        <EmptyState v-if="rates.length === 0" size="compact" description="暂无作业提交数据" />
        <div v-for="r in rates" :key="r.id" class="rate-item">
          <div class="rate-info">
            <span class="rate-title">{{ r.title }}</span>
            <span class="rate-class">{{ r.class_name }}</span>
          </div>
          <el-progress :percentage="r.rate" :color="rateColor(r.rate)" style="flex:1" />
          <span class="rate-text">{{ r.submitted }}/{{ r.total }}（{{ r.rate }}%）</span>
        </div>
      </div>

      <div style="display:flex;gap:12px">
        <el-button type="primary" size="large" @click="$router.push('/teacher/assignments/create')">
          <el-icon><Plus /></el-icon> 发布新作业
        </el-button>
        <el-button size="large" @click="$router.push('/teacher/assignments')">管理作业</el-button>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { Plus, TrendCharts } from '@element-plus/icons-vue'
import { statsApi } from '@/api'

const stats = ref({})
const rates = ref([])
const loading = ref(true)
const loadError = ref(false)

function rateColor(r) {
  if (r >= 80) return '#3da884'
  if (r >= 50) return '#e6a23c'
  return '#f56c6c'
}

async function loadData() {
  loading.value = true
  loadError.value = false
  // allSettled 保留部分成功：仅全部失败才进入错误态
  const [s, r] = await Promise.allSettled([statsApi.teacher(), statsApi.assignmentRates()])
  if (s.status === 'fulfilled') stats.value = s.value.data
  if (r.status === 'fulfilled') rates.value = r.value.data
  loadError.value = s.status === 'rejected' && r.status === 'rejected'
  loading.value = false
}

onMounted(loadData)
</script>

<style scoped>
.rate-item { display: flex; align-items: center; gap: 16px; padding: 12px 0; border-bottom: 1px solid var(--border); }
.rate-info { min-width: 200px; }
.rate-title { font-weight: 500; display: block; }
.rate-class { font-size: 12px; color: var(--text-light); }
.rate-text { font-size: 13px; color: var(--text-light); white-space: nowrap; }
</style>
