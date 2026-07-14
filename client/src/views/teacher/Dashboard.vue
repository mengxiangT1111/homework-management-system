<template>
  <div class="page-container">
    <div class="page-title">教师工作台</div>

    <el-row :gutter="20" style="margin-bottom:20px">
      <el-col :xs="12" :sm="6">
        <div class="stat-card">
          <div class="stat-label">我的课程</div>
          <div class="stat-value">{{ stats.courseCount || 0 }}</div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="6">
        <div class="stat-card">
          <div class="stat-label">作业任务</div>
          <div class="stat-value">{{ stats.assignmentCount || 0 }}</div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="6">
        <div class="stat-card">
          <div class="stat-label">待批改</div>
          <div class="stat-value" style="color:var(--warning)">{{ stats.ungradedCount || 0 }}</div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="6">
        <div class="stat-card">
          <div class="stat-label">总提交数</div>
          <div class="stat-value">{{ stats.submissionCount || 0 }}</div>
        </div>
      </el-col>
    </el-row>

    <!-- 提交率图表 -->
    <div class="card-section">
      <h3 style="margin-bottom:16px">📊 最近作业提交率</h3>
      <div v-if="rates.length === 0" class="empty-box">暂无数据</div>
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
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import { statsApi } from '@/api'

const stats = ref({})
const rates = ref([])

function rateColor(r) {
  if (r >= 80) return '#52c4a0'
  if (r >= 50) return '#e6a23c'
  return '#f56c6c'
}

async function loadData() {
  try {
    const [s, r] = await Promise.all([statsApi.teacher(), statsApi.assignmentRates()])
    stats.value = s.data
    rates.value = r.data
  } catch (e) {}
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
