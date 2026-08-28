<template>
  <div class="page-container">
    <div class="page-title">我的提交记录</div>

    <div class="card-section">
      <div v-if="list.length === 0" class="empty-box">
        <el-icon :size="48"><UploadFilled /></el-icon>
        <p style="margin-top:12px">还没有提交记录</p>
      </div>

      <el-table v-else v-loading="loading" :data="list" stripe>
        <el-table-column label="作业" min-width="200">
          <template #default="{ row }">
            <div class="sub-title">{{ row.assignment?.title }}</div>
            <div class="sub-course">{{ row.assignment?.course?.name }}</div>
          </template>
        </el-table-column>
        <el-table-column label="提交时间" width="170">
          <template #default="{ row }">{{ formatTime(row.submitted_at) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusText(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="分数" width="80">
          <template #default="{ row }">
            <span v-if="row.score !== null" class="score">{{ row.score }}</span>
            <span v-else class="placeholder-text">—</span>
          </template>
        </el-table-column>
        <el-table-column label="老师评语" min-width="200">
          <template #default="{ row }">
            <span v-if="row.comment">{{ row.comment }}</span>
            <span v-else class="placeholder-text">暂无</span>
          </template>
        </el-table-column>
        <el-table-column label="文件数" width="80" align="center">
          <template #default="{ row }">{{ row.files?.length || 0 }}</template>
        </el-table-column>
        <el-table-column label="操作" width="170" align="center">
          <template #default="{ row }">
            <el-button link type="primary" @click="$router.push(`/student/assignments/${row.assignment_id}`)">查看</el-button>
            <el-button link type="success" :loading="gradingLoadingId === row.id" @click="openGradingResult(row)">AI批改详情</el-button>
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

    <!-- AI 批改结果对话框 -->
    <el-dialog v-model="gradingVisible" title="AI 批改详情" width="760px" top="3vh">
      <GradingResultCard v-if="gradingResult" :result="gradingResult" />
      <div v-else style="text-align:center;color:var(--text-light);padding:40px 0">该提交暂无 AI 批改结果</div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { UploadFilled } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { submissionApi, gradingApi } from '@/api'
import { SUBMISSION_STATUS, statusOf } from '@/utils/statusMaps'
import GradingResultCard from '@/components/GradingResultCard.vue'

const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 10
const loading = ref(false)

const gradingVisible = ref(false)
const gradingResult = ref(null)
const gradingLoadingId = ref(null)

function formatTime(t) { return new Date(t).toLocaleString('zh-CN') }
const statusText = (s) => statusOf(SUBMISSION_STATUS, s).text
const statusType = (s) => statusOf(SUBMISSION_STATUS, s).type

async function loadData() {
  loading.value = true
  try {
    const res = await submissionApi.myList({ page: page.value, pageSize })
    list.value = res.data.list
    total.value = res.data.total
  } finally { loading.value = false }
}
function handlePage(p) { page.value = p; loadData() }

async function openGradingResult(row) {
  gradingLoadingId.value = row.id
  try {
    const res = await gradingApi.resultBySubmission(row.id)
    if (!res.data) {
      gradingResult.value = null
      gradingVisible.value = true
      return
    }
    gradingResult.value = res.data
    gradingVisible.value = true
  } catch (e) {
    // 学生只能看自己的提交，403/404 一般是路径异常
    ElMessage.error(e.response?.data?.message || '查询批改结果失败')
  } finally {
    gradingLoadingId.value = null
  }
}

onMounted(loadData)
</script>

<style scoped>
.sub-title { font-weight: 500; }
.sub-course { font-size: 12px; color: var(--text-light); margin-top: 2px; }
.score { font-size: 16px; font-weight: 700; color: var(--primary); }
.placeholder-text { color: var(--ink-400); }
</style>
