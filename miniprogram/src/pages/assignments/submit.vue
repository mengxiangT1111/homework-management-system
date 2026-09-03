<template>
  <view class="page">
    <template v-if="assignment">
      <view class="card">
        <text class="s-title">{{ assignment.title }}</text>
        <text class="cell-sub" style="display:block;margin-top:10rpx;">
          最多 {{ maxFiles }} 份 · 单文件 ≤ {{ maxSizeMb }}MB
          <template v-if="allowedFormats.length"> · 允许 {{ allowedFormats.join(' / ') }}</template>
        </text>
      </view>

      <view class="card" v-if="blocked">
        <text class="danger-text">{{ assignment.status === 'closed' ? '该作业已关闭，无法提交' : '已过截止时间，无法提交' }}</text>
      </view>

      <template v-else>
        <!-- 上传区 -->
        <view class="card">
          <view class="upload-zone" hover-class="hv" @click="chooseFromChat">
            <text class="upload-glyph">＋</text>
            <text class="upload-main">选择文件上传</text>
            <text class="upload-sub">支持聊天文件 / 拍照 / 相册，单文件 ≤ 100MB</text>
          </view>
          <view class="pick-row">
            <button class="pick-btn" hover-class="hv" @click="chooseFromChat">
              <text class="pick-glyph">📁</text>
              <text>聊天文件</text>
            </button>
            <button class="pick-btn" hover-class="hv" @click="choosePhoto">
              <text class="pick-glyph">📷</text>
              <text>拍照 / 相册</text>
            </button>
          </view>
        </view>

        <!-- 已选文件 -->
        <view class="card" v-if="items.length">
          <view class="sec-head">
            <text class="sec-title">文件清单</text>
            <text class="meta">{{ items.length }}/{{ maxFiles }}</text>
          </view>
          <view class="file-item" v-for="(it, idx) in items" :key="it.path + '-' + idx">
            <view class="icon-tile tile-mint"><text>📄</text></view>
            <view class="cell-main">
              <text class="ellipsis file-name">{{ it.name }}</text>
              <text class="cell-sub">{{ formatSize(it.size) }}</text>
              <view class="prog-track item-prog" v-if="it.status === 'uploading'">
                <view class="prog-fill" :style="{ width: it.progress + '%' }"></view>
              </view>
            </view>
            <view class="file-state">
              <text v-if="it.status === 'pending'" class="tag tag-info">待上传</text>
              <text v-else-if="it.status === 'uploading'" class="tag tag-warning">{{ it.progress }}%</text>
              <text v-else-if="it.status === 'done'" class="tag tag-success">已上传</text>
              <text v-else-if="it.status === 'failed'" class="tag tag-danger" @click="uploadOne(idx)">失败 重试</text>
              <text class="file-del" v-if="it.status !== 'uploading'" @click="removeItem(idx)">✕</text>
            </view>
          </view>
        </view>

        <view class="card">
          <view class="form-item" style="margin-bottom:0;">
            <text class="form-label">备注（可选）</text>
            <textarea v-model="remark" class="form-textarea" placeholder="给老师留言…" placeholder-class="input-ph" />
          </view>
        </view>

        <view class="fixbar">
          <button class="btn-primary" :class="{ hv: submitting || uploadingAny }" :disabled="submitting || uploadingAny" @click="submitAll">
            {{ uploadingAny ? '上传中…' : submitting ? '提交中…' : '提交作业（' + doneCount + '/' + items.length + ' 已上传）' }}
          </button>
        </view>
      </template>
    </template>
    <!-- 加载失败/缺参：给出原因与重试入口，不再整页空白 -->
    <view class="card" v-else style="margin-top: 24rpx;">
      <empty-state icon="⚠️" text="作业加载失败" :sub="loadError || '网络异常，请稍后重试'" />
      <button class="btn-ghost err-retry" hover-class="hv" @click="loadAssignment">重新加载</button>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { get, post, uploadSingle } from '../../utils/request'
import { formatSize } from '../../utils/format'
import { getExt } from '../../utils/preview'

const HARD_LIMIT_MB = 100

let assignmentId = null
const assignment = ref(null)
const items = ref([]) // { path, name, size, ext, status, progress, descriptor }
const remark = ref('')
const submitting = ref(false)
// 加载失败/缺参提示（此前失败时整页纯白无任何反馈）
const loadError = ref('')

const maxFiles = computed(() => (assignment.value && assignment.value.max_files) || 5)
const maxSizeMb = computed(() => (assignment.value && assignment.value.max_size_mb) || 100)
const allowedFormats = computed(() => (assignment.value && assignment.value.allowed_formats) || [])
const blocked = computed(
  () => assignment.value && (assignment.value.status === 'closed' || assignment.value.is_overdue)
)
const uploadingAny = computed(() => items.value.some((it) => it.status === 'uploading'))
const doneCount = computed(() => items.value.filter((it) => it.status === 'done').length)

onLoad((q) => {
  assignmentId = q.id
})
onShow(() => {
  // 缺少 id（通知跳转已删除作业/分享误入）时给出明确提示而不是整页空白
  if (!assignmentId) {
    loadError.value = '缺少作业参数，请从作业列表重新进入'
    return
  }
  loadError.value = ''
  loadAssignment()
})

async function loadAssignment() {
  try {
    assignment.value = await get('/api/assignments/' + assignmentId)
  } catch (e) {
    assignment.value = null
    loadError.value = '作业加载失败或已被删除'
  }
}

function remainingCount() {
  return maxFiles.value - items.value.length
}

function chooseFromChat() {
  const remaining = remainingCount()
  if (remaining <= 0) return uni.showToast({ title: `最多只能上传 ${maxFiles.value} 份文件`, icon: 'none' })
  uni.chooseMessageFile({
    count: remaining,
    type: 'file',
    // allowedFormats 为空数组表示允许全部格式，不传 extension
    extension: allowedFormats.value.length ? allowedFormats.value : undefined,
    success: (res) => {
      addFiles(res.tempFiles.map((f) => ({ path: f.path, name: f.name || 'file', size: f.size })))
    }
  })
}

function choosePhoto() {
  const remaining = remainingCount()
  if (remaining <= 0) return uni.showToast({ title: `最多只能上传 ${maxFiles.value} 份文件`, icon: 'none' })
  uni.chooseMedia({
    count: remaining,
    mediaType: ['image', 'video'],
    sizeType: ['compressed'],
    success: (res) => {
      addFiles(
        res.tempFiles.map((f) => ({
          path: f.tempFilePath,
          name: (f.tempFilePath.split('/').pop() || 'photo').split('?')[0],
          size: f.size
        }))
      )
    }
  })
}

function addFiles(list) {
  for (const f of list) {
    const ext = getExt(f.name) || getExt(f.path)
    if (allowedFormats.value.length && !allowedFormats.value.includes(ext)) {
      uni.showToast({ title: `${f.name} 格式不被允许`, icon: 'none' })
      continue
    }
    if (f.size > HARD_LIMIT_MB * 1024 * 1024) {
      uni.showToast({ title: `${f.name} 超过 100MB，请到网页端提交`, icon: 'none' })
      continue
    }
    if (f.size > maxSizeMb.value * 1024 * 1024) {
      uni.showToast({ title: `${f.name} 超过单文件上限 ${maxSizeMb.value}MB`, icon: 'none' })
      continue
    }
    items.value.push({ path: f.path, name: f.name, size: f.size, ext, status: 'pending', progress: 0, descriptor: null })
  }
}

function removeItem(idx) {
  items.value.splice(idx, 1)
}

async function uploadOne(idx) {
  const it = items.value[idx]
  if (!it || it.status === 'uploading' || it.status === 'done') return
  it.status = 'uploading'
  it.progress = 0
  try {
    it.descriptor = await uploadSingle({
      filePath: it.path,
      filename: it.name,
      onProgress: (p) => {
        it.progress = p
      }
    })
    it.status = 'done'
  } catch (e) {
    it.status = 'failed'
    it.descriptor = null
  }
}

async function submitAll() {
  if (submitting.value || uploadingAny.value) return
  if (!items.value.length) return uni.showToast({ title: '请至少上传一份文件', icon: 'none' })

  // 串行上传未完成的文件；单个失败即中止，让用户重试
  for (let i = 0; i < items.value.length; i++) {
    const it = items.value[i]
    if (it.status === 'done') continue
    await uploadOne(i)
    if (it.status !== 'done') {
      return uni.showToast({ title: `${it.name} 上传失败，请重试`, icon: 'none' })
    }
  }

  submitting.value = true
  try {
    const files = items.value.map((it) => it.descriptor)
    await post('/api/submissions/assignment/' + assignmentId, {
      files,
      remark: remark.value || undefined
    })
    uni.showToast({ title: '提交成功', icon: 'success' })
    setTimeout(() => uni.navigateBack(), 800)
  } catch (e) {
    // 错误已提示
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.s-title {
  font-size: 32rpx;
  font-weight: 700;
  color: #2c3e50;
  line-height: 1.5;
}

.upload-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 44rpx 24rpx;
  border: 2rpx dashed #97dbc2;
  border-radius: 20rpx;
  background: #f2faf7;
}
.upload-glyph {
  width: 84rpx;
  height: 84rpx;
  border-radius: 50%;
  background: #3da884;
  color: #ffffff;
  font-size: 48rpx;
  font-weight: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  box-shadow: 0 4rpx 12rpx rgba(61, 168, 132, 0.28);
}
.upload-main {
  margin-top: 18rpx;
  font-size: 29rpx;
  font-weight: 600;
  color: #2c3e50;
}
.upload-sub {
  margin-top: 8rpx;
  font-size: 23rpx;
  color: #7d918a;
}

.pick-row {
  display: flex;
  gap: 20rpx;
  margin-top: 22rpx;
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
.pick-glyph { font-size: 28rpx; }

.file-item {
  display: flex;
  align-items: center;
  gap: 18rpx;
  padding: 20rpx 0;
  border-bottom: 1rpx solid #f0f5f2;
}
.file-item:last-child { border-bottom: none; }
.file-name {
  display: block;
  font-size: 26rpx;
  color: #2c3e50;
  margin-bottom: 4rpx;
}
.item-prog {
  height: 8rpx;
  margin-top: 10rpx;
}
.file-state {
  display: flex;
  align-items: center;
  gap: 14rpx;
  flex-shrink: 0;
}
.file-del {
  color: #a8bdb4;
  font-size: 28rpx;
  padding: 4rpx 8rpx;
}
.input-ph { color: #a8bdb4; }
/* 加载失败卡的重试按钮 */
.err-retry {
  width: 100%;
  height: 80rpx;
  margin-top: 24rpx;
}
/* fixbar 悬浮条不遮挡底部内容 */
.page {
  padding-bottom: 170rpx;
}
</style>
