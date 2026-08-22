<template>
  <el-container class="main-layout">
    <!-- 手机端侧边栏遮罩 -->
    <div class="sidebar-overlay" :class="{ 'is-visible': mobileMenuOpen }" @click="toggleMobileMenu"></div>

    <!-- 侧边栏 -->
    <el-aside :width="collapsed ? '64px' : '220px'" class="sidebar" :class="{ 'is-mobile-open': mobileMenuOpen }">
      <div class="logo-area">
        <span class="logo-icon">📚</span>
        <span v-show="!collapsed" class="logo-text">作业管理系统</span>
        <!-- 手机端关闭按钮 -->
        <el-icon class="mobile-close" v-if="mobileMenuOpen" @click="toggleMobileMenu"><Close /></el-icon>
      </div>
      <el-menu
        :default-active="$route.path"
        :collapse="collapsed"
        router
        class="side-menu"
        background-color="transparent"
        text-color="#e8f0ec"
        active-text-color="#ffffff"
        @select="onMenuSelect"
      >
        <el-menu-item v-for="item in menuItems" :key="item.path" :index="item.path">
          <el-icon><component :is="item.icon" /></el-icon>
          <template #title>{{ item.title }}</template>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <!-- 顶栏 -->
      <el-header class="topbar">
        <div class="topbar-left">
          <el-icon class="collapse-btn" :class="{ 'mobile-hamburger': true }" @click="toggleMobileMenu">
            <Operation />
          </el-icon>
          <span class="welcome">{{ greeting }}，{{ authStore.realName }}</span>
        </div>
        <div class="topbar-right">
          <!-- 通知铃铛 -->
          <el-badge :value="notifStore.unreadCount" :hidden="notifStore.unreadCount === 0" :max="99">
            <el-icon class="icon-btn" @click="goNotifications"><Bell /></el-icon>
          </el-badge>
          <!-- 用户菜单 -->
          <el-dropdown @command="handleCommand">
            <div class="user-info">
              <el-avatar :size="32" class="user-avatar">
                {{ authStore.realName.charAt(0) }}
              </el-avatar>
              <span class="user-name">{{ authStore.realName }}</span>
              <el-icon><CaretBottom /></el-icon>
            </div>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="profile">
                  <el-icon><User /></el-icon>个人中心
                </el-dropdown-item>
                <el-dropdown-item command="logout" divided>
                  <el-icon><SwitchButton /></el-icon>退出登录
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <!-- 主内容 -->
      <el-main class="main-content">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { Operation, Close, Bell, CaretBottom, User, SwitchButton } from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { useNotificationStore } from '@/stores/notification'
import { classApi, courseApi } from '@/api'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const notifStore = useNotificationStore()

const collapsed = ref(false)
const mobileMenuOpen = ref(false)
const isClassLeader = ref(false)
const isCourseAssistant = ref(false)
let pollTimer = null

const role = computed(() => authStore.role)

const menuConfig = {
  student: [
    { path: '/student/dashboard', title: '仪表盘', icon: 'HomeFilled' },
    { path: '/student/classes', title: '我的班级', icon: 'School' },
    { path: '/student/assignments', title: '作业列表', icon: 'Document' },
    { path: '/student/submissions', title: '我的提交', icon: 'UploadFilled' },
    { path: '/student/collect', title: '作业收集', icon: 'DataLine', leaderOnly: true },
    { path: '/student/assistant', title: '课代表', icon: 'Medal', assistantOnly: true },
    { path: '/student/notifications', title: '消息通知', icon: 'Bell' },
    { path: '/student/profile', title: '个人中心', icon: 'User' }
  ],
  teacher: [
    { path: '/teacher/dashboard', title: '仪表盘', icon: 'HomeFilled' },
    { path: '/teacher/assignments', title: '作业管理', icon: 'Document' },
    { path: '/teacher/plagiarism', title: '查重中心', icon: 'WarningFilled' },
    { path: '/teacher/grading/templates', title: '批改模板', icon: 'List' },
    { path: '/teacher/grading/reviews', title: '批改复核', icon: 'Finished' },
    { path: '/teacher/courses', title: '我的课程', icon: 'Reading' },
    { path: '/teacher/notifications', title: '消息通知', icon: 'Bell' },
    { path: '/teacher/profile', title: '个人中心', icon: 'User' }
  ],
  admin: [
    { path: '/admin/dashboard', title: '数据统计', icon: 'DataAnalysis' },
    { path: '/admin/classes', title: '班级管理', icon: 'School' },
    { path: '/admin/schools', title: '学校管理', icon: 'OfficeBuilding' },
    { path: '/admin/users', title: '用户管理', icon: 'UserFilled' },
    { path: '/admin/courses', title: '课程管理', icon: 'Reading' },
    { path: '/admin/cleanup', title: '文件清理', icon: 'Delete' },
    { path: '/admin/notifications', title: '消息通知', icon: 'Bell' },
    { path: '/admin/profile', title: '个人中心', icon: 'User' }
  ]
}

const menuItems = computed(() => {
  const items = menuConfig[role.value] || []
  // 班级负责人/课代表专属菜单：非相应身份隐藏
  return items.filter(item =>
    (!item.leaderOnly || isClassLeader.value) &&
    (!item.assistantOnly || isCourseAssistant.value)
  )
})

const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 6) return '凌晨好'
  if (h < 12) return '上午好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
})

function goNotifications() {
  router.push(`/${role.value}/notifications`)
}

function toggleMobileMenu() {
  mobileMenuOpen.value = !mobileMenuOpen.value
}

function onMenuSelect() {
  if (window.innerWidth <= 768) {
    mobileMenuOpen.value = false
  }
}

async function handleCommand(cmd) {
  if (cmd === 'profile') {
    router.push(`/${role.value}/profile`)
  } else if (cmd === 'logout') {
    try {
      await ElMessageBox.confirm('确定要退出登录吗？', '提示', { type: 'warning' })
      authStore.logout()
      router.push('/login')
    } catch (e) {}
  }
}

onMounted(async () => {
  // 刷新用户信息
  try {
    await authStore.fetchProfile()
  } catch (e) {}
  await notifStore.fetchUnreadCount()
  // 学生检查是否有班级负责人职务 / 课代表职务
  if (authStore.role === 'student') {
    try {
      const res = await classApi.myPositions()
      isClassLeader.value = res.data && res.data.length > 0
    } catch (e) {}
    try {
      const res = await courseApi.myAssistantships()
      isCourseAssistant.value = res.data && res.data.length > 0
    } catch (e) {}
  }
  // 每 60 秒轮询未读通知
  pollTimer = setInterval(() => notifStore.fetchUnreadCount(), 60000)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<style scoped>
.main-layout { height: 100vh; }

.sidebar {
  background: linear-gradient(180deg, #2d6a5f 0%, #1e4d44 100%);
  transition: width 0.3s;
  overflow-x: hidden;
}

.logo-area {
  height: 60px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 20px;
  color: white;
  white-space: nowrap;
}

.logo-icon { font-size: 24px; }
.logo-text { font-size: 15px; font-weight: 600; }

.side-menu {
  border: none;
  padding-top: 10px;
}

.side-menu :deep(.el-menu-item) {
  border-radius: 8px;
  margin: 4px 10px;
  height: 46px;
}

.side-menu :deep(.el-menu-item.is-active) {
  background: var(--primary) !important;
}

.side-menu :deep(.el-menu-item:hover) {
  background: rgba(255,255,255,0.1) !important;
}

.topbar {
  background: white;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
  padding: 0 24px;
  height: 60px;
}

.topbar-left { display: flex; align-items: center; gap: 16px; }

.collapse-btn {
  font-size: 20px;
  cursor: pointer;
  color: var(--text-light);
}

.welcome { font-size: 14px; color: var(--text); }

.topbar-right { display: flex; align-items: center; gap: 20px; }

.icon-btn {
  font-size: 20px;
  cursor: pointer;
  color: var(--text-light);
}

.icon-btn:hover { color: var(--primary); }

.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.user-avatar {
  background: var(--primary);
  color: white;
  font-weight: 600;
}

.user-name { font-size: 14px; color: var(--text); }

.main-content {
  background: var(--bg);
  padding: 0;
  overflow-y: auto;
}

@media (max-width: 768px) {
  .user-name { display: none; }
  .welcome { display: none; }
}
</style>
