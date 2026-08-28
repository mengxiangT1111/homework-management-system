<template>
  <div class="page-container">
    <div class="page-title">作业提交</div>

    <div v-if="assignment" class="card-section">
      <h2 style="margin-bottom:12px">{{ assignment.title }}</h2>
      <div class="info-row">
        <span><el-icon><Reading /></el-icon>课程：{{ assignment.course?.name }}</span>
        <span><el-icon><School /></el-icon>班级：{{ assignment.course?.class?.name }}</span>
        <span :class="{ overdue: assignment.is_overdue }">
          <el-icon><Clock /></el-icon>截止：{{ formatTime(assignment.deadline) }}
        </span>
      </div>
      <div v-if="assignment.description" class="desc-box">
        <strong>作业要求：</strong>{{ assignment.description }}
      </div>

      <!-- 提交样例区域 -->
      <div v-if="assignment.sample_files && assignment.sample_files.length > 0" class="sample-section">
        <strong class="sample-title"><el-icon><Paperclip /></el-icon>提交样例：</strong>
        <div class="sample-list">
          <div v-for="(s, idx) in assignment.sample_files" :key="idx" class="sample-file-item">
            <!-- 图片：点击放大在线预览（支持多图切换/缩放） -->
            <template v-if="isImageSample(s)">
              <el-image
                :src="sampleUrl(s.url)" :alt="s.name" fit="cover" class="sample-image"
                :preview-src-list="imageSampleUrls" :initial-index="imageSampleIndex(idx)"
                preview-teleported :hide-on-click-modal="true"
              />
              <span class="sample-label">{{ s.name }}</span>
            </template>
            <!-- 视频：内嵌在线播放 -->
            <template v-else-if="isVideoSample(s)">
              <video :src="sampleUrl(s.url)" controls class="sample-video"></video>
              <span class="sample-label">{{ s.name }}</span>
            </template>
            <!-- 文档：点击弹窗预览（PDF 内嵌显示） -->
            <template v-else>
              <a href="javascript:void(0)" class="sample-link" @click="previewSample(s)">
                <el-icon :size="24"><Document /></el-icon> {{ s.name }}
              </a>
            </template>
          </div>
        </div>
      </div>

      <div class="format-box">
        允许格式：<el-tag v-for="f in (assignment.allowed_formats||[])" :key="f" size="small" effect="plain" style="margin-right:4px">{{ f }}</el-tag>
        ｜ 最多 {{ assignment.max_files }} 个文件
        ｜ <el-tag v-if="!assignment.need_grading" type="success" size="small" effect="plain">提交即通过</el-tag>
        <el-tag v-else type="warning" size="small" effect="plain">需批改</el-tag>
      </div>
    </div>

    <!-- 已提交记录 -->
    <div v-if="mySubmission" class="card-section">
      <h3 style="margin-bottom:16px"><el-icon><Select /></el-icon>你的提交记录</h3>
      <el-alert v-if="mySubmission.score !== null" :title="`本次作业得分：${mySubmission.score} 分`" type="success" :closable="false" style="margin-bottom:16px" />
      <div v-if="mySubmission.comment" class="comment-box">
        <strong>老师评语：</strong>{{ mySubmission.comment }}
      </div>
      <div class="submitted-files">
        <div class="files-title">已提交文件：</div>
        <div v-for="f in mySubmission.files" :key="f.id" class="sub-file">
          <el-icon><Document /></el-icon>
          <span class="file-name">{{ f.original_name }}</span>
          <span class="file-size">{{ formatSize(f.file_size) }}</span>
          <el-tag v-if="f.is_cleaned" type="info" size="small">文件已过期清理</el-tag>
          <template v-else>
            <el-button link type="primary" @click="previewFile(f)">预览</el-button>
            <el-button link type="primary" @click="downloadF(f)">下载</el-button>
          </template>
        </div>
      </div>
    </div>

    <!-- 逾期提示 -->
    <div v-if="assignment?.is_overdue && !mySubmission" class="card-section">
      <el-result icon="warning" title="作业已逾期" sub-title="该作业已超过截止时间，无法提交">
      </el-result>
    </div>

    <!-- 提交区 -->
    <div v-if="assignment && !assignment.is_overdue" class="card-section">
      <h3 style="margin-bottom:16px">{{ mySubmission ? '重新提交作业' : '上传作业文件' }}</h3>
      <el-input v-model="remark" type="textarea" :rows="2" placeholder="提交备注（选填）" style="margin-bottom:16px" />
      <FileUploader
        ref="uploaderRef"
        :allowed-formats="assignment.allowed_formats"
        :max-files="assignment.max_files"
        :max-size-mb="assignment.max_size_mb || 100"
        @uploaded="onUploaded"
      />
      <el-button type="primary" size="large" :loading="submitting" :disabled="uploadedFiles.length === 0"
        style="margin-top:20px" @click="doSubmit">
        {{ mySubmission ? '确认重新提交' : '确认提交作业' }}
      </el-button>
    </div>

    <!-- 预览组件 -->
    <FilePreview v-model="previewVisible" :file-path="previewPath" :file-name="previewName" />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Reading, School, Clock, Document } from '@element-plus/icons-vue'
import FileUploader from '@/components/FileUploader.vue'
import FilePreview from '@/components/FilePreview.vue'
import { assignmentApi, submissionApi, downloadFile } from '@/api'

const route = useRoute()
const assignment = ref(null)
const mySubmission = ref(null)
const remark = ref('')
const uploadedFiles = ref([])
const submitting = ref(false)
const previewVisible = ref(false)
const previewPath = ref('')
const previewName = ref('')
const uploaderRef = ref(null)

function formatTime(t) { return new Date(t).toLocaleString('zh-CN') }
function formatSize(b) {
  if (b < 1024) return b + ' B'
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB'
  return (b / 1048576).toFixed(2) + ' MB'
}

// 样例文件 URL 解析（兼容 cos:// 与本地路径）
import { fileUrl as resolveFileUrl, isCOS } from '@/utils/fileUrl'
import { computed } from 'vue'

function sampleUrl(url) {
  return resolveFileUrl(url)
}

// 样例类型判断：优先 MIME，扩展名兜底（历史数据可能缺 type）
function sampleExt(s) { return String(s.url || s.name || '').split('.').pop().toLowerCase() }
function isImageSample(s) {
  return (s.type && s.type.startsWith('image/')) || ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(sampleExt(s))
}
function isVideoSample(s) {
  return (s.type && s.type.startsWith('video/')) || ['mp4', 'webm', 'ogg'].includes(sampleExt(s))
}

// 图片灯箱预览列表与起始索引
const imageSampleUrls = computed(() =>
  (assignment.value.sample_files || []).filter(isImageSample).map(s => sampleUrl(s.url))
)
function imageSampleIndex(idx) {
  const files = assignment.value.sample_files || []
  return files.slice(0, idx + 1).filter(isImageSample).length - 1
}

async function loadData() {
  const res = await assignmentApi.get(route.params.id)
  assignment.value = res.data
  if (res.data.my_submission) {
    mySubmission.value = res.data.my_submission
  }
}

function onUploaded(files) {
  uploadedFiles.value = files
  ElMessage.success('文件上传完成，请点击"确认提交"')
}

async function doSubmit() {
  if (uploadedFiles.value.length === 0) {
    ElMessage.warning('请先上传文件'); return
  }
  submitting.value = true
  try {
    const res = await submissionApi.submit(route.params.id, {
      files: uploadedFiles.value,
      remark: remark.value
    })
    ElMessage.success('作业提交成功！')
    uploadedFiles.value = []
    remark.value = ''
    // 同步清空上传组件的文件列表，否则旧文件残留会混入下次"开始上传"的结果
    uploaderRef.value && uploaderRef.value.clearAll()
    mySubmission.value = res.data
    await loadData()
  } catch (e) {} finally { submitting.value = false }
}

function previewFile(f) {
  previewPath.value = f.file_path
  previewName.value = f.original_name
  previewVisible.value = true
}

function downloadF(f) {
  if (isCOS(f.file_path)) {
    window.open(resolveFileUrl(f.file_path), '_blank')
  } else {
    downloadFile('/' + f.file_path, f.original_name)
  }
}

function previewSample(s) {
  previewPath.value = s.url
  previewName.value = s.name || '样例文件'
  previewVisible.value = true
}

onMounted(loadData)
</script>

<style scoped>
.info-row { display: flex; gap: 20px; flex-wrap: wrap; color: var(--text-light); font-size: 13px; margin-bottom: 12px; }
.info-row span { display: flex; align-items: center; gap: 4px; }
.overdue { color: var(--danger); font-weight: 600; }
.desc-box { background: var(--bg); padding: 12px; border-radius: 8px; margin: 12px 0; line-height: 1.8; font-size: 14px; }
.format-box { font-size: 13px; color: var(--text-light); margin-top: 8px; }
.comment-box { background: var(--brand-50); padding: 12px; border-radius: 8px; border-left: 4px solid var(--primary); margin-bottom: 16px; line-height: 1.8; }
.submitted-files { margin-top: 8px; }
.files-title { font-weight: 500; margin-bottom: 8px; }
.sub-file { display: flex; align-items: center; gap: 10px; padding: 8px; background: var(--bg); border-radius: 6px; margin-bottom: 6px; font-size: 13px; }
.sub-file .file-name { flex: 1; }
.sub-file .file-size { color: var(--text-light); }
.sample-section {
  background: var(--ink-50);
  padding: 16px;
  border-radius: 8px;
  margin: 12px 0;
}
.sample-title { display: inline-flex; align-items: center; gap: 4px; }
.sample-title .el-icon { color: var(--brand-600); vertical-align: -3px; }
.sample-list {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 10px;
}
.sample-file-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px;
  background: white;
  border-radius: 8px;
  border: 1px solid var(--border);
  max-width: 200px;
}
.sample-image {
  width: 180px;
  height: 120px;
  border-radius: 4px;
  object-fit: cover;
  cursor: pointer;
}
.sample-video {
  width: 180px;
  max-height: 120px;
  border-radius: 4px;
}
.sample-label {
  font-size: 12px;
  color: var(--text-light);
  text-align: center;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sample-link {
  color: var(--primary);
  font-size: 13px;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
}
.sample-link:hover {
  text-decoration: underline;
}
</style>