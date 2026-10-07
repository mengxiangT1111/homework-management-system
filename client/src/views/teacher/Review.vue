<template>
  <div class="page-container">
    <div class="page-title">
      <el-button link @click="$router.back()"><el-icon><ArrowLeft /></el-icon>返回</el-button>
      作业批阅
    </div>

    <!-- 作业信息 -->
    <div v-if="data" class="card-section">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
        <div>
          <h2>{{ data.assignment.title }}</h2>
          <div class="info-row">
            <span>班级：{{ classInfo }}</span>
            <span>截止：{{ formatTime(data.assignment.deadline) }}</span>
            <span>总人数：{{ data.total_students }}</span>
            <span>已交：{{ data.submitted_count }}</span>
            <span style="color:var(--danger)">未交：{{ data.unsubmitted_count }}</span>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <el-button type="success" @click="downloadAll" :disabled="data.submitted_count === 0">打包下载</el-button>
          <el-button type="warning" @click="exportExcel">导出未交名单</el-button>
          <el-button type="primary" plain @click="remindUnsubmitted" :disabled="data.unsubmitted_count === 0">催交</el-button>
          <el-button type="danger" :disabled="data.submitted_count === 0" :loading="batchGrading" @click="openBatchAI">
            <el-icon><MagicStick /></el-icon> AI一键批改
          </el-button>
        </div>
      </div>
    </div>

    <!-- 学生列表 -->
    <div class="card-section">
      <el-table :data="pagedStudents" stripe>
        <el-table-column label="学号" prop="username" width="120" />
        <el-table-column label="姓名" prop="real_name" width="100" />
        <el-table-column label="提交状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.submitted" type="success" size="small">已提交</el-tag>
            <el-tag v-else type="danger" size="small">未提交</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="提交时间" width="170">
          <template #default="{ row }">{{ row.submission ? formatTime(row.submission.submitted_at) : '—' }}</template>
        </el-table-column>
        <el-table-column label="文件数" width="70" align="center">
          <template #default="{ row }">{{ row.submission?.files?.length || 0 }}</template>
        </el-table-column>
        <!-- 查重结果列 -->
        <el-table-column label="查重结果" width="160" align="center">
          <template #default="{ row }">
            <template v-if="row.submission">
              <el-tag v-if="row._plagiarismScore !== undefined"
                :type="row._plagiarismScore > 70 ? 'danger' : row._plagiarismScore > 40 ? 'warning' : 'success'"
                style="cursor:pointer" @click="openPlagiarismDetail(row.submission.id)">
                {{ row._plagiarismScore }}% 相似
              </el-tag>
              <el-button v-else size="small" type="warning" plain
                :loading="row._plagiarismLoading"
                @click="startPlagiarismCheck(row)">
                查重检测
              </el-button>
            </template>
            <span v-else class="placeholder-text">—</span>
          </template>
        </el-table-column>
        <el-table-column label="分数" width="70" align="center">
          <template #default="{ row }">
            <span v-if="row.submission?.score !== null && row.submission?.score !== undefined" class="score">{{ row.submission.score }}</span>
            <span v-else class="placeholder-text">—</span>
          </template>
        </el-table-column>
        <el-table-column label="评语" min-width="150">
          <template #default="{ row }">
            <span v-if="row.submission?.comment" class="comment-text">{{ row.submission.comment }}</span>
            <span v-else class="placeholder-text">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" align="center" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.submitted" link type="primary" @click="openGrade(row)">批阅</el-button>
            <span v-else style="color:var(--text-light)">—</span>
          </template>
        </el-table-column>
      </el-table>
      <el-pagination
        v-if="(data?.students || []).length > studentPageSize" background layout="prev, pager, next, total"
        :total="(data?.students || []).length" :page-size="studentPageSize" :current-page="studentPage"
        class="table-footer"
        @current-change="p => studentPage = p"
      />
    </div>

    <!-- 批阅对话框 -->
    <el-dialog v-model="gradeVisible" title="批阅作业" width="720px" top="5vh">
      <div v-if="current" class="grade-content">
        <div class="grade-student">
          <strong>{{ current.real_name }}</strong>（{{ current.username }}）
          <span style="margin-left:12px;color:var(--text-light)">提交于 {{ current.submission && formatTime(current.submission.submitted_at) }}</span>
          <el-tag v-if="current._plagiarismScore !== undefined"
            :type="current._plagiarismScore > 70 ? 'danger' : current._plagiarismScore > 40 ? 'warning' : 'success'"
            size="small" style="margin-left:12px">查重最高相似 {{ current._plagiarismScore }}%</el-tag>
        </div>

        <!-- 文件列表 -->
        <div class="grade-files">
          <div class="files-title">提交的文件（{{ current.submission?.files?.length || 0 }}）：</div>
          <div v-for="f in (current.submission?.files || [])" :key="f.id" class="grade-file">
            <el-icon><Document /></el-icon>
            <span class="fname">{{ f.original_name }}</span>
            <el-tag v-if="f.is_cleaned" type="info" size="small">已过期清理</el-tag>
            <template v-else>
              <el-button link type="primary" @click="previewFile(f)">预览</el-button>
              <el-button link type="primary" @click="downloadF(f)">下载</el-button>
            </template>
          </div>
        </div>

        <el-divider />

        <!-- 打分 -->
        <el-form label-width="80px">
          <el-form-item label="分数">
            <el-input-number v-model="gradeForm.score" :min="0" :max="gradeMax" :precision="1" />
            <span style="margin-left:8px;color:var(--text-light)">/ {{ gradeMax }}</span>
          </el-form-item>
          <el-form-item label="评语">
            <el-input v-model="gradeForm.comment" type="textarea" :rows="4" placeholder="请输入评语" />
          </el-form-item>
          <el-form-item label="状态">
            <el-radio-group v-model="gradeForm.status">
              <el-radio value="graded">已评分</el-radio>
              <el-radio value="returned">退回重做</el-radio>
            </el-radio-group>
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button @click="gradeVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveGrade">保存批阅</el-button>
      </template>
    </el-dialog>

    <!-- 预览组件 -->
    <FilePreview v-model="previewVisible" :file-path="previewPath" :file-name="previewName" :file-size="previewSize" />

    <!-- 查重详情对话框 -->
    <PlagiarismDetail
      v-model="plagiarismVisible"
      :assignment-id="assignmentId"
      :submission-id="plagiarismSubmissionId"
      @refresh="loadPlagiarismScores" />

    <!-- AI 批量批改对话框（新版：模板化 + 异步队列） -->
    <el-dialog v-model="batchAIVisible" title="AI 一键批量批改" width="720px" top="5vh" @close="stopBatchPolling">
      <el-alert type="info" :closable="false" style="margin-bottom:16px">
        将按所选评分模板创建异步批改任务（不阻塞页面），AI 逐份批改后自动保存评分；低置信度结果会进入"批改复核"队列待人工确认。
      </el-alert>

      <!-- 批改范围：待批改/已批改统计 + 是否重新批改 -->
      <div class="batch-scope">
        <span>
          已提交 <strong>{{ batchTotalSubmitted }}</strong> 份：待批改
          <strong>{{ batchPendingCount }}</strong> 份、已批改
          <strong>{{ batchGradedCount }}</strong> 份
          <span v-if="batchGradedCount > 0" class="scope-hint">（"提交即通过"的作业提交后直接计为已批改）</span>
        </span>
        <div style="display:flex;flex-direction:column;align-items:flex-start;gap:2px">
          <el-checkbox v-model="batchAIForm.force">包含已批改的提交（覆盖原分数重新批改）</el-checkbox>
          <el-checkbox v-model="batchAIForm.reviewAll">全部转人工复核（开放性主观题如作文建议勾选，AI 结果经确认后才生效）</el-checkbox>
        </div>
      </div>
      <el-alert v-if="batchTotalSubmitted === 0" type="warning" :closable="false" style="margin-bottom:16px">
        还没有学生提交，无法批量批改
      </el-alert>

      <el-card shadow="never" class="ai-param-card">
        <template #header>
          <span class="ai-card-title"><el-icon><Tickets /></el-icon>批改参数（所有学生共用）</span>
        </template>
        <el-form :model="batchAIForm" label-width="100px" size="small">
          <el-form-item label="评分模板" required>
            <el-select v-model="batchAIForm.template_id" placeholder="选择已发布的评分模板" style="width:100%" :loading="templatesLoading">
              <el-option
                v-for="t in templateOptions"
                :key="t.id"
                :label="`${t.name}（${t.subject}·满分${t.full_score}·v${t.version}${t.is_mine ? '' : '·共享'}）`"
                :value="t.id"
                :disabled="t.status !== 'published'"
              />
            </el-select>
            <div style="font-size:12px;color:var(--text-light);margin-top:4px">
              模板在"批改模板"页面创建与发布；未发布的模板不可用
            </div>
          </el-form-item>
          <el-form-item label="批改模式">
            <el-radio-group v-model="batchAIForm.mode">
              <el-radio value="balanced">均衡</el-radio>
              <el-radio value="strict">严格</el-radio>
              <el-radio value="encouraging">鼓励</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="评分补充">
            <el-input v-model="batchAIForm.grading_criteria" type="textarea" :rows="2"
              placeholder="可选，附加在模板细则之后的补充说明" />
          </el-form-item>
          <el-form-item label="参考答案" required>
            <el-input v-model="batchAIForm.reference_answer" type="textarea" :rows="4"
              placeholder="粘贴参考答案文本，或上传Word文档自动提取" />
            <div style="margin-top:6px">
              <el-upload action="#" :auto-upload="false" :show-file-list="false" accept=".doc,.docx" @change="handleBatchRefUpload">
                <el-button size="small" type="primary" plain>上传Word文档提取</el-button>
              </el-upload>
            </div>
          </el-form-item>
        </el-form>
      </el-card>

      <div v-if="batchGrading" style="margin:16px 0;text-align:center">
        <el-progress :percentage="batchProgress" :stroke-width="12" striped />
        <p style="color:var(--text-light);margin-top:8px;font-size:13px">
          AI 正在后台批改（{{ batchProgressInfo }}），可关闭此窗口，稍后重新打开会自动恢复进度
        </p>
        <el-button size="small" type="danger" plain style="margin-top:8px" :loading="batchCancelling" @click="cancelBatchTask">
          取消剩余任务
        </el-button>
      </div>

      <div v-if="batchResult" class="batch-result">
        <el-divider />
        <el-alert :title="`批改完成：成功 ${batchResult.success_count} 人，待复核 ${batchResult.review_count} 人，失败 ${batchResult.fail_count} 人`" :type="batchResult.fail_count > 0 ? 'warning' : 'success'" :closable="false" />
        <el-table :data="batchResult.details" size="small" max-height="300" style="margin-top:12px">
          <el-table-column label="学生" prop="student_name" width="100" />
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag v-if="row.status === 'success'" type="success" size="small">成功</el-tag>
              <el-tag v-else-if="row.needs_review" type="warning" size="small">待复核</el-tag>
              <el-tag v-else type="danger" size="small">失败</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="得分" width="70" align="center">
            <template #default="{ row }">{{ row.score ?? '-' }}</template>
          </el-table-column>
          <el-table-column label="原因" min-width="200">
            <template #default="{ row }">{{ row.error_msg || (row.needs_review ? '低置信度，已进入人工复核' : '-') }}</template>
          </el-table-column>
        </el-table>
      </div>

      <template #footer>
        <el-button @click="batchAIVisible = false">关闭</el-button>
        <el-button type="danger" :loading="batchGrading" @click="doBatchAIGrade"
          :disabled="!batchAIForm.template_id || !batchAIForm.reference_answer || batchTotalSubmitted === 0 || (batchPendingCount === 0 && !batchAIForm.force)">
          <el-icon><MagicStick /></el-icon> 开始一键批改
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Document, MagicStick, Tickets } from '@element-plus/icons-vue'
import FilePreview from '@/components/FilePreview.vue'
import PlagiarismDetail from '@/components/PlagiarismDetail.vue'
import { assignmentApi, submissionApi, downloadFile, plagiarismApi, aiApi, gradingApi } from '@/api'

const route = useRoute()
const data = ref(null)
const gradeVisible = ref(false)
const current = ref(null)
const saving = ref(false)
const gradeForm = reactive({ score: 0, comment: '', status: 'graded' })

const previewVisible = ref(false)
const previewPath = ref('')
const previewName = ref('')
const previewSize = ref(null)

const plagiarismVisible = ref(false)
const plagiarismSubmissionId = ref(null)
const assignmentId = computed(() => parseInt(route.params.id))

// 学生表客户端分页：全班全量返回，直接渲染大班时页面冗长
const studentPage = ref(1)
const studentPageSize = 15
const pagedStudents = computed(() => {
  const arr = data.value?.students || []
  return arr.slice((studentPage.value - 1) * studentPageSize, studentPage.value * studentPageSize)
})

const classInfo = computed(() => {
  const a = data.value?.assignment
  if (!a) return ''
  return [a.course_name, a.class_name].filter(Boolean).join(' · ')
})

// 批改范围统计（与后端批量任务口径一致：submitted=待批改，graded=已批改）
const batchTotalSubmitted = computed(() =>
  (data.value?.students || []).filter(s => s.submitted).length
)
const batchPendingCount = computed(() =>
  (data.value?.students || []).filter(s => s.submitted && s.submission && s.submission.status === 'submitted').length
)
const batchGradedCount = computed(() =>
  (data.value?.students || []).filter(s => s.submitted && s.submission && s.submission.status === 'graded').length
)

function formatTime(t) {
  const d = new Date(t)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('zh-CN')
}

async function loadData() {
  const res = await assignmentApi.submissions(route.params.id)
  data.value = res.data
  // 加载所有提交的查重分数
  await loadPlagiarismScores()
}

async function loadPlagiarismScores() {
  if (!data.value?.students) return
  // 一次拉取本作业全部提交的查重摘要，替代逐学生请求（N 个请求 → 1 个）
  try {
    const res = await plagiarismApi.assignmentSummary(assignmentId.value)
    const summary = res.data?.summary || {}
    for (const s of data.value.students) {
      if (s.submission && summary[s.submission.id] !== undefined) {
        s._plagiarismScore = summary[s.submission.id]
        s._plagiarismStatus = 'done'
      }
    }
  } catch (e) {
    // 查重服务不可用或暂无结果
  }
}

const gradeMax = ref(100)

function openGrade(row) {
  current.value = row
  gradeForm.score = row.submission?.score ?? 0
  gradeForm.comment = row.submission?.comment || ''
  gradeForm.status = row.submission?.status === 'returned' ? 'returned' : 'graded'
  gradeVisible.value = true
  // 评分模板满分允许 1-1000：AI 批改过的提交以模板满分为手动打分上限，
  // 否则 AI 打出 >100 分后教师无法手动修正（后端校验同口径）
  gradeMax.value = 100
  gradingApi.resultBySubmission(row.submission.id).then(res => {
    const full = Number(res.data?.full_score)
    if (Number.isFinite(full) && full > 100) {
      gradeMax.value = full
      if (Number(gradeForm.score) > gradeMax.value) gradeForm.score = gradeMax.value
    }
  }).catch(() => {})
}

async function saveGrade() {
  saving.value = true
  try {
    await submissionApi.grade(current.value.submission.id, { ...gradeForm })
    ElMessage.success('批阅成功')
    gradeVisible.value = false
    loadData()
  } catch (e) {} finally { saving.value = false }
}

function previewFile(f) {
  previewPath.value = f.file_path
  previewName.value = f.original_name
  previewSize.value = f.file_size ?? null
  previewVisible.value = true
}

function downloadF(f) {
  // 本地与 COS 文件统一走带 Authorization 的授权下载接口（XHR blob 保存）；
  // COS 不再 window.open 签名 URL（桶强制下载且头部不可控）
  downloadFile('/api/files/download?path=' + encodeURIComponent(f.file_path), f.original_name)
}

function downloadAll() {
  downloadFile(submissionApi.downloadAll(route.params.id), '提交打包.zip')
}

function exportExcel() {
  downloadFile(submissionApi.exportExcel(route.params.id), '未交名单.xlsx')
}

async function remindUnsubmitted() {
  try {
    await ElMessageBox.confirm(`确定向 ${data.value.unsubmitted_count} 名未交学生发送催交通知？`, '催交提醒', { type: 'warning' })
    const res = await submissionApi.remind(route.params.id)
    ElMessage.success(res.message)
  } catch (e) {}
}

async function startPlagiarismCheck(row) {
  row._plagiarismLoading = true
  try {
    await ElMessageBox.confirm(
      `将对 ${row.real_name} 的作业与同班其他已提交作业进行查重比对，是否继续？`,
      '查重检测',
      { type: 'info', confirmButtonText: '开始检测', cancelButtonText: '取消' }
    )
    const res = await plagiarismApi.check(assignmentId.value, row.submission.id)
    row._plagiarismScore = res.data?.topSimilarity || 0
    row._plagiarismLoading = false
    ElMessage.success(`查重完成，最高相似度 ${res.data?.topSimilarity || 0}%`)
  } catch (e) {
    row._plagiarismLoading = false
    // 用户取消或出错
  }
}

function openPlagiarismDetail(submissionId) {
  plagiarismSubmissionId.value = submissionId
  plagiarismVisible.value = true
}

onMounted(loadData)

// 批量 AI 批改（新版：模板化 + 异步队列 + 进度轮询）
const batchGrading = ref(false)
const batchAIVisible = ref(false)
const batchAIForm = reactive({
  template_id: null,
  mode: 'balanced',
  grading_criteria: '',
  reference_answer: '',
  // 包含已批改的提交（覆盖原分数重新批改），对应后端 force
  force: false,
  // 本批全部结果转人工复核，对应后端 review_all（开放性主观题推荐）
  reviewAll: false
})
const batchProgress = ref(0)
const batchProgressInfo = ref('')
const batchResult = ref(null)
const templateOptions = ref([])
const templatesLoading = ref(false)
let batchTimer = null
const batchCancelling = ref(false)
// 最近一次轮询到的任务列表（"取消剩余任务"时从中筛排队中的）
let lastTaskList = []

async function loadTemplates() {
  templatesLoading.value = true
  try {
    const res = await gradingApi.templates({ page: 1, pageSize: 100 })
    templateOptions.value = res.data.list
    // 默认选中第一个已发布模板
    if (!batchAIForm.template_id) {
      const first = templateOptions.value.find(t => t.status === 'published')
      batchAIForm.template_id = first ? first.id : null
    }
  } catch (e) {
    ElMessage.error('评分模板加载失败，请先在"批改模板"页面创建并发布模板')
  } finally { templatesLoading.value = false }
}

async function openBatchAI() {
  batchAIForm.template_id = batchAIForm.template_id || null
  batchAIForm.mode = 'balanced'
  batchAIForm.grading_criteria = ''
  batchAIForm.reference_answer = ''
  batchAIForm.reviewAll = false
  batchProgress.value = 0
  batchProgressInfo.value = ''
  batchResult.value = null
  // 复位进行中标记：否则上次任务进行中关闭对话框后，重开时按钮永久禁用、进度条冻结
  batchGrading.value = false
  if (templateOptions.value.length === 0) loadTemplates()
  batchAIVisible.value = true
  // 断点恢复：该作业有进行中的批改任务时，自动接续进度轮询
  try {
    const p = await gradingApi.taskProgress(route.params.id)
    const { total, pending, processing } = p.data.progress
    if (total > 0 && pending + processing > 0) {
      batchGrading.value = true
      lastTaskList = p.data.list || []
      await pollBatchOnce()
      if (batchGrading.value) startBatchPolling()
    }
  } catch (e) { /* 进度查询失败不影响新建任务 */ }
}

function stopBatchPolling() {
  if (batchTimer) { clearInterval(batchTimer); batchTimer = null }
  batchGrading.value = false
}

// 批量批改弹窗：上传 Word 参考答案并提取文本
async function handleBatchRefUpload(file) {
  const formData = new FormData()
  formData.append('file', file.raw)
  try {
    const res = await aiApi.uploadReference(formData)
    batchAIForm.reference_answer = res.data.text
    ElMessage.success('Word 文档解析成功')
  } catch (e) {
    ElMessage.error('Word 解析失败：' + (e.message || '格式错误'))
  }
}

async function doBatchAIGrade() {
  if (!batchAIForm.template_id) { ElMessage.warning('请选择评分模板'); return }
  if (!batchAIForm.reference_answer) { ElMessage.warning('请填写或上传参考答案'); return }
  if (batchTotalSubmitted.value === 0) { ElMessage.warning('还没有学生提交'); return }
  if (batchPendingCount.value === 0 && !batchAIForm.force) {
    ElMessage.warning('没有待批改的提交；如需重新批改已批改的提交，请勾选"包含已批改的提交"')
    return
  }
  batchGrading.value = true
  batchProgress.value = 5
  batchResult.value = null
  try {
    // 1. 创建异步任务（立即返回，不等待LLM）
    const res = await gradingApi.batchTask({
      assignment_id: route.params.id,
      template_id: batchAIForm.template_id,
      force: batchAIForm.force === true,
      review_all: batchAIForm.reviewAll === true,
      reference_answer: batchAIForm.reference_answer,
      grading_criteria: batchAIForm.grading_criteria,
      mode: batchAIForm.mode
    })
    ElMessage.success(res.message)
    // 2. 轮询进度（5秒一次，见 startBatchPolling）
    startBatchPolling()
  } catch (e) {
    batchGrading.value = false
    ElMessage.error(e.response?.data?.message || '创建批改任务失败')
  }
}

// 单次进度查询：刷新进度条；全部任务结束时收尾展示结果
// （新建任务后轮询与重开窗口断点恢复共用）
async function pollBatchOnce() {
  const p = await gradingApi.taskProgress(route.params.id)
  const { total, success, failed, cancelled, pending, processing } = p.data.progress
  lastTaskList = p.data.list || []
  const done = success + failed + cancelled
  batchProgress.value = total > 0 ? Math.max(5, Math.round(done / total * 100)) : 100
  batchProgressInfo.value = `完成 ${done}/${total}，排队 ${pending}，批改中 ${processing}`
  if (pending + processing === 0 && total > 0) {
    stopBatchPolling()
    batchProgress.value = 100
    const list = p.data.list || []
    const needsReview = list.filter(x => x.needs_review).length
    batchResult.value = {
      success_count: success,
      review_count: needsReview,
      fail_count: failed,
      details: list
    }
    loadData()
    if (needsReview > 0) {
      ElMessage.warning(`${needsReview} 份结果置信度较低，已进入"批改复核"队列`)
    }
  }
}

function startBatchPolling() {
  if (batchTimer) clearInterval(batchTimer)
  let pollCount = 0
  batchTimer = setInterval(async () => {
    try {
      if (++pollCount > 720) { // 1小时未完成视为异常
        stopBatchPolling()
        ElMessage.warning('批改任务长时间未完成，请稍后重新打开此窗口查看进度')
        return
      }
      await pollBatchOnce()
    } catch (e) { /* 单次轮询失败忽略，等下一轮 */ }
  }, 5000)
}

// 取消剩余任务：仅能取消排队中（pending）的任务，已在批改中的会自然完成
async function cancelBatchTask() {
  const pendings = lastTaskList.filter(t => t.status === 'pending')
  if (pendings.length === 0) {
    ElMessage.info('没有排队中的任务可取消（已在批改中的任务会自然完成）')
    return
  }
  try {
    await ElMessageBox.confirm(
      `将取消 ${pendings.length} 份排队中任务的批改（已在批改中的会自然完成），是否继续？`,
      '取消批改',
      { type: 'warning' }
    )
  } catch (e) { return }
  batchCancelling.value = true
  let ok = 0
  for (const t of pendings) {
    try { await gradingApi.cancelTask(t.id); ok++ } catch (e) { /* 单个取消失败继续下一个 */ }
  }
  batchCancelling.value = false
  if (ok > 0) ElMessage.success(`已取消 ${ok} 份排队任务`)
  try { await pollBatchOnce() } catch (e) { /* 刷新失败等下一轮轮询 */ }
}

// 组件卸载时停止轮询：el-dialog 的 close 事件在路由切换销毁组件时不会触发，
// 否则 interval 永久运行并操作已卸载组件的 ref
onUnmounted(stopBatchPolling)
</script>

<style scoped>
.info-row { display: flex; gap: 16px; flex-wrap: wrap; font-size: 13px; color: var(--text-light); margin-top: 8px; }
.score { font-size: 16px; font-weight: 700; color: var(--primary); }
.placeholder-text { color: var(--ink-400); }
.comment-text { display: inline-block; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.grade-student { margin-bottom: 16px; }
.grade-files { background: var(--bg); padding: 12px; border-radius: 8px; }
.files-title { font-weight: 500; margin-bottom: 8px; font-size: 14px; }
.grade-file { display: flex; align-items: center; gap: 8px; padding: 6px 0; font-size: 13px; }
.grade-file .fname { flex: 1; }
.ai-param-card { --el-card-bg-color: var(--ink-50); margin-bottom: 16px; }
.ai-card-title { display: flex; align-items: center; gap: 6px; font-weight: 600; }
.ai-card-title .el-icon { color: var(--brand-600); }
.batch-scope {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 14px;
  margin-bottom: 16px;
  border: 1px solid var(--ink-100);
  border-radius: var(--radius-md);
  background: var(--ink-50);
  font-size: 13px;
  color: var(--text-light);
}
.batch-scope strong { color: var(--ink-800); font-variant-numeric: tabular-nums; }
.batch-scope .scope-hint { color: var(--ink-500); }
</style>