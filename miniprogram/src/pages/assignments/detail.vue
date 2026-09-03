<template>
  <view class="page">
    <!-- ===== 学生视角 ===== -->
    <template v-if="isStudent">
      <template v-if="assignment">
        <view class="card hero-card">
          <view class="row">
            <text class="tag" :class="'tag-' + st.type">{{ st.text }}</text>
            <text class="meta" style="margin-left:auto;">{{ assignment.course ? assignment.course.name : '' }}</text>
          </view>
          <text class="d-title">{{ assignment.title }}</text>
          <text class="cell-sub" v-if="assignment.teacher">发布教师 · {{ assignment.teacher.real_name }}</text>
          <view class="d-reqs">
            <view class="req-item">
              <text class="req-k">截止时间</text>
              <text class="req-v" :class="{ 'dl-overdue': rem.overdue }">{{ formatDateTime(assignment.deadline) }}</text>
            </view>
            <view class="req-item">
              <text class="req-k">剩余</text>
              <text class="req-v" :class="{ 'dl-urgent': rem.urgent, 'dl-overdue': rem.overdue }">{{ rem.text }}</text>
            </view>
            <view class="req-item">
              <text class="req-k">文件要求</text>
              <text class="req-v">≤{{ assignment.max_files }} 份 / ≤{{ assignment.max_size_mb }}MB</text>
            </view>
          </view>
          <view class="chips" v-if="assignment.allowed_formats && assignment.allowed_formats.length">
            <text class="chip" v-for="f in assignment.allowed_formats" :key="f">{{ f }}</text>
          </view>
          <view v-if="assignment.description" class="d-desc">
            <text class="d-desc-text">{{ assignment.description }}</text>
          </view>
        </view>

        <!-- 样例文件 -->
        <view class="card" v-if="sampleFiles.length">
          <view class="sec-head">
            <text class="sec-title">样例文件</text>
          </view>
          <view class="cell" hover-class="hv" v-for="(s, i) in sampleFiles" :key="i" @click="previewSample(s)">
            <view class="icon-tile tile-blue"><text>📄</text></view>
            <view class="cell-main">
              <text class="cell-title ellipsis">{{ s.name }}</text>
              <text class="cell-sub">点击预览</text>
            </view>
            <text class="cell-arrow">›</text>
          </view>
        </view>

        <!-- 我的提交 -->
        <view class="card">
          <view class="sec-head">
            <text class="sec-title">我的提交</text>
            <text v-if="mySubmission" class="tag" :class="'tag-' + subSt.type">{{ subSt.text }}</text>
          </view>
          <template v-if="mySubmission">
            <view class="score-line" v-if="mySubmission.score != null">
              <text class="score-num">{{ mySubmission.score }}</text>
              <view class="score-side">
                <text class="score-label">教师评分</text>
                <text class="meta">提交于 {{ formatDateTime(mySubmission.submitted_at) }}</text>
              </view>
            </view>
            <text class="cell-sub" v-else style="display:block;">提交于 {{ formatDateTime(mySubmission.submitted_at) }}</text>

            <view v-if="aiPending" class="ai-waiting">
              <text>🤖 AI 已评，待教师确认后显示成绩</text>
            </view>

            <view v-if="mySubmission.comment" class="quote-block">
              <text class="quote-label">教师评语</text>
              <text class="quote-text">{{ mySubmission.comment }}</text>
            </view>

            <view class="sec-head" style="margin:26rpx 0 8rpx;" v-if="mySubmission.files && mySubmission.files.length">
              <text class="sec-title" style="font-size:26rpx;">提交文件（{{ mySubmission.files.length }}）</text>
            </view>
            <view class="cell" hover-class="hv" v-for="f in mySubmission.files || []" :key="f.id" @click="previewSubFile(f)">
              <view class="icon-tile" :class="f.is_cleaned === 1 ? 'tile-slate' : 'tile-mint'"><text>📎</text></view>
              <view class="cell-main">
                <text class="cell-title ellipsis" :class="{ cleaned: f.is_cleaned === 1 }">{{ f.original_name }}</text>
                <text class="cell-sub" v-if="f.is_cleaned === 1">文件已过期清理</text>
              </view>
              <text class="cell-arrow" v-if="f.is_cleaned !== 1">›</text>
            </view>

            <!-- AI 批改结果 -->
            <view v-if="aiResult" class="ai-block">
              <view class="row" hover-class="hv" @click="aiExpanded = !aiExpanded">
                <text class="ai-block-title">🤖 AI 批改结果</text>
                <text class="sec-act">{{ aiExpanded ? '收起 ▴' : '展开 ▾' }}</text>
              </view>
              <template v-if="aiExpanded">
                <view class="ai-score-line">
                  <text class="ai-score">{{ aiResult.total_score }}</text>
                  <view class="score-side">
                    <text class="score-label">AI 评分 / {{ aiResult.full_score }} 分</text>
                    <text class="meta">置信度 {{ formatConfidence(aiResult.confidence) }}</text>
                  </view>
                </view>
                <view class="ai-dim" v-for="(d, i) in aiResult.dimension_scores || []" :key="i">
                  <view class="row">
                    <text class="ai-dim-name">{{ d.name }}</text>
                    <text class="ai-dim-score">{{ d.score }} / {{ d.max_score }}</text>
                  </view>
                  <view class="prog-track dim-track">
                    <view class="prog-fill" :style="{ width: dimPct(d) + '%' }"></view>
                  </view>
                  <text class="ai-dim-fb" v-if="d.feedback">{{ d.feedback }}</text>
                </view>
                <view v-if="aiResult.overall_feedback" class="quote-block">
                  <text class="quote-label">总体评语</text>
                  <text class="quote-text">{{ aiResult.overall_feedback }}</text>
                </view>
                <view v-if="aiResult.improvement_advice" class="quote-block quote-blue">
                  <text class="quote-label">改进建议</text>
                  <text class="quote-text">{{ aiResult.improvement_advice }}</text>
                </view>
              </template>
            </view>
          </template>
          <empty-state v-else icon="🍃" text="还没有提交过这份作业" />
        </view>

        <!-- 提交入口 -->
        <view class="card" v-if="closed || overdue">
          <text class="danger-text">{{ closed ? '该作业已关闭，无法提交' : '已过截止时间，无法提交' }}</text>
        </view>
        <view class="fixbar" v-else>
          <button class="btn-primary" hover-class="hv" @click="goSubmit">
            {{ mySubmission ? '重新提交（将覆盖）' : '提交作业' }}
          </button>
        </view>
      </template>
      <!-- 加载失败/缺参：给出原因与重试入口，不再整页空白 -->
      <view class="card" v-else>
        <empty-state icon="⚠️" text="作业加载失败" :sub="loadError || '网络异常，请稍后重试'" />
        <button class="btn-ghost err-retry" hover-class="hv" @click="loadStudent">重新加载</button>
      </view>
    </template>

    <!-- ===== 教师视角 ===== -->
    <template v-else-if="isTeacher">
      <template v-if="detail">
        <view class="card hero-card">
          <view class="row">
            <text class="tag" :class="'tag-' + st.type">{{ st.text }}</text>
            <text class="meta" style="margin-left:auto;">
              {{ detail.assignment.course_name }}<template v-if="detail.assignment.class_name"> · {{ detail.assignment.class_name }}</template>
            </text>
          </view>
          <text class="d-title">{{ detail.assignment.title }}</text>
          <view class="d-reqs">
            <view class="req-item">
              <text class="req-k">截止</text>
              <text class="req-v">{{ formatDateTime(detail.assignment.deadline) }}</text>
            </view>
            <view class="req-item">
              <text class="req-k">状态</text>
              <text class="req-v">{{ rem.text }}</text>
            </view>
          </view>
          <view class="d-samples" v-if="teacherSamples.length">
            <view class="sec-head" style="margin:24rpx 0 8rpx;">
              <text class="sec-title" style="font-size:26rpx;">提交样例（{{ teacherSamples.length }}）</text>
            </view>
            <view class="cell" hover-class="hv" v-for="(s, i) in teacherSamples" :key="i" @click="previewSample(s)">
              <view class="icon-tile tile-blue"><text>📄</text></view>
              <view class="cell-main">
                <text class="cell-title ellipsis">{{ s.name }}</text>
                <text class="cell-sub">点击预览</text>
              </view>
              <text class="cell-arrow">›</text>
            </view>
          </view>
          <view class="d-ops">
            <button class="btn-ghost op-btn" hover-class="hv" @click="goEdit">✏️ 编辑</button>
            <!-- status 未知（聚合接口不含 status 且补拉失败）时隐藏开关按钮：
                 已关闭作业会误显示"关闭作业"，点了就是对已关闭作业重复发关闭 -->
            <button
              v-if="statusKnown"
              class="op-btn"
              :class="closed ? 'btn-ghost' : 'btn-danger'"
              hover-class="hv"
              @click="toggleStatus"
            >
              {{ closed ? '↺ 重新开启' : '⏸ 关闭作业' }}
            </button>
            <button class="btn-ghost op-btn" hover-class="hv" @click="remind">📣 催交</button>
          </view>
        </view>

        <!-- 提交进度 -->
        <view class="card">
          <view class="sec-head">
            <text class="sec-title">提交进度</text>
            <text class="meta">{{ detail.submitted_count }} / {{ detail.total_students }} 人</text>
          </view>
          <view class="prog-track">
            <view class="prog-fill" :style="{ width: progressPercent + '%', backgroundColor: rateColor(progressPercent) }"></view>
          </view>
          <view class="stat-row">
            <view class="stat-b"><text class="stat-n" style="color:#2f8065;">{{ detail.submitted_count }}</text><text class="stat-k">已交</text></view>
            <view class="stat-b"><text class="stat-n" style="color:#f56c6c;">{{ detail.unsubmitted_count }}</text><text class="stat-k">未交</text></view>
            <view class="stat-b"><text class="stat-n" style="color:#47544e;">{{ detail.total_students }}</text><text class="stat-k">总人数</text></view>
          </view>
        </view>

        <!-- AI 批改 -->
        <view class="card">
          <view class="sec-head">
            <text class="sec-title">AI 批改</text>
            <view class="row" style="gap:14rpx;">
              <button class="btn-ghost op-btn-sm" hover-class="hv" @click="openBatch">发起批改</button>
              <button
                v-if="taskProgress && taskProgress.pending > 0"
                class="btn-danger op-btn-sm"
                hover-class="hv"
                @click="cancelTask"
              >取消</button>
            </view>
          </view>
          <template v-if="taskProgress && taskProgress.total > 0">
            <view class="prog-track">
              <view class="prog-fill" :style="{ width: taskPercent + '%' }"></view>
            </view>
            <view class="stat-row">
              <view class="stat-b"><text class="stat-n" style="color:#2f8065;">{{ taskProgress.success }}</text><text class="stat-k">成功</text></view>
              <view class="stat-b"><text class="stat-n" style="color:#f56c6c;">{{ taskProgress.failed }}</text><text class="stat-k">失败</text></view>
              <view class="stat-b"><text class="stat-n" style="color:#e6a23c;">{{ taskProgress.processing }}</text><text class="stat-k">进行中</text></view>
              <view class="stat-b"><text class="stat-n" style="color:#7d918a;">{{ taskProgress.pending }}</text><text class="stat-k">等待</text></view>
            </view>
            <view class="task-row" v-for="t in taskList.slice(0, 5)" :key="t.id">
              <view class="avatar av-56"><text>{{ (t.student_name || '?').slice(0, 1) }}</text></view>
              <text class="cell-main ellipsis" style="font-size:26rpx;color:#5f6f68;">{{ t.student_name }}</text>
              <text class="tag" :class="'tag-' + taskTagType(t.status)">{{ taskTagText(t.status) }}</text>
            </view>
            <text class="hint" v-if="taskList.length > 5" style="display:block;margin-top:12rpx;">仅显示前 5 条，全部任务请在网页端查看</text>
            <text class="hint" v-if="taskProgress.failed > 0" style="display:block;margin-top:12rpx;">失败任务请到网页端查看原因</text>
          </template>
          <text class="hint" v-else>对已交作业发起 AI 批改，低置信度结果会进入复核队列</text>
        </view>

        <!-- 提交名单 -->
        <view class="card">
          <view class="sec-head">
            <text class="sec-title">已交名单</text>
            <text class="meta">{{ submittedStudents.length }} 人</text>
          </view>
          <template v-if="submittedStudents.length">
            <view class="cell" hover-class="hv" v-for="s in submittedStudents" :key="s.student_id" @click="goReview(s)">
              <view class="avatar av-72"><text>{{ (s.real_name || '?').slice(0, 1) }}</text></view>
              <view class="cell-main">
                <text class="cell-title">{{ s.real_name }}</text>
                <text class="cell-sub" v-if="s.submission">{{ formatDateTime(s.submission.submitted_at) }}</text>
              </view>
              <text class="tag" v-if="s.submission" :class="'tag-' + subStOf(s).type">{{ subStOf(s).text }}</text>
              <text class="score-sm" v-if="s.submission && s.submission.score != null">{{ s.submission.score }}分</text>
              <text class="cell-arrow">›</text>
            </view>
          </template>
          <empty-state v-else icon="📭" text="还没有学生提交" />
        </view>

        <!-- 未交名单 -->
        <view class="card" v-if="unsubmittedStudents.length">
          <view class="row" hover-class="hv" @click="showUnsubmitted = !showUnsubmitted">
            <text class="sec-title">未交名单（{{ unsubmittedStudents.length }}）</text>
            <text class="sec-act">{{ showUnsubmitted ? '收起 ▴' : '展开 ▾' }}</text>
          </view>
          <view v-if="showUnsubmitted" class="unsub-list">
            <text class="unsub-item" v-for="s in unsubmittedStudents" :key="s.student_id">
              {{ s.real_name }}
            </text>
          </view>
        </view>
      </template>
      <!-- 加载失败/缺参：给出原因与重试入口，不再整页空白 -->
      <view class="card" v-else>
        <empty-state icon="⚠️" text="作业加载失败" :sub="loadError || '网络异常，请稍后重试'" />
        <button class="btn-ghost err-retry" hover-class="hv" @click="loadTeacher">重新加载</button>
      </view>
    </template>

    <!-- AI 批改发起弹层 -->
    <view class="sheet-mask" v-if="batchVisible" @click="batchVisible = false">
      <view class="sheet" @click.stop>
        <text class="sheet-title">发起 AI 批改</text>
        <scroll-view scroll-y class="sheet-body">
          <view class="form-item">
            <text class="form-label">评分模板（必选）</text>
            <template v-if="templates.length">
              <view
                class="tpl-item"
                :class="{ active: batchForm.template_id === t.id }"
                hover-class="hv"
                v-for="t in templates"
                :key="t.id"
                @click="batchForm.template_id = t.id"
              >
                <view class="icon-tile tile-mint"><text>📋</text></view>
                <view class="cell-main">
                  <text class="cell-title ellipsis">{{ t.name }}</text>
                  <text class="cell-sub">{{ t.subject }} · 满分 {{ t.full_score }}</text>
                </view>
                <text v-if="batchForm.template_id === t.id" class="tpl-check">✓</text>
              </view>
            </template>
            <text class="hint" v-else>暂无已发布模板，请先到网页端创建并发布</text>
          </view>
          <view class="form-item">
            <text class="form-label">评分模式</text>
            <radio-group class="mode-group" @change="onModeChange">
              <label class="mode-item" v-for="m in GRADING_MODES" :key="m.value">
                <radio :value="m.value" :checked="batchForm.mode === m.value" color="#52c4a0" style="transform:scale(0.8);" />
                <text>{{ m.text }}</text>
              </label>
            </radio-group>
          </view>
          <view class="form-item">
            <text class="form-label">参考答案（可选）</text>
            <textarea
              v-model="batchForm.reference_answer"
              class="form-textarea"
              placeholder="粘贴参考答案或评分要点，可提升批改质量"
              placeholder-class="input-ph"
            />
          </view>
          <view class="form-item row" style="justify-content:space-between;">
            <text class="form-label" style="margin-bottom:0;">已有结果时强制重批</text>
            <switch :checked="batchForm.force" color="#52c4a0" @change="onForceChange" />
          </view>
        </scroll-view>
        <button class="btn-primary sheet-btn" :class="{ hv: batchSubmitting || !batchForm.template_id }" :disabled="batchSubmitting || !batchForm.template_id" @click="startBatch">
          {{ batchSubmitting ? '创建中…' : '开始批改' }}
        </button>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onLoad, onShow, onHide, onUnload } from '@dcloudio/uni-app'
import { get, post, put } from '../../utils/request'
import { useAuthStore } from '../../stores/auth'
import { formatDateTime, remainingText, formatConfidence } from '../../utils/format'
import { assignmentStatus, submissionStatus, GRADING_MODES } from '../../utils/statusMaps'
import { previewFile } from '../../utils/preview'

const auth = useAuthStore()
const isStudent = computed(() => auth.role === 'student')
const isTeacher = computed(() => auth.role === 'teacher')

let assignmentId = null

// 学生侧
const assignment = ref(null)
const aiResult = ref(null)
const aiExpanded = ref(false)
// 加载失败/缺参提示（此前失败时整页纯白无任何反馈）
const loadError = ref('')

// 教师侧
const detail = ref(null)
const teacherAssignment = ref(null)
const showUnsubmitted = ref(false)
const taskProgress = ref(null)
const taskList = ref([])

// AI 批改发起
const batchVisible = ref(false)
const batchSubmitting = ref(false)
const templates = ref([])
const batchForm = ref({ template_id: null, mode: 'balanced', reference_answer: '', force: false })

let pollTimer = null

// 学生用作业详情、教师用补拉的作业详情（聚合接口不含 status），兜底聚合接口内的 assignment
const currentAssignment = computed(
  () => assignment.value || teacherAssignment.value || (detail.value && detail.value.assignment)
)
const st = computed(() => assignmentStatus(currentAssignment.value))
const closed = computed(() => !!(currentAssignment.value && currentAssignment.value.status === 'closed'))
// status 是否已知：聚合接口的 assignment 不含 status 字段，只有完整作业详情才有。
// 补拉失败时 status 未知，此时隐藏开/关按钮，避免对已关闭作业误发"关闭"操作
const statusKnown = computed(() => !!(currentAssignment.value && currentAssignment.value.status))
const overdue = computed(() => !!(currentAssignment.value && currentAssignment.value.is_overdue))
const rem = computed(() => remainingText(currentAssignment.value && currentAssignment.value.deadline))
const mySubmission = computed(() => assignment.value && assignment.value.my_submission)
const subSt = computed(() => submissionStatus(mySubmission.value))
const sampleFiles = computed(() => (assignment.value && assignment.value.sample_files) || [])
// AI 已评但分数未回写（低置信度挂复核）→ "待教师确认"
const aiPending = computed(() => {
  const sub = mySubmission.value
  return !!(aiResult.value && sub && (sub.score == null || sub.score === undefined))
})
const teacherSamples = computed(() => (teacherAssignment.value && teacherAssignment.value.sample_files) || [])
const submittedStudents = computed(() =>
  ((detail.value && detail.value.students) || []).filter((s) => s.submitted && s.submission)
)
const unsubmittedStudents = computed(() => ((detail.value && detail.value.students) || []).filter((s) => !s.submitted))
const progressPercent = computed(() => {
  const d = detail.value
  if (!d || !d.total_students) return 0
  return Math.round((d.submitted_count / d.total_students) * 100)
})
const taskPercent = computed(() => {
  const p = taskProgress.value
  if (!p || !p.total) return 0
  return Math.round(((p.success + p.failed + p.cancelled) / p.total) * 100)
})

onLoad((q) => {
  assignmentId = q.id
})
onShow(() => {
  if (!auth.isLoggedIn) return
  // 缺少 id（分享/扫码误入、通知跳转已删除作业）时给出明确提示而不是整页空白
  if (!assignmentId) {
    loadError.value = '缺少作业参数，请从作业列表重新进入'
    return
  }
  loadError.value = ''
  if (isStudent.value) loadStudent()
  else if (isTeacher.value) loadTeacher()
})
// 页面被压栈（进批改/编辑页）时停止轮询，回到本页 onShow 会按需重启
onHide(() => stopPolling())
onUnload(() => stopPolling())

// 纯视图辅助：姓名首字 / 维度得分百分比
function dimPct(d) {
  const max = Number(d && d.max_score)
  const v = Number(d && d.score)
  if (!max || isNaN(v)) return 0
  return Math.max(0, Math.min(100, Math.round((v / max) * 100)))
}

// 对齐网页端提交率进度条语义色（75% 橙、25% 红、接近全交绿）
function rateColor(pct) {
  if (pct >= 90) return '#52c4a0'
  if (pct >= 50) return '#e6a23c'
  return '#f56c6c'
}

// ===== 学生 =====
async function loadStudent() {
  try {
    assignment.value = await get('/api/assignments/' + assignmentId)
  } catch (e) {
    assignment.value = null
    loadError.value = '作业加载失败或已被删除'
    return
  }
  const sub = assignment.value && assignment.value.my_submission
  if (sub && sub.id) {
    try {
      aiResult.value = await get('/api/grading/results/submission/' + sub.id, null, { silent: true })
    } catch (e) {
      aiResult.value = null
    }
  } else {
    aiResult.value = null
  }
}

function previewSample(s) {
  if (s && s.url) previewFile(s.url, s.name)
}
function previewSubFile(f) {
  previewFile(f.file_path, f.original_name)
}
function goSubmit() {
  if (!mySubmission.value) return uni.navigateTo({ url: '/pages/assignments/submit?id=' + assignmentId })
  uni.showModal({
    title: '重新提交',
    content: '将覆盖原有提交的文件，确定继续吗？',
    success: (r) => {
      if (r.confirm) uni.navigateTo({ url: '/pages/assignments/submit?id=' + assignmentId })
    }
  })
}

// ===== 教师 =====
async function loadTeacher() {
  // 聚合接口一次返回进度 + 全员名单 + 提交对象（含 files）
  try {
    detail.value = await get('/api/assignments/' + assignmentId + '/submissions')
  } catch (e) {
    detail.value = null
    loadError.value = '作业加载失败或已被删除'
    return
  }
  // 聚合接口的 assignment 不含 status/need_grading，补拉一次完整作业详情
  try {
    teacherAssignment.value = await get('/api/assignments/' + assignmentId, null, { silent: true })
  } catch (e) {
    teacherAssignment.value = null
  }
  await refreshTasks()
}

async function refreshTasks() {
  try {
    const data = await get('/api/grading/tasks?assignment_id=' + assignmentId, null, { silent: true })
    if (data && data.progress) {
      taskProgress.value = data.progress
      taskList.value = data.list || []
      if (data.progress.pending + data.progress.processing > 0) startPolling()
      else stopPolling()
    } else {
      taskProgress.value = null
      taskList.value = []
    }
  } catch (e) {
    taskProgress.value = null
  }
}

function startPolling() {
  if (pollTimer) return
  pollTimer = setInterval(async () => {
    try {
      const data = await get('/api/grading/tasks?assignment_id=' + assignmentId, null, { silent: true })
      if (data && data.progress) {
        taskProgress.value = data.progress
        taskList.value = data.list || []
        if (data.progress.pending + data.progress.processing === 0) stopPolling()
      }
    } catch (e) {
      stopPolling()
    }
  }, 3000)
}
function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function taskTagText(s) {
  const map = { pending: '等待', processing: '批改中', success: '成功', failed: '失败', cancelled: '已取消' }
  return map[s] || s
}
function taskTagType(s) {
  const map = { pending: 'info', processing: 'warning', success: 'success', failed: 'danger', cancelled: 'info' }
  return map[s] || 'info'
}

async function openBatch() {
  batchVisible.value = true
  if (!templates.value.length) {
    try {
      const data = await get('/api/grading/templates', { status: 'published', page: 1, pageSize: 50 })
      templates.value = (data && data.list) || []
    } catch (e) {
      templates.value = []
    }
  }
}
function onModeChange(e) {
  batchForm.value.mode = e.detail.value
}
function onForceChange(e) {
  batchForm.value.force = e.detail.value
}
async function startBatch() {
  if (!batchForm.value.template_id) return uni.showToast({ title: '请选择评分模板', icon: 'none' })
  if (batchSubmitting.value) return
  batchSubmitting.value = true
  try {
    const payload = {
      assignment_id: Number(assignmentId),
      template_id: batchForm.value.template_id,
      mode: batchForm.value.mode
    }
    if (batchForm.value.reference_answer) payload.reference_answer = batchForm.value.reference_answer
    if (batchForm.value.force) payload.force = true
    const data = await post('/api/grading/tasks/batch', payload)
    uni.showToast({ title: `已创建 ${data.count} 个批改任务`, icon: 'none' })
    batchVisible.value = false
    await refreshTasks()
  } catch (e) {
    // 错误已提示
  } finally {
    batchSubmitting.value = false
  }
}
async function cancelTask() {
  const pendingTask = taskList.value.find((t) => t.status === 'pending')
  if (!pendingTask) return
  uni.showModal({
    title: '取消批改任务',
    content: '确定取消等待中的批改任务吗？',
    success: async (r) => {
      if (!r.confirm) return
      try {
        await post('/api/grading/tasks/' + pendingTask.id + '/cancel')
        uni.showToast({ title: '任务已取消', icon: 'none' })
        await refreshTasks()
      } catch (e) {}
    }
  })
}

function subStOf(s) {
  return submissionStatus(s.submission)
}
function goReview(s) {
  uni.navigateTo({
    url: '/pages/teacher/review?submissionId=' + s.submission.id
  })
}
function goEdit() {
  uni.navigateTo({ url: '/pages/teacher/edit-assignment?id=' + assignmentId })
}
function toggleStatus() {
  const target = closed.value ? 'active' : 'closed'
  const text = target === 'closed' ? '关闭后学生将无法再提交这份作业' : '重新开启后学生可继续提交'
  uni.showModal({
    title: target === 'closed' ? '关闭作业' : '重新开启',
    content: text,
    success: async (r) => {
      if (!r.confirm) return
      try {
        await put('/api/assignments/' + assignmentId, { status: target })
        uni.showToast({ title: '操作成功', icon: 'none' })
        await loadTeacher()
      } catch (e) {}
    }
  })
}
function remind() {
  uni.showModal({
    title: '催交提醒',
    content: '将向所有未交学生发送站内通知（1 小时内不重复发送）',
    success: async (r) => {
      if (!r.confirm) return
      try {
        const data = await post('/api/submissions/assignment/' + assignmentId + '/remind')
        uni.showToast({ title: `已提醒 ${data.reminded} 人`, icon: 'none' })
      } catch (e) {}
    }
  })
}
</script>

<style scoped>
.hero-card { padding-bottom: 32rpx; }
.d-title {
  display: block;
  font-size: 36rpx;
  font-weight: 700;
  color: #2c3e50;
  line-height: 1.45;
  margin-top: 18rpx;
}
.d-reqs {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx 28rpx;
  margin-top: 24rpx;
  padding: 20rpx 24rpx;
  background: #f7faf8;
  border-radius: 16rpx;
}
.req-item {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
  min-width: 180rpx;
}
.req-k {
  font-size: 22rpx;
  color: #7d918a;
}
.req-v {
  font-size: 25rpx;
  color: #2c3e50;
  font-weight: 500;
}
.d-desc {
  margin-top: 22rpx;
  background: #f7faf8;
  border-radius: 16rpx;
  padding: 22rpx 24rpx;
}
.d-desc-text {
  font-size: 26rpx;
  color: #5f6f68;
  line-height: 1.7;
}
.dl-urgent { color: #e6a23c !important; }
.dl-overdue { color: #f56c6c !important; }

.cleaned { color: #a8bdb4; }

.score-line {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 8rpx 0 20rpx;
}
.score-num {
  font-size: 64rpx;
  font-weight: 700;
  color: #2f8065;
  line-height: 1.1;
}
.score-side {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}
.score-label {
  font-size: 25rpx;
  font-weight: 600;
  color: #2c3e50;
}
.score-sm {
  font-size: 26rpx;
  font-weight: 600;
  color: #2f8065;
  flex-shrink: 0;
}

.ai-waiting {
  margin-top: 18rpx;
  background: #fcf5eb;
  border-radius: 14rpx;
  padding: 18rpx 22rpx;
  font-size: 25rpx;
  color: #b88130;
}

.quote-block {
  margin-top: 18rpx;
  background: #f7faf8;
  border-radius: 16rpx;
  padding: 20rpx 24rpx;
}
.quote-blue { background: #ecf5fe; }
.quote-label {
  display: block;
  font-size: 22rpx;
  color: #7d918a;
  margin-bottom: 8rpx;
}
.quote-text {
  font-size: 26rpx;
  color: #47544e;
  line-height: 1.7;
}

.ai-block {
  margin-top: 26rpx;
  border-top: 1rpx solid #f0f5f2;
  padding-top: 24rpx;
}
.ai-block-title {
  font-size: 29rpx;
  font-weight: 600;
  color: #2c3e50;
  flex: 1;
}
.ai-score-line {
  display: flex;
  align-items: center;
  gap: 20rpx;
  margin: 20rpx 0;
}
.ai-score {
  font-size: 60rpx;
  font-weight: 700;
  color: #2f8065;
  line-height: 1.1;
}
.ai-dim {
  background: #f7faf8;
  border-radius: 16rpx;
  padding: 18rpx 22rpx;
  margin-bottom: 14rpx;
}
.ai-dim-name { font-size: 26rpx; color: #2c3e50; font-weight: 500; }
.ai-dim-score { font-size: 26rpx; color: #2f8065; font-weight: 600; }
.dim-track { height: 10rpx; margin-top: 12rpx; }
.ai-dim-fb {
  display: block;
  font-size: 24rpx;
  color: #7d918a;
  margin-top: 10rpx;
  line-height: 1.6;
}

.d-ops {
  display: flex;
  gap: 14rpx;
  margin-top: 26rpx;
}
.op-btn {
  flex: 1;
  height: 76rpx;
  font-size: 25rpx;
}
.op-btn-sm {
  height: 60rpx;
  font-size: 24rpx;
  padding: 0 24rpx;
}

.stat-row {
  display: flex;
  margin-top: 24rpx;
}
.stat-b {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  border-right: 1rpx solid #f0f5f2;
}
.stat-b:last-child { border-right: none; }
.stat-n {
  font-size: 38rpx;
  font-weight: 700;
}
.stat-k {
  font-size: 22rpx;
  color: #7d918a;
  margin-top: 6rpx;
}

.task-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 14rpx 0;
}

.unsub-list {
  margin-top: 20rpx;
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}
.unsub-item {
  background: #fef0f0;
  color: #c45656;
  border-radius: 999rpx;
  padding: 8rpx 26rpx;
  font-size: 24rpx;
}

.sheet-body { flex: 1; min-height: 200rpx; max-height: 52vh; }
.sheet-btn { margin-top: 28rpx; }
.tpl-item {
  display: flex;
  align-items: center;
  gap: 18rpx;
  border: 2rpx solid #f0f5f2;
  border-radius: 18rpx;
  padding: 18rpx 22rpx;
  margin-bottom: 14rpx;
}
.tpl-item.active {
  border-color: #3da884;
  background: #edf9f5;
}
.tpl-check {
  color: #52c4a0;
  font-weight: 700;
  font-size: 30rpx;
}
.mode-group { display: flex; gap: 36rpx; }
.mode-item { display: flex; align-items: center; gap: 6rpx; font-size: 28rpx; color: #47544e; }
.input-ph { color: #a8bdb4; }
/* 加载失败卡的重试按钮 */
.err-retry {
  width: 100%;
  height: 80rpx;
  margin-top: 24rpx;
}
/* fixbar 悬浮条不遮挡底部内容（学生提交按钮） */
.page {
  padding-bottom: 170rpx;
}
</style>
