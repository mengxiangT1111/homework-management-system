<template>
  <div class="file-uploader">
    <!-- 拖拽上传区 -->
    <el-upload
      drag
      multiple
      :auto-upload="false"
      :show-file-list="false"
      :accept="acceptStr"
      :on-change="handleFileChange"
      :disabled="uploading"
    >
      <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
      <div class="el-upload__text">
        拖拽文件到此处，或<em>点击上传</em>
      </div>
      <template #tip>
        <div class="upload-tip">
          支持 {{ allowedFormats.join(' / ') }} 格式，最多 {{ maxFiles }} 个文件，单个文件不超过 {{ maxSizeMb }}MB
        </div>
      </template>
    </el-upload>

    <!-- 已选文件列表 -->
    <div v-if="fileList.length > 0" class="file-list">
      <div v-for="(item, idx) in fileList" :key="idx" class="file-item">
        <div class="file-info">
          <el-icon class="file-icon"><Document /></el-icon>
          <div class="file-detail">
            <div class="file-name">{{ item.file.name }}</div>
            <div class="file-meta">{{ formatSize(item.file.size) }}</div>
          </div>
        </div>
        <div class="file-status">
          <el-progress
            v-if="item.status === 'uploading' || item.status === 'done'"
            :percentage="item.progress"
            :status="item.status === 'done' ? 'success' : ''"
            :stroke-width="6"
            style="width:160px"
          />
          <el-tag v-if="item.status === 'done'" type="success" size="small" effect="plain">已上传</el-tag>
          <el-icon v-if="!uploading" class="remove-btn" @click="removeFile(idx)"><CircleClose /></el-icon>
        </div>
      </div>
    </div>

    <!-- 上传按钮 -->
    <div v-if="fileList.length > 0" class="upload-actions">
      <el-button type="primary" :loading="uploading" @click="startUpload" :disabled="fileList.length === 0">
        {{ uploading ? '上传中...' : '开始上传' }}
      </el-button>
      <el-button @click="clearAll" :disabled="uploading">清空</el-button>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { UploadFilled, Document, CircleClose } from '@element-plus/icons-vue'
import { uploadFileChunked } from '@/utils/upload'

const props = defineProps({
  allowedFormats: { type: Array, default: () => ['pdf', 'doc', 'docx', 'jpg', 'png', 'zip'] },
  maxFiles: { type: Number, default: 5 },
  maxSizeMb: { type: Number, default: 100 }
})

const emit = defineEmits(['uploaded'])

const fileList = reactive([]) // [{file, status, progress, result}]
const uploading = ref(false)

const acceptStr = computed(() =>
  props.allowedFormats.map(f => f === 'jpg' ? '.jpg,.jpeg' : '.' + f).join(',')
)

function getExt(name) {
  return name.split('.').pop().toLowerCase()
}

function handleFileChange(file) {
  const raw = file.raw
  if (!raw) return
  // jpeg 与 jpg 视为同一格式（accept 放行了 .jpeg，校验需同步归一化，否则前后矛盾）
  const ext = getExt(raw.name) === 'jpeg' ? 'jpg' : getExt(raw.name)
  if (props.allowedFormats.length > 0 && !props.allowedFormats.includes(ext)) {
    ElMessage.warning(`${raw.name} 格式不支持（仅支持：${props.allowedFormats.join(', ')}）`)
    return
  }
  if (raw.size > props.maxSizeMb * 1024 * 1024) {
    ElMessage.warning(`${raw.name} 超过 ${props.maxSizeMb}MB 限制`)
    return
  }
  if (fileList.length >= props.maxFiles) {
    ElMessage.warning(`最多上传 ${props.maxFiles} 个文件`)
    return
  }
  // 同名且同大小的文件视为重复（重复加入会占用 maxFiles 名额并重复上传）
  if (fileList.some(f => f.file.name === raw.name && f.file.size === raw.size)) {
    ElMessage.warning(`「${raw.name}」已在列表中，无需重复添加`)
    return
  }
  fileList.push({ file: raw, status: 'pending', progress: 0, result: null })
}

function removeFile(idx) {
  fileList.splice(idx, 1)
}

function clearAll() {
  fileList.splice(0, fileList.length)
}

async function startUpload() {
  if (fileList.length === 0) return
  uploading.value = true
  try {
    for (const item of fileList) {
      if (item.status === 'done') continue
      item.status = 'uploading'
      item.progress = 0
      const result = await uploadFileChunked(item.file, (p) => {
        item.progress = p
      })
      item.result = result
      item.status = 'done'
      item.progress = 100
    }
    ElMessage.success('全部文件上传成功')
    const results = fileList.map(f => f.result)
    emit('uploaded', results)
  } catch (e) {
    // 失败的文件状态复位为待上传，用户可重试（否则进度条永远显示"上传中"）
    for (const item of fileList) {
      if (item.status === 'uploading') item.status = 'pending'
    }
    ElMessage.error('上传失败：' + (e.message || '未知错误'))
  } finally {
    uploading.value = false
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(2) + ' MB'
}

defineExpose({ clearAll, fileList })
</script>

<style scoped>
.upload-tip {
  color: var(--text-light);
  font-size: 12px;
  margin-top: 6px;
}
.file-list { margin-top: 16px; }
.file-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px; background: var(--bg); border-radius: 8px;
  margin-bottom: 8px;
}
.file-info { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; }
.file-icon { font-size: 28px; color: var(--primary); }
.file-detail { min-width: 0; }
.file-name {
  font-size: 14px; color: var(--text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 240px;
}
.file-meta { font-size: 12px; color: var(--text-light); margin-top: 2px; }
.file-status { display: flex; align-items: center; gap: 10px; }
.remove-btn { cursor: pointer; color: var(--danger); font-size: 18px; }
.upload-actions { margin-top: 16px; display: flex; gap: 10px; }
</style>
