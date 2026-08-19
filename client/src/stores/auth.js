import { defineStore } from 'pinia'
import { authApi } from '@/api'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('token') || '',
    // localStorage 数据损坏时 JSON.parse 会抛错导致应用白屏，兜底返回 null
    user: (() => {
      try {
        return JSON.parse(localStorage.getItem('user') || 'null')
      } catch (e) {
        localStorage.removeItem('user')
        return null
      }
    })()
  }),
  getters: {
    isLoggedIn: (state) => !!state.token,
    role: (state) => state.user?.role || '',
    realName: (state) => state.user?.real_name || ''
  },
  actions: {
    async login(credentials) {
      const res = await authApi.login(credentials)
      this.token = res.data.token
      this.user = res.data.user
      localStorage.setItem('token', res.data.token)
      localStorage.setItem('user', JSON.stringify(res.data.user))
      return res.data
    },
    async register(data) {
      const res = await authApi.register(data)
      // 教师注册待审核：后端不返回 token，不建立登录态
      if (!res.data?.token) return res.data
      this.token = res.data.token
      this.user = res.data.user
      localStorage.setItem('token', res.data.token)
      localStorage.setItem('user', JSON.stringify(res.data.user))
      return res.data
    },
    async fetchProfile() {
      const res = await authApi.getProfile()
      this.user = res.data
      localStorage.setItem('user', JSON.stringify(res.data))
      return res.data
    },
    logout() {
      this.token = ''
      this.user = null
      localStorage.removeItem('token')
      localStorage.removeItem('user')
    }
  }
})
