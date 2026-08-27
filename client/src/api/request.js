import axios from 'axios'
import { ElMessage } from 'element-plus'
import router from '@/router'
import { useAuthStore } from '@/stores/auth'

const request = axios.create({
  baseURL: '/api',
  timeout: 30000
})

// 请求拦截：附带 token
request.interceptors.request.use(
  config => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  error => Promise.reject(error)
)

// 401 跳转去重：并发多个请求同时 401 时只弹一次提示、只跳转一次
let redirectingToLogin = false

// 响应拦截：统一处理
request.interceptors.response.use(
  response => {
    const res = response.data
    // 文件下载类响应直接返回
    if (response.config.responseType === 'blob') {
      return response
    }
    if (res.success === false) {
      ElMessage.error(res.message || '请求失败')
      return Promise.reject(new Error(res.message || 'Error'))
    }
    return res
  },
  error => {
    if (error.response) {
      const { status, data } = error.response
      if (status === 401) {
        if (!redirectingToLogin) {
          redirectingToLogin = true
          ElMessage.error(data?.message || '登录已过期，请重新登录')
          // 必须同步清空 Pinia 内存态：只清 localStorage 的话 isLoggedIn 仍为 true，
          // 路由守卫会把 /login 重定向回业务页，形成 401 死循环
          //（useAuthStore 在回调内运行时调用，规避与 auth store 的模块循环依赖）
          try {
            useAuthStore().logout()
          } catch (e) {
            localStorage.removeItem('token')
            localStorage.removeItem('user')
          }
          router.push('/login').finally(() => { redirectingToLogin = false })
        }
      } else if (status === 403) {
        ElMessage.error(data?.message || '权限不足')
      } else {
        ElMessage.error(data?.message || `请求错误 (${status})`)
      }
    } else if (error.code === 'ECONNABORTED') {
      ElMessage.error('请求超时，请检查网络')
    } else {
      ElMessage.error('网络异常，请检查后端服务是否启动')
    }
    return Promise.reject(error)
  }
)

export default request
