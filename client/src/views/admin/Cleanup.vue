<template>
  <div class="page-container">
    <div class="page-title">文件清理</div>

    <el-alert type="info" :closable="false" style="margin-bottom:20px">
      清理已超过截止时间且超过保留期的作业文件，释放磁盘空间。被清理的提交记录仍保留在数据库中，仅删除物理文件。
    </el-alert>

    <div class="card-section">
      <div class="filter-bar">
        <span>保留天数：</span>
        <el-input-number v-model="retainDays" :min="1" :max="365" />
        <span style="color:var(--text-light);font-size:13px">（截止时间超过此天数的作业文件将被清理）</span>
        <el-button type="primary" @click="preview" :loading="loadingPreview">预览清理项</el-button>
      </div>

      <el-divider />

      <div v-if="previewData">
        <h3 style="margin-bottom:16px">清理预览</h3>
        <el-row :gutter="20" style="margin-bottom:20px">
          <el-col :span="6">
            <div class="mini-stat">
              <div class="mini-label">过期作业数</div>
              <div class="mini-value">{{ previewData.expiredAssignmentCount }}</div>
            </div>
          </el-col>
          <el-col :span="6">
            <div class="mini-stat">
              <div class="mini-label">待清理文件</div>
              <div class="mini-value">{{ previewData.fileCount }}</div>
            </div>
          </el-col>
          <el-col :span="6">
            <div class="mini-stat">
              <div class="mini-label">占用空间</div>
              <div class="mini-value">{{ formatSize(previewData.fileSize) }}</div>
            </div>
          </el-col>
          <el-col :span="6">
            <div class="mini-stat">
              <div class="mini-label">截止日期</div>
              <div class="mini-value" style="font-size:16px">{{ formatDate(previewData.cutoffDate) }}</div>
            </div>
          </el-col>
        </el-row>

        <div v-if="previewData.assignments.length > 0">
          <div class="files-title">涉及的作业：</div>
          <el-tag v-for="a in previewData.assignments" :key="a.id" style="margin:4px">
            {{ a.title }}（截止 {{ formatDate(a.deadline) }}）
          </el-tag>
        </div>

        <div v-if="previewData.fileCount > 0" style="margin-top:24px">
          <el-button type="danger" size="large" :loading="cleaning" @click="runCleanup">
            <el-icon><Delete /></el-icon> 确认执行清理
          </el-button>
        </div>
        <el-alert v-else type="success" :closable="false" style="margin-top:16px" title="暂无需要清理的过期文件" />
      </div>

      <div v-else class="empty-box">
        <el-icon :size="48"><Delete /></el-icon>
        <p style="margin-top:12px">点击"预览清理项"查看可清理的文件</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete } from '@element-plus/icons-vue'
import { statsApi } from '@/api'

const retainDays = ref(30)
const loadingPreview = ref(false)
const cleaning = ref(false)
const previewData = ref(null)

function formatSize(b) {
  if (!b) return '0 B'
  if (b < 1024) return b + ' B'
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB'
  if (b < 1073741824) return (b / 1048576).toFixed(2) + ' MB'
  return (b / 1073741824).toFixed(2) + ' GB'
}
function formatDate(t) { return new Date(t).toLocaleDateString('zh-CN') }

async function preview() {
  loadingPreview.value = true
  try {
    const res = await statsApi.cleanupPreview({ days: retainDays.value })
    previewData.value = res.data
  } catch (e) {} finally { loadingPreview.value = false }
}

async function runCleanup() {
  try {
    await ElMessageBox.confirm(
      `确定清理 ${previewData.value.fileCount} 个文件（${formatSize(previewData.value.fileSize)}）？此操作不可恢复！`,
      '危险操作确认', { type: 'error' }
    )
    cleaning.value = true
    const res = await statsApi.cleanupRun({ days: retainDays.value })
    ElMessage.success(res.message)
    preview()
  } catch (e) {} finally { cleaning.value = false }
}
</script>

<style scoped>
.mini-stat { background: var(--bg); padding: 16px; border-radius: 8px; text-align: center; }
.mini-label { font-size: 12px; color: var(--text-light); }
.mini-value { font-size: 24px; font-weight: 700; color: var(--primary); margin-top: 6px; }
.files-title { font-weight: 500; margin-bottom: 8px; }
</style>
