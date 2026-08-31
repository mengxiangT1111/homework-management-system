/**
 * 状态文案与颜色映射（与 Web 端 client/src/utils/statusMaps.js 对齐）
 * type 对应全局样式里的 tag-* 类
 */

// 作业状态胶囊：教师显式关闭 > 逾期 > 进行中
export function assignmentStatus(a) {
  if (!a) return { text: '-', type: 'info' }
  if (a.status === 'closed') return { text: '已关闭', type: 'info' }
  if (a.is_overdue) return { text: '已逾期', type: 'danger' }
  return { text: '进行中', type: 'primary' }
}

export const SUBMISSION_STATUS = {
  submitted: { text: '待批改', type: 'warning' },
  graded: { text: '已批改', type: 'success' },
  returned: { text: '已退回', type: 'danger' }
}

export function submissionStatus(s) {
  return SUBMISSION_STATUS[s && s.status] || { text: '已提交', type: 'primary' }
}

export const NOTIFICATION_TYPES = {
  deadline: { text: '截止提醒', color: '#e6a23c' },
  grade: { text: '成绩', color: '#3da884' },
  assignment: { text: '作业', color: '#52c4a0' },
  system: { text: '系统', color: '#909399' }
}

export const ROLE_NAMES = {
  student: '学生',
  teacher: '教师',
  admin: '管理员'
}

// AI 批改任务的三个评分模式
export const GRADING_MODES = [
  { value: 'balanced', text: '均衡' },
  { value: 'strict', text: '严格' },
  { value: 'encouraging', text: '鼓励' }
]
