<template>
  <view class="page">
    <template v-if="list.length">
      <view class="card q-card" v-for="r in list" :key="r.id" hover-class="hv" @click="goReview(r)">
        <view class="row">
          <view class="avatar av-72"><text>{{ initial(r) }}</text></view>
          <view class="cell-main">
            <text class="q-name">{{ r.submission && r.submission.student ? r.submission.student.real_name : '未知学生' }}</text>
            <text class="cell-sub">提交于 {{ formatDateTime(r.created_at) }}</text>
          </view>
          <text class="tag tag-warning">待复核</text>
        </view>
        <view class="q-scores">
          <view class="q-score-item">
            <text class="q-score" style="color:#2f8065;">{{ r.result ? r.result.total_score : '-' }}</text>
            <text class="stat-k">AI 评分</text>
          </view>
          <view class="q-score-item">
            <text class="q-score" style="color:#5f6f68;">{{ r.result ? r.result.full_score : '-' }}</text>
            <text class="stat-k">满分</text>
          </view>
          <view class="q-score-item">
            <text class="q-score" style="color:#e6a23c;">{{ formatConfidence(r.result ? r.result.confidence : null) }}</text>
            <text class="stat-k">置信度</text>
          </view>
          <view class="q-score-item">
            <text class="q-score" style="color:#2c3e50;">{{ r.original_score != null ? r.original_score : '未批' }}</text>
            <text class="stat-k">当前分数</text>
          </view>
        </view>
        <view class="q-foot">
          <text class="hint">低置信度 AI 结果需人工复核</text>
          <text class="sec-act">去复核 ›</text>
        </view>
      </view>
      <view class="loading-more" v-if="loading">加载中…</view>
      <view class="loading-more" v-else-if="finished">— 没有更多了 —</view>
    </template>
    <empty-state v-else-if="!loading" icon="🎉" text="没有待复核的工单" sub="AI 批改结果都在掌控之中" />
    <view class="loading-more" v-if="loading && !list.length">加载中…</view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onShow, onPullDownRefresh, onReachBottom } from '@dcloudio/uni-app'
import { get } from '../../utils/request'
import { formatDateTime, formatConfidence } from '../../utils/format'

const list = ref([])
const page = ref(1)
const total = ref(0)
const loading = ref(false)
const finished = computed(() => total.value > 0 && list.value.length >= total.value)
const PAGE_SIZE = 10

onShow(() => {
  load(true)
})
onPullDownRefresh(async () => {
  await load(true)
  uni.stopPullDownRefresh()
})
onReachBottom(() => load(false))

async function load(reset) {
  if (loading.value) return
  if (!reset && finished.value) return
  loading.value = true
  const targetPage = reset ? 1 : page.value
  try {
    const data = await get('/api/grading/reviews', { status: 'pending', page: targetPage, pageSize: PAGE_SIZE })
    const rows = data.list || []
    total.value = data.total || 0
    list.value = reset ? rows : list.value.concat(rows)
    page.value = targetPage + 1
  } catch (e) {
    // 错误已提示
  } finally {
    loading.value = false
  }
}

function initial(r) {
  const n = r.submission && r.submission.student && r.submission.student.real_name
  return (n || '?').slice(0, 1)
}

function goReview(r) {
  if (!r.submission || !r.submission.id) return
  uni.navigateTo({
    url: '/pages/teacher/review?submissionId=' + r.submission.id + '&reviewId=' + r.id
  })
}
</script>

<style scoped>
.q-card { margin-bottom: 24rpx; }
.q-name {
  display: block;
  font-size: 30rpx;
  font-weight: 600;
  color: #2c3e50;
  margin-bottom: 6rpx;
}
.q-scores {
  display: flex;
  margin-top: 22rpx;
  background: #f7faf8;
  border-radius: 18rpx;
  padding: 22rpx 0;
}
.q-score-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  border-right: 1rpx solid #f0f5f2;
}
.q-score-item:last-child { border-right: none; }
.q-score {
  font-size: 34rpx;
  font-weight: 700;
}
.stat-k {
  font-size: 22rpx;
  color: #7d918a;
  margin-top: 6rpx;
}
.q-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 18rpx;
}
</style>
