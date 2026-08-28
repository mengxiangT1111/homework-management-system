/**
 * 通用格式化工具
 */

// 时间格式化（空值/非法值兜底，避免渲染出 "Invalid Date"）
export function formatTime(t) {
  if (!t) return '—'
  const d = new Date(t)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('zh-CN')
}

// ISO 时间串（后端 DataTypes.DATE 序列化产物，如 2026-08-20T16:00:00.000Z）
// 转为 el-date-picker 的 value-format（YYYY-MM-DD HH:mm:ss）。
// 不转换时 picker 按自身 valueFormat 解析 ISO 串会失败，导致编辑弹窗回显为空。
export function toPickerValue(iso) {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:00`
}

// 提交率进度条统一配色：≥80 达标（深薄荷）/ ≥50 偏低（琥珀）/ <50 危险（红）
export function rateColor(r) {
  if (r >= 80) return '#3da884'
  if (r >= 50) return '#e6a23c'
  return '#f56c6c'
}
