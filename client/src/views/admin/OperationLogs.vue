<template>
  <div class="page-container">
    <div class="page-title">操作日志</div>

    <el-alert type="info" :closable="false" style="margin-bottom:20px">
      系统自动记录所有变更类操作（登录、账号管理、作业发布/批改、查重、清理等）。
      为防止日志堆满磁盘：超过 <strong>{{ meta.retentionDays }}</strong> 天的记录每天自动清理，
      总条数超过 <strong>{{ meta.maxRows.toLocaleString() }}</strong> 条时从最旧开始删除。
      当前共 <strong>{{ meta.total.toLocaleString() }}</strong> 条<template v-if="meta.oldest">，最早记录于 {{ formatTime(meta.oldest) }}</template>。
      <el-button link type="primary" style="margin-left:8px" :loading="cleaning" @click="runCleanup">立即执行清理</el-button>
    </el-alert>

    <div class="card-section">
      <div class="filter-bar">
        <el-input v-model="filters.keyword" placeholder="搜索账号 / 姓名 / 路径 / IP" clearable style="width:220px" @keyup.enter="search" />
        <el-select v-model="filters.action" placeholder="动作类型" clearable filterable style="width:200px">
          <el-option v-for="a in actions" :key="a.action" :value="a.action" :label="a.action_label" />
        </el-select>
        <el-select v-model="filters.result" placeholder="结果" clearable style="width:110px">
          <el-option label="成功" :value="1" />
          <el-option label="失败" :value="0" />
        </el-select>
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          value-format="YYYY-MM-DD"
          style="width:260px"
        />
        <el-button type="primary" :icon="Search" @click="search">查询</el-button>
        <el-button @click="reset">重置</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe style="width:100%">
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作人" min-width="140">
          <template #default="{ row }">
            <div v-if="row.username">
              <div>{{ row.real_name || '—' }}</div>
              <div style="font-size:12px;color:var(--text-light)">{{ row.username }}</div>
            </div>
            <span v-else style="color:var(--text-light)">未登录</span>
          </template>
        </el-table-column>
        <el-table-column label="角色" width="80">
          <template #default="{ row }">
            <el-tag v-if="row.role" size="small" :type="statusOf(ROLE, row.role).type">{{ statusOf(ROLE, row.role).text }}</el-tag>
            <span v-else style="color:var(--text-light)">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" min-width="150">
          <template #default="{ row }">
            <span :class="{ 'danger-op': row.action_label === '删除用户' || row.action_label === '删除作业' }">
              {{ row.action_label }}
            </span>
            <div style="font-size:12px;color:var(--text-light)">{{ row.method }} {{ row.path }}</div>
          </template>
        </el-table-column>
        <el-table-column label="目标ID" prop="target_id" width="80">
          <template #default="{ row }">{{ row.target_id ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="结果" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="row.result === 1 ? 'success' : 'danger'">
              {{ row.result === 1 ? '成功' : '失败' }} {{ row.status_code }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="IP" prop="ip" width="130">
          <template #default="{ row }">{{ row.ip || '—' }}</template>
        </el-table-column>
        <el-table-column label="详情" width="70" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.detail" link type="primary" @click="showDetail(row)">查看</el-button>
            <span v-else style="color:var(--text-light)">—</span>
          </template>
        </el-table-column>
      </el-table>

      <div style="display:flex;justify-content:flex-end;margin-top:16px">
        <el-pagination
          background
          layout="total, prev, pager, next"
          :total="total"
          :page-size="pageSize"
          :current-page="page"
          @current-change="handlePage"
        />
      </div>
    </div>

    <!-- 参数详情（已脱敏） -->
    <el-dialog v-model="detailVisible" title="操作参数详情（敏感字段已脱敏）" width="640px">
      <div style="margin-bottom:12px;color:var(--text-light);font-size:13px">
        {{ detailRow?.action_label }} · {{ detailRow?.method }} {{ detailRow?.path }}
      </div>
      <pre class="detail-pre">{{ prettyDetail }}</pre>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import { operationLogApi } from '@/api'
import { ROLE, statusOf } from '@/utils/statusMaps'

const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false)
const cleaning = ref(false)

const filters = reactive({ keyword: '', action: '', result: '' })
const dateRange = ref(null)
const actions = ref([])
const meta = ref({ total: 0, oldest: null, retentionDays: 180, maxRows: 200000 })

const detailVisible = ref(false)
const detailRow = ref(null)
const prettyDetail = computed(() => {
  if (!detailRow.value?.detail) return ''
  try { return JSON.stringify(JSON.parse(detailRow.value.detail), null, 2) } catch (e) {
    return detailRow.value.detail
  }
})

function formatTime(t) {
  const d = new Date(t)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('zh-CN')
}

async function loadMeta() {
  try {
    const res = await operationLogApi.meta()
    meta.value = { ...meta.value, ...res.data }
    actions.value = res.data.actions || []
  } catch (e) { /* 筛选下拉加载失败不阻断列表 */ }
}

async function loadData() {
  loading.value = true
  try {
    const params = {
      page: page.value, pageSize,
      keyword: filters.keyword || undefined,
      action: filters.action || undefined,
      result: filters.result === '' ? undefined : filters.result,
      start_date: dateRange.value?.[0],
      end_date: dateRange.value?.[1]
    }
    const res = await operationLogApi.list(params)
    list.value = res.data.list
    total.value = res.data.total
  } finally { loading.value = false }
}

function handlePage(p) { page.value = p; loadData() }
function search() { page.value = 1; loadData() }
function reset() {
  filters.keyword = ''
  filters.action = ''
  filters.result = ''
  dateRange.value = null
  search()
}

function showDetail(row) {
  detailRow.value = row
  detailVisible.value = true
}

async function runCleanup() {
  try {
    await ElMessageBox.confirm(
      `将立即删除超过 ${meta.value.retentionDays} 天及超出 ${meta.value.maxRows.toLocaleString()} 条上限的操作日志，确定执行？`,
      '清理确认', { type: 'warning' }
    )
  } catch (e) { return }
  cleaning.value = true
  try {
    const res = await operationLogApi.cleanup()
    ElMessage.success(res.message)
    loadMeta()
    loadData()
  } catch (e) {} finally { cleaning.value = false }
}

onMounted(() => {
  loadMeta()
  loadData()
})
</script>

<style scoped>
.danger-op { color: var(--el-color-danger); font-weight: 500; }
.detail-pre {
  background: var(--bg);
  padding: 14px;
  border-radius: 6px;
  max-height: 420px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
}
</style>
