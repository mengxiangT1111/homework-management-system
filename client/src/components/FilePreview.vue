<template>
  <el-dialog
    v-model="visible"
    width="80%"
    top="5vh"
    destroy-on-close
    :fullscreen="fullscreen"
    class="file-preview-dialog"
  >
    <template #header>
      <div class="fp-header">
        <span class="fp-title" :title="fileName">{{ fileName || '文件预览' }}</span>
        <el-tag size="small" effect="plain">{{ kindLabel }}</el-tag>
        <span v-if="fileSizeText" class="fp-size">{{ fileSizeText }}</span>
        <el-button link class="fp-fs-btn" @click="fullscreen = !fullscreen">
          <el-icon><FullScreen /></el-icon>{{ fullscreen ? '退出全屏' : '全屏' }}
        </el-button>
      </div>
    </template>

    <div class="preview-body" :class="{ 'is-fullscreen': fullscreen }">
      <!-- 加载中 -->
      <div v-if="loading" class="preview-status"
        v-loading="true" :element-loading-text="loadingText" />

      <!-- 加载失败 -->
      <div v-else-if="error" class="preview-status">
        <el-result icon="warning" title="预览加载失败" :sub-title="error">
          <template #extra>
            <el-button type="primary" @click="load">重试</el-button>
            <el-button @click="downloadFileNow">下载查看</el-button>
          </template>
        </el-result>
      </div>

      <!-- 图片：点击可放大/缩放/旋转 -->
      <div v-else-if="kind === 'image'" class="image-wrap">
        <el-image :src="url" :alt="fileName" fit="contain"
          :preview-src-list="[url]" preview-teleported :hide-on-click-modal="true" class="preview-image" />
      </div>

      <!-- PDF / Office（后端已转为 PDF）：浏览器内嵌查看器 -->
      <iframe v-else-if="kind === 'pdf' || kind === 'office'" :src="url" class="preview-frame" />

      <!-- 视频 -->
      <div v-else-if="kind === 'video'" class="media-wrap">
        <video :src="url" controls preload="metadata" class="media-video" />
      </div>

      <!-- 音频 -->
      <div v-else-if="kind === 'audio'" class="media-wrap">
        <audio :src="url" controls class="media-audio" />
      </div>

      <!-- Word：后端转 HTML，sandbox iframe 渲染（禁脚本，防文档内恶意内容） -->
      <template v-else-if="kind === 'docx'">
        <el-alert v-if="previewData?.truncated" type="warning" :closable="false"
          title="文档过长，仅展示前部分内容，完整内容请下载查看" style="margin-bottom:8px" />
        <iframe v-if="previewDocHtml" :srcdoc="previewDocHtml" sandbox="allow-popups allow-popups-to-escape-sandbox" class="preview-frame doc-frame" />
      </template>

      <!-- Excel：后端转表格 HTML -->
      <template v-else-if="kind === 'xlsx'">
        <el-alert v-if="previewData?.truncated" type="warning" :closable="false"
          title="表格过大，仅展示前 200 行 × 30 列 × 5 个工作表，完整内容请下载查看" style="margin-bottom:8px" />
        <iframe v-if="previewDocHtml" :srcdoc="previewDocHtml" sandbox="allow-popups allow-popups-to-escape-sandbox" class="preview-frame doc-frame" />
      </template>

      <!-- 文本 -->
      <template v-else-if="kind === 'text'">
        <el-alert v-if="previewData?.truncated" type="warning" :closable="false"
          title="文本过长，仅展示前部分内容，完整内容请下载查看" style="margin-bottom:8px" />
        <el-alert v-if="previewData?.encoding_suspect" type="info" :closable="false"
          title="该文件可能不是 UTF-8 编码，若显示乱码请下载后本地打开" style="margin-bottom:8px" />
        <pre class="text-preview">{{ previewData?.text }}</pre>
      </template>

      <!-- 其余格式：引导下载 -->
      <div v-else class="preview-status no-preview">
        <el-icon :size="60"><Document /></el-icon>
        <p>{{ extUpper }} 文件暂不支持在线预览</p>
        <el-button type="primary" @click="downloadFileNow">下载查看</el-button>
      </div>
    </div>

    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
      <el-button v-if="url && ['image', 'pdf', 'video', 'audio'].includes(kind)"
        @click="openInNewTab">新窗口打开</el-button>
      <el-button type="primary" @click="downloadFileNow">下载文件</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { Document, FullScreen } from '@element-plus/icons-vue'
import { resolveFileUrl } from '@/utils/fileUrl'
import { filesApi, downloadFile } from '@/api'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  filePath: { type: String, default: '' },
  fileName: { type: String, default: '' },
  fileSize: { type: Number, default: null }
})
const emit = defineEmits(['update:modelValue'])

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
})

const ext = computed(() => String(props.fileName || props.filePath || '').split('.').pop().toLowerCase())
const extUpper = computed(() => ext.value.toUpperCase())

// 与后端 /api/files/download 的 INLINE_TYPES 白名单保持一致：
// 这些格式后端以 inline 下发，用原生标签加载；其余"能转换的"走 preview 接口。
// doc/ppt/pptx/xls 由后端 LibreOffice 转 PDF 流式返回（office 分支，blob 加载）。
// 外链样例（历史数据，http(s) 开头）无法站内转换，docx/xlsx/text 归入"下载查看"。
const kind = computed(() => {
  const e = ext.value
  const external = /^https?:\/\//i.test(normalizePath(props.filePath))
  if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(e)) return 'image'
  if (e === 'pdf') return 'pdf'
  if (['mp4', 'webm', 'mov'].includes(e)) return 'video'
  if (['mp3', 'wav'].includes(e)) return 'audio'
  if (external) return 'unsupported'
  if (e === 'docx') return 'docx'
  if (e === 'xlsx') return 'xlsx'
  if (['txt', 'md', 'csv', 'log', 'json'].includes(e)) return 'text'
  if (['doc', 'xls', 'ppt', 'pptx'].includes(e)) return 'office'
  return 'unsupported'
})

const KIND_LABELS = {
  image: '图片', pdf: 'PDF', video: '视频', audio: '音频',
  docx: 'Word 文档', xlsx: 'Excel 表格', text: '文本',
  office: 'Office 文档', unsupported: '文件'
}
const kindLabel = computed(() => KIND_LABELS[kind.value] || '文件')

const loading = ref(false)
const error = ref('')
const url = ref('')          // 图片/PDF/音视频的票据（或 COS 签名）URL；office 为 PDF blob URL
const previewData = ref(null) // docx/xlsx/text 的转换结果
const fullscreen = ref(false)
let pdfBlobUrl = ''          // office 分支生成的 objectURL，换文件/卸载时释放

// office 首次要等 LibreOffice 转换，提示语不同
const loadingText = computed(() =>
  kind.value === 'office' ? '正在转换文档（首次打开可能需要十几秒）…' : '正在加载预览…'
)

const fileSizeText = computed(() => {
  const b = props.fileSize ?? previewData.value?.file_size
  if (!b && b !== 0) return ''
  if (b < 1024) return b + ' B'
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB'
  return (b / 1048576).toFixed(2) + ' MB'
})

// Word/Excel 的 HTML 包一层基础样式后在 sandbox iframe 内渲染
const previewDocHtml = computed(() => {
  const d = previewData.value
  if (!d || !d.html) return ''
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:"Microsoft YaHei","PingFang SC",-apple-system,"Segoe UI",sans-serif;line-height:1.9;color:#2c3e50;max-width:860px;margin:0 auto;padding:24px 32px;font-size:15px}
    img{max-width:100%;height:auto}
    table{border-collapse:collapse;width:100%;margin:12px 0;font-size:13px}
    td,th{border:1px solid #e2e8f0;padding:6px 10px;word-break:break-all}
    th{background:#f1f5f9;text-align:left}
    h1,h2,h3,h4{margin:18px 0 8px}
    p{margin:8px 0}
    a{color:#3b82f6}
  </style></head><body>${d.html}</body></html>`
})

function normalizePath(p) {
  return String(p || '').trim().replace(/^\/+/, '')
}

async function load() {
  error.value = ''
  releasePdfBlob()
  url.value = ''
  previewData.value = null
  const p = normalizePath(props.filePath)
  if (!p) { error.value = '缺少文件路径'; return }

  loading.value = true
  try {
    if (['image', 'pdf', 'video', 'audio'].includes(kind.value)) {
      // iframe/img/video 无法带 Authorization 头，先换短时效票据（或 COS 签名）URL
      const u = await resolveFileUrl(p)
      if (!u) { error.value = '无法获取文件访问地址（可能无权访问或文件已被清理）'; return }
      url.value = u
    } else if (kind.value === 'office') {
      // 后端 LibreOffice 转 PDF 后流式返回二进制，转成本地 blob URL 给 iframe
      const res = await filesApi.previewBlob(p)
      const blob = res?.data
      if (!(blob instanceof Blob) || blob.size === 0) {
        error.value = '转换结果为空，请下载查看'; return
      }
      pdfBlobUrl = URL.createObjectURL(blob)
      url.value = pdfBlobUrl
    } else if (['docx', 'xlsx', 'text'].includes(kind.value)) {
      const res = await filesApi.preview(p)
      previewData.value = res.data || null
      if (kind.value !== 'text' && !previewData.value?.html) {
        error.value = '文档内容为空，无法预览'
      }
    }
  } catch (e) {
    // 全局拦截器已弹过错误提示，这里只负责弹窗内的错误态
    // blob 响应出错时 data 是 Blob，需解析出后端返回的 message
    let msg = e.response?.data?.message
    if (!msg && e.response?.data instanceof Blob) {
      try { msg = JSON.parse(await e.response.data.text()).message } catch { /* 保留默认 */ }
    }
    error.value = msg || '加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

function releasePdfBlob() {
  if (pdfBlobUrl) {
    URL.revokeObjectURL(pdfBlobUrl)
    pdfBlobUrl = ''
  }
}

onBeforeUnmount(releasePdfBlob)

watch(
  () => [props.modelValue, props.filePath],
  ([open, fp]) => {
    if (open && fp) {
      fullscreen.value = false
      load()
    }
  },
  { immediate: true }
)

// 下载始终走带 Authorization 的授权下载接口（COS 文件由后端 302 到签名 URL）
function downloadFileNow() {
  downloadFile(`/api/files/download?path=${encodeURIComponent(normalizePath(props.filePath))}`, props.fileName || '文件')
}

function openInNewTab() {
  if (url.value) window.open(url.value, '_blank')
}
</script>

<style scoped>
.fp-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-right: 28px; /* 给右上角关闭按钮留位 */
  min-width: 0;
}
.fp-title {
  font-size: 16px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fp-size { color: var(--text-light, #909399); font-size: 12px; }
.fp-fs-btn { margin-left: auto; flex-shrink: 0; }

.preview-body { height: 72vh; }
.preview-body.is-fullscreen { height: calc(100vh - 150px); }
.preview-frame { width: 100%; height: 100%; border: none; border-radius: 6px; }
.doc-frame { background: #fff; border: 1px solid var(--border, #e5e7eb); }

.image-wrap {
  height: 100%; display: flex; align-items: center; justify-content: center;
  background: var(--bg, #f5f5f5); overflow: auto; border-radius: 6px;
}
.preview-image { max-width: 100%; max-height: 100%; }

.media-wrap {
  height: 100%; display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  background: var(--bg, #f5f5f5); border-radius: 6px;
}
.media-video { max-width: 100%; max-height: 100%; border-radius: 8px; background: #000; }
.media-audio { width: min(520px, 90%); }

.text-preview {
  height: 100%; overflow: auto; margin: 0;
  padding: 16px 20px; background: #fff; border-radius: 6px;
  border: 1px solid var(--border, #e5e7eb);
  font-family: Consolas, Menlo, monospace; font-size: 13px; line-height: 1.7;
  white-space: pre-wrap; word-break: break-all;
}

.preview-status {
  height: 100%; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 16px;
  color: var(--text-light, #909399);
}
.no-preview p { margin: 0; }
</style>
