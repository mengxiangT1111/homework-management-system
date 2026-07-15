<template>
  <div class="page-container">
    <div class="page-title">发布新作业</div>

    <div class="card-section" style="max-width:800px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="120px">
        <el-form-item label="作业标题" prop="title">
          <el-input v-model="form.title" placeholder="如：第三次平时作业" maxlength="100" show-word-limit />
        </el-form-item>

        <el-form-item label="所属课程" prop="course_id">
          <el-select v-model="form.course_id" placeholder="选择课程" style="width:100%" filterable>
            <el-option v-for="c in courses" :key="c.id"
              :label="`${c.name}（${c.class?.name || ''}）`" :value="c.id" />
          </el-select>
        </el-form-item>

        <el-form-item label="截止时间" prop="deadline">
          <el-date-picker v-model="form.deadline" type="datetime" placeholder="选择截止时间"
            format="YYYY-MM-DD HH:mm" value-format="YYYY-MM-DD HH:mm:ss"
            :disabled-date="(d)=>d<new Date(Date.now()-86400000)" style="width:100%" />
        </el-form-item>

        <el-form-item label="允许格式">
          <el-select v-model="form.allowed_formats" multiple placeholder="留空则允许全部" style="width:100%">
            <el-option v-for="f in formatOptions" :key="f" :label="f" :value="f" />
          </el-select>
        </el-form-item>

        <el-form-item label="最大文件数">
          <el-input-number v-model="form.max_files" :min="1" :max="20" />
        </el-form-item>

        <el-form-item label="单文件上限">
          <el-input v-model="form.max_size_mb" placeholder="MB" style="width:120px">
            <template #append>MB</template>
          </el-input>
        </el-form-item>

        <el-form-item label="作业要求">
          <el-input v-model="form.description" type="textarea" :rows="4"
            placeholder="详细描述作业内容、提交要求等" maxlength="2000" show-word-limit />
        </el-form-item>

        <el-form-item label="提交样例">
          <div class="sample-section">
            <el-tabs v-model="activeSampleTab" type="border-card">
              <el-tab-pane label="图片样例" name="image">
                <div class="sample-upload-area">
                  <el-upload
                    action="#"
                    :auto-upload="false"
                    :show-file-list="false"
                    accept="image/*"
                    @change="(file) => handleSampleUpload(file, 'image')"
                  >
                    <div v-if="sampleImages.length === 0" class="upload-placeholder">
                      <el-icon size="32"><Plus /></el-icon>
                      <span>上传图片样例</span>
                      <span class="upload-tip">支持 JPG、PNG 格式</span>
                    </div>
                  </el-upload>
                  <div v-if="sampleImages.length > 0" class="sample-preview-grid">
                    <div v-for="(img, idx) in sampleImages" :key="idx" class="sample-item">
                      <img :src="img.url" alt="样例图片" />
                      <div class="sample-actions">
                        <el-button type="danger" size="small" circle @click="removeSample('image', idx)">
                          <el-icon><Delete /></el-icon>
                        </el-button>
                      </div>
                    </div>
                  </div>
                </div>
              </el-tab-pane>

              <el-tab-pane label="视频样例" name="video">
                <div class="sample-upload-area">
                  <el-upload
                    action="#"
                    :auto-upload="false"
                    :show-file-list="false"
                    accept="video/*"
                    @change="(file) => handleSampleUpload(file, 'video')"
                  >
                    <div v-if="sampleVideos.length === 0" class="upload-placeholder">
                      <el-icon size="32"><Plus /></el-icon>
                      <span>上传视频样例</span>
                      <span class="upload-tip">支持 MP4、AVI、MOV 格式，最大100MB</span>
                    </div>
                  </el-upload>
                  <div v-if="sampleVideos.length > 0" class="sample-video-list">
                    <div v-for="(vid, idx) in sampleVideos" :key="idx" class="video-item">
                      <video :src="vid.url" controls></video>
                      <el-button type="danger" size="small" @click="removeSample('video', idx)" style="margin-top:8px">
                        <el-icon><Delete /></el-icon> 删除
                      </el-button>
                    </div>
                  </div>
                </div>
              </el-tab-pane>

              <el-tab-pane label="文档样例" name="document">
                <div class="sample-upload-area">
                  <el-upload
                    action="#"
                    :auto-upload="false"
                    :show-file-list="false"
                    accept=".doc,.docx,.pdf"
                    @change="(file) => handleSampleUpload(file, 'document')"
                  >
                    <div v-if="sampleDocuments.length === 0" class="upload-placeholder">
                      <el-icon size="32"><Plus /></el-icon>
                      <span>上传文档样例</span>
                      <span class="upload-tip">支持 Word、PDF 格式</span>
                    </div>
                  </el-upload>
                  <div v-if="sampleDocuments.length > 0" class="sample-document-list">
                    <div v-for="(doc, idx) in sampleDocuments" :key="idx" class="document-item">
                      <el-icon><Document /></el-icon>
                      <span class="doc-name">{{ doc.name }}</span>
                      <el-button type="danger" size="small" @click="removeSample('document', idx)">
                        <el-icon><Delete /></el-icon>
                      </el-button>
                    </div>
                  </div>
                </div>
              </el-tab-pane>
            </el-tabs>
            <div class="sample-note">
              <el-icon><InfoFilled /></el-icon>
              <span>样例文件将随作业一同发布，帮助学生理解提交要求</span>
            </div>
          </div>
        </el-form-item>

        <el-form-item>
          <el-button type="primary" size="large" :loading="submitting" @click="submit">发布作业</el-button>
          <el-button size="large" @click="$router.back()">取消</el-button>
        </el-form-item>
      </el-form>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Plus, Delete, Document, InfoFilled } from '@element-plus/icons-vue'
import { courseApi, assignmentApi, uploadApi } from '@/api'
import { uploadFileChunked } from '@/utils/upload'

const router = useRouter()
const formRef = ref()
const submitting = ref(false)
const courses = ref([])

const formatOptions = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'jpg', 'jpeg', 'png', 'gif', 'zip', 'rar', 'txt']

const form = reactive({
  title: '',
  course_id: null,
  deadline: '',
  allowed_formats: ['pdf', 'doc', 'docx', 'jpg', 'png', 'zip'],
  max_files: 5,
  max_size_mb: 100,
  description: '',
  sample_files: []
})

const rules = {
  title: [{ required: true, message: '请输入作业标题', trigger: 'blur' }],
  course_id: [{ required: true, message: '请选择课程', trigger: 'change' }],
  deadline: [{ required: true, message: '请选择截止时间', trigger: 'change' }]
}

// 样例相关
const activeSampleTab = ref('image')
const sampleImages = ref([])
const sampleVideos = ref([])
const sampleDocuments = ref([])

function handleSampleUpload(file, type) {
  const maxSize = type === 'video' ? 100 : 20
  if (file.raw.size > maxSize * 1024 * 1024) {
    ElMessage.warning(`${type === 'video' ? '视频' : '文件'}大小不能超过 ${maxSize}MB`)
    return
  }
  const url = URL.createObjectURL(file.raw)
  if (type === 'image') {
    sampleImages.value.push({ url, file: file.raw, name: file.name })
  } else if (type === 'video') {
    sampleVideos.value.push({ url, file: file.raw, name: file.name })
  } else if (type === 'document') {
    sampleDocuments.value.push({ url, file: file.raw, name: file.name })
  }
  ElMessage.success(`已添加样例文件：${file.name}`)
}

function removeSample(type, idx) {
  if (type === 'image') sampleImages.value.splice(idx, 1)
  else if (type === 'video') sampleVideos.value.splice(idx, 1)
  else if (type === 'document') sampleDocuments.value.splice(idx, 1)
}

async function loadCourses() {
  const res = await courseApi.myTeaching()
  courses.value = res.data
}

async function submit() {
  await formRef.value.validate(async (valid) => {
    if (!valid) return
    submitting.value = true
    try {
      // 先上传样例文件到服务器，获取真实URL
      const allSamples = [
        ...sampleImages.value,
        ...sampleVideos.value,
        ...sampleDocuments.value
      ]
      const uploadedSamples = []
      for (const s of allSamples) {
        try {
          const result = await uploadFileChunked(s.file, (p) => {})
          uploadedSamples.push({
            name: s.name,
            type: s.file.type,
            url: '/' + result.file_path
          })
        } catch (e) {
          ElMessage.warning(`样例文件 ${s.name} 上传失败，已跳过`)
        }
      }
      form.sample_files = uploadedSamples
      await assignmentApi.create(form)
      ElMessage.success('作业发布成功')
      router.push('/teacher/assignments')
    } catch (e) {
    } finally {
      submitting.value = false
    }
  })
}

onMounted(loadCourses)
</script>

<style scoped>
.sample-section {
  width: 100%;
}

.sample-upload-area {
  min-height: 120px;
  padding: 12px;
}

.upload-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 120px;
  border: 2px dashed #d9d9d9;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s;
  color: #8c939d;
}

.upload-placeholder:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.upload-placeholder span {
  margin-top: 8px;
  font-size: 14px;
}

.upload-tip {
  font-size: 12px;
  color: #c0c4cc;
}

.sample-preview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 12px;
  margin-top: 12px;
}

.sample-item {
  position: relative;
  border-radius: 8px;
  overflow: hidden;
  aspect-ratio: 1;
  background: #f5f7fa;
}

.sample-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.sample-actions {
  position: absolute;
  top: 4px;
  right: 4px;
}

.sample-video-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 12px;
}

.video-item video {
  max-width: 100%;
  max-height: 200px;
  border-radius: 8px;
  background: #000;
}

.sample-document-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}

.document-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: #f5f7fa;
  border-radius: 8px;
}

.doc-name {
  flex: 1;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sample-note {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  padding: 8px 12px;
  background: #f0f9eb;
  border-radius: 4px;
  font-size: 13px;
  color: var(--primary);
}

@media (max-width: 768px) {
  .sample-preview-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>