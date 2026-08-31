<template>
  <view class="page">
    <view class="toolbar">
      <text class="meta" v-if="total">共 {{ total }} 条</text>
      <text class="sec-act" v-if="list.length" hover-class="hv" @click="markAllRead">全部已读</text>
    </view>

    <template v-if="list.length">
      <view
        class="card n-card"
        hover-class="hv"
        v-for="n in list"
        :key="n.id"
        @click="onTap(n)"
      >
        <view class="n-unread" v-if="!n.is_read"></view>
        <view class="icon-tile" :class="tileOf(n)"><text>{{ glyphOf(n) }}</text></view>
        <view class="cell-main">
          <view class="row">
            <text class="n-title ellipsis" :class="{ bold: !n.is_read }">{{ n.title }}</text>
            <text class="n-time">{{ formatDateTime(n.created_at) }}</text>
          </view>
          <text class="n-content ellipsis-2" v-if="n.content">{{ n.content }}</text>
          <text class="n-type" :style="{ color: typeOf(n).color }">{{ typeOf(n).text }}</text>
        </view>
      </view>
      <view class="loading-more" v-if="loading">加载中…</view>
      <view class="loading-more" v-else-if="finished">— 没有更多了 —</view>
    </template>
    <empty-state v-else-if="!loading" icon="🔔" text="暂无消息" sub="作业提醒和成绩通知会出现在这里" />
    <view class="loading-more" v-if="loading && !list.length">加载中…</view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onShow, onPullDownRefresh, onReachBottom } from '@dcloudio/uni-app'
import { get, put } from '../../utils/request'
import { formatDateTime } from '../../utils/format'
import { NOTIFICATION_TYPES } from '../../utils/statusMaps'
import { refreshBadge } from '../../utils/badge'

const list = ref([])
const page = ref(1)
const total = ref(0)
const loading = ref(false)
const finished = computed(() => total.value > 0 && list.value.length >= total.value)
const PAGE_SIZE = 10

onShow(() => {
  load(true)
  refreshBadge()
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
    const data = await get('/api/notifications', { page: targetPage, pageSize: PAGE_SIZE })
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

function typeOf(n) {
  return NOTIFICATION_TYPES[n.type] || NOTIFICATION_TYPES.system
}
function glyphOf(n) {
  const map = { deadline: '⏰', grade: '📈', assignment: '📚', system: '📢' }
  return map[n.type] || '📢'
}
function tileOf(n) {
  const map = { deadline: 'tile-amber', grade: 'tile-mint', assignment: 'tile-blue', system: 'tile-slate' }
  return map[n.type] || 'tile-slate'
}

async function onTap(n) {
  if (!n.is_read) {
    try {
      await put('/api/notifications/' + n.id + '/read', null, { silent: true })
      n.is_read = 1
      refreshBadge()
    } catch (e) {
      // 静默
    }
  }
  // system 的 related_id 不是作业 ID（可能是用户 ID），一律不跳转
  const canJump = ['deadline', 'assignment', 'grade'].includes(n.type) && n.related_id
  if (canJump) {
    uni.navigateTo({ url: '/pages/assignments/detail?id=' + n.related_id })
  }
}

async function markAllRead() {
  try {
    await put('/api/notifications/all/read')
    list.value = list.value.map((n) => ({ ...n, is_read: 1 }))
    refreshBadge()
  } catch (e) {
    // 错误已提示
  }
}
</script>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 32rpx 8rpx;
  min-height: 40rpx;
}
.n-card {
  display: flex;
  gap: 20rpx;
  position: relative;
  overflow: hidden;
}
.n-unread {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 6rpx;
  background: #52c4a0;
}
.n-title {
  flex: 1;
  min-width: 0;
  font-size: 28rpx;
  color: #47544e;
}
.n-title.bold { font-weight: 600; color: #2c3e50; }
.n-time {
  font-size: 22rpx;
  color: #a8bdb4;
  flex-shrink: 0;
  margin-left: 12rpx;
}
.n-content {
  display: block;
  font-size: 25rpx;
  color: #7d918a;
  margin-top: 8rpx;
  line-height: 1.6;
}
.n-type {
  display: block;
  font-size: 22rpx;
  margin-top: 10rpx;
}
</style>
