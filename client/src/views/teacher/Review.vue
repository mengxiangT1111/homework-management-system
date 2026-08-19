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
            <span v-else style="color:#ccc">—</span>
          </template>
        </el-table-column>
        <el-table-column label="分数" width="70" align="center">
          <template #default="{ row }">
            <span v-if="row.submission?.score !== null && row.submission?.score !== undefined" class="score">{{ row.submission.score }}</span>
            <span v-else style="color:#ccc">—</span>
          </template>
        </el-table-column>
        <el-table-column label="评语" min-width="150">
          <template #default="{ row }">
            <span v-if="row.submission?.comment" class="comment-text">{{ row.submission.comment }}</span>
            <span v-else style="color:#ccc">—</span>
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
    <el-dialog v-model="gradeVisible" title="批阅作业" width="700px" top="5vh">
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
        <el-card shadow="never" style="margin-bottom:16px;background:#f8fbf9">
          <template #header>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span style="font-weight:600">📋 批改参数</span>
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
        <el-card v-if="aiResult" shadow="never" style="background:#f0faf6">
          <template #header>
            <span style="font-weight:600">🤖 AI 批改结果</span>
          </template>
          <div class="ai-result">
            <div class="ai-score-display">
              <span class="ai-score-num">{{ aiResult.score }}</span>
              <span class="ai-score-max">/ {{ aiForm.full_score }}</span>
            </div>

            <el-divider />

            <div class="ai-result-section">
              <div class="ai-section-title">📝 扣分理由</div>
              <div class="ai-section-content">{{ aiResult.deduction_reason }}</div>
            </div>

            <div class="ai-result-section">
              <div class="ai-section-title">💬 评语</div>
              <div class="ai-section-content">{{ aiResult.comment }}</div>
            </div>

            <div class="ai-result-section">
              <div class="ai-section-title">💡 改进建议</div>
              <div class="ai-section-content">{{ aiResult.improvement_advice }}</div>
            </div>

            <div v-if="aiResult.knowledge_errors?.length > 0" class="ai-result-section">
              <div class="ai-section-title">⚠️ 知识点错误</div>
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

    <!-- AI 批量批改对话框 -->
    <el-dialog v-model="batchAIVisible" title="AI 一键批量批改" width="700px" top="5vh">
      <el-alert type="info" :closable="false" style="margin-bottom:16px">
        AI 将自动读取所有已提交学生（待批改状态）的作业文件，提取文本内容后逐一批改并保存评分。
      </el-alert>

      <el-card shadow="never" style="background:#f8fbf9">
        <template #header>
          <span style="font-weight:600">📋 批改参数（所有学生共用）</span>
        </template>
        <el-form :model="batchAIForm" label-width="100px" size="small">
          <el-form-item label="满分分值" required>
            <el-input-number v-model="batchAIForm.full_score" :min="1" :max="100" />
            <span style="margin-left:8px;color:var(--text-light)">分</span>
          </el-form-item>
          <el-form-item label="评分细则">
            <el-input v-model="batchAIForm.grading_criteria" type="textarea" :rows="3"
              placeholder="可选，不填则AI自动从参考答案提取要点" />
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
        <p style="color:var(--text-light);margin-top:8px;font-size:13px">正在AI批改中，请稍候...</p>
      </div>

      <div v-if="batchResult" class="batch-result">
        <el-divider />
        <el-alert :title="`批改完成：成功 ${batchResult.success_count} 人，失败 ${batchResult.fail_count} 人`" type="success" :closable="false" />
        <el-table :data="batchResult.details" size="small" max-height="300" style="margin-top:12px">
          <el-table-column label="学生" prop="student_name" width="100" />
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag v-if="row.status === 'success'" type="success" size="small">成功</el-tag>
              <el-tag v-else-if="row.status === 'skipped'" type="warning" size="small">跳过</el-tag>
              <el-tag v-else type="danger" size="small">失败</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="得分" width="70" align="center">
            <template #default="{ row }">{{ row.score ?? '-' }}</template>
          </el-table-column>
          <el-table-column label="原因" min-width="200">
            <template #default="{ row }">{{ row.reason || '-' }}</template>
          </el-table-column>
        </el-table>
      </div>

      <template #footer>
        <el-button @click="batchAIVisible = false">关闭</el-button>
        <el-button type="danger" :loading="batchGrading" @click="doBatchAIGrade" :disabled="!batchAIForm.reference_answer">
          <el-icon><MagicStick /></el-icon> 开始一键批改
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Document, MagicStick } from '@element-plus/icons-vue'
import FilePreview from '@/components/FilePreview.vue'
import PlagiarismDetail from '@/components/PlagiarismDetail.vue'
import { assignmentApi, submissionApi, downloadFile, plagiarismApi, aiApi } from '@/api'
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

// 批量 AI 批改
const batchGrading = ref(false)
const batchAIVisible = ref(false)
const batchAIForm = reactive({
  full_score: 100,
  grading_criteria: '',
  reference_answer: '',
  useWord: false
})
const batchRefFile = ref(null)
const batchProgress = ref(0)
const batchResult = ref(null)

function openBatchAI() {
  batchAIForm.full_score = 100
  batchAIForm.grading_criteria = ''
  batchAIForm.reference_answer = ''
  batchAIForm.useWord = false
  batchRefFile.value = null
  batchProgress.value = 0
  batchResult.value = null
  batchAIVisible.value = true
}

async function handleBatchRefUpload(file) {
  batchRefFile.value = file.raw
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
  if (!batchAIForm.reference_answer) {
    ElMessage.warning('请填写或上传参考答案')
    return
  }
  batchGrading.value = true
  batchProgress.value = 10
  batchResult.value = null
  try {
    const res = await aiApi.batchGrade({
      assignment_id: route.params.id,
      full_score: batchAIForm.full_score,
      grading_criteria: batchAIForm.grading_criteria,
      reference_answer: batchAIForm.reference_answer
    })
    batchResult.value = res.data
    batchProgress.value = 100
    ElMessage.success(res.message)
    loadData()
  } catch (e) {
    ElMessage.error('批量批改失败：' + (e.response?.data?.message || e.message || '未知错误'))
  } finally {
    batchGrading.value = false
  }
}
</script>

<style scoped>
.info-row { display: flex; gap: 16px; flex-wrap: wrap; font-size: 13px; color: var(--text-light); margin-top: 8px; }
.score { font-size: 16px; font-weight: 700; color: var(--primary); }
.comment-text { display: inline-block; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.grade-student { margin-bottom: 16px; }
.grade-files { background: var(--bg); padding: 12px; border-radius: 8px; }
.files-title { font-weight: 500; margin-bottom: 8px; font-size: 14px; }
.grade-file { display: flex; align-items: center; gap: 8px; padding: 6px 0; font-size: 13px; }
.grade-file .fname { flex: 1; }
.ai-student { margin-bottom: 16px; font-size: 15px; }
.ai-score-display { text-align: center; margin: 16px 0; }
.ai-score-num { font-size: 48px; font-weight: 700; color: var(--primary); }
.ai-score-max { font-size: 20px; color: var(--text-light); margin-left: 4px; }
.ai-result-section { margin-bottom: 16px; }
.ai-section-title { font-weight: 600; font-size: 14px; color: var(--text); margin-bottom: 6px; }
.ai-section-content { font-size: 14px; line-height: 1.8; color: var(--text); white-space: pre-wrap; background: white; padding: 10px; border-radius: 6px; }
</style>