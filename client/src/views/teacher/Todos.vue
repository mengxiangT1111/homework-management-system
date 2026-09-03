<template>
  <div class="page-container">
    <div class="page-title-row">
      <div class="page-title">任务待办</div>
      <el-button type="primary" :disabled="classes.length === 0" @click="formVisible = true">
        <el-icon style="margin-right:4px"><Plus /></el-icon>发布待办
      </el-button>
    </div>
    <p class="page-desc">面向你任教或担任班主任的班级发布任务待办，学生完成情况一目了然</p>

    <div class="card-section">
      <div class="table-toolbar">
        <div class="toolbar-filters">
          <el-select v-model="classFilter" placeholder="全部班级" clearable style="width:200px" @change="handleFilterChange">
            <el-option v-for="c in classes" :key="c.id" :label="`${c.name}（${c.grade}）`" :value="c.id" />
          </el-select>
          <el-radio-group v-model="statusFilter" @change="handleFilterChange">
            <el-radio-button value="active">进行中</el-radio-button>
            <el-radio-button value="closed">已结束</el-radio-button>
            <el-radio-button value="all">全部</el-radio-button>
          </el-radio-group>
        </div>
        <span class="toolbar-meta">共 {{ total }} 条待办</span>
      </div>

      <div v-if="list.length === 0 && !loading" class="empty-box">
        <el-icon :size="48"><Tickets /></el-icon>
        <p style="margin-top:12px">{{ classes.length === 0 ? '你还不是任何班级的班主任或任课教师' : '暂无待办，点击右上角发布' }}</p>
      </div>

      <el-table v-else v-loading="loading" :data="list" stripe>
        <el-table-column label="待办" min-width="220">
          <template #default="{ row }">
            <div class="td-title">
              {{ row.title }}
              <el-tag :type="statusOf(TODO_STATUS, row.status).type" size="small" effect="plain">
                {{ statusOf(TODO_STATUS, row.status).text }}
              </el-tag>
              <el-tag v-if="row.is_overdue" type="danger" size="small" effect="plain">已逾期</el-tag>
            </div>
            <div v-if="row.content" class="td-content">{{ row.content }}</div>
          </template>
        </el-table-column>
        <el-table-column label="班级" width="150">
          <template #default="{ row }">{{ row.class?.name }}</template>
        </el-table-column>
        <el-table-column label="截止时间" width="160">
          <template #default="{ row }">{{ row.due_date ? formatTime(row.due_date) : '—' }}</template>
        </el-table-column>
        <el-table-column label="完成情况" min-width="180">
          <template #default="{ row }">
            <div class="rate-cell">
              <el-progress
                :percentage="row.class_size > 0 ? Math.round(row.completed_count / row.class_size * 100) : 0"
                :color="rateColor(row.class_size > 0 ? Math.round(row.completed_count / row.class_size * 100) : 0)"
                :stroke-width="8" :show-text="false" style="flex:1"
              />
              <span class="rate-text">{{ row.completed_count }}/{{ row.class_size }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="发布时间" width="160">
          <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="240" align="center" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button link type="primary" @click="openProgress(row)">进度</el-button>
            <el-button v-if="row.status === 'active'" link type="warning" @click="handleToggleStatus(row)">结束</el-button>
            <el-button v-else link type="success" @click="handleToggleStatus(row)">重启</el-button>
            <el-button link type="danger" @click="handleRemove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-if="total > 0" background layout="prev, pager, next, total"
        :total="total" :page-size="pageSize" :current-page="page"
        class="table-footer"
        @current-change="handlePage"
      />
    </div>

    <TodoFormDialog v-model="formVisible" :todo="editing" :classes="classes" @saved="reload" />
    <TodoProgressDialog v-model="progressVisible" :todo="progressTodo" @reminded="reload" />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Tickets, Plus } from '@element-plus/icons-vue'
import { todoApi } from '@/api'
import { formatTime, rateColor } from '@/utils/format'
import { TODO_STATUS, statusOf } from '@/utils/statusMaps'
import TodoFormDialog from '@/components/TodoFormDialog.vue'
import TodoProgressDialog from '@/components/TodoProgressDialog.vue'

const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 10
const loading = ref(false)
const classes = ref([])
const classFilter = ref(null)
const statusFilter = ref('active')

const formVisible = ref(false)
const editing = ref(null)
const progressVisible = ref(false)
const progressTodo = ref(null)

async function loadClasses() {
  try {
    const res = await todoApi.teacherClasses()
    classes.value = res.data || []
  } catch (e) {
    classes.value = []
  }
}

async function loadData() {
  loading.value = true
  try {
    const params = { page: page.value, pageSize, status: statusFilter.value }
    if (classFilter.value) params.class_id = classFilter.value
    const res = await todoApi.list(params)
    list.value = res.data.list
    total.value = res.data.total
  } finally {
    loading.value = false
  }
}

function reload() { loadData() }
function handlePage(p) { page.value = p; loadData() }
function handleFilterChange() { page.value = 1; loadData() }

function openEdit(row) {
  editing.value = row
  formVisible.value = true
}

function openProgress(row) {
  progressTodo.value = row
  progressVisible.value = true
}

async function handleToggleStatus(row) {
  const closing = row.status === 'active'
  try {
    await ElMessageBox.confirm(
      closing ? `确定结束待办「${row.title}」吗？结束后学生将不能再标记完成。` : `确定重新开启待办「${row.title}」吗？`,
      '提示', { type: 'warning' }
    )
  } catch (e) { return }
  await todoApi.update(row.id, { status: closing ? 'closed' : 'active' })
  ElMessage.success(closing ? '待办已结束' : '待办已重新开启')
  loadData()
}

async function handleRemove(row) {
  try {
    await ElMessageBox.confirm(`确定删除待办「${row.title}」吗？`, '提示', { type: 'warning' })
  } catch (e) { return }
  await todoApi.remove(row.id)
  ElMessage.success('待办已删除')
  loadData()
}

onMounted(async () => {
  await loadClasses()
  loadData()
})
</script>

<style scoped>
.page-title-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-wrap: wrap;
}
.page-title-row :deep(.page-title) { margin-bottom: 6px; }
.td-title { font-weight: 500; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.td-content {
  font-size: 12px; color: var(--text-light); margin-top: 4px;
  display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden;
}
.rate-cell { display: flex; align-items: center; gap: 8px; }
.rate-text { font-size: 12px; color: var(--text-light); white-space: nowrap; }
</style>
