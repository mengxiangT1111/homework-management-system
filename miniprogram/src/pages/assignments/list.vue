<template>
  <view class="page">
    <!-- 教师筛选栏 -->
    <view v-if="isTeacher" class="filter-bar">
      <view class="filter-picker">
        <picker mode="selector" :range="courseNames" :value="courseIndex" @change="onCourseChange">
          <view class="filter-item">{{ courseNames[courseIndex] || '全部课程' }} <text class="filter-arrow">▾</text></view>
        </picker>
        <picker mode="selector" :range="statusNames" :value="statusIndex" @change="onStatusChange">
          <view class="filter-item">{{ statusNames[statusIndex] }} <text class="filter-arrow">▾</text></view>
        </picker>
      </view>
      <view class="filter-create" hover-class="hv" @click="goCreate">＋ 发布</view>
    </view>

    <template v-if="list.length">
      <view class="card a-card" v-for="a in list" :key="a.id" hover-class="hv" @click="goDetail(a.id)">
        <view class="row">
          <text class="tag" :class="'tag-' + st(a).type">{{ st(a).text }}</text>
          <text class="a-course ellipsis">{{ a.course ? a.course.name : '' }}<template v-if="a.course && a.course.class"> · {{ a.course.class.name }}</template></text>
        </view>
        <text class="a-title">{{ a.title }}</text>
        <view class="a-deadline">
          <text class="a-dl-glyph">⏱</text>
          <text class="meta">{{ formatDateTime(a.deadline) }}</text>
          <text class="deadline" :class="{ 'dl-urgent': rem(a).urgent, 'dl-overdue': rem(a).overdue }">
            {{ rem(a).text }}
          </text>
        </view>
        <view class="a-foot">
          <template v-if="isStudent">
            <text v-if="a.my_submission && a.my_submission.score != null" class="a-mark">已批改 · {{ a.my_submission.score }} 分</text>
            <text v-else-if="a.my_submission" class="a-mark">已提交，等待批改</text>
            <text v-else class="a-mark a-mark-warn">未提交</text>
          </template>
          <template v-else>
            <text class="a-mark">已交 {{ a.submit_count || 0 }} 人</text>
          </template>
          <text class="cell-arrow">›</text>
        </view>
      </view>
      <view class="loading-more" v-if="loading">加载中…</view>
      <view class="loading-more" v-else-if="finished">— 没有更多了 —</view>
    </template>
    <empty-state v-else-if="!loading" icon="📚" text="暂无作业" />
    <view class="loading-more" v-if="loading && !list.length">加载中…</view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onShow, onPullDownRefresh, onReachBottom } from '@dcloudio/uni-app'
import { get } from '../../utils/request'
import { useAuthStore } from '../../stores/auth'
import { formatDateTime, remainingText } from '../../utils/format'
import { assignmentStatus } from '../../utils/statusMaps'

const auth = useAuthStore()
const isStudent = computed(() => auth.role === 'student')
const isTeacher = computed(() => auth.role === 'teacher')

const list = ref([])
const page = ref(1)
const pageSize = 10
const total = ref(0)
const loading = ref(false)
const finished = computed(() => total.value > 0 && list.value.length >= total.value)

// 教师筛选
const courses = ref([])
const coursesLoaded = ref(false)
const courseIndex = ref(0)
const courseNames = computed(() => ['全部课程', ...courses.value.map((c) => c.name)])
const statusNames = ['全部', '进行中', '已关闭']
const statusValues = ['', 'active', 'closed']
const statusIndex = ref(0)

const PAGE_SIZE = 10

onShow(() => {
  if (!auth.isLoggedIn) return
  if (isTeacher.value && !coursesLoaded.value) loadCourses()
  load(true)
})

onPullDownRefresh(async () => {
  await load(true)
  uni.stopPullDownRefresh()
})

onReachBottom(() => load(false))

async function loadCourses() {
  try {
    courses.value = (await get('/api/courses/my/teaching')) || []
    coursesLoaded.value = true
  } catch (e) {
    courses.value = []
  }
}

function onCourseChange(e) {
  courseIndex.value = Number(e.detail.value)
  load(true)
}
function onStatusChange(e) {
  statusIndex.value = Number(e.detail.value)
  load(true)
}

async function load(reset) {
  if (loading.value) return
  if (!reset && finished.value) return
  loading.value = true
  const targetPage = reset ? 1 : page.value
  try {
    const params = { page: targetPage, pageSize: PAGE_SIZE }
    if (isTeacher.value) {
      if (courseIndex.value > 0 && courses.value[courseIndex.value - 1]) {
        params.course_id = courses.value[courseIndex.value - 1].id
      }
      const st = statusValues[statusIndex.value]
      if (st) params.status = st
    }
    const data = await get('/api/assignments', params)
    const rows = data.list || []
    total.value = data.total || 0
    list.value = reset ? rows : list.value.concat(rows)
    page.value = targetPage + 1
  } catch (e) {
    // 错误已在请求层提示
  } finally {
    loading.value = false
  }
}

function st(a) {
  return assignmentStatus(a)
}
function rem(a) {
  return remainingText(a.deadline)
}
function goDetail(id) {
  uni.navigateTo({ url: '/pages/assignments/detail?id=' + id })
}
function goCreate() {
  uni.navigateTo({ url: '/pages/teacher/edit-assignment' })
}
</script>

<style scoped>
.filter-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 24rpx 4rpx;
}
.filter-picker {
  display: flex;
  gap: 14rpx;
}
.filter-item {
  background: #ffffff;
  border-radius: 999rpx;
  padding: 12rpx 26rpx;
  font-size: 25rpx;
  color: #5f6f68;
  box-shadow: 0 4rpx 14rpx rgba(44, 94, 79, 0.05);
}
.filter-arrow {
  color: #a8bdb4;
  font-size: 22rpx;
}
.filter-create {
  background: #3da884;
  color: #ffffff;
  border-radius: 999rpx;
  padding: 12rpx 30rpx;
  font-size: 25rpx;
  font-weight: 500;
  box-shadow: 0 4rpx 12rpx rgba(61, 168, 132, 0.28);
}

.a-card { margin-bottom: 24rpx; }
.a-course {
  flex: 1;
  min-width: 0;
  margin-left: 14rpx;
  font-size: 23rpx;
  color: #7d918a;
}
.a-title {
  display: block;
  font-size: 32rpx;
  font-weight: 600;
  color: #2c3e50;
  line-height: 1.5;
  margin-top: 16rpx;
}
.a-deadline {
  display: flex;
  align-items: center;
  gap: 8rpx;
  margin-top: 18rpx;
}
.a-dl-glyph { font-size: 22rpx; }
.deadline {
  font-size: 24rpx;
  color: #7d918a;
}
.dl-urgent { color: #e6a23c; font-weight: 500; }
.dl-overdue { color: #f56c6c; font-weight: 500; }
.a-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 20rpx;
  padding-top: 20rpx;
  border-top: 1rpx solid #f0f5f2;
}
.a-mark {
  font-size: 24rpx;
  color: #2f8065;
  font-weight: 500;
}
.a-mark-warn { color: #b88130; }
</style>
