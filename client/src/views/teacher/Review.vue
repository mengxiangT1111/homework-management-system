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
      <el-table :data="data?.students || []" stripe>
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
            <el-button v-if="row.submitted" link type="success" @click="openAIGrade(row)">AI批改</el-button>
            <span v-else style="color:var(--text-light)">—</span>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 批阅对话框 -->
    <el-dialog v-model="gradeVisible" title="批阅作业" width="720px" top="5vh">
      <div v-if="current" class="grade-content">
        <div class="grade-student">
          <strong>{{ current.real_name }}</strong>（{{ current.username }}）
          <span style="margin-left:12px;color:var(--text-light)">提交于 {{ current.submission && formatTime(current.submission.submitted_at) }}</span>
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
            <el-input-number v-model="gradeForm.score" :min="0" :max="100" :precision="1" />
            <span style="margin-left:8px;color:var(--text-light)">/ 100</span>
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
    <FilePreview v-model="previewVisible" :file-path="previewPath" :file-name="previewName" />

    <!-- 查重详情对话框 -->
    <PlagiarismDetail
      v-model="plagiarismVisible"
      :assignment-id="assignmentId"
      :submission-id="plagiarismSubmissionId"
      @refresh="loadPlagiarismScores" />

<!-- AI 批改对话框（单题） -->
    <el-dialog v-model="aiVisible" title="AI 智能批改" width="750px" top="3vh">
      <div v-if="aiCurrent" class="ai-content">
        <div class="ai-student">
          <strong>{{ aiCurrent.real_name }}</strong>（{{ aiCurrent.username }}）
        </div>

        <!-- AI 批改参数 -->
        <el-card shadow="never" class="ai-param-card">
          <template #header>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span class="ai-card-title"><el-icon><Tickets /></el-icon>批改参数</span>
              <el-button size="small" type="primary" :loading="aiGrading" @click="doAIGrade">
                <el-icon><MagicStick /></el-icon> 开始AI批改
              </el-button>
            </div>
          </template>
          <el-form :model="aiForm" label-width="90px" size="small">
            <el-form-item label="满分分值" required>
              <el-input-number v-model="aiForm.full_score" :min="1" :max="100" />
              <span style="margin-left:8px;color:var(--text-light)">分</span>
            </el-form-item>
            <el-form-item label="评分细则">
              <el-input v-model="aiForm.grading_criteria" type="textarea" :rows="3"
                placeholder="可选，不填则AI自动从参考答案提取要点" />
            </el-form-item>
            <el-form-item label="参考答案" required>
              <el-input v-model="aiForm.reference_answer" type="textarea" :rows="3"
                placeholder="可粘贴文本，或上传Word文档自动提取" />
              <div style="margin-top:6px">
                <el-upload action="#" :auto-upload="false" :show-file-list="false" accept=".doc,.docx" @change="handleRefUpload">
                  <el-button size="small" type="primary" plain>上传Word文档提取</el-button>
                </el-upload>
              </div>
            </el-form-item>
            <el-form-item label="学生作答">
              <el-input v-model="aiForm.student_answer" type="textarea" :rows="3"
                placeholder="可手动输入，也可从学生提交文件中自动提取" />
            </el-form-item>
          </el-form>
        </el-card>

        <!-- AI 批改结果 -->
        <el-card v-if="aiResult" shadow="never" class="ai-result-card">
          <template #header>
            <span class="ai-card-title"><el-icon><MagicStick /></el-icon>AI 批改结果</span>
          </template>
          <div class="ai-result">
            <div class="ai-score-display">
              <span class="ai-score-num">{{ aiResult.score }}</span>
              <span class="ai-score-max">/ {{ aiForm.full_score }}</span>
            </div>

            <el-divider />

            <div class="ai-result-section">
              <div class="ai-section-title"><el-icon><EditPen /></el-icon>扣分理由</div>
              <div class="ai-section-content">{{ aiResult.deduction_reason }}</div>
            </div>

            <div class="ai-result-section">
              <div class="ai-section-title"><el-icon><ChatDotRound /></el-icon>评语</div>
              <div class="ai-section-content">{{ aiResult.comment }}</div>
            </div>

            <div class="ai-result-section">
              <div class="ai-section-title"><el-icon><MagicStick /></el-icon>改进建议</div>
              <div class="ai-section-content">{{ aiResult.improvement_advice }}</div>
            </div>

            <div v-if="aiResult.knowledge_errors?.length > 0" class="ai-result-section">
              <div class="ai-section-title"><el-icon><WarningFilled /></el-icon>知识点错误</div>
              <el-tag v-for="(err, idx) in aiResult.knowledge_errors" :key="idx" type="danger" style="margin:4px 4px 4px 0">{{ err }}</el-tag>
            </div>

            <el-divider />
            <el-button type="primary" @click="applyAIResult" :loading="applying">应用此结果到批阅</el-button>
          </div>
        </el-card>
      </div>
      <template #footer>
        <el-button @click="aiVisible = false">关闭</el-button>
      </template>
    </el-dialog>

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
        <el-checkbox v-model="batchAIForm.force">包含已批改的提交（覆盖原分数重新批改）</el-checkbox>
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
          AI 正在后台批改（{{ batchProgressInfo }}），可关闭此窗口稍后在列表查看进度
        </p>
      </div>

      <div v-if="batchResult" class="batch-result">
        <el-divider />
        <el-alert :title="`批改完成：成功 ${batchResult.success_count} 人，失败 ${batchResult.fail_count} 人`" type="success" :closable="false" />
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
import { ArrowLeft, Document, MagicStick, Tickets, EditPen, ChatDotRound, WarningFilled } from '@element-plus/icons-vue'
import FilePreview from '@/components/FilePreview.vue'
import PlagiarismDetail from '@/components/PlagiarismDetail.vue'
import { assignmentApi, submissionApi, downloadFile, plagiarismApi, aiApi, gradingApi } from '@/api'
import { fileUrl as resolveFileUrl, isCOS } from '@/utils/fileUrl'

const route = useRoute()
const data = ref(null)
const gradeVisible = ref(false)
const current = ref(null)
const saving = ref(false)
const gradeForm = reactive({ score: 0, comment: '', status: 'graded' })

const previewVisible = ref(false)
const previewPath = ref('')
const previewName = ref('')

const plagiarismVisible = ref(false)
const plagiarismSubmissionId = ref(null)
const assignmentId = computed(() => parseInt(route.params.id))

// AI 批改相关
const aiVisible = ref(false)
const aiCurrent = ref(null)
const aiGrading = ref(false)
const applying = ref(false)
const aiResult = ref(null)
const aiForm = reactive({
  full_score: 100,
  grading_criteria: '',
  reference_answer: '',
  student_answer: ''
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

function formatTime(t) { return new Date(t).toLocaleString('zh-CN') }

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

function openGrade(row) {
  current.value = row
  gradeForm.score = row.submission?.score ?? 0
  gradeForm.comment = row.submission?.comment || ''
  gradeForm.status = row.submission?.status === 'returned' ? 'returned' : 'graded'
  gradeVisible.value = true
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
  previewVisible.value = true
}

function downloadF(f) {
  if (isCOS(f.file_path)) {
    window.open(resolveFileUrl(f.file_path), '_blank')
  } else {
    downloadFile('/' + f.file_path, f.original_name)
  }
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

function openAIGrade(row) {
  aiCurrent.value = row
  aiForm.full_score = 100
  aiForm.grading_criteria = ''
  aiForm.reference_answer = ''
  aiForm.student_answer = ''
  aiResult.value = null
  aiVisible.value = true
}

async function doAIGrade() {
  if (!aiForm.reference_answer || !aiForm.student_answer) {
    ElMessage.warning('请填写参考答案和学生作答')
    return
  }
  aiGrading.value = true
  aiResult.value = null
  try {
    const res = await aiApi.grade(aiForm)
    aiResult.value = res.data
    ElMessage.success('AI 批改完成')
  } catch (e) {
    ElMessage.error('AI 批改失败：' + (e.response?.data?.message || e.message || '未知错误'))
  } finally {
    aiGrading.value = false
  }
}

async function applyAIResult() {
  if (!aiResult.value || !aiCurrent.value?.submission) return
  applying.value = true
  try {
    await submissionApi.grade(aiCurrent.value.submission.id, {
      score: aiResult.value.score,
      comment: `【AI评语】${aiResult.value.comment}\n\n【改进建议】${aiResult.value.improvement_advice}${aiResult.value.knowledge_errors?.length ? '\n\n【知识盲区】' + aiResult.value.knowledge_errors.join('；') : ''}`,
      status: 'graded'
    })
    ElMessage.success('已应用 AI 批改结果')
    aiVisible.value = false
    loadData()
  } catch (e) {
    ElMessage.error('应用失败')
  } finally {
    applying.value = false
  }
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
  force: false
})
const batchProgress = ref(0)
const batchProgressInfo = ref('')
const batchResult = ref(null)
const templateOptions = ref([])
const templatesLoading = ref(false)
let batchTimer = null

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

function openBatchAI() {
  batchAIForm.template_id = batchAIForm.template_id || null
  batchAIForm.mode = 'balanced'
  batchAIForm.grading_criteria = ''
  batchAIForm.reference_answer = ''
  batchProgress.value = 0
  batchProgressInfo.value = ''
  batchResult.value = null
  // 复位进行中标记：否则上次任务进行中关闭对话框后，重开时按钮永久禁用、进度条冻结
  batchGrading.value = false
  if (templateOptions.value.length === 0) loadTemplates()
  batchAIVisible.value = true
}

function stopBatchPolling() {
  if (batchTimer) { clearInterval(batchTimer); batchTimer = null }
  batchGrading.value = false
}

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
      reference_answer: batchAIForm.reference_answer,
      grading_criteria: batchAIForm.grading_criteria,
      mode: batchAIForm.mode
    })
    ElMessage.success(res.message)
    // 2. 轮询进度（5秒一次；带上限，后端任务异常卡死时不至于永久轮询）
    let pollCount = 0
    batchTimer = setInterval(async () => {
      try {
        if (++pollCount > 720) { // 1小时未完成视为异常
          stopBatchPolling()
          ElMessage.warning('批改任务长时间未完成，请稍后重新进入页面查看进度')
          return
        }
        const p = await gradingApi.taskProgress(route.params.id)
        const { total, success, failed, pending, processing } = p.data.progress
        const done = success + failed
        batchProgress.value = total > 0 ? Math.max(5, Math.round(done / total * 100)) : 100
        batchProgressInfo.value = `完成 ${done}/${total}，排队 ${pending}，批改中 ${processing}`
        if (pending + processing === 0 && total > 0) {
          stopBatchPolling()
          batchProgress.value = 100
          const needsReview = p.data.list.filter(x => x.needs_review).length
          batchResult.value = {
            success_count: success,
            fail_count: failed + needsReview,
            details: p.data.list
          }
          loadData()
          if (needsReview > 0) {
            ElMessage.warning(`${needsReview} 份结果置信度较低，已进入"批改复核"队列`)
          }
        }
      } catch (e) { /* 单次轮询失败忽略，等下一轮 */ }
    }, 5000)
  } catch (e) {
    batchGrading.value = false
    ElMessage.error(e.response?.data?.message || '创建批改任务失败')
  }
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
.ai-student { margin-bottom: 16px; font-size: 15px; }
.ai-score-display { text-align: center; margin: 16px 0; }
.ai-score-num { font-size: 48px; font-weight: 700; color: var(--brand-700); }
.ai-score-max { font-size: 20px; color: var(--text-light); margin-left: 4px; }
.ai-param-card { --el-card-bg-color: var(--ink-50); margin-bottom: 16px; }
.ai-result-card { --el-card-bg-color: var(--brand-50); }
.ai-card-title { display: flex; align-items: center; gap: 6px; font-weight: 600; }
.ai-card-title .el-icon { color: var(--brand-600); }
.ai-result-section { margin-bottom: 16px; }
.ai-section-title { display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 14px; color: var(--text); margin-bottom: 6px; }
.ai-section-title .el-icon { color: var(--brand-600); }
.ai-section-content { font-size: 14px; line-height: 1.8; color: var(--text); white-space: pre-wrap; background: white; padding: 10px; border-radius: 6px; }
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