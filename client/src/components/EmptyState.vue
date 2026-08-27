<template>
  <div class="empty-state" :class="[`is-${type}`, `is-${size}`]">
    <div class="empty-state__icon">
      <el-icon :size="iconSize">
        <Search v-if="type === 'search'" />
        <CircleCloseFilled v-else-if="type === 'error'" />
        <Files v-else />
      </el-icon>
    </div>
    <div class="empty-state__title">{{ titleText }}</div>
    <div v-if="description" class="empty-state__desc">{{ description }}</div>
    <div v-if="type === 'error'" class="empty-state__action">
      <el-button type="primary" size="small" @click="$emit('retry')">重新加载</el-button>
    </div>
    <slot />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Search, CircleCloseFilled, Files } from '@element-plus/icons-vue'

const props = defineProps({
  // empty：无数据 / search：搜索无结果 / error：加载失败（带重试）
  type: { type: String, default: 'empty' },
  title: { type: String, default: '' },
  description: { type: String, default: '' },
  // default：页面级 / compact：卡片与弹窗内
  size: { type: String, default: 'default' }
})

defineEmits(['retry'])

const DEFAULT_TITLES = {
  empty: '暂无数据',
  search: '未找到匹配结果',
  error: '加载失败'
}

const titleText = computed(() => props.title || DEFAULT_TITLES[props.type] || '暂无数据')
const iconSize = computed(() => (props.size === 'compact' ? 24 : 34))
</script>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 56px 20px;
  color: var(--text-light);
}
.empty-state.is-compact { padding: 28px 16px; }

.empty-state__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  border-radius: 50%;
  margin-bottom: 16px;
  background: var(--brand-50);
  color: var(--brand-600);
}
.is-compact .empty-state__icon { width: 48px; height: 48px; margin-bottom: 12px; }

.is-search .empty-state__icon { background: var(--ink-100); color: var(--ink-500); }
.is-error .empty-state__icon { background: var(--el-color-danger-light-9); color: var(--color-danger); }

.empty-state__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--ink-700);
}
.empty-state__desc {
  font-size: 13px;
  line-height: 1.7;
  margin-top: 6px;
  max-width: 320px;
}
.empty-state__action { margin-top: 14px; }
</style>
