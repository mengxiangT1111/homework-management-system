<template>
  <div class="page-container">
    <div class="page-title-row">
      <div class="page-title">任务待办</div>
      <el-button v-if="canPublish" type="primary" @click="formVisible = true">
        <el-icon style="margin-right:4px"><Plus /></el-icon>发布待办
      </el-button>
    </div>
    <p v-if="canPublish" class="page-desc">
      你是{{ publishClass?.name }}的{{ publishIdentity }}，可以为本班发布任务待办
    </p>

    <!-- 未加入班级 -->
    <div v-if="!hasClass" class="card-section">
      <div class="empty-box">
        <el-icon :size="48"><Tickets /></el-icon>
        <p style="margin-top:12px">还没有加入班级</p>
        <p class="placeholder-text">加入班级后即可查看老师和学习委员发布的任务待办</p>
        <el-button type="primary" style="margin-top:8px" @click="$router.push('/student/classes')">去加入班级</el-button>
      </div>
    </div>

    <div v-else class="card-section">
      <div class="table-toolbar">
        <div class="toolbar-filters">
          <el-radio-group v-model="statusFilter" @change="handleFilterChange">
            <el-radio-button value="active">进行中</el-radio-button>
            <el-radio-button value="closed">已结束</el-radio-button>
            <el-radio-button value="all">全部</el-radio-button>
          </el-radio-group>
        </div>
        <span class="toolbar-meta">
          共 {{ total }} 条待办<template v-if="pendingCount !== null">，未完成 {{ pendingCount }} 条</template>
        </span>
      </div>

      <div v-if="list.length === 0 && !loading" class="empty-box">
        <el-icon :size="48"><Tickets /></el-icon>
        <p style="margin-top:12px">{{ statusFilter === 'active' ? '暂无进行中的待办' : '暂无待办' }}</p>
      </div>

      <div v-loading="loading">
        <div v-for="item in list" :key="item.id" class="todo-item" :class="{ 'is-done': item.my_completion }">
          <div class="item-main">
            <div class="item-title">
              <span class="title-text" :class="{ done: item.my_completion }">{{ item.title }}</span>
              <el-tag v-if="item.my_completion" type="success" size="small" effect="plain">已完成</el-tag>
              <el-tag v-else-if="item.is_overdue" type="danger" size="small" effect="plain">已逾期</el-tag>
              <el-tag v-else-if="item.status === 'active'" type="warning" size="small" effect="plain">待完成</el-tag>
              <el-tag :type="statusOf(TODO_STATUS, item.status).type" size="small" effect="plain">
                {{ statusOf(TODO_STATUS, item.status).text }}
              </el-tag>
            </div>
            <div v-if="item.content" class="item-content">{{ item.content }}</div>
            <div class="item-meta">
              <span><el-icon><User /></el-icon>{{ creatorText(item) }}</span>
              <span :class="{ overdue: item.is_overdue }">
                <el-icon><Clock /></el-icon>{{ item.due_date ? formatTime(item.due_date) + ' 截止' : '无截止时间' }}
              </span>
              <span><el-icon><Finished /></el-icon>{{ item.completed_count }}/{{ item.class_size }} 人已完成</span>
            </div>
          </div>

          <div class="item-actions">
            <template v-if="item.status === 'active'">
              <el-button v-if="!item.my_completion" type="success" size="small" :loading="actingId === item.id" @click="handleComplete(item)">标记完成</el-button>
              <el-button v-else size="small" :loading="actingId === item.id" @click="handleUncomplete(item)">取消完成</el-button>
            </template>
            <template v-if="item.is_mine">
              <el-button link type="primary" @click="openEdit(item)">编辑</el-button>
              <el-button link type="primary" @click="openProgress(item)">进度</el-button>
              <el-button v-if="item.status === 'active'" link type="warning" @click="handleToggleStatus(item)">结束</el-button>
              <el-button v-else link type="success" @click="handleToggleStatus(item)">重启</el-button>
              <el-button link type="danger" @click="handleRemove(item)">删除</el-button>
            </template>
          </div>
        </div>
      </div>

      <el-pagination
        v-if="total > 0" background layout="prev, pager, next, total"
        :total="total" :page-size="pageSize" :current-page="page"
        class="table-footer"
        @current-change="handlePage"
      />
    </div>

    <!-- 发布/编辑待办（班级负责人/课代表） -->
    <TodoFormDialog
      v-model="formVisible"
      :todo="editing"
      :fixed-class-id="publishClassId"
      :fixed-class-name="publishClass?.name || ''"
      @saved="reload"
    />
    <!-- 发布者查看完成进度 -->
    <TodoProgressDialog v-model="progressVisible" :todo="progressTodo" @reminded="reload" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Tickets, Plus, User, Clock, Finished } from '@element-plus/icons-vue'
import { todoApi, classApi, courseApi } from '@/api'
import { formatTime } from '@/utils/format'
import { TODO_STATUS, statusOf } from '@/utils/statusMaps'
import TodoFormDialog from '@/components/TodoFormDialog.vue'
import TodoProgressDialog from '@/components/TodoProgressDialog.vue'

const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 10
const loading = ref(false)
const statusFilter = ref('active')
const actingId = ref(null)

const hasClass = ref(true)
// 发布能力：班级负责人（班长/学委）或课代表可发布本班待办（学生只属于一个班）
const publishIdentity = ref('') // 班长 / 学委 / 课代表
const publishClass = ref(null)
const canPublish = computed(() => !!publishClass.value)
const publishClassId = computed(() => publishClass.value?.id || null)

const formVisible = ref(false)
const editing = ref(null)
const progressVisible = ref(false)
const progressTodo = ref(null)

// 进行中且我未完成的数量（工具栏提示；仅 active 视角下与列表一致）
const pendingCount = computed(() => {
  if (statusFilter.value !== 'active') return null
  return list.value.filter(t => !t.my_completion).length
})

function creatorText(item) {
  // creator_identity 为发布时身份（老师/班长/学委/课代表），旧数据按角色兜底
  const identity = item.creator_identity ||
    (item.creator?.role === 'teacher' ? '老师' : (item.creator?.role === 'student' ? '同学' : ''))
  return `${identity}${item.creator?.real_name || ''}`
}

async function loadContext() {
  try {
    const [clsRes, posRes, astRes] = await Promise.all([
      classApi.myClasses(),
      classApi.myPositions(),
      courseApi.myAssistantships().catch(() => ({ data: [] }))
    ])
    // 学生最多属于一个班（后端唯一约束）；有班但职务为空说明是普通成员
    const classes = clsRes.data || []
    hasClass.value = classes.length > 0
    // 发布身份（与后端中间件同口径）：班长/学委优先，其次课代表
    const leaderPos = (posRes.data || []).find(p => p.position === 'monitor' || p.position === 'commissary')
    const assistantships = astRes.data || []
    if (leaderPos) {
      publishIdentity.value = leaderPos.position_text
      publishClass.value = leaderPos.class || classes[0] || null
    } else if (assistantships.length > 0) {
      publishIdentity.value = '课代表'
      publishClass.value = assistantships[0].course?.class || classes[0] || null
    } else {
      publishIdentity.value = ''
      publishClass.value = null
    }
  } catch (e) {
    hasClass.value = true
  }
}

async function loadData() {
  loading.value = true
  try {
    const res = await todoApi.list({ page: page.value, pageSize, status: statusFilter.value })
    list.value = res.data.list
    total.value = res.data.total
  } finally {
    loading.value = false
  }
}

function reload() { loadData() }
function handlePage(p) { page.value = p; loadData() }
function handleFilterChange() { page.value = 1; loadData() }

async function handleComplete(item) {
  actingId.value = item.id
  try {
    await todoApi.complete(item.id)
    ElMessage.success('已完成该待办')
    loadData()
  } finally {
    actingId.value = null
  }
}

async function handleUncomplete(item) {
  actingId.value = item.id
  try {
    await todoApi.uncomplete(item.id)
    ElMessage.success('已取消完成')
    loadData()
  } finally {
    actingId.value = null
  }
}

function openEdit(item) {
  editing.value = item
  formVisible.value = true
}

function openProgress(item) {
  progressTodo.value = item
  progressVisible.value = true
}

async function handleToggleStatus(item) {
  const closing = item.status === 'active'
  try {
    await ElMessageBox.confirm(
      closing ? `确定结束待办「${item.title}」吗？结束后同学将不能再标记完成。` : `确定重新开启待办「${item.title}」吗？`,
      '提示', { type: 'warning' }
    )
  } catch (e) { return }
  await todoApi.update(item.id, { status: closing ? 'closed' : 'active' })
  ElMessage.success(closing ? '待办已结束' : '待办已重新开启')
  loadData()
}

async function handleRemove(item) {
  try {
    await ElMessageBox.confirm(`确定删除待办「${item.title}」吗？`, '提示', { type: 'warning' })
  } catch (e) { return }
  await todoApi.remove(item.id)
  ElMessage.success('待办已删除')
  loadData()
}

onMounted(async () => {
  await loadContext()
  if (hasClass.value) loadData()
})
</script>

<style scoped>
.page-title-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-wrap: wrap;
}
/* 保留 page-title 的品牌竖条视觉 */
.page-title-row :deep(.page-title) { margin-bottom: 6px; }

.todo-item {
  display: flex; justify-content: space-between; align-items: center;
  gap: 12px; padding: 16px; border-radius: 8px; background: var(--bg);
  margin-bottom: 10px; transition: all 0.2s;
}
.todo-item:hover { box-shadow: var(--shadow); }
.todo-item.is-done { opacity: 0.75; }
.item-main { min-width: 0; flex: 1; }
.item-title { font-size: 15px; font-weight: 500; margin-bottom: 8px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.title-text.done { text-decoration: line-through; color: var(--ink-400); }
.item-content {
  font-size: 13px; color: var(--text-light); margin-bottom: 8px;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.item-meta { display: flex; gap: 16px; font-size: 12px; color: var(--text-light); flex-wrap: wrap; }
.item-meta span { display: flex; align-items: center; gap: 4px; }
.overdue { color: var(--danger) !important; font-weight: 600; }
.item-actions { display: flex; align-items: center; gap: 2px; flex-wrap: wrap; justify-content: flex-end; }
.placeholder-text { color: var(--ink-400); font-size: 13px; }

@media (max-width: 600px) {
  .todo-item { flex-direction: column; align-items: stretch; }
  .item-actions { justify-content: flex-start; }
}
</style>
