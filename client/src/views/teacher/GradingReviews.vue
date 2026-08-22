<template>
  <div class="page-container">
    <div class="page-title">AI 批改人工复核</div>

    <div class="card-section">
      <!-- 状态筛选 -->
      <el-radio-group v-model="filterStatus" style="margin-bottom:16px" @change="loadList">
        <el-radio-button value="pending">待复核（{{ pendingCount }}）</el-radio-button>
        <el-radio-button value="approved">已通过</el-radio-button>
        <el-radio-button value="adjusted">已调整</el-radio-button>
        <el-radio-button value="rejected">已否决</el-radio-button>
      </el-radio-group>

      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column label="学生" width="100">
          <template #default="{ row }">
            {{ row.submission?.student?.real_name || '未知' }}
          </template>
        </el-table-column>
        <el-table-column label="学号" width="110">
          <template #default="{ row }">{{ row.submission?.student?.username || '—' }}</template>
        </el-table-column>
        <el-table-column label="AI得分" width="90" align="center">
          <template #default="{ row }">
            <span class="score">{{ row.result?.total_score ?? row.original_score }}</span>
            <span style="color:#909399;font-size:12px"> / {{ row.result?.full_score }}</span>
          </template>
        </el-table-column>
        <el-table-column label="置信度" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="Number(row.result?.confidence) < 0.4 ? 'danger' : 'warning'" size="small">
              {{ row.result?.confidence }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="触发原因" min-width="220">
          <template #default="{ row }">
            <span v-if="row.result?.review_reasons?.length" class="reason-text">{{ row.result.review_reasons.join('；') }}</span>
            <span v-else style="color:#ccc">—</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusText(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="复核结果" width="90" align="center">
          <template #default="{ row }">{{ row.final_score ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="提交时间" width="170">
          <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status === 'pending'" link type="primary" @click="openReview(row)">复核</el-button>
            <el-button v-else link type="primary" @click="openView(row)">查看</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-if="total > pageSize" background layout="prev, pager, next, total"
        :total="total" :page-size="pageSize" :current-page="page"
        style="margin-top:20px; justify-content:center; display:flex"
        @current-change="handlePage"
      />
    </div>

    <!-- 复核对话框 -->
    <el-dialog v-model="reviewVisible" title="人工复核 AI 批改" width="820px" top="3vh">
      <div v-if="current">
        <GradingResultCard :result="reviewPayload" :show-review-reasons="true" />

        <el-divider />

        <!-- 复核操作（仅待复核可操作） -->
        <template v-if="current.status === 'pending'">
          <el-form label-width="90px">
            <el-form-item label="结论">
              <el-radio-group v-model="reviewForm.action">
                <el-radio value="approve">通过（确认AI分数）</el-radio>
                <el-radio value="adjust">调整分数</el-radio>
                <el-radio value="reject">否决（留待人工批阅）</el-radio>
              </el-radio-group>
            </el-form-item>

            <el-form-item v-if="reviewForm.action === 'adjust'" label="最终总分">
              <el-input-number v-model="reviewForm.final_score" :min="0" :max="Number(current.result?.full_score) || 100" :precision="1" />
              <span style="margin-left:8px;color:var(--el-text-color-secondary)">/ {{ current.result?.full_score }}</span>
            </el-form-item>

            <el-form-item v-if="reviewForm.action === 'adjust'" label="维度调分">
              <div style="width:100%">
                <div v-for="d in adjustDims" :key="d.code" style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
                  <span style="width:110px;font-size:13px">{{ d.name }}</span>
                  <el-input-number v-model="d.to" :min="0" :max="Number(d.max_score)" :precision="1" size="small" style="width:120px" controls-position="right" />
                  <span style="color:var(--el-text-color-secondary);font-size:12px">/ {{ d.max_score }}（AI原分：{{ d.from }}）</span>
                </div>
              </div>
            </el-form-item>

            <el-form-item label="复核意见">
              <el-input v-model="reviewForm.comment" type="textarea" :rows="2" placeholder="可选，展示给学生" />
            </el-form-item>
          </el-form>
        </template>

        <!-- 已处理：展示复核结论 -->
        <el-alert v-else :closable="false" :type="current.status === 'rejected' ? 'warning' : 'success'"
          :title="`该工单已处理：${statusText(current.status)}${current.final_score != null ? '，最终分数 ' + current.final_score : ''}${current.comment ? '。意见：' + current.comment : ''}`" />
      </div>

      <template #footer>
        <el-button @click="reviewVisible = false">{{ current?.status === 'pending' ? '取消' : '关闭' }}</el-button>
        <el-button v-if="current?.status === 'pending'" type="primary" :loading="submitting" @click="submit">
          提交复核结论
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import GradingResultCard from '@/components/GradingResultCard.vue'
import { gradingApi } from '@/api'

const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 10
const loading = ref(false)
const filterStatus = ref('pending')
const pendingCount = ref(0)

const reviewVisible = ref(false)
const current = ref(null)
const submitting = ref(false)
const reviewForm = reactive({ action: 'approve', final_score: 0, comment: '' })
const adjustDims = ref([])

// GradingResultCard 需要的结果对象：工单行 + result 字段组合
const reviewPayload = computed(() => {
  if (!current.value) return null
  const r = current.value.result || {}
  return {
    ...r,
    total_score: current.value.status === 'adjusted' && current.value.final_score != null
      ? current.value.final_score
      : (r.total_score ?? Number(current.value.original_score)),
    review: {
      status: current.value.status,
      final_score: current.value.final_score,
      comment: current.value.comment
    }
  }
})

const statusText = (s) => ({ pending: '待复核', approved: '已通过', adjusted: '已调整', rejected: '已否决' }[s] || s)
const statusType = (s) => ({ pending: 'warning', approved: 'success', adjusted: '', rejected: 'danger' }[s] || 'info')
const formatTime = (t) => new Date(t).toLocaleString('zh-CN')

async function loadList() {
  loading.value = true
  try {
    const res = await gradingApi.reviews({ status: filterStatus.value, page: page.value, pageSize })
    list.value = res.data.list
    total.value = res.data.total
    // 待复核数量角标（无论当前筛选什么状态）
    if (filterStatus.value === 'pending') pendingCount.value = res.data.total
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '加载复核队列失败')
  } finally { loading.value = false }
}

async function loadPendingCount() {
  try {
    const res = await gradingApi.reviews({ status: 'pending', page: 1, pageSize: 1 })
    pendingCount.value = res.data.total
  } catch (e) { /* 忽略 */ }
}

function handlePage(p) { page.value = p; loadList() }

function openReview(row) {
  current.value = row
  reviewForm.action = 'approve'
  reviewForm.final_score = Number(row.result?.total_score ?? row.original_score) || 0
  reviewForm.comment = ''
  // 维度调分初始化：AI 原分作为默认值
  adjustDims.value = (row.result?.dimension_scores || []).map(d => ({
    code: d.code,
    name: d.name,
    max_score: d.max_score,
    from: d.score,
    to: d.score
  }))
  reviewVisible.value = true
}

function openView(row) {
  current.value = row
  reviewVisible.value = true
}

async function submit() {
  if (!current.value) return
  submitting.value = true
  try {
    const payload = {
      action: reviewForm.action,
      comment: reviewForm.comment || undefined
    }
    if (reviewForm.action === 'adjust') {
      payload.final_score = reviewForm.final_score
      payload.dimension_adjustments = adjustDims.value
        .filter(d => d.to !== d.from)
        .map(d => ({ code: d.code, from: d.from, to: d.to }))
    }
    await gradingApi.submitReview(current.value.id, payload)
    ElMessage.success('复核结论已提交')
    reviewVisible.value = false
    loadList()
    loadPendingCount()
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '提交失败')
  } finally { submitting.value = false }
}

onMounted(() => { loadList(); loadPendingCount() })
</script>

<style scoped>
.score { font-size: 16px; font-weight: 700; color: var(--primary); }
.reason-text { font-size: 13px; color: var(--text-light); }
</style>
