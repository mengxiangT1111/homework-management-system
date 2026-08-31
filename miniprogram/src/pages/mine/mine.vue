<template>
  <view class="page">
    <!-- 对齐网页端个人中心：渐变横幅 + 头像叠出 + 角色标签 -->
    <view class="card profile-card">
      <view class="profile-banner">
        <view class="hero-blob b1"></view>
        <view class="hero-blob b2"></view>
      </view>
      <view class="profile-body">
        <view class="me-avatar"><text class="me-avatar-txt">{{ avatarText }}</text></view>
        <text class="me-name">{{ name }}</text>
        <text class="me-role">{{ roleText }}</text>
        <text class="me-sub">@{{ username }}<template v-if="auth.schoolName"> · {{ auth.schoolName }}</template></text>
      </view>
    </view>

    <view class="card menu">
      <view class="cell" hover-class="hv" @click="go('/pages/mine/password')">
        <view class="icon-tile tile-amber"><text>🔑</text></view>
        <view class="cell-main"><text class="cell-title">修改密码</text></view>
        <text class="cell-arrow">›</text>
      </view>
      <view class="cell" v-if="isStudent" hover-class="hv" @click="go('/pages/mine/classes')">
        <view class="icon-tile tile-blue"><text>🏫</text></view>
        <view class="cell-main"><text class="cell-title">我的班级</text></view>
        <text class="cell-arrow">›</text>
      </view>
    </view>

    <!-- 我的课程（教师，页内区块） -->
    <view class="card" v-if="isTeacher">
      <view class="row" hover-class="hv" @click="toggleCourses">
        <view class="icon-tile tile-mint"><text>📚</text></view>
        <view class="cell-main">
          <text class="cell-title">我的课程</text>
          <text class="cell-sub">{{ courses.length ? courses.length + ' 门任教课程' : '点击展开' }}</text>
        </view>
        <text class="cell-arrow">{{ coursesExpanded ? '▴' : '▾' }}</text>
      </view>
      <template v-if="coursesExpanded">
        <view class="course-item" v-for="c in courses" :key="c.id">
          <view class="cell-main">
            <text class="course-name">{{ c.name }}</text>
            <text class="cell-sub">{{ c.class ? c.class.name : '' }}</text>
          </view>
        </view>
        <text class="hint" v-if="!courses.length" style="display:block;padding:16rpx 0;">暂无任教课程</text>
      </template>
    </view>

    <view class="card logout-card">
      <button class="logout-btn" hover-class="hv" @click="handleLogout">退出登录</button>
    </view>

    <text class="ver-hint">信衡 XINHENG · 让每一分都可信</text>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { get } from '../../utils/request'
import { useAuthStore } from '../../stores/auth'
import { ROLE_NAMES } from '../../utils/statusMaps'

const auth = useAuthStore()
const isStudent = computed(() => auth.role === 'student')
const isTeacher = computed(() => auth.role === 'teacher')

const name = computed(() => (auth.userInfo && auth.userInfo.real_name) || '-')
const username = computed(() => (auth.userInfo && auth.userInfo.username) || '-')
const roleText = computed(() => ROLE_NAMES[auth.role] || '-')
const avatarText = computed(() => {
  const n = name.value
  return n && n !== '-' ? n.slice(0, 1) : '?'
})

const coursesExpanded = ref(false)
const courses = ref([])

onShow(() => {
  if (auth.isLoggedIn) auth.fetchProfile().catch(() => {})
})

function go(url) {
  uni.navigateTo({ url })
}
function toggleCourses() {
  coursesExpanded.value = !coursesExpanded.value
  if (coursesExpanded.value && !courses.value.length) loadCourses()
}
async function loadCourses() {
  try {
    courses.value = (await get('/api/courses/my/teaching')) || []
  } catch (e) {
    courses.value = []
  }
}
function handleLogout() {
  uni.showModal({
    title: '退出登录',
    content: '确定要退出当前账号吗？',
    success: (r) => {
      if (!r.confirm) return
      auth.logout()
      uni.reLaunch({ url: '/pages/login/login' })
    }
  })
}
</script>

<style scoped>
/* 对齐网页端个人中心资料卡：水平薄荷渐变横幅 + 头像叠出 */
.profile-card {
  margin-top: 24rpx;
  padding: 0;
  overflow: hidden;
}
.profile-banner {
  position: relative;
  height: 170rpx;
  background: linear-gradient(90deg, #6fcda9 0%, #52c4a0 42%, #2d6a5f 100%);
  overflow: hidden;
}
.hero-blob {
  position: absolute;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.14);
}
.b1 { width: 220rpx; height: 220rpx; right: -50rpx; top: -90rpx; }
.b2 { width: 130rpx; height: 130rpx; right: 150rpx; bottom: -60rpx; opacity: 0.7; }
.profile-body {
  position: relative;
  z-index: 1; /* 保证头像/文字在横幅装饰圆之上 */
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 32rpx 36rpx;
  margin-top: -60rpx;
}
.me-avatar {
  flex-shrink: 0;
  position: relative;
  width: 128rpx;
  height: 128rpx;
  border-radius: 50%;
  background: #52c4a0;
  border: 6rpx solid #ffffff;
  box-shadow: 0 8rpx 20rpx rgba(30, 77, 68, 0.18);
  overflow: hidden;
}
/* 绝对定位居中：不依赖 flex 对 CJK 字形的度量，54% 让字形略偏下 */
.me-avatar-txt {
  position: absolute;
  left: 50%;
  top: 54%;
  transform: translate(-50%, -50%);
  font-size: 48rpx;
  font-weight: 700;
  color: #ffffff;
  line-height: 1;
}
.me-name {
  display: block;
  margin-top: 18rpx;
  font-size: 34rpx;
  font-weight: 700;
  color: #2c3e50;
}
/* 对齐网页端角色标签：琥珀描边 */
.me-role {
  margin-top: 12rpx;
  padding: 4rpx 24rpx;
  border-radius: 999rpx;
  border: 1rpx solid #f2d09d;
  background: #ffffff;
  color: #b88130;
  font-size: 23rpx;
}
.me-sub {
  display: block;
  margin-top: 12rpx;
  font-size: 24rpx;
  color: #7d918a;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  max-width: 100%;
}

.menu { margin-top: 24rpx; padding: 8rpx 28rpx; }
.course-item {
  padding: 18rpx 0 18rpx 94rpx;
  border-top: 1rpx dashed #f0f5f2;
}
.course-name {
  display: block;
  font-size: 27rpx;
  color: #2c3e50;
  margin-bottom: 4rpx;
}

.logout-card { padding: 0; }
.logout-btn {
  width: 100%;
  height: 100rpx;
  background: transparent;
  color: #f56c6c;
  font-size: 29rpx;
  border-radius: 24rpx;
}
.ver-hint {
  display: block;
  text-align: center;
  margin: 10rpx 0 30rpx;
  font-size: 22rpx;
  color: #a8bdb4;
}
</style>
