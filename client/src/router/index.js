import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const routes = [
  { path: '/', redirect: '/login' },
  { path: '/login', name: 'Login', component: () => import('@/views/Login.vue'), meta: { guest: true } },
  { path: '/register', name: 'Register', component: () => import('@/views/Register.vue'), meta: { guest: true } },

  // 学生端
  {
    path: '/student',
    component: () => import('@/layouts/MainLayout.vue'),
    meta: { role: 'student' },
    children: [
      { path: '', redirect: '/student/dashboard' },
      { path: 'dashboard', name: 'StudentDashboard', component: () => import('@/views/student/Dashboard.vue') },
      { path: 'classes', name: 'StudentClasses', component: () => import('@/views/student/MyClasses.vue') },
      { path: 'assignments', name: 'StudentAssignments', component: () => import('@/views/student/Assignments.vue') },
      { path: 'assignments/:id', name: 'StudentSubmit', component: () => import('@/views/student/Submit.vue') },
      { path: 'submissions', name: 'StudentSubmissions', component: () => import('@/views/student/Submissions.vue') },
      { path: 'collect', name: 'StudentCollect', component: () => import('@/views/student/Collect.vue') },
      { path: 'notifications', name: 'StudentNotifications', component: () => import('@/views/Notifications.vue') },
      { path: 'profile', name: 'StudentProfile', component: () => import('@/views/Profile.vue') }
    ]
  },

  // 教师端
  {
    path: '/teacher',
    component: () => import('@/layouts/MainLayout.vue'),
    meta: { role: 'teacher' },
    children: [
      { path: '', redirect: '/teacher/dashboard' },
      { path: 'dashboard', name: 'TeacherDashboard', component: () => import('@/views/teacher/Dashboard.vue') },
      { path: 'assignments', name: 'TeacherAssignments', component: () => import('@/views/teacher/Assignments.vue') },
      { path: 'assignments/create', name: 'TeacherCreateAssignment', component: () => import('@/views/teacher/CreateAssignment.vue') },
      { path: 'assignments/:id/review', name: 'TeacherReview', component: () => import('@/views/teacher/Review.vue') },
      { path: 'courses', name: 'TeacherCourses', component: () => import('@/views/teacher/Courses.vue') },
      { path: 'notifications', name: 'TeacherNotifications', component: () => import('@/views/Notifications.vue') },
      { path: 'profile', name: 'TeacherProfile', component: () => import('@/views/Profile.vue') }
    ]
  },

  // 管理员端
  {
    path: '/admin',
    component: () => import('@/layouts/MainLayout.vue'),
    meta: { role: 'admin' },
    children: [
      { path: '', redirect: '/admin/dashboard' },
      { path: 'dashboard', name: 'AdminDashboard', component: () => import('@/views/admin/Dashboard.vue') },
      { path: 'classes', name: 'AdminClasses', component: () => import('@/views/admin/Classes.vue') },
      { path: 'users', name: 'AdminUsers', component: () => import('@/views/admin/Users.vue') },
      { path: 'courses', name: 'AdminCourses', component: () => import('@/views/admin/Courses.vue') },
      { path: 'cleanup', name: 'AdminCleanup', component: () => import('@/views/admin/Cleanup.vue') },
      { path: 'notifications', name: 'AdminNotifications', component: () => import('@/views/Notifications.vue') },
      { path: 'profile', name: 'AdminProfile', component: () => import('@/views/Profile.vue') }
    ]
  },

  { path: '/:pathMatch(.*)*', redirect: '/login' }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// 路由守卫
router.beforeEach((to, from, next) => {
  const auth = useAuthStore()
  if (to.meta.guest) {
    // 已登录用户访问登录页，跳转到对应首页
    if (auth.isLoggedIn) {
      return next(`/${auth.role}`)
    }
    return next()
  }
  if (to.meta.role) {
    if (!auth.isLoggedIn) return next('/login')
    if (auth.role !== to.meta.role) {
      // 角色不匹配，跳转到自己的首页
      return next(`/${auth.role}`)
    }
    return next()
  }
  next()
})

export default router
