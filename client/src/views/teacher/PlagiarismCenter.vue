<template>
  <div class="page-container">
    <div class="page-title">
      查重检测中心
      <el-button v-if="currentAssignment" type="primary" plain style="margin-left:auto" @click="backToList">
        返回作业列表
      </el-button>
    </div>

    <!-- 步骤1：选择作业 -->
    <div v-if="!currentAssignment" class="card-section">
      <h3 style="margin-bottom:16px">选择要查重的作业</h3>
      <el-table v-if="loadingAssignments || assignments.length > 0" :data="assignments" stripe v-loading="loadingAssignments">
        <el-table-column label="作业标题" min-width="180">
          <template #default="{ row }">
            <div style="font-weight:500">{{ row.title }}</div>
          </template>
        </el-table-column>
        <el-table-column label="课程 / 班级" min-width="160">
          <template #default="{ row }">
            <div>{{ row.course?.name }}</div>
            <div style="font-size:12px;color:var(--text-light)">{{ row.course?.class?.name }}</div>
          </template>
        </el-table-column>
        <el-table-column label="截止时间" width="170">
          <template #default="{ row }">{{ formatTime(row.deadline) }}</template>
        </el-table-column>
        <el-table-column label="提交人数" width="100" align="center">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ row.submit_count || 0 }} 人</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="160" align="center">
          <template #default="{ row }">
            <el-button
              type="warning"
              size="small"
              :disabled="(row.submit_count || 0) < 2"
              @click="selectAssignment(row)"
            >
              查重检测
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <EmptyState v-if="!loadingAssignments && assignments.length === 0" size="compact" description="暂无作业" />
    </div>

    <!-- 步骤2：查重结果面板 -->
    <template v-if="currentAssignment">
      <!-- 作业信息和操作区 -->
      <div class="card-section">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
          <div>
            <h2>{{ currentAssignment.title }}</h2>
            <div class="info-row">
              <span>{{ currentAssignment.course?.name }} / {{ currentAssignment.course?.class?.name }}</span>
              <span>截止：{{ formatTime(currentAssignment.deadline) }}</span>
              <span>已提交：{{ currentAssignment.submit_count || 0 }} 人</span>
            </div>
          </div>
          <div style="display:flex;gap:8px">
            <el-button
              type="warning"
              :loading="batchLoading"
              :disabled="(currentAssignment.submit_count || 0) < 2"
              @click="batchCheckAll"
              size="large"
            >
              <el-icon><DCaret /></el-icon>
              {{ batchLoading ? '查重中...' : '一键查重全班' }}
            </el-button>
          </div>
        </div>
      </div>

      <!-- 查重进度（后台任务执行中，前端轮询） -->
      <div v-if="batchLoading" class="card-section">
        <div class="progress-wrapper">
          <el-progress :percentage="batchProgress" :stroke-width="12" />
          <p class="progress-text">
            {{ taskStatusText }}
            <span v-if="batchTotal > 0">（已完成 {{ batchCurrent }} / {{ batchTotal }} 对比对）</span>
          </p>
          <div style="text-align:center;margin-top:8px">
            <el-button size="small" plain :loading="cancelling" @click="cancelRunningTask">
              取消查重
            </el-button>
          </div>
        </div>
      </div>

      <!-- 查重结果摘要 -->
      <div v-if="!batchLoading && batchResult" class="card-section">
        <div class="summary-grid">
          <div class="summary-card">
            <div class="summary-number">{{ batchResult.total }}</div>
            <div class="summary-label">总提交数</div>
          </div>
          <div class="summary-card">
            <div class="summary-number">{{ batchResult.totalComparisons || 0 }}</div>
            <div class="summary-label">总比对次数</div>
          </div>
          <div class="summary-card highlight">
            <div class="summary-number">{{ batchResult.suspiciousCount || 0 }}</div>
            <div class="summary-label">可疑结果</div>
          </div>
        </div>
      </div>

      <!-- 可疑结果列表 -->
      <div v-if="!batchLoading && suspiciousResults.length > 0" class="card-section">
        <div class="section-header">
          <h3><el-icon style="color:var(--color-danger)"><WarningFilled /></el-icon>可疑结果（前 {{ suspiciousResults.length }} 条）</h3>
        </div>
        <el-table :data="suspiciousResults" stripe @row-click="viewDetail">
          <el-table-column label="学生 A" width="120">
            <template #default="{ row }">{{ row.studentName }}</template>
          </el-table-column>
          <el-table-column label="学生 B" width="120">
            <template #default="{ row }">{{ row.comparedWithName }}</template>
          </el-table-column>
          <el-table-column label="综合相似度" width="160">
            <template #default="{ row }">
              <el-progress
                :percentage="Math.round(row.similarityScore)"
                :color="scoreColor(row.similarityScore)"
                :stroke-width="18"
                :text-inside="true"
              />
            </template>
          </el-table-column>
          <el-table-column label="风险等级" width="120" align="center">
            <template #default="{ row }">
              <el-tag :type="row.similarityScore > 70 ? 'danger' : 'warning'" size="small">
                {{ row.similarityScore > 70 ? '高度可疑' : '中度可疑' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="120" align="center">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click.stop="viewDetail(row)">查看详情</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <!-- 无可疑结果 -->
      <div v-if="!batchLoading && batchResult && suspiciousResults.length === 0" class="card-section">
        <el-result icon="success" title="查重完成" sub-title="本次检测未发现可疑结果">
          <template #extra>
            <el-button type="primary" @click="backToList">返回列表</el-button>
          </template>
        </el-result>
      </div>

      <!-- 所有学生查重得分概览 -->
      <div v-if="!batchLoading && Object.keys(studentMaxScores).length > 0" class="card-section">
        <div class="section-header">
          <h3><el-icon><DataAnalysis /></el-icon>全班查重结果一览</h3>
        </div>
        <el-table :data="studentScoreList" stripe size="small">
          <el-table-column label="学生" prop="studentName" width="120" />
          <el-table-column label="最高相似度" width="180">
            <template #default="{ row }">
              <el-progress
                :percentage="Math.round(row.maxScore)"
                :color="scoreColor(row.maxScore)"
                :stroke-width="14"
                :text-inside="true"
              />
            </template>
          </el-table-column>
          <el-table-column label="风险" width="100" align="center">
            <template #default="{ row }">
              <el-tag v-if="row.maxScore > 70" type="danger" size="small">高危</el-tag>
              <el-tag v-else-if="row.maxScore > 40" type="warning" size="small">中危</el-tag>
              <el-tag v-else type="success" size="small">正常</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="120" align="center">
            <template #default="{ row }">
              <el-button
                link type="primary" size="small"
                @click="viewStudentDetail(row.submissionId)"
              >
                查看详情
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </template>

    <!-- 查重详情弹窗 -->
    <PlagiarismDetail
      v-model="detailVisible"
      :assignment-id="assignmentId"
      :submission-id="detailSubmissionId"
      @refresh="loadSummary"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { DCaret } from '@element-plus/icons-vue'
import { assignmentApi, plagiarismApi } from '@/api'
import PlagiarismDetail from '@/components/PlagiarismDetail.vue'

const loadingAssignments = ref(false)
const assignments = ref([])
const currentAssignment = ref(null)
const batchLoading = ref(false)
const batchProgress = ref(0)
const batchCurrent = ref(0)
const batchTotal = ref(0)
const batchResult = ref(null)
const suspiciousResults = ref([])
const studentMaxScores = ref({})
const detailVisible = ref(false)
const detailSubmissionId = ref(null)
const cancelling = ref(false)
const taskPhase = ref('') // 任务阶段提示（物化文件/检测中）
let pollTimer = null
const assignmentId = computed(() => currentAssignment.value?.id)

const taskStatusText = computed(() => {
  if (taskPhase.value) return taskPhase.value
  return '后台查重进行中，可离开本页，稍后回来查看进度...'
})

const studentScoreList = computed(() => {
  const nameMap = batchResult.value?.studentNameMap || {}
  return Object.entries(studentMaxScores.value).map(([submissionId, maxScore]) => {
    return {
      submissionId: parseInt(submissionId),
      studentName: nameMap[submissionId] || '未知',
      maxScore: parseFloat(maxScore)
    }
  }).sort((a, b) => b.maxScore - a.maxScore)
})

function formatTime(t) {
  const d = new Date(t)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('zh-CN')
}

function scoreColor(score) {
  if (score > 70) return '#f56c6c'
  if (score > 40) return '#e6a23c'
  return '#67c23a'
}

async function loadAssignments() {
  loadingAssignments.value = true
  try {
    const res = await assignmentApi.list({ page: 1, pageSize: 100 })
    assignments.value = res.data.list || []
  } catch (e) {
    ElMessage.error('加载作业列表失败')
  } finally {
    loadingAssignments.value = false
  }
}

function selectAssignment(row) {
  if ((row.submit_count || 0) < 2) {
    ElMessage.warning('提交人数不足，至少需要2人提交才能查重')
    return
  }
  currentAssignment.value = row
  batchResult.value = null
  suspiciousResults.value = []
  studentMaxScores.value = {}
  batchProgress.value = 0
  batchCurrent.value = 0
  batchTotal.value = 0
  // 加载已有结果 + 若有进行中的查重任务则恢复进度展示
  loadSummary()
  resumeRunningTask()
}

function backToList() {
  stopPolling()
  currentAssignment.value = null
  batchResult.value = null
  suspiciousResults.value = []
  studentMaxScores.value = {}
  loadAssignments()
}

/** 进入作业时检查是否有进行中的任务，有则恢复轮询展示 */
async function resumeRunningTask() {
  if (!currentAssignment.value) return
  try {
    const res = await plagiarismApi.taskStatus(currentAssignment.value.id)
    const t = res.data?.task
    if (t && (t.status === 'pending' || t.status === 'processing')) {
      batchLoading.value = true
      taskPhase.value = t.status === 'pending' ? '任务排队中...' : ''
      batchTotal.value = t.totalPairs || 0
      batchCurrent.value = t.completedPairs || 0
      startPolling()
    } else if (t && t.status === 'done' && res.data?.summary) {
      applySummary(res.data.summary)
    }
  } catch (e) {
    // 状态查询失败不影响使用
  }
}

async function batchCheckAll() {
  try {
    await ElMessageBox.confirm(
      `将对「${currentAssignment.value.title}」所有已提交作业进行两两查重比对，任务在后台执行，可随时回来查看进度，是否继续？`,
      '全班一键查重',
      {
        type: 'warning',
        confirmButtonText: '开始查重',
        cancelButtonText: '取消'
      }
    )
  } catch (e) {
    return
  }

  batchLoading.value = true
  batchProgress.value = 0
  batchCurrent.value = 0
  batchTotal.value = 0
  taskPhase.value = '正在创建查重任务...'

  try {
    const res = await plagiarismApi.batchCheck(currentAssignment.value.id)

    // 提交人数不足等情况：直接提示并结束
    if (!res.data?.task) {
      ElMessage.info(res.message || '无法创建查重任务')
      batchLoading.value = false
      return
    }

    if (res.data.alreadyRunning) {
      ElMessage.info('该作业已有查重任务在进行中，正在展示进度')
    }

    batchTotal.value = res.data.task.totalPairs || 0
    batchCurrent.value = res.data.task.completedPairs || 0
    taskPhase.value = res.data.task.status === 'pending' ? '任务排队中...' : ''
    startPolling()
  } catch (e) {
    ElMessage.error(e.message || '创建查重任务失败')
    batchLoading.value = false
  }
}

function startPolling() {
  stopPolling()
  pollTimer = setInterval(pollTaskStatus, 2000)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function pollTaskStatus() {
  if (!currentAssignment.value) return stopPolling()
  try {
    const res = await plagiarismApi.taskStatus(currentAssignment.value.id)
    const t = res.data?.task
    if (!t) {
      stopPolling()
      batchLoading.value = false
      return
    }

    batchTotal.value = t.totalPairs || 0
    batchCurrent.value = t.completedPairs || 0
    taskPhase.value = t.status === 'pending' ? '任务排队中...' : ''
    batchProgress.value = batchTotal.value > 0
      ? Math.min(100, Math.floor((batchCurrent.value / batchTotal.value) * 100))
      : (t.status === 'done' ? 100 : 0)

    if (t.status === 'done') {
      stopPolling()
      batchLoading.value = false
      applySummary(res.data?.summary)
    } else if (t.status === 'failed') {
      stopPolling()
      batchLoading.value = false
      batchProgress.value = 0
      ElMessage.error(t.errorMsg || '查重任务执行失败')
    } else if (t.status === 'cancelled') {
      stopPolling()
      batchLoading.value = false
      ElMessage.info('查重任务已取消')
    }
  } catch (e) {
    // 单次轮询失败（网络抖动）忽略，下一轮重试
  }
}

/** 任务完成后套用汇总数据（结构与旧版同步接口一致） */
function applySummary(summary) {
  if (!summary) return
  batchResult.value = summary
  suspiciousResults.value = (summary.suspiciousResults || []).map(r => ({
    ...r,
    similarityScore: parseFloat(r.similarityScore) || 0
  }))
  studentMaxScores.value = summary.studentMaxScores || {}
  batchProgress.value = 100

  if (suspiciousResults.value.length > 0) {
    ElMessage.warning(`查重完成，发现 ${summary.suspiciousCount || suspiciousResults.value.length} 对可疑结果`)
  } else {
    ElMessage.success('查重完成，未发现可疑结果')
  }
}

async function cancelRunningTask() {
  if (!currentAssignment.value) return
  try {
    await ElMessageBox.confirm('确定取消当前查重任务吗？已完成的对不会回滚。', '取消查重', {
      type: 'warning',
      confirmButtonText: '确定取消',
      cancelButtonText: '继续查重'
    })
  } catch (e) {
    return
  }
  cancelling.value = true
  try {
    await plagiarismApi.taskCancel(currentAssignment.value.id)
    ElMessage.success('已发送取消指令，任务将在当前比对完成后停止')
  } catch (e) {
    ElMessage.error(e.message || '取消失败')
  } finally {
    cancelling.value = false
  }
}

async function loadSummary() {
  if (!currentAssignment.value) return
  try {
    const res = await plagiarismApi.assignmentSummary(currentAssignment.value.id)
    studentMaxScores.value = res.data?.summary || {}
  } catch (e) {
    // 没有结果正常
  }
}

function viewDetail(row) {
  detailSubmissionId.value = row.submissionId
  detailVisible.value = true
}

function viewStudentDetail(submissionId) {
  detailSubmissionId.value = submissionId
  detailVisible.value = true
}

onMounted(loadAssignments)
onUnmounted(stopPolling)
</script>

<style scoped>
.info-row {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  font-size: 13px;
  color: var(--text-light);
  margin-top: 8px;
}
.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}
.summary-card {
  background: var(--bg);
  border-radius: 12px;
  padding: 20px;
  text-align: center;
  border: 1px solid #eee;
}
.summary-card.highlight {
  border-color: var(--el-color-warning);
  background: #fffbe6;
}
.summary-number {
  font-size: 36px;
  font-weight: 800;
  color: var(--el-color-primary);
}
.summary-card.highlight .summary-number {
  color: var(--el-color-warning);
}
.summary-label {
  font-size: 13px;
  color: #999;
  margin-top: 4px;
}
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.section-header h3 {
  margin: 0;
  font-size: 16px;
}
.progress-wrapper {
  padding: 20px 0;
}
.progress-text {
  text-align: center;
  color: #999;
  font-size: 13px;
  margin-top: 8px;
}
</style>