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

      <!-- 任务待办（老师/学委发布） -->
      <div class="card-section" style="margin-top:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h3>
            <el-icon><Memo /></el-icon>任务待办
            <el-tag v-if="pendingTodos.length > 0" type="warning" size="small" effect="plain" style="margin-left:8px">
              {{ pendingTodos.length }} 条未完成
            </el-tag>
          </h3>
          <el-button type="primary" link @click="$router.push('/student/todos')">查看全部</el-button>
        </div>
        <EmptyState v-if="pendingTodos.length === 0" size="compact" title="全部完成" description="暂无未完成的任务待办" />
        <div v-for="item in pendingTodos" :key="item.id" class="todo-item">
          <div class="todo-info">
            <div class="todo-title">
              {{ item.title }}
              <el-tag v-if="item.is_overdue" type="danger" size="small" effect="plain">已逾期</el-tag>
            </div>
            <div class="todo-meta">
              <span class="deadline">{{ todoCreatorText(item) }}发布</span>
              <span v-if="item.due_date" class="deadline" :class="{ urgent: isUrgent(item.due_date) }">
                <el-icon><Clock /></el-icon>
                截止：{{ formatTime(item.due_date) }}
              </span>
              <span v-else class="deadline">无截止时间</span>
            </div>
          </div>
          <el-button type="success" size="small" :loading="completingId === item.id" @click="handleCompleteTodo(item)">
            标记完成
          </el-button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { School, Reading, AlarmClock, Finished, Clock, Tickets, Memo } from '@element-plus/icons-vue'
import { statsApi, assignmentApi, classApi, todoApi } from '@/api'

const stats = ref({})
const pending = ref([])
const classNames = ref([])
const todos = ref([])
const completingId = ref(null)
const loading = ref(true)
const loadError = ref(false)

// 进行中且我未完成的任务待办（最多展示 5 条，其余进「任务待办」页）
const pendingTodos = computed(() =>
  todos.value.filter(t => t.status === 'active' && !t.my_completion).slice(0, 5)
)

function formatTime(t) {
  const d = new Date(t)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('zh-CN')
}
function isUrgent(deadline) {
  const diff = new Date(deadline) - new Date()
  return diff < 24 * 60 * 60 * 1000 && diff > 0
}
function todoCreatorText(item) {
  const identity = item.creator_identity ||
    (item.creator?.role === 'teacher' ? '老师' : (item.creator?.role === 'student' ? '同学' : ''))
  return `${identity}${item.creator?.real_name || ''}`
}

async function handleCompleteTodo(item) {
  completingId.value = item.id
  try {
    await todoApi.complete(item.id)
    ElMessage.success('已完成该待办')
    // 本地移除，避免整页刷新打断浏览
    todos.value = todos.value.filter(t => t.id !== item.id)
  } finally {
    completingId.value = null
  }
}

async function loadData() {
  loading.value = true
  loadError.value = false
  // allSettled 保留部分成功：仅全部失败才进入错误态
  const [s, res, c, t] = await Promise.allSettled([
    statsApi.student(),
    assignmentApi.list({ pageSize: 50 }),
    classApi.myClasses(),
    todoApi.list({ pageSize: 50, status: 'active' })
  ])
  if (s.status === 'fulfilled') stats.value = s.value.data
  if (res.status === 'fulfilled') {
    pending.value = res.value.data.list.filter(a => !a.my_submission && !a.is_overdue).slice(0, 5)
  }
  if (c.status === 'fulfilled') {
    classNames.value = c.value.data.map(x => x.name)
  }
  if (t.status === 'fulfilled') {
    todos.value = t.value.data.list
  }
  loadError.value = s.status === 'rejected' && res.status === 'rejected' && t.status === 'rejected'
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
