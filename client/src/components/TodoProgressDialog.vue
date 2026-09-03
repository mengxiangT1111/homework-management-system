<template>
  <el-dialog v-model="visible" title="完成进度" width="720px" top="5vh">
    <div v-loading="loading">
      <template v-if="data">
        <div class="progress-head">
          <div class="progress-title">
            <span class="todo-title">{{ data.title }}</span>
            <el-tag :type="statusOf(TODO_STATUS, data.status).type" size="small">
              {{ statusOf(TODO_STATUS, data.status).text }}
            </el-tag>
          </div>
          <div class="progress-nums">
            <span class="rate" :style="{ color: rateColor(data.complete_rate) }">{{ data.complete_rate }}%</span>
            <span class="cnt">已完成 {{ data.completed_count }} / {{ data.total }} 人</span>
          </div>
          <el-progress
            :percentage="data.complete_rate" :color="rateColor(data.complete_rate)"
            :stroke-width="10" :show-text="false"
          />
        </div>

        <div class="member-cols">
          <div class="member-col">
            <div class="col-head done">已完成（{{ data.completed.length }}）</div>
            <div v-if="data.completed.length === 0" class="col-empty">暂无</div>
            <div v-for="m in data.completed" :key="m.id" class="member-row">
              <span class="name">{{ m.real_name }}</span>
              <span class="time">{{ formatTime(m.completed_at) }}</span>
            </div>
          </div>
          <div class="member-col">
            <div class="col-head todo">未完成（{{ data.uncompleted.length }}）</div>
            <div v-if="data.uncompleted.length === 0" class="col-empty">全部完成 🎉</div>
            <div v-for="m in data.uncompleted" :key="m.id" class="member-row">
              <span class="name">{{ m.real_name }}</span>
              <span class="time">—</span>
            </div>
          </div>
        </div>
      </template>
    </div>
    <template #footer>
      <el-button v-if="data && data.status === 'active' && data.uncompleted_count > 0"
        type="primary" :loading="reminding" @click="handleRemind">
        提醒未完成同学
      </el-button>
      <el-button @click="visible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { todoApi } from '@/api'
import { formatTime, rateColor } from '@/utils/format'
import { TODO_STATUS, statusOf } from '@/utils/statusMaps'

const props = defineProps({
  modelValue: Boolean,
  todo: { type: Object, default: null }
})
const emit = defineEmits(['update:modelValue', 'reminded'])

const visible = computed({
  get: () => props.modelValue,
  set: v => emit('update:modelValue', v)
})

const loading = ref(false)
const reminding = ref(false)
const data = ref(null)

watch(() => props.modelValue, async (v) => {
  if (!v || !props.todo) return
  loading.value = true
  data.value = null
  try {
    const res = await todoApi.progress(props.todo.id)
    data.value = res.data
  } finally {
    loading.value = false
  }
})

async function handleRemind() {
  reminding.value = true
  try {
    const res = await todoApi.remind(props.todo.id)
    ElMessage.success(res.message || '已提醒')
    emit('reminded')
    const r = await todoApi.progress(props.todo.id)
    data.value = r.data
  } finally {
    reminding.value = false
  }
}
</script>

<style scoped>
.progress-head { margin-bottom: 16px; }
.progress-title { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.todo-title { font-size: 15px; font-weight: 600; }
.progress-nums { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; }
.progress-nums .rate { font-size: 22px; font-weight: 700; }
.progress-nums .cnt { font-size: 12px; color: var(--text-light); }
.member-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.member-col { background: var(--bg); border-radius: 8px; padding: 12px; max-height: 320px; overflow-y: auto; }
.col-head { font-size: 13px; font-weight: 600; margin-bottom: 8px; }
.col-head.done { color: var(--brand-600); }
.col-head.todo { color: var(--color-warning, #e6a23c); }
.col-empty { font-size: 13px; color: var(--ink-400); padding: 8px 0; }
.member-row { display: flex; justify-content: space-between; padding: 6px 4px; font-size: 13px; border-bottom: 1px dashed var(--border-light, var(--border)); }
.member-row:last-child { border-bottom: none; }
.member-row .time { color: var(--ink-400); font-size: 12px; }
@media (max-width: 600px) {
  .member-cols { grid-template-columns: 1fr; }
}
</style>
