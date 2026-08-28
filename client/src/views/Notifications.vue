<template>
  <div class="page-container">
    <div class="page-title">
      消息通知
      <el-button type="primary" size="small" plain :loading="markingAll" @click="markAll" style="margin-left:auto">全部已读</el-button>
    </div>

    <div class="card-section">
      <div v-if="list.length === 0" class="empty-box">
        <el-icon :size="48"><BellFilled /></el-icon>
        <p style="margin-top:12px">暂无通知</p>
      </div>

      <div v-for="item in list" :key="item.id" class="notif-item" :class="{ unread: !item.is_read }">
        <div class="notif-icon">
          <el-icon :size="20">
            <component :is="typeIcon(item.type)" />
          </el-icon>
        </div>
        <div class="notif-content">
          <div class="notif-title">{{ item.title }}</div>
          <div class="notif-text">{{ item.content }}</div>
          <div class="notif-time">{{ formatTime(item.created_at) }}</div>
        </div>
        <div class="notif-actions">
          <el-button v-if="!item.is_read" link type="primary" @click="markOne(item)">已读</el-button>
          <el-button link type="danger" @click="removeOne(item)">删除</el-button>
        </div>
      </div>

      <el-pagination
        v-if="total > 0"
        background layout="prev, pager, next" :total="total"
        :page-size="pageSize" :current-page="page"
        class="table-footer"
        @current-change="handlePage"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { BellFilled, Clock, Trophy, Bell, Document } from '@element-plus/icons-vue'
import { useNotificationStore } from '@/stores/notification'

const notifStore = useNotificationStore()
const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 10
const markingAll = ref(false)

function typeIcon(type) {
  return { deadline: Clock, grade: Trophy, assignment: Document, system: Bell }[type] || Bell
}

function formatTime(t) {
  const d = new Date(t)
  return d.toLocaleString('zh-CN')
}

async function loadData() {
  const res = await notifStore.fetchList({ page: page.value, pageSize })
  list.value = res.list
  total.value = res.total
}

function handlePage(p) {
  page.value = p
  loadData()
}

async function markOne(item) {
  // 防重复点击（避免 unreadCount 被重复扣减），并兜底接口失败时的未处理异常
  if (item._marking || item.is_read) return
  item._marking = true
  try {
    await notifStore.markRead(item.id)
    item.is_read = 1
  } catch (e) {} finally { item._marking = false }
}

async function markAll() {
  if (markingAll.value) return
  markingAll.value = true
  try {
    await notifStore.markAllRead()
    list.value.forEach(i => i.is_read = 1)
    ElMessage.success('已全部标记为已读')
  } catch (e) {} finally { markingAll.value = false }
}

async function removeOne(item) {
  try {
    await ElMessageBox.confirm('确定删除该通知？', '提示', { type: 'warning' })
    await notifStore.remove(item.id)
    ElMessage.success('已删除')
    loadData()
  } catch (e) {}
}

onMounted(loadData)
</script>

<style scoped>
.notif-item {
  display: flex; align-items: flex-start; gap: 14px;
  padding: 16px; border-bottom: 1px solid var(--border);
  transition: background 0.2s;
}
.notif-item:hover { background: var(--bg); }
.notif-item.unread { background: #f0faf6; }
.notif-item.unread .notif-title { font-weight: 600; }
.notif-icon {
  width: 40px; height: 40px; border-radius: 50%;
  background: var(--primary); color: white;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.notif-content { flex: 1; min-width: 0; }
.notif-title { font-size: 15px; color: var(--text); margin-bottom: 4px; }
.notif-text { font-size: 13px; color: var(--text-light); line-height: 1.6; }
.notif-time { font-size: 12px; color: #aaa; margin-top: 6px; }
.notif-actions { flex-shrink: 0; }
</style>
