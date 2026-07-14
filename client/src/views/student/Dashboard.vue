<template>
  <div class="page-container">
    <div class="page-title">学生仪表盘</div>

    <!-- 数据卡片 -->
    <el-row :gutter="20" style="margin-bottom:20px">
      <el-col :xs="12" :sm="6">
        <div class="stat-card">
          <div class="stat-label">我的班级</div>
          <div class="stat-value">{{ stats.classCount || 0 }}</div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="6">
        <div class="stat-card">
          <div class="stat-label">在修课程</div>
          <div class="stat-value">{{ stats.courseCount || 0 }}</div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="6">
        <div class="stat-card">
          <div class="stat-label">待提交作业</div>
          <div class="stat-value" style="color:var(--warning)">{{ stats.pendingSubmit || 0 }}</div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="6">
        <div class="stat-card">
          <div class="stat-label">已提交作业</div>
          <div class="stat-value">{{ stats.mySubmissions || 0 }}</div>
        </div>
      </el-col>
    </el-row>

    <!-- 待办作业 -->
    <div class="card-section">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h3>📋 待办作业</h3>
        <el-button type="primary" link @click="$router.push('/student/assignments')">查看全部</el-button>
      </div>
      <div v-if="pending.length === 0" class="empty-box">
        <el-icon :size="40"><Select /></el-icon>
        <p style="margin-top:12px">暂无待办作业，太棒了！</p>
      </div>
      <div v-for="item in pending" :key="item.id" class="todo-item">
        <div class="todo-info">
          <div class="todo-title">{{ item.title }}</div>
          <div class="todo-meta">
            <el-tag size="small">{{ item.course?.class?.name }}</el-tag>
            <span class="deadline" :class="{ urgent: isUrgent(item.deadline) }">
              <el-icon><Clock /></el-icon>
              截止：{{ formatTime(item.deadline) }}
            </span>
          </div>
        </div>
        <el-button type="primary" size="small" @click="$router.push(`/student/assignments/${item.id}`)">
          {{ isUrgent(item.deadline) ? '立即提交' : '去提交' }}
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { Select, Clock } from '@element-plus/icons-vue'
import { statsApi, assignmentApi } from '@/api'

const stats = ref({})
const pending = ref([])

function formatTime(t) { return new Date(t).toLocaleString('zh-CN') }
function isUrgent(deadline) {
  const diff = new Date(deadline) - new Date()
  return diff < 24 * 60 * 60 * 1000 && diff > 0
}

async function loadData() {
  try {
    const s = await statsApi.student()
    stats.value = s.data
  } catch (e) {}
  try {
    const res = await assignmentApi.list({ pageSize: 50 })
    // 筛选未提交且未逾期的
    pending.value = res.data.list.filter(a => !a.my_submission && !a.is_overdue).slice(0, 5)
  } catch (e) {}
}

onMounted(loadData)
</script>

<style scoped>
.todo-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px; border-radius: 8px; background: var(--bg);
  margin-bottom: 10px;
}
.todo-title { font-size: 15px; font-weight: 500; margin-bottom: 6px; }
.todo-meta { display: flex; align-items: center; gap: 12px; }
.deadline { font-size: 12px; color: var(--text-light); display: flex; align-items: center; gap: 4px; }
.deadline.urgent { color: var(--danger); font-weight: 600; }
</style>
