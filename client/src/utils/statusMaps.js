/**
 * 全站状态 → 标签类型/文案统一映射
 * 同一状态语义跨页面必须同色同文案，避免各页自定义导致漂移
 */
export const SUBMISSION_STATUS = {
  submitted: { text: '待批改', type: 'warning' },
  graded: { text: '已通过', type: 'success' },
  returned: { text: '已退回', type: 'info' }
}

export const REVIEW_STATUS = {
  pending: { text: '待复核', type: 'warning' },
  approved: { text: '已通过', type: 'success' },
  adjusted: { text: '已调整', type: 'primary' },
  rejected: { text: '已否决', type: 'danger' }
}

export const TEMPLATE_STATUS = {
  draft: { text: '草稿', type: 'warning' },
  published: { text: '已发布', type: 'success' },
  disabled: { text: '已停用', type: 'info' }
}

export const ROLE = {
  student: { text: '学生', type: 'success' },
  teacher: { text: '教师', type: 'warning' },
  admin: { text: '管理员', type: 'danger' }
}

export const TODO_STATUS = {
  active: { text: '进行中', type: 'success' },
  closed: { text: '已结束', type: 'info' }
}

// 取映射，未命中兜底为中性标签
export function statusOf(map, key) {
  return map[key] || { text: key || '—', type: 'info' }
}
