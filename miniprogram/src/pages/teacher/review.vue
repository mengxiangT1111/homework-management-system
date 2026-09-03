<template>
  <view class="page">
    <template v-if="detail">
      <!-- 学生信息头 -->
      <view class="card r-head">
        <view class="avatar av-96"><text>{{ initial }}</text></view>
        <view class="cell-main">
          <text class="r-name">{{ detail.student ? detail.student.real_name : '未知学生' }}</text>
          <text class="cell-sub">
            {{ detail.assignment ? detail.assignment.title : '' }}
          </text>
          <text class="cell-sub" v-if="detail.remark">备注：{{ detail.remark }}</text>
        </view>
        <text class="tag" :class="'tag-' + subSt.type">{{ subSt.text }}</text>
      </view>

      <!-- 文件列表 -->
      <view class="card">
        <view class="sec-head">
          <text class="sec-title">作业文件</text>
          <text class="meta">{{ (detail.files || []).length }} 个</text>
        </view>
        <template v-if="(detail.files || []).length">
          <view class="cell" hover-class="hv" v-for="f in detail.files" :key="f.id" @click="preview(f)">
            <view class="icon-tile" :class="f.is_cleaned === 1 ? 'tile-slate' : 'tile-blue'"><text>📎</text></view>
            <view class="cell-main">
              <text class="cell-title ellipsis" :class="{ cleaned: f.is_cleaned === 1 }">{{ f.original_name }}</text>
              <text class="cell-sub" v-if="f.is_cleaned === 1">文件已过期清理</text>
              <text class="cell-sub" v-else>提交于 {{ formatDateTime(detail.submitted_at) }} · 点击预览</text>
            </view>
            <text class="cell-arrow" v-if="f.is_cleaned !== 1">›</text>
          </view>
        </template>
        <empty-state v-else icon="📭" text="无文件" />
      </view>

      <!-- AI 批改结果 -->
      <view class="card">
        <view class="sec-head">
          <text class="sec-title">AI 批改结果</text>
        </view>
        <template v-if="aiResult">
          <view class="ai-score-line">
            <text class="ai-score">{{ aiResult.total_score }}</text>
            <view class="score-side">
              <text class="score-label">满分 {{ aiResult.full_score }} 分</text>
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
        <text class="hint" v-else>未进行 AI 批改</text>
      </view>

      <!-- 打分评语 -->
      <view class="card">
        <view class="sec-head">
          <text class="sec-title">手动批改</text>
          <text class="meta" v-if="detail.score != null">现有 {{ detail.score }} 分</text>
        </view>
        <view class="form-item">
          <text class="form-label">分数（0-{{ maxScore }}）</text>
          <input v-model="score" class="form-input" type="digit" placeholder="请输入分数" placeholder-class="input-ph" />
        </view>
        <view class="form-item">
          <text class="form-label">评语</text>
          <textarea v-model="comment" class="form-textarea" placeholder="写下评语（可选）" placeholder-class="input-ph" />
        </view>
        <button class="btn-primary grade-btn" :class="{ hv: saving }" :disabled="saving" @click="saveGrade">
          {{ saving ? '保存中…' : '保存批改' }}
        </button>
      </view>

      <!-- 复核操作条（从复核队列进入时出现） -->
      <view class="card" v-if="reviewId">
        <view class="sec-head">
          <text class="sec-title">复核结论</text>
          <text class="tag tag-warning">待复核</text>
        </view>
        <view class="review-actions">
          <button class="btn-ghost review-btn" hover-class="hv" :disabled="reviewing" @click="approve">✓ 采纳</button>
          <button class="btn-ghost review-btn" hover-class="hv" :disabled="reviewing" @click="showAdjust = !showAdjust">✎ 调整分数</button>
          <button class="btn-danger review-btn" hover-class="hv" :disabled="reviewing" @click="showReject = !showReject">↺ 驳回重批</button>
        </view>

        <view v-if="showAdjust" class="review-panel">
          <view class="form-item">
            <text class="form-label">最终分数（0-{{ maxScore }}）</text>
            <input v-model="finalScore" class="form-input" type="digit" placeholder="请输入最终分数" placeholder-class="input-ph" />
          </view>
          <view class="form-item">
            <text class="form-label">说明（可选）</text>
            <input v-model="adjustComment" class="form-input" placeholder="调整原因" placeholder-class="input-ph" />
          </view>
          <button class="btn-primary grade-btn" hover-class="hv" :disabled="reviewing" @click="adjust">提交调整</button>
        </view>

        <view v-if="showReject" class="review-panel">
          <view class="form-item">
            <text class="form-label">驳回原因（必填）</text>
            <textarea v-model="rejectComment" class="form-textarea" placeholder="说明驳回原因" placeholder-class="input-ph" />
          </view>
          <button class="btn-primary grade-btn reject-btn" hover-class="hv" :disabled="reviewing" @click="reject">确认驳回</button>
        </view>
      </view>
    </template>
    <!-- 加载失败/缺参：给出原因与重试入口，不再整页空白 -->
    <view class="card" v-else style="margin-top: 24rpx;">
      <empty-state icon="⚠️" text="提交加载失败" :sub="loadError || '网络异常，请稍后重试'" />
      <button class="btn-ghost err-retry" hover-class="hv" @click="load">重新加载</button>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { get, put, post } from '../../utils/request'
import { formatDateTime, formatConfidence } from '../../utils/format'
import { submissionStatus } from '../../utils/statusMaps'
import { previewFile } from '../../utils/preview'

let submissionId = null
const reviewId = ref(null)

const detail = ref(null)
const aiResult = ref(null)
const score = ref('')
const comment = ref('')
const saving = ref(false)
// 加载失败/缺参提示（此前失败时整页纯白无任何反馈）
const loadError = ref('')

const showAdjust = ref(false)
const showReject = ref(false)
const finalScore = ref('')
const adjustComment = ref('')
const rejectComment = ref('')
const reviewing = ref(false)

const subSt = computed(() => submissionStatus(detail.value))
// 打分上限：默认 100；该提交已有 AI 结果且模板满分 >100 时以 AI 满分为准（与服务端校验一致）
const maxScore = computed(() => {
  const fs = aiResult.value && Number(aiResult.value.full_score)
  return fs && fs > 100 ? fs : 100
})
const initial = computed(() => {
  const n = detail.value && detail.value.student && detail.value.student.real_name
  return (n || '?').slice(0, 1)
})

onLoad((q) => {
  submissionId = q.submissionId
  if (q.reviewId) reviewId.value = q.reviewId
})
onShow(() => {
  // 缺少 submissionId（页面栈参数丢失）时给出明确提示而不是整页空白
  if (!submissionId) {
    loadError.value = '缺少提交参数，请从作业详情重新进入'
    return
  }
  loadError.value = ''
  load()
})

// 纯视图辅助：维度得分百分比
function dimPct(d) {
  const max = Number(d && d.max_score)
  const v = Number(d && d.score)
  if (!max || isNaN(v)) return 0
  return Math.max(0, Math.min(100, Math.round((v / max) * 100)))
}

async function load() {
  try {
    detail.value = await get('/api/submissions/detail/' + submissionId)
    if (detail.value) {
      score.value = detail.value.score != null ? String(detail.value.score) : ''
      comment.value = detail.value.comment || ''
    }
  } catch (e) {
    detail.value = null
    loadError.value = '提交加载失败或已被删除'
    return
  }
  try {
    aiResult.value = await get('/api/grading/results/submission/' + submissionId, null, { silent: true })
  } catch (e) {
    aiResult.value = null
  }
}

function preview(f) {
  previewFile(f.file_path, f.original_name)
}

async function saveGrade() {
  if (saving.value) return
  const s = Number(score.value)
  if (score.value === '' || isNaN(s)) return uni.showToast({ title: '请输入分数', icon: 'none' })
  if (s < 0 || s > maxScore.value) {
    return uni.showToast({ title: `分数需在 0-${maxScore.value} 之间`, icon: 'none' })
  }
  saving.value = true
  try {
    await put('/api/submissions/' + submissionId + '/grade', {
      score: s,
      comment: comment.value
    })
    uni.showToast({ title: '批改已保存', icon: 'success' })
    await load()
  } catch (e) {
    // 错误已提示
  } finally {
    saving.value = false
  }
}

function done() {
  uni.showToast({ title: '复核结论已提交', icon: 'success' })
  setTimeout(() => uni.navigateBack(), 800)
}

function approve() {
  uni.showModal({
    title: '采纳 AI 结果',
    content: '将 AI 评分与评语作为最终批改结果？',
    success: async (r) => {
      if (!r.confirm) return
      reviewing.value = true
      try {
        await post('/api/grading/reviews/' + reviewId.value, { action: 'approve' })
        done()
      } catch (e) {
        // 错误已提示
      } finally {
        reviewing.value = false
      }
    }
  })
}

async function adjust() {
  const s = Number(finalScore.value)
  if (finalScore.value === '' || isNaN(s)) return uni.showToast({ title: '请输入最终分数', icon: 'none' })
  if (s < 0 || s > maxScore.value) return uni.showToast({ title: `分数需在 0-${maxScore.value} 之间`, icon: 'none' })
  reviewing.value = true
  try {
    await post('/api/grading/reviews/' + reviewId.value, {
      action: 'adjust',
      final_score: s,
      comment: adjustComment.value || undefined
    })
    done()
  } catch (e) {
    // 错误已提示
  } finally {
    reviewing.value = false
  }
}

function reject() {
  if (!rejectComment.value.trim()) return uni.showToast({ title: '请填写驳回原因', icon: 'none' })
  reviewing.value = true
  post('/api/grading/reviews/' + reviewId.value, {
    action: 'reject',
    comment: rejectComment.value.trim()
  })
    .then(done)
    .catch(() => {})
    .finally(() => {
      reviewing.value = false
    })
}
</script>

<style scoped>
.r-head {
  display: flex;
  align-items: center;
  gap: 24rpx;
  margin-top: 24rpx;
}
.r-name {
  display: block;
  font-size: 34rpx;
  font-weight: 700;
  color: #2c3e50;
  margin-bottom: 6rpx;
}

.cleaned { color: #a8bdb4; }

.ai-score-line {
  display: flex;
  align-items: center;
  gap: 20rpx;
  margin-bottom: 22rpx;
}
.ai-score {
  font-size: 60rpx;
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

.grade-btn { margin-top: 8rpx; }

.review-actions {
  display: flex;
  gap: 14rpx;
}
.review-btn {
  flex: 1;
  height: 80rpx;
  font-size: 25rpx;
}
.reject-btn {
  background: #f56c6c;
  border: none;
  color: #ffffff;
}
.review-panel {
  margin-top: 26rpx;
  border-top: 1rpx solid #f0f5f2;
  padding-top: 26rpx;
}
.input-ph { color: #a8bdb4; }
/* 加载失败卡的重试按钮 */
.err-retry {
  width: 100%;
  height: 80rpx;
  margin-top: 24rpx;
}
</style>
