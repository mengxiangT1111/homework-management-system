<template>
  <el-dialog v-model="visible" :title="fileName" width="80%" top="5vh" destroy-on-close>
    <div class="preview-container">
      <!-- PDF 预览 -->
      <iframe v-if="isPdf" :src="fileUrl" class="preview-frame" />
      <!-- 图片预览 -->
      <div v-else-if="isImage" class="image-wrap">
        <img :src="fileUrl" :alt="fileName" class="preview-image" />
      </div>
      <!-- 其他文件不支持预览 -->
      <div v-else class="no-preview">
        <el-icon :size="60"><Document /></el-icon>
        <p>该文件格式暂不支持在线预览</p>
        <el-button type="primary" @click="downloadFile">下载查看</el-button>
      </div>
    </div>
    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
      <el-button type="primary" @click="downloadFile">下载文件</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { Document } from '@element-plus/icons-vue'
import { resolveFileUrl } from '@/utils/fileUrl'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  filePath: { type: String, default: '' },
  fileName: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue'])

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
})

const ext = computed(() => props.fileName.split('.').pop().toLowerCase())
const isPdf = computed(() => ext.value === 'pdf')
const isImage = computed(() => ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(ext.value))

// URL 需经 /api/files/urls 换取短时效票据（iframe/img 无法带 Authorization 头），
// 打开弹窗时异步解析；解析期间组件短暂空白属预期
const url = ref('')
watch(
  () => [props.modelValue, props.filePath],
  async ([open, fp]) => {
    if (open && fp) {
      url.value = ''
      url.value = await resolveFileUrl(fp)
    }
  },
  { immediate: true }
)

const fileUrl = computed(() => url.value)

function downloadFile() {
  // 已解析则直接打开（COS 为签名 URL，本地为票据 URL）
  if (url.value) window.open(url.value, '_blank')
}
</script>

<style scoped>
.preview-container { height: 70vh; }
.preview-frame { width: 100%; height: 100%; border: none; }
.image-wrap {
  height: 100%; display: flex; align-items: center; justify-content: center;
  background: #f5f5f5; overflow: auto;
}
.preview-image { max-width: 100%; max-height: 100%; object-fit: contain; }
.no-preview {
  height: 100%; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 16px;
  color: var(--text-light);
}
</style>
