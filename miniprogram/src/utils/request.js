import { BASE_URL } from './config'

export function getToken() {
  return uni.getStorageSync('token') || ''
}

// 401 跳转去重：并发多个请求同时 401 时只提示一次、只跳一次
let redirectingToLogin = false
function handleUnauthorized() {
  uni.removeStorageSync('token')
  uni.removeStorageSync('userInfo')
  // 同步 pinia 内存登录态（App.vue 监听）：只清 Storage 的话，
  // reLaunch 前的窗口期内 isLoggedIn 仍为 true，页面会读到过期登录态
  uni.$emit('auth:unauthorized')
  if (redirectingToLogin) return
  redirectingToLogin = true
  uni.showToast({ title: '登录已过期，请重新登录', icon: 'none' })
  setTimeout(() => {
    uni.reLaunch({
      url: '/pages/login/login',
      complete: () => {
        redirectingToLogin = false
      }
    })
  }, 600)
}

// 登录接口的 401 是业务失败（账号/密码错误、选错学校），不是"登录过期"
function isLoginRequest(url) {
  return typeof url === 'string' && url.indexOf('/api/auth/login') !== -1
}

function failToast(message) {
  uni.showToast({ title: message || '请求失败', icon: 'none' })
}

/**
 * 统一请求层：自动带 token、按 { code, success, message, data } 解包、
 * success === false 时 toast message 并 reject；silent 时不弹提示（调用方自行处理）
 */
export function request({ url, method = 'GET', data, timeout = 30000, silent = false }) {
  return new Promise((resolve, reject) => {
    uni.request({
      url: BASE_URL + url,
      method,
      data,
      timeout,
      header: { Authorization: 'Bearer ' + getToken() },
      success: (res) => {
        if (res.statusCode === 401 && !isLoginRequest(url)) {
          handleUnauthorized()
          return reject(new Error('未登录'))
        }
        // 登录接口的 401 落到这里按 body 统一解包：toast 服务端返回的真实
        // 错误文案（如"学号/工号或密码错误"），并保留用户已填的表单
        const body = res.data
        if (!body || typeof body !== 'object') {
          if (!silent) failToast('服务异常，请稍后重试')
          return reject(new Error('服务异常'))
        }
        if (body.success === false) {
          if (!silent) failToast(body.message)
          const err = new Error(body.message || '请求失败')
          err.statusCode = res.statusCode
          return reject(err)
        }
        resolve(body.data)
      },
      fail: () => {
        if (!silent) failToast('网络异常，请稍后重试')
        reject(new Error('网络异常'))
      }
    })
  })
}

export const get = (url, data, opts) => request({ url, method: 'GET', data, ...opts })
export const post = (url, data, opts) => request({ url, method: 'POST', data, ...opts })
export const put = (url, data, opts) => request({ url, method: 'PUT', data, ...opts })
export const del = (url, data, opts) => request({ url, method: 'DELETE', data, ...opts })

/**
 * 小程序单文件直传（POST /api/upload/single），返回与 merge 同构的 descriptor：
 * { original_name, file_path, file_size, mime_type, file_hash, ext }
 * onProgress(progress) 回调 0-100 百分比
 */
export function uploadSingle({ filePath, filename, onProgress }) {
  return new Promise((resolve, reject) => {
    const task = uni.uploadFile({
      url: BASE_URL + '/api/upload/single',
      filePath,
      name: 'file',
      formData: { filename },
      header: { Authorization: 'Bearer ' + getToken() },
      timeout: 300000,
      success: (res) => {
        if (res.statusCode === 401) {
          handleUnauthorized()
          return reject(new Error('未登录'))
        }
        let body = null
        try {
          body = JSON.parse(res.data)
        } catch (e) {
          body = null
        }
        if (!body || typeof body !== 'object') {
          failToast('上传响应异常')
          return reject(new Error('上传响应异常'))
        }
        if (body.success === false) {
          failToast(body.message)
          return reject(new Error(body.message || '上传失败'))
        }
        resolve(body.data)
      },
      fail: () => {
        failToast('网络异常，上传失败')
        reject(new Error('上传失败'))
      }
    })
    if (onProgress && task && task.onProgressUpdate) {
      task.onProgressUpdate((res) => onProgress(res.progress))
    }
  })
}
