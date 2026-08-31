<template>
  <view class="page">
    <template v-if="list.length">
      <view class="card" v-for="s in list" :key="s.id" hover-class="hv" @click="goDetail(s)">
        <view class="row">
          <text class="tag" :class="'tag-' + st(s).type">{{ st(s).text }}</text>
          <text class="m-course ellipsis">{{ s.assignment && s.assignment.course ? s.assignment.course.name : '' }}</text>
        </view>
        <text class="m-title">{{ s.assignment ? s.assignment.title : '-' }}</text>
        <view class="m-foot">
          <text class="cell-sub" style="margin-top:0;">提交于 {{ formatDateTime(s.submitted_at) }}</text>
          <text class="m-score" v-if="s.score != null">{{ s.score }} 分</text>
          <text class="m-score m-score-none" v-else>待批改</text>
        </view>
      </view>
      <view class="loading-more" v-if="loading">加载中…</view>
      <view class="loading-more" v-else-if="finished">— 没有更多了 —</view>
    </template>
    <empty-state v-else-if="!loading" icon="🗂️" text="还没有提交记录" />
    <view class="loading-more" v-if="loading && !list.length">加载中…</view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onShow, onPullDownRefresh, onReachBottom } from '@dcloudio/uni-app'
import { get } from '../../utils/request'
import { formatDateTime } from '../../utils/format'
import { submissionStatus } from '../../utils/statusMaps'

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
    const data = await get('/api/submissions/my/list', { page: targetPage, pageSize: PAGE_SIZE })
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

function st(s) {
  return submissionStatus(s)
}
function goDetail(s) {
  if (s.assignment_id) uni.navigateTo({ url: '/pages/assignments/detail?id=' + s.assignment_id })
}
</script>

<style scoped>
.m-course {
  flex: 1;
  min-width: 0;
  margin-left: 14rpx;
  font-size: 23rpx;
  color: #7d918a;
}
.m-title {
  display: block;
  font-size: 31rpx;
  font-weight: 600;
  color: #2c3e50;
  line-height: 1.5;
  margin-top: 16rpx;
}
.m-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 20rpx;
  padding-top: 20rpx;
  border-top: 1rpx solid #f0f5f2;
}
.m-score {
  font-size: 30rpx;
  font-weight: 700;
  color: #2f8065;
}
.m-score-none {
  font-size: 24rpx;
  font-weight: 500;
  color: #b88130;
}
</style>
