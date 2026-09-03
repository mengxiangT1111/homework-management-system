<template>
  <view class="page">
    <view class="card">
      <view class="sec-head">
        <text class="sec-title">基本信息</text>
      </view>
      <view class="form-item">
        <text class="form-label">作业标题 <text class="danger-text">*</text></text>
        <input v-model="form.title" class="form-input" placeholder="请输入作业标题" placeholder-class="input-ph" />
      </view>
      <view class="form-item">
        <text class="form-label">作业要求说明</text>
        <textarea v-model="form.description" class="form-textarea" placeholder="描述作业内容与要求（可选）" placeholder-class="input-ph" />
      </view>
      <view class="form-item">
        <text class="form-label">所属课程 <text class="danger-text">*</text></text>
        <picker v-if="!isEdit" mode="selector" :range="courseNames" :value="courseIndex" @change="onCourseChange">
          <view class="picker-value" :class="{ placeholder: courseIndex < 0 }">
            <text :class="courseIndex >= 0 ? '' : 'input-ph'">
              {{ courseIndex >= 0 ? courseNames[courseIndex] : '请选择课程' }}
            </text>
            <text class="p-arrow">▾</text>
          </view>
        </picker>
        <view v-else class="picker-value">
          <text>{{ courseNames[courseIndex] || '原课程' }}</text>
        </view>
      </view>
    </view>

    <view class="card">
      <view class="sec-head">
        <text class="sec-title">截止与要求</text>
      </view>
      <view class="form-item">
        <text class="form-label">截止时间 <text class="danger-text">*</text>{{ isEdit ? '（修改必须晚于当前时间）' : '' }}</text>
        <view class="dt-row">
          <picker mode="date" :value="deadlineDate" :start="startDate" @change="onDateChange">
            <view class="picker-value dt-picker" :class="{ placeholder: !deadlineDate }">
              <text :class="deadlineDate ? '' : 'input-ph'">{{ deadlineDate || '选择日期' }}</text>
              <text class="p-arrow">▾</text>
            </view>
          </picker>
          <picker mode="time" :value="deadlineTime" @change="onTimeChange">
            <view class="picker-value dt-picker" :class="{ placeholder: !deadlineTime }">
              <text :class="deadlineTime ? '' : 'input-ph'">{{ deadlineTime || '时间' }}</text>
              <text class="p-arrow">▾</text>
            </view>
          </picker>
        </view>
      </view>
      <view class="form-item form-inline">
        <text class="form-label" style="margin-bottom:0;">最多文件份数</text>
        <input v-model="form.max_files" class="form-input num-input" type="number" />
      </view>
      <view class="form-item form-inline">
        <text class="form-label" style="margin-bottom:0;">单文件上限（MB）</text>
        <input v-model="form.max_size_mb" class="form-input num-input" type="number" />
      </view>
    </view>

    <view class="card">
      <view class="sec-head">
        <text class="sec-title">批改选项</text>
      </view>
      <view class="form-item">
        <text class="form-label">允许的文件格式（不选默认允许全部）</text>
        <view class="chips">
          <text
            class="chip"
            :class="{ active: form.allowed_formats.includes(f) }"
            v-for="f in ALL_FORMATS"
            :key="f"
            @click="toggleFormat(f)"
          >{{ f }}</text>
        </view>
      </view>
      <view class="form-item form-inline" style="margin-bottom:6rpx;">
        <text class="form-label" style="margin-bottom:0;">需要教师批改打分</text>
        <switch :checked="form.need_grading" color="#52c4a0" @change="onNeedGradingChange" />
      </view>
    </view>

    <!-- 提交样例（可选）：上传后学生端可预览 -->
    <view class="card">
      <view class="sec-head">
        <text class="sec-title">提交样例（可选）</text>
        <text class="meta">{{ samples.length }}/5</text>
      </view>
      <view class="cell" v-for="(sm, i) in samples" :key="sm.key">
        <view class="icon-tile" :class="sm.status === 'failed' ? 'tile-red-bg' : 'tile-mint'"><text>📄</text></view>
        <view class="cell-main">
          <text class="cell-title ellipsis">{{ sm.name }}</text>
          <text v-if="sm.status === 'uploading'" class="cell-sub">上传中 {{ sm.progress }}%</text>
          <text v-else-if="sm.status === 'failed'" class="cell-sub danger-text">上传失败，点右侧重试</text>
          <text v-else class="cell-sub">已就绪，学生端可预览</text>
          <view class="prog-track sm-prog" v-if="sm.status === 'uploading'">
            <view class="prog-fill" :style="{ width: sm.progress + '%' }"></view>
          </view>
        </view>
        <text v-if="sm.status === 'failed'" class="sec-act" @click="uploadSample(i)">重试</text>
        <text v-if="sm.status !== 'uploading'" class="sm-del" @click="removeSample(i)">✕</text>
      </view>
      <view class="pick-row" v-if="samples.length < 5">
        <button class="pick-btn" hover-class="hv" @click="addSampleFromChat">📁 聊天文件</button>
        <button class="pick-btn" hover-class="hv" @click="addSampleFromPhoto">📷 拍照 / 相册</button>
      </view>
      <text class="hint" style="display:block;margin-top:14rpx;">样例会展示给学生预览；单个 ≤ 100MB，最多 5 个</text>
    </view>

    <view class="fixbar">
      <button class="btn-primary" :class="{ hv: saving }" :disabled="saving" @click="save">
        {{ saving ? '保存中…' : isEdit ? '保存修改' : '发布作业' }}
      </button>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { get, post, put, uploadSingle } from '../../utils/request'
import { formatTime } from '../../utils/format'

const ALL_FORMATS = ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png', 'gif', 'zip', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'mp4']

const isEdit = ref(false)
let editId = null
let original = null // 编辑前的原始值，用于"只提交变更字段"

const courses = ref([])
const courseIndex = ref(-1)
const deadlineDate = ref('')
const deadlineTime = ref('')
const saving = ref(false)

// 提交样例：{ key, name, type, size, path, status, progress, url }
// 已有样例（编辑预填）没有 path，url 直接可用；新上传的在 status=done 后才有 url
const samples = ref([])
let sampleKeySeq = 1

const form = ref({
  title: '',
  description: '',
  allowed_formats: ['pdf', 'doc', 'docx', 'jpg', 'png', 'zip'],
  max_files: 5,
  max_size_mb: 100,
  need_grading: false
})

const courseNames = computed(() => courses.value.map((c) => c.name))
const startDate = ref(new Date().toISOString().slice(0, 10))

onLoad(async (q) => {
  if (q.id) {
    isEdit.value = true
    editId = q.id
    uni.setNavigationBarTitle({ title: '编辑作业' })
  }
  await loadCourses()
  if (isEdit.value) await loadAssignment()
})

async function loadCourses() {
  try {
    courses.value = (await get('/api/courses/my/teaching')) || []
  } catch (e) {
    courses.value = []
  }
}

async function loadAssignment() {
  try {
    const a = await get('/api/assignments/' + editId)
    original = a
    form.value.title = a.title || ''
    form.value.description = a.description || ''
    form.value.allowed_formats = (a.allowed_formats || []).slice()
    form.value.max_files = a.max_files
    form.value.max_size_mb = a.max_size_mb
    form.value.need_grading = a.need_grading === 1 || a.need_grading === true
    const t = formatTime(a.deadline)
    deadlineDate.value = t.date
    deadlineTime.value = t.time
    // 课程锁定：显示原课程名（后端不允许改所属课程）
    courseIndex.value = courses.value.findIndex((c) => c.id === a.course_id)
    // 预填已有样例
    samples.value = (Array.isArray(a.sample_files) ? a.sample_files : []).map((s) => ({
      key: 'e' + sampleKeySeq++,
      name: s.name || '样例文件',
      type: s.type || '',
      size: 0,
      path: null,
      status: 'done',
      progress: 100,
      url: s.url
    }))
  } catch (e) {
    // 错误已提示
  }
}

function onCourseChange(e) {
  courseIndex.value = Number(e.detail.value)
}
function onDateChange(e) {
  deadlineDate.value = e.detail.value
}
function onTimeChange(e) {
  deadlineTime.value = e.detail.value
}
function onNeedGradingChange(e) {
  form.value.need_grading = e.detail.value
}
function toggleFormat(f) {
  const arr = form.value.allowed_formats
  const idx = arr.indexOf(f)
  if (idx >= 0) arr.splice(idx, 1)
  else arr.push(f)
}

function buildDeadline() {
  if (!deadlineDate.value || !deadlineTime.value) return null
  return `${deadlineDate.value} ${deadlineTime.value}:00`
}

// ===== 提交样例 =====
const HARD_LIMIT_MB = 100

function addSampleFiles(list) {
  for (const f of list) {
    if (samples.value.length >= 5) {
      return uni.showToast({ title: '样例最多 5 个', icon: 'none' })
    }
    if (f.size > HARD_LIMIT_MB * 1024 * 1024) {
      uni.showToast({ title: `${f.name} 超过 100MB`, icon: 'none' })
      continue
    }
    samples.value.push({
      key: 'n' + sampleKeySeq++,
      name: f.name,
      type: '',
      size: f.size,
      path: f.path,
      status: 'pending',
      progress: 0,
      url: null
    })
  }
}

function addSampleFromChat() {
  if (samples.value.length >= 5) return uni.showToast({ title: '样例最多 5 个', icon: 'none' })
  uni.chooseMessageFile({
    count: 5 - samples.value.length,
    type: 'file',
    success: (r) => {
      addSampleFiles(r.tempFiles.map((f) => ({ path: f.path, name: f.name || 'file', size: f.size })))
    }
  })
}

function addSampleFromPhoto() {
  if (samples.value.length >= 5) return uni.showToast({ title: '样例最多 5 个', icon: 'none' })
  uni.chooseMedia({
    count: 5 - samples.value.length,
    mediaType: ['image', 'video'],
    sizeType: ['compressed'],
    success: (r) => {
      addSampleFiles(
        r.tempFiles.map((f) => ({
          path: f.tempFilePath,
          name: (f.tempFilePath.split('/').pop() || 'sample').split('?')[0],
          size: f.size
        }))
      )
    }
  })
}

async function uploadSample(i) {
  const sm = samples.value[i]
  if (!sm || !sm.path || sm.status === 'uploading' || sm.status === 'done') return
  sm.status = 'uploading'
  sm.progress = 0
  try {
    const d = await uploadSingle({
      filePath: sm.path,
      filename: sm.name,
      onProgress: (p) => {
        sm.progress = p
      }
    })
    sm.url = d.file_path
    sm.type = d.mime_type || sm.type
    sm.status = 'done'
  } catch (e) {
    sm.status = 'failed'
    sm.url = null
  }
}

function removeSample(i) {
  if (samples.value[i].status !== 'uploading') samples.value.splice(i, 1)
}

// 串行上传所有未完成的样例；全部成功返回 true
async function ensureSamplesUploaded() {
  for (let i = 0; i < samples.value.length; i++) {
    const sm = samples.value[i]
    if (sm.status === 'done') continue
    await uploadSample(i)
    if (sm.status !== 'done') {
      uni.showToast({ title: `${sm.name} 上传失败，请重试`, icon: 'none' })
      return false
    }
  }
  return true
}

// 与网页端同构：[{ name, type, url: file_path }]
function buildSampleFiles() {
  return samples.value
    .filter((s) => s.status === 'done' && s.url)
    .map((s) => ({ name: s.name, type: s.type, url: s.url }))
}

function samplesChanged() {
  const now = JSON.stringify(buildSampleFiles())
  const orig = JSON.stringify(Array.isArray(original && original.sample_files) ? original.sample_files : [])
  return now !== orig
}

async function save() {
  if (saving.value) return
  const f = form.value
  if (!f.title.trim()) return uni.showToast({ title: '请输入作业标题', icon: 'none' })

  try {
    if (isEdit.value) {
      // 详情未加载成功（弱网/403/404）时 original 为 null，直接拼 payload 会
      // TypeError 被外层 catch 吞掉、按钮看似"失灵"。这里先重试加载，仍失败则明确提示
      if (!original) {
        uni.showToast({ title: '作业详情未加载，正在重试…', icon: 'none' })
        await loadAssignment()
        if (!original) {
          return uni.showToast({ title: '详情加载失败，请返回重新进入', icon: 'none' })
        }
      }
      // 编辑：只提交有变化的字段。服务端仅在携带 deadline 时校验"晚于当前时间"，
      // 原样回传已逾期的旧截止时间会被 422，因此未修改的字段一律不带。
      const payload = {}
      const trimmedTitle = f.title.trim()
      if (trimmedTitle !== original.title) payload.title = trimmedTitle
      if ((f.description || '') !== (original.description || '')) payload.description = f.description
      if (f.allowed_formats.join(',') !== (original.allowed_formats || []).join(',')) {
        payload.allowed_formats = f.allowed_formats
      }
      if (Number(f.max_files) !== original.max_files) payload.max_files = Number(f.max_files)
      if (Number(f.max_size_mb) !== original.max_size_mb) payload.max_size_mb = Number(f.max_size_mb)
      const origNeed = original.need_grading === 1 || original.need_grading === true
      if (f.need_grading !== origNeed) payload.need_grading = f.need_grading
      const dl = buildDeadline()
      const origDl = formatTime(original.deadline)
      const origDlStr = origDl.date && origDl.time ? `${origDl.date} ${origDl.time}:00` : ''
      if (dl && dl !== origDlStr) payload.deadline = dl

      // 样例：先确保全部上传完成；有变化才携带（服务端为整体替换）
      if (samples.value.length && !(await ensureSamplesUploaded())) return
      if (samplesChanged()) payload.sample_files = buildSampleFiles()

      if (!Object.keys(payload).length) {
        return uni.showToast({ title: '内容未做修改', icon: 'none' })
      }
      saving.value = true
      await put('/api/assignments/' + editId, payload)
      uni.showToast({ title: '保存成功', icon: 'success' })
    } else {
      const course = courses.value[courseIndex.value]
      if (!course) return uni.showToast({ title: '请选择课程', icon: 'none' })
      const dl = buildDeadline()
      if (!dl) return uni.showToast({ title: '请选择截止日期和时间', icon: 'none' })
      if (!(await ensureSamplesUploaded())) return
      saving.value = true
      await post('/api/assignments', {
        title: f.title.trim(),
        description: f.description || '',
        course_id: course.id,
        deadline: dl,
        allowed_formats: f.allowed_formats,
        max_files: Number(f.max_files) || 5,
        max_size_mb: Number(f.max_size_mb) || 100,
        need_grading: f.need_grading,
        sample_files: buildSampleFiles()
      })
      uni.showToast({ title: '发布成功', icon: 'success' })
    }
    setTimeout(() => uni.navigateBack(), 800)
  } catch (e) {
    // 错误已提示
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.dt-row {
  display: flex;
  gap: 16rpx;
}
.dt-picker { flex: 1; }
.p-arrow {
  color: #a8bdb4;
  font-size: 24rpx;
}
.form-inline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
}
.num-input {
  width: 200rpx;
  text-align: center;
}
.input-ph { color: #a8bdb4; }
.sm-del {
  color: #b6c1bb;
  font-size: 28rpx;
  padding: 4rpx 8rpx;
  flex-shrink: 0;
}
.sm-prog {
  height: 8rpx;
  margin-top: 10rpx;
}
/* 上传失败态图标块底色（模板引用此前无定义，失败态无视觉区分） */
.tile-red-bg {
  background: #fef0f0;
}
.pick-row {
  display: flex;
  gap: 20rpx;
  margin-top: 8rpx;
}
.pick-btn {
  flex: 1;
  height: 84rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10rpx;
  background: #ffffff;
  border: 1rpx solid #d3e0d9;
  border-radius: 999rpx;
  font-size: 26rpx;
  color: #2f8065;
}
/* fixbar 悬浮条不遮挡底部内容 */
.page {
  padding-bottom: 170rpx;
}
</style>
