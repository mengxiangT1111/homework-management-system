<template>
  <view class="page">
    <!-- 对齐网页端 .page-title + .page-desc -->
    <view class="pt">
      <view class="pt-bar"></view>
      <text class="pt-text">{{ isTeacher ? '教师面板' : '首页' }}</text>
    </view>
    <text class="pt-desc">{{ greeting }}，{{ name }}<template v-if="auth.schoolName"> · {{ auth.schoolName }}</template></text>

    <!-- 学生 -->
    <template v-if="isStudent">
      <view class="stat-grid">
        <view class="stat-card" v-for="s in studentStats" :key="s.label" hover-class="hv">
          <view class="stat-top">
            <view class="icon-tile" :class="s.tile"><text>{{ s.icon }}</text></view>
            <text class="stat-label">{{ s.label }}</text>
          </view>
          <text class="stat-value">{{ s.value }}</text>
        </view>
      </view>

      <view class="card">
        <view class="sec-head">
          <text class="sec-title">快捷入口</text>
        </view>
        <view class="quick-row">
          <view class="quick-item" hover-class="hv" @click="go('/pages/submissions/my')">
            <view class="icon-tile tile-mint"><text>📄</text></view>
            <text class="quick-text">提交记录</text>
          </view>
          <view class="quick-item" hover-class="hv" @click="go('/pages/mine/classes')">
            <view class="icon-tile tile-blue"><text>🏫</text></view>
            <text class="quick-text">我的班级</text>
          </view>
          <view class="quick-item" hover-class="hv" @click="switchTab('/pages/assignments/list')">
            <view class="icon-tile tile-amber"><text>📚</text></view>
            <text class="quick-text">全部作业</text>
          </view>
          <view class="quick-item" hover-class="hv" @click="switchTab('/pages/notifications/notifications')">
            <view class="icon-tile tile-slate"><text>🔔</text></view>
            <text class="quick-text">消息</text>
          </view>
        </view>
      </view>

      <view class="card duty-card" v-if="hasDuty" hover-class="hv" @click="go('/pages/collect/collect')">
        <view class="icon-tile tile-amber"><text>🏅</text></view>
        <view class="cell-main">
          <text class="cell-title">作业收集</text>
          <text class="cell-sub">你是班委 / 课代表，点此催交</text>
        </view>
        <text class="cell-arrow">›</text>
      </view>

      <view class="card">
        <view class="sec-head">
          <text class="sec-title">待交作业</text>
          <text class="sec-act" hover-class="hv" @click="switchTab('/pages/assignments/list')">全部 ›</text>
        </view>
        <template v-if="pendingList.length">
          <view
            class="cell"
            hover-class="hv"
            v-for="a in pendingList"
            :key="a.id"
            @click="go('/pages/assignments/detail?id=' + a.id)"
          >
            <view class="cell-main">
              <text class="cell-title ellipsis">{{ a.title }}</text>
              <text class="cell-sub">{{ a.course ? a.course.name : '' }}</text>
            </view>
            <text class="deadline" :class="{ 'dl-urgent': rem(a).urgent, 'dl-overdue': rem(a).overdue }">
              {{ rem(a).text }}
            </text>
          </view>
        </template>
        <empty-state v-else icon="🎉" text="暂无待交作业" sub="该交的都交完啦" />
      </view>
    </template>

    <!-- 教师 -->
    <template v-else-if="isTeacher">
      <view class="stat-grid">
        <view class="stat-card" v-for="s in teacherStats" :key="s.label" hover-class="hv">
          <view class="stat-top">
            <view class="icon-tile" :class="s.tile"><text>{{ s.icon }}</text></view>
            <text class="stat-label">{{ s.label }}</text>
          </view>
          <text class="stat-value">{{ s.value }}</text>
        </view>
      </view>

      <view class="card">
        <view class="sec-head">
          <text class="sec-title">快捷入口</text>
        </view>
        <view class="quick-row">
          <view class="quick-item" hover-class="hv" @click="go('/pages/teacher/edit-assignment')">
            <view class="icon-tile tile-mint"><text>📝</text></view>
            <text class="quick-text">发布作业</text>
          </view>
          <view class="quick-item" hover-class="hv" @click="go('/pages/teacher/review-queue')">
            <view class="icon-tile tile-amber"><text>🤖</text></view>
            <text class="quick-text">AI 复核</text>
          </view>
          <view class="quick-item" hover-class="hv" @click="switchTab('/pages/assignments/list')">
            <view class="icon-tile tile-blue"><text>📚</text></view>
            <text class="quick-text">作业管理</text>
          </view>
          <view class="quick-item" hover-class="hv" @click="switchTab('/pages/notifications/notifications')">
            <view class="icon-tile tile-slate"><text>🔔</text></view>
            <text class="quick-text">消息</text>
          </view>
        </view>
      </view>

      <view class="card">
        <view class="sec-head">
          <text class="sec-title">近期作业</text>
          <text class="sec-act" hover-class="hv" @click="switchTab('/pages/assignments/list')">全部 ›</text>
        </view>
        <template v-if="recentList.length">
          <view
            class="cell"
            hover-class="hv"
            v-for="a in recentList"
            :key="a.id"
            @click="go('/pages/assignments/detail?id=' + a.id)"
          >
            <view class="cell-main">
              <text class="cell-title ellipsis">{{ a.title }}</text>
              <text class="cell-sub">{{ a.course ? a.course.name : '' }} · 已交 {{ a.submit_count || 0 }} 人</text>
            </view>
            <text class="deadline" :class="{ 'dl-urgent': rem(a).urgent, 'dl-overdue': rem(a).overdue }">
              {{ rem(a).text }}
            </text>
          </view>
        </template>
        <empty-state v-else icon="🌿" text="还没有发布过作业" sub="点上方「发布作业」开始" />
      </view>
    </template>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { get } from '../../utils/request'
import { useAuthStore } from '../../stores/auth'
import { remainingText } from '../../utils/format'
import { ROLE_NAMES } from '../../utils/statusMaps'
import { refreshBadge } from '../../utils/badge'

const auth = useAuthStore()
const isStudent = computed(() => auth.role === 'student')
const isTeacher = computed(() => auth.role === 'teacher')
const name = computed(() => (auth.userInfo && auth.userInfo.real_name) || '')

// 对齐网页端顶栏时段问候（晚上好，童老师）
const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 5) return '夜深了'
  if (h < 9) return '早上好'
  if (h < 12) return '上午好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
})

const studentStats = ref([])
const teacherStats = ref([])
const pendingList = ref([])
const recentList = ref([])

onShow(() => {
  if (!auth.isLoggedIn) return
  refreshBadge()
  if (isStudent.value) {
    loadStudent()
    loadDuties()
  } else if (isTeacher.value) loadTeacher()
})

// 学生：是否担任班委 / 课代表（决定首页是否显示收集入口）
async function loadDuties() {
  try {
    const [p, sh] = await Promise.all([
      get('/api/classes/my/positions', null, { silent: true }).catch(() => []),
      get('/api/courses/my/assistantships', null, { silent: true }).catch(() => [])
    ])
    hasDuty.value = (p || []).length + (sh || []).length > 0
  } catch (e) {
    hasDuty.value = false
  }
}

async function loadStudent() {
  try {
    const s = await get('/api/stats/student')
    studentStats.value = [
      { label: '待提交作业', value: s.pendingSubmit ?? 0, icon: '⏰', tile: 'tile-amber' },
      { label: '已提交作业', value: s.mySubmissions ?? 0, icon: '✅', tile: 'tile-mint' },
      { label: '已批改', value: s.graded ?? 0, icon: '📈', tile: 'tile-blue' },
      { label: '在修课程', value: s.courseCount ?? 0, icon: '📖', tile: 'tile-slate' }
    ]
  } catch (e) {
    studentStats.value = []
  }
  try {
    const data = await get('/api/assignments', { status: 'active', page: 1, pageSize: 10 })
    pendingList.value = (data.list || []).filter((a) => !a.my_submission).slice(0, 5)
  } catch (e) {
    pendingList.value = []
  }
}

async function loadTeacher() {
  try {
    const s = await get('/api/stats/teacher')
    teacherStats.value = [
      { label: '任教课程', value: s.courseCount ?? 0, icon: '📖', tile: 'tile-mint' },
      { label: '作业总数', value: s.assignmentCount ?? 0, icon: '📄', tile: 'tile-mint' },
      { label: '收到提交', value: s.submissionCount ?? 0, icon: '📥', tile: 'tile-blue' },
      { label: '待批改', value: s.ungradedCount ?? 0, icon: '✏️', tile: 'tile-amber' }
    ]
  } catch (e) {
    teacherStats.value = []
  }
  try {
    const data = await get('/api/assignments', { page: 1, pageSize: 5 })
    recentList.value = data.list || []
  } catch (e) {
    recentList.value = []
  }
}

function rem(a) {
  return remainingText(a.deadline)
}
function go(url) {
  uni.navigateTo({ url })
}
function switchTab(url) {
  uni.switchTab({ url })
}
</script>

<style scoped>
/* 对齐网页端 stat-card：两列网格（space-between + 49%，兼容老内核） */
.stat-grid {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  padding: 20rpx 20rpx 4rpx;
}
.stat-card {
  width: 49%;
  margin-bottom: 20rpx;
  background: #ffffff;
  border: 1rpx solid #f0f5f2;
  border-radius: 24rpx;
  padding: 30rpx 32rpx;
  box-shadow: 0 2rpx 8rpx rgba(30, 77, 68, 0.05);
  display: flex;
  flex-direction: column;
}
.stat-top {
  display: flex;
  align-items: center;
  gap: 18rpx;
  margin-bottom: 18rpx;
}
.stat-value {
  font-size: 52rpx;
  font-weight: 700;
  line-height: 1.2;
  color: #2c3e50;
  letter-spacing: -1rpx;
}
.stat-label {
  font-size: 24rpx;
  color: #5f6f68;
}

.quick-row {
  display: flex;
}
.quick-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
}
.quick-text {
  font-size: 24rpx;
  color: #5f6f68;
}

.deadline {
  font-size: 24rpx;
  color: #7d918a;
  flex-shrink: 0;
  margin-left: 12rpx;
}
.dl-urgent { color: #e6a23c; font-weight: 500; }
.dl-overdue { color: #f56c6c; font-weight: 500; }
</style>
