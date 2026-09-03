import { defineStore } from 'pinia'
import { get, post } from '../utils/request'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: uni.getStorageSync('token') || '',
    userInfo: uni.getStorageSync('userInfo') || null
  }),
  getters: {
    isLoggedIn: (s) => !!s.token,
    role: (s) => (s.userInfo && s.userInfo.role) || '',
    schoolName: (s) => (s.userInfo && s.userInfo.school && s.userInfo.school.name) || ''
  },
  actions: {
    async login(username, password, schoolId) {
      const data = await post('/api/auth/login', {
        username,
        password,
        school_id: schoolId
      })
      if (data.user && data.user.role === 'admin') {
        const err = new Error('管理员请使用网页端登录')
        err.noState = true
        throw err
      }
      this.token = data.token
      this.userInfo = data.user
      uni.setStorageSync('token', data.token)
      uni.setStorageSync('userInfo', data.user)
      return data.user
    },
    /**
     * 注册：学生成功即自动登录；教师需管理员审核（返回 pendingReview）
     * payload: { username, password, real_name, role, school_id, phone?, email? }
     */
    async register(payload) {
      const data = await post('/api/auth/register', payload)
      if (data && data.pending_review) {
        return { pendingReview: true }
      }
      this.token = data.token
      this.userInfo = data.user
      uni.setStorageSync('token', data.token)
      uni.setStorageSync('userInfo', data.user)
      return { pendingReview: false }
    },
    async fetchProfile() {
      // silent：启动自动登录等场景静默校验，失败不弹无关 toast（由调用方决定提示）
      const user = await get('/api/auth/profile', null, { silent: true })
      this.userInfo = user
      uni.setStorageSync('userInfo', user)
      return user
    },
    // 清空本地登录态（退出登录 / 改密码 / 401 均走这里）
    logout() {
      this.token = ''
      this.userInfo = null
      uni.removeStorageSync('token')
      uni.removeStorageSync('userInfo')
    }
  }
})
