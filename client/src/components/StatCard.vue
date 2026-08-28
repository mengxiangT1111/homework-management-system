<template>
  <div
    class="sc"
    :class="[`tone-${tone}`, { 'is-clickable': !!to }]"
    :role="to ? 'button' : undefined"
    :tabindex="to ? 0 : undefined"
    @click="go"
    @keydown.enter="go"
  >
    <div class="sc-icon">
      <el-icon :size="20"><component :is="icon" /></el-icon>
    </div>
    <div class="sc-body">
      <div class="sc-label">{{ label }}</div>
      <div class="sc-value" :title="hint || String(value)">{{ value }}</div>
      <div v-if="sub" class="sc-sub">{{ sub }}</div>
    </div>
    <el-icon v-if="to" class="sc-arrow"><ArrowRight /></el-icon>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'
import { ArrowRight } from '@element-plus/icons-vue'

const props = defineProps({
  label: { type: String, required: true },
  value: { type: [String, Number], default: '—' },
  // 数值下方的补充说明（如"学生 120 · 教师 8"）
  sub: { type: String, default: '' },
  // 悬停提示全文（值被截断时用，如多个班级名）
  hint: { type: String, default: '' },
  // 图标组件（EP icon）
  icon: { type: [Object, String], default: undefined },
  // 语义色调：brand / warning / danger
  tone: { type: String, default: 'brand' },
  // 可选跳转路由，传入后整卡可点击
  to: { type: String, default: '' }
})

const router = useRouter()
function go() {
  if (props.to) router.push(props.to)
}
</script>

<style scoped>
.sc {
  height: 100%;
  display: flex;
  align-items: center;
  gap: 14px;
  background: var(--bg-card);
  border: 1px solid var(--ink-100);
  border-radius: var(--radius-lg);
  padding: 18px 20px;
  box-shadow: var(--shadow-xs);
  transition: transform var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}
.sc.is-clickable { cursor: pointer; }
.sc.is-clickable:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
  border-color: var(--brand-300);
}
.sc.is-clickable:hover .sc-arrow { opacity: 1; transform: translateX(0); }
.sc:focus-visible { outline: 2px solid var(--brand-600); outline-offset: 2px; }

.sc-icon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: var(--brand-50);
  color: var(--brand-600);
}
.tone-warning .sc-icon { background: var(--el-color-warning-light-9); color: var(--el-color-warning-dark-2); }
.tone-danger .sc-icon { background: var(--el-color-danger-light-9); color: var(--el-color-danger-dark-2); }

.sc-body { flex: 1; min-width: 0; }
.sc-label { font-size: 13px; color: var(--ink-600); }
.sc-value {
  font-size: 24px;
  font-weight: 700;
  color: var(--ink-800);
  line-height: 1.25;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sc-sub { font-size: 12px; color: var(--text-light); margin-top: 2px; }

.sc-arrow {
  color: var(--ink-400);
  flex-shrink: 0;
  opacity: 0;
  transform: translateX(-4px);
  transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
}
</style>
