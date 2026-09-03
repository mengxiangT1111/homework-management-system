/**
 * 时间解析：iOS 不支持 'YYYY-MM-DD HH:mm:ss' 格式的 new Date，
 * 统一走这里。ISO 字符串（含 T）交给原生解析；其余替换 '-' 为 '/'。
 */
export function parseDate(str) {
  if (!str) return null
  if (str instanceof Date) return str
  const s = String(str).trim()
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s)
    return isNaN(d.getTime()) ? null : d
  }
  const d = new Date(s.replace('T', ' ').replace(/-/g, '/'))
  return isNaN(d.getTime()) ? null : d
}

function pad(n) {
  return String(n).padStart(2, '0')
}

export function formatDateTime(str) {
  const d = parseDate(str)
  if (!d) return str || '-'
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatDate(str) {
  const d = parseDate(str)
  if (!d) return str || '-'
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function formatTime(str) {
  const d = parseDate(str)
  if (!d) return { date: '', time: '' }
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
}

export function formatSize(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}

/**
 * 截止剩余文案：{ text, overdue, urgent }
 * urgent = 3 天内截止，用于红色/高亮展示
 */
export function remainingText(deadline) {
  const d = parseDate(deadline)
  if (!d) return { text: '-', overdue: false, urgent: false }
  const diff = d.getTime() - Date.now()
  if (diff <= 0) return { text: '已逾期', overdue: true, urgent: false }
  const DAY = 24 * 3600 * 1000
  const HOUR = 3600 * 1000
  const MIN = 60 * 1000
  const days = Math.floor(diff / DAY)
  const hours = Math.floor((diff % DAY) / HOUR)
  if (days >= 1) {
    return { text: `剩 ${days} 天 ${hours} 小时`, overdue: false, urgent: diff < 3 * DAY }
  }
  const mins = Math.floor((diff % HOUR) / MIN)
  return { text: `剩 ${hours} 小时 ${mins} 分`, overdue: false, urgent: true }
}

/** 置信度 0-1 → 百分比文案（无结果显示 '-'，不能走 Number：Number(null)===0 会误显 0%） */
export function formatConfidence(v) {
  if (v === null || v === undefined || v === '') return '-'
  const n = Number(v)
  if (isNaN(n)) return '-'
  return Math.round(n * 100) + '%'
}
