<template>
  <div class="page-container">
    <div class="page-title">学生仪表盘</div>
    <div class="page-desc">掌握你的班级、作业与提交动态</div>

    <!-- 加载失败（全部请求失败才进入错误态，带重试） -->
    <EmptyState v-if="loadError" type="error" description="仪表盘数据加载失败，请检查网络后重试" @retry="loadData" />

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
      <!-- 数据卡片 -->
      <el-row :gutter="16" class="stagger" style="margin-bottom:20px">
        <el-col :xs="12" :md="6">
          <StatCard label="我的班级" :value="classNames.length ? classNames.join('、') : (stats.classCount || '—')"
            :hint="classNames.join('、')" :icon="School" to="/student/classes" />
        </el-col>
        <el-col :xs="12" :md="6">
          <StatCard label="在修课程" :value="stats.courseCount || 0" :icon="Reading" />
        </el-col>
        <el-col :xs="12" :md="6">
          <StatCard label="待提交作业" :value="stats.pendingSubmit || 0" :icon="AlarmClock" tone="warning" to="/student/assignments" />
        </el-col>
        <el-col :xs="12" :md="6">
          <StatCard label="已提交作业" :value="stats.mySubmissions || 0" :icon="Finished" to="/student/submissions" />
        </el-col>
      </el-row>

      <!-- 待办作业 -->
      <div class="card-section">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h3><el-icon><Tickets /></el-icon>待办作业</h3>
          <el-button type="primary" link @click="$router.push('/student/assignments')">查看全部</el-button>
        </div>
        <EmptyState v-if="pending.length === 0" size="compact" title="全部完成" description="暂无待办作业" />
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
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { School, Reading, AlarmClock, Finished, Clock, Tickets } from '@element-plus/icons-vue'
import { statsApi, assignmentApi, classApi } from '@/api'

const stats = ref({})
const pending = ref([])
const classNames = ref([])
const loading = ref(true)
const loadError = ref(false)

function formatTime(t) { return new Date(t).toLocaleString('zh-CN') }
function isUrgent(deadline) {
  const diff = new Date(deadline) - new Date()
  return diff < 24 * 60 * 60 * 1000 && diff > 0
}

async function loadData() {
  loading.value = true
  loadError.value = false
  // allSettled 保留部分成功：仅全部失败才进入错误态
  const [s, res, c] = await Promise.allSettled([
    statsApi.student(),
    assignmentApi.list({ pageSize: 50 }),
    classApi.myClasses()
  ])
  if (s.status === 'fulfilled') stats.value = s.value.data
  if (res.status === 'fulfilled') {
    pending.value = res.value.data.list.filter(a => !a.my_submission && !a.is_overdue).slice(0, 5)
  }
  if (c.status === 'fulfilled') {
    classNames.value = c.value.data.map(x => x.name)
  }
  loadError.value = s.status === 'rejected' && res.status === 'rejected'
  loading.value = false
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
