import request from './request'
import { ElMessage } from 'element-plus'

// ===== 认证 =====
export const authApi = {
  register: (data) => request.post('/auth/register', data),
  login: (data) => request.post('/auth/login', data),
  getProfile: () => request.get('/auth/profile'),
  updateProfile: (data) => request.put('/auth/profile', data),
  changePassword: (data) => request.put('/auth/password', data)
}

// ===== 用户 =====
export const userApi = {
  list: (params) => request.get('/users', { params }),
  get: (id) => request.get(`/users/${id}`),
  createTeacher: (data) => request.post('/users/teacher', data),
  createStudent: (data) => request.post('/users/student', data),
  resetPassword: (id, data) => request.put(`/users/${id}/password`, data),
  toggleStatus: (id) => request.patch(`/users/${id}/status`),
  remove: (id) => request.delete(`/users/${id}`),
  teachers: (params) => request.get('/users/role/teachers', { params }),
  students: (params) => request.get('/users/role/students', { params })
}

// ===== 班级 =====
export const classApi = {
  list: (params) => request.get('/classes', { params }),
  all: (params) => request.get('/classes/all/list', { params }),
  get: (id) => request.get(`/classes/${id}`),
  students: (id) => request.get(`/classes/${id}/students`),
  create: (data) => request.post('/classes', data),
  update: (id, data) => request.put(`/classes/${id}`, data),
  remove: (id) => request.delete(`/classes/${id}`),
  addStudents: (id, ids) => request.post(`/classes/${id}/students`, { student_ids: ids }),
  removeStudent: (id, studentId) => request.delete(`/classes/${id}/students/${studentId}`),
  setPosition: (id, studentId, position) => request.put(`/classes/${id}/students/${studentId}/position`, { position }),
  myClasses: () => request.get('/classes/my/list'),
  myPositions: () => request.get('/classes/my/positions'),
  join: (id) => request.post(`/classes/${id}/join`),
  leave: (id) => request.post(`/classes/${id}/leave`),
  // 班级负责人专属
  leaderAssignments: (classId) => request.get('/classes/leader/assignments', { params: { class_id: classId } }),
  leaderUnsubmitted: (assignmentId, classId) => request.get(`/classes/leader/assignment/${assignmentId}/unsubmitted`, { params: { class_id: classId } }),
  leaderRemind: (assignmentId, classId) => request.post(`/classes/leader/assignment/${assignmentId}/remind`, { class_id: classId }),
  leaderCreateAssignment: (classId, data) => request.post('/classes/leader/assignment', { class_id: classId, ...data }),
  leaderUpdateAssignment: (classId, assignmentId, data) => request.put(`/classes/leader/assignment/${assignmentId}?class_id=${classId}`, data),
  leaderDeleteAssignment: (classId, assignmentId) => request.delete(`/classes/leader/assignment/${assignmentId}?class_id=${classId}`),
  leaderDownloadAll: (classId, assignmentId) => `/api/classes/leader/assignment/${assignmentId}/download?class_id=${classId}`
}

// ===== 课程 =====
export const courseApi = {
  list: (params) => request.get('/courses', { params }),
  all: () => request.get('/courses/all/list'),
  get: (id) => request.get(`/courses/${id}`),
  create: (data) => request.post('/courses', data),
  update: (id, data) => request.put(`/courses/${id}`, data),
  remove: (id) => request.delete(`/courses/${id}`),
  myTeaching: () => request.get('/courses/my/teaching'),
  // 课代表管理（任课教师/管理员）
  assistants: (id) => request.get(`/courses/${id}/assistants`),
  addAssistant: (id, studentId) => request.post(`/courses/${id}/assistants`, { student_id: studentId }),
  removeAssistant: (id, studentId) => request.delete(`/courses/${id}/assistants/${studentId}`),
  // 学生：我的课代表职务
  myAssistantships: () => request.get('/courses/my/assistantships'),
  // 课代表作业收集
  assistantAssignments: (courseId) => request.get('/courses/assistant/assignments', { params: { course_id: courseId } }),
  assistantUnsubmitted: (assignmentId, courseId) => request.get(`/courses/assistant/assignment/${assignmentId}/unsubmitted`, { params: { course_id: courseId } }),
  assistantRemind: (assignmentId, courseId) => request.post(`/courses/assistant/assignment/${assignmentId}/remind`, { course_id: courseId }),
  assistantCreateAssignment: (data) => request.post('/courses/assistant/assignment', data),
  assistantUpdateAssignment: (assignmentId, data) => request.put(`/courses/assistant/assignment/${assignmentId}`, data),
  assistantDeleteAssignment: (assignmentId, courseId) => request.delete(`/courses/assistant/assignment/${assignmentId}`, { params: { course_id: courseId } }),
  assistantDownloadAll: (assignmentId, courseId) => `/api/courses/assistant/assignment/${assignmentId}/download?course_id=${courseId}`
}

// ===== 作业 =====
export const assignmentApi = {
  list: (params) => request.get('/assignments', { params }),
  get: (id) => request.get(`/assignments/${id}`),
  submissions: (id) => request.get(`/assignments/${id}/submissions`),
  unsubmitted: (id) => request.get(`/assignments/${id}/unsubmitted`),
  create: (data) => request.post('/assignments', data),
  update: (id, data) => request.put(`/assignments/${id}`, data),
  remove: (id) => request.delete(`/assignments/${id}`)
}

// ===== 提交 =====
export const submissionApi = {
  submit: (assignmentId, data) => request.post(`/submissions/assignment/${assignmentId}`, data),
  myList: (params) => request.get('/submissions/my/list', { params }),
  myDetail: (assignmentId) => request.get(`/submissions/my/assignment/${assignmentId}`),
  detail: (id) => request.get(`/submissions/detail/${id}`),
  grade: (id, data) => request.put(`/submissions/${id}/grade`, data),
  remind: (assignmentId) => request.post(`/submissions/assignment/${assignmentId}/remind`),
  downloadAll: (assignmentId) => `/api/submissions/assignment/${assignmentId}/download`,
  exportExcel: (assignmentId) => `/api/submissions/assignment/${assignmentId}/export`
}

// ===== 通知 =====
export const notificationApi = {
  list: (params) => request.get('/notifications', { params }),
  unreadCount: () => request.get('/notifications/unread/count'),
  markRead: (id) => request.put(`/notifications/${id}/read`),
  markAllRead: () => request.put('/notifications/all/read'),
  remove: (id) => request.delete(`/notifications/${id}`)
}

// ===== 学校 =====
export const schoolApi = {
  all: () => request.get('/schools/all'),
  list: (params) => request.get('/schools', { params }),
  create: (data) => request.post('/schools', data),
  update: (id, data) => request.put(`/schools/${id}`, data),
  remove: (id) => request.delete(`/schools/${id}`)
}

// ===== AI 批改 =====
export const aiApi = {
  // AI 批改链路长（外部 LLM 调用 + 失败重试），单独放宽超时，
  // 避免前端 30s 超时报错而后端仍在继续写库、教师误以为失败而重复触发
  grade: (data) => request.post('/ai/grade', data, { timeout: 300000 }),
  batchGrade: (data) => request.post('/ai/batch-grade', data, { timeout: 600000 }),
  uploadReference: (formData) => request.post('/ai/upload-reference', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 30000
  })
}

// ===== 统计 =====
export const statsApi = {
  overview: () => request.get('/stats/overview'),
  assignmentRates: () => request.get('/stats/assignment-rates'),
  teacher: () => request.get('/stats/teacher'),
  student: () => request.get('/stats/student'),
  cleanupPreview: (params) => request.get('/stats/cleanup/preview', { params }),
  cleanupRun: (data) => request.post('/stats/cleanup/run', data)
}

// ===== 上传 =====
export const uploadApi = {
  check: (hash) => request.get('/upload/check', { params: { hash } }),
  uploadChunk: (formData, hash, index) => request.post(`/upload/chunk?hash=${hash}&index=${index}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000
  }),
  merge: (data) => request.post('/upload/merge', data)
}

// ===== 查重 =====
export const plagiarismApi = {
  check: (assignmentId, submissionId) => request.post(`/plagiarism/check/${assignmentId}/${submissionId}`),
  batchCheck: (assignmentId) => request.post(`/plagiarism/batch-check/${assignmentId}`, undefined, { timeout: 600000 }),
  results: (assignmentId, submissionId) => request.get(`/plagiarism/results/${assignmentId}/${submissionId}`),
  maxScore: (assignmentId, submissionId) => request.get(`/plagiarism/max-score/${assignmentId}/${submissionId}`),
  assignmentSummary: (assignmentId) => request.get(`/plagiarism/assignment-summary/${assignmentId}`),
  deleteResults: (assignmentId, submissionId) => request.delete(`/plagiarism/results/${assignmentId}/${submissionId}`)
}

// 下载工具（带 token）
export function downloadFile(url, filename) {
  const token = localStorage.getItem('token')
  const xhr = new XMLHttpRequest()
  xhr.open('GET', url, true)
  xhr.responseType = 'blob'
  xhr.setRequestHeader('Authorization', `Bearer ${token}`)
  xhr.onload = function () {
    if (xhr.status === 200) {
      const blob = xhr.response
      const link = document.createElement('a')
      link.href = window.URL.createObjectURL(blob)
      link.download = filename || 'download'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(link.href)
    } else {
      ElMessage.error('下载失败')
    }
  }
  xhr.onerror = function () {
    ElMessage.error('下载失败，请检查网络')
  }
  xhr.ontimeout = function () {
    ElMessage.error('下载超时，请重试')
  }
  xhr.timeout = 300000
  xhr.send()
}
