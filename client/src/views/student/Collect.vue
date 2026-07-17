<template>
  <div class="page-container">
    <div class="page-title">作业收集（班级负责人）</div>

    <el-alert v-if="positions.length > 0" type="success" :closable="false" style="margin-bottom:20px">
      你是
      <span v-for="(p, i) in positions" :key="i">
        <strong>{{ p.class?.name }}</strong> 的 <strong>{{ p.position_text }}</strong><span v-if="i < positions.length - 1">、</span>
      </span>
      ，可在此查看本班作业提交情况并催交未交同学。
    </el-alert>

    <!-- 切换班级 -->
    <div class="card-section" v-if="positions.length > 1">
      <el-radio-group v-model="currentClassId" @change="loadData">
        <el-radio-button v-for="p in positions" :key="p.class_id" :value="p.class_id">
          {{ p.class?.name }}（{{ p.position_text }}）
        </el-radio-button>
      </el-radio-group>
    </div>

    <div v-if="positions.length === 0" class="card-section">
      <el-empty description="你目前不是班级负责人，无法使用此功能" />
    </div>

    <!-- 作业提交进度 -->
    <div v-else class="card-section">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h3 style="margin:0">📊 作业提交进度</h3>
        <el-button type="primary" @click="openCreateDialog">
          <el-icon><Plus /></el-icon> 发布作业
        </el-button>
      </div>
      <div v-if="assignments.length === 0" class="empty-box">
        <el-icon :size="48"><Document /></el-icon>
        <p style="margin-top:12px">本班暂无作业</p>
      </div>

      <div v-for="a in assignments" :key="a.id" class="collect-item">
        <div class="collect-main">
          <div class="collect-title">
            {{ a.title }}
            <el-tag v-if="a.is_overdue" type="info" size="small">已截止</el-tag>
            <el-tag v-else type="success" size="small">进行中</el-tag>
            <span class="collect-course">{{ a.course_name }}</span>
          </div>
          <div class="collect-meta">
            <span><el-icon><Clock /></el-icon>截止：{{ formatTime(a.deadline) }}</span>
            <span>已交：<strong style="color:var(--primary)">{{ a.submitted_count }}</strong>/{{ a.total_students }}</span>
            <span style="color:var(--danger)">未交：{{ a.unsubmitted_count }}</span>
          </div>
          <el-progress :percentage="a.submit_rate" :color="rateColor(a.submit_rate)" :stroke-width="8" style="margin-top:8px" />
        </div>
        <div class="collect-actions">
          <el-button type="primary" size="small" @click="viewUnsubmitted(a)">未交名单</el-button>
          <el-button type="warning" size="small" :disabled="a.unsubmitted_count === 0" @click="remind(a)">催交</el-button>
          <el-button type="success" size="small" :disabled="a.submitted_count === 0" @click="downloadAll(a)">打包下载</el-button>
          <el-button type="primary" size="small" @click="openEdit(a)">编辑</el-button>
          <el-button type="danger" size="small" :disabled="a.submitted_count > 0" @click="deleteAssignment(a)">删除</el-button>
        </div>
      </div>
    </div>

    <!-- 未交名单对话框 -->
    <el-dialog v-model="unsubVisible" :title="`未交名单 - ${currentAssignment?.title}`" width="600px">
      <div v-if="unsubData">
        <el-alert type="warning" :closable="false" style="margin-bottom:16px">
          共 {{ unsubData.total_students }} 人，已交 {{ unsubData.submitted_count }} 人，未交 <strong>{{ unsubData.unsubmitted_count }}</strong> 人
        </el-alert>
        <el-table :data="unsubData.list" stripe size="small" max-height="360">
          <el-table-column type="index" label="#" width="50" />
          <el-table-column label="学号" prop="username" width="120" />
          <el-table-column label="姓名" prop="real_name" width="100" />
          <el-table-column label="职务" width="80">
            <template #default="{ row }">
              <el-tag v-if="row.position === 'monitor'" size="small" type="warning">班长</el-tag>
              <el-tag v-else-if="row.position === 'commissary'" size="small" type="success">学委</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="邮箱" prop="email" />
        </el-table>
        <div style="margin-top:16px;text-align:right">
          <el-button type="warning" :loading="reminding" :disabled="unsubData.unsubmitted_count === 0" @click="remind(currentAssignment)">
            一键催交全部
          </el-button>
        </div>
      </div>
    </el-dialog>

    <!-- 发布作业对话框 -->
    <el-dialog v-model="createVisible" title="发布作业" width="560px">
      <el-form :model="createForm" label-width="100px">
        <el-form-item label="作业标题" required>
          <el-input v-model="createForm.title" placeholder="如：第三次平时作业" />
        </el-form-item>
        <el-form-item label="所属课程" required>
          <el-select v-model="createForm.course_id" placeholder="选择课程" style="width:100%">
            <el-option v-for="c in classCourses" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="截止时间" required>
          <el-date-picker v-model="createForm.deadline" type="datetime" placeholder="选择截止时间"
            format="YYYY-MM-DD HH:mm" value-format="YYYY-MM-DD HH:mm:ss"
            :disabled-date="(d) => d < new Date(Date.now() - 86400000)" style="width:100%" />
        </el-form-item>
        <el-form-item label="允许格式">
          <el-select v-model="createForm.allowed_formats" multiple style="width:100%">
            <el-option label="PDF" value="pdf" />
            <el-option label="Word" value="docx" />
            <el-option label="图片" value="jpg" />
            <el-option label="压缩包" value="zip" />
          </el-select>
        </el-form-item>
        <el-form-item label="作业要求">
          <el-input v-model="createForm.description" type="textarea" :rows="3" placeholder="作业要求说明" />
        </el-form-item>
        <el-form-item label="是否需要批改">
          <el-switch
            v-model="createForm.need_grading"
            active-text="需要批改"
            inactive-text="不需要批改（提交即通过）"
          />
        </el-form-item>
        <el-form-item label="提交样例">
          <div class="sample-section">
            <el-tabs v-model="activeSampleTab" type="border-card">
              <el-tab-pane label="图片样例" name="image">
                <div class="sample-upload-area">
                  <el-upload action="#" :auto-upload="false" :show-file-list="false" accept="image/*" @change="(file) => handleSampleUpload(file, 'image')">
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
                        <el-button type="danger" size="small" circle @click="removeSample('image', idx)"><el-icon><Delete /></el-icon></el-button>
                      </div>
                    </div>
                  </div>
                </div>
              </el-tab-pane>
              <el-tab-pane label="视频样例" name="video">
                <div class="sample-upload-area">
                  <el-upload action="#" :auto-upload="false" :show-file-list="false" accept="video/*" @change="(file) => handleSampleUpload(file, 'video')">
                    <div v-if="sampleVideos.length === 0" class="upload-placeholder">
                      <el-icon size="32"><Plus /></el-icon>
                      <span>上传视频样例</span>
                      <span class="upload-tip">支持 MP4 格式，最大100MB</span>
                    </div>
                  </el-upload>
                  <div v-if="sampleVideos.length > 0" class="sample-video-list">
                    <div v-for="(vid, idx) in sampleVideos" :key="idx" class="video-item">
                      <video :src="vid.url" controls></video>
                      <el-button type="danger" size="small" @click="removeSample('video', idx)"><el-icon><Delete /></el-icon> 删除</el-button>
                    </div>
                  </div>
                </div>
              </el-tab-pane>
              <el-tab-pane label="文档样例" name="document">
                <div class="sample-upload-area">
                  <el-upload action="#" :auto-upload="false" :show-file-list="false" accept=".doc,.docx,.pdf" @change="(file) => handleSampleUpload(file, 'document')">
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
                      <el-button type="danger" size="small" @click="removeSample('document', idx)"><el-icon><Delete /></el-icon></el-button>
                    </div>
                  </div>
                </div>
              </el-tab-pane>
            </el-tabs>
            <div class="sample-note"><el-icon><InfoFilled /></el-icon><span>样例文件将随作业一同发布</span></div>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="submitCreate">发布</el-button>
      </template>
    </el-dialog>

    <!-- 编辑作业对话框 -->
    <el-dialog v-model="editVisible" title="修改作业" width="560px" top="5vh">
      <el-form :model="editForm" label-width="100px">
        <el-form-item label="作业标题" required>
          <el-input v-model="editForm.title" maxlength="100" />
        </el-form-item>
        <el-form-item label="截止时间" required>
          <el-date-picker v-model="editForm.deadline" type="datetime" placeholder="选择截止时间"
            format="YYYY-MM-DD HH:mm" value-format="YYYY-MM-DD HH:mm:ss"
            :disabled-date="(d) => d < new Date(Date.now() - 86400000)" style="width:100%" />
        </el-form-item>
        <el-form-item label="允许格式">
          <el-select v-model="editForm.allowed_formats" multiple style="width:100%">
            <el-option label="PDF" value="pdf" />
            <el-option label="Word" value="docx" />
            <el-option label="图片" value="jpg" />
            <el-option label="压缩包" value="zip" />
          </el-select>
        </el-form-item>
        <el-form-item label="最大文件数">
          <el-input-number v-model="editForm.max_files" :min="1" :max="20" />
        </el-form-item>
        <el-form-item label="是否需要批改">
          <el-switch v-model="editForm.need_grading" active-text="需要批改" inactive-text="提交即通过" />
        </el-form-item>
        <el-form-item label="作业要求">
          <el-input v-model="editForm.description" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item label="提交样例">
          <div class="sample-section">
            <el-tabs v-model="editSampleTab" type="border-card">
              <el-tab-pane label="图片样例" name="image">
                <div class="sample-upload-area">
                  <el-upload action="#" :auto-upload="false" :show-file-list="false" accept="image/*" @change="(file) => handleEditSample(file, 'image')">
                    <div v-if="editSampleImages.length === 0" class="upload-placeholder">
                      <el-icon size="32"><Plus /></el-icon>
                      <span>上传图片样例</span>
                    </div>
                  </el-upload>
                  <div v-if="editSampleImages.length > 0" class="sample-preview-grid">
                    <div v-for="(img, idx) in editSampleImages" :key="idx" class="sample-item">
                      <img :src="img.url" alt="样例" />
                      <div class="sample-actions"><el-button type="danger" size="small" circle @click="removeEditSample('image', idx)"><el-icon><Delete /></el-icon></el-button></div>
                    </div>
                  </div>
                </div>
              </el-tab-pane>
              <el-tab-pane label="文档样例" name="document">
                <div class="sample-upload-area">
                  <el-upload action="#" :auto-upload="false" :show-file-list="false" accept=".doc,.docx,.pdf" @change="(file) => handleEditSample(file, 'document')">
                    <div v-if="editSampleDocs.length === 0" class="upload-placeholder">
                      <el-icon size="32"><Plus /></el-icon>
                      <span>上传文档样例</span>
                    </div>
                  </el-upload>
                  <div v-if="editSampleDocs.length > 0" class="sample-document-list">
                    <div v-for="(doc, idx) in editSampleDocs" :key="idx" class="document-item">
                      <el-icon><Document /></el-icon>
                      <span class="doc-name">{{ doc.name }}</span>
                      <el-button type="danger" size="small" @click="removeEditSample('document', idx)"><el-icon><Delete /></el-icon></el-button>
                    </div>
                  </div>
                </div>
              </el-tab-pane>
            </el-tabs>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="savingEdit" @click="saveEdit">保存修改</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Document, Clock, Plus, Delete, InfoFilled } from '@element-plus/icons-vue'
import { classApi, courseApi, downloadFile } from '@/api'
import { uploadFileChunked } from '@/utils/upload'

const positions = ref([])
const currentClassId = ref(null)
const assignments = ref([])
const unsubVisible = ref(false)
const currentAssignment = ref(null)
const unsubData = ref(null)
const reminding = ref(false)
const createVisible = ref(false)
const creating = ref(false)
const classCourses = ref([])
const createForm = reactive({
  title: '',
  course_id: null,
  deadline: '',
  allowed_formats: ['pdf', 'docx', 'jpg', 'zip'],
  description: '',
  sample_files: [],
  need_grading: false
})
const sampleImages = ref([])
const sampleVideos = ref([])
const sampleDocuments = ref([])
const activeSampleTab = ref('image')

function formatTime(t) { return new Date(t).toLocaleString('zh-CN') }
function rateColor(r) {
  if (r >= 80) return '#52c4a0'
  if (r >= 50) return '#e6a23c'
  return '#f56c6c'
}

async function loadPositions() {
  const res = await classApi.myPositions()
  positions.value = res.data
  if (res.data.length > 0) {
    currentClassId.value = res.data[0].class_id
    await loadData()
  }
}

async function loadData() {
  if (!currentClassId.value) return
  const res = await classApi.leaderAssignments(currentClassId.value)
  assignments.value = res.data.assignments
}

async function viewUnsubmitted(a) {
  currentAssignment.value = a
  const res = await classApi.leaderUnsubmitted(a.id, currentClassId.value)
  unsubData.value = res.data
  unsubVisible.value = true
}

async function remind(a) {
  try {
    await ElMessageBox.confirm(`确定向 ${a.unsubmitted_count} 名未交同学发送催交通知？`, '催交提醒', { type: 'warning' })
    reminding.value = true
    const res = await classApi.leaderRemind(a.id, currentClassId.value)
    ElMessage.success(res.message)
    loadData()
  } catch (e) {} finally { reminding.value = false }
}

async function openCreateDialog() {
  // 获取本班课程列表
  const res = await courseApi.list({ class_id: currentClassId.value, pageSize: 100 })
  classCourses.value = res.data.list
  createForm.title = ''
  createForm.course_id = null
  createForm.deadline = ''
  createForm.description = ''
  createForm.sample_files = []
  sampleImages.value = []
  sampleVideos.value = []
  sampleDocuments.value = []
  createVisible.value = true
}

function handleSampleUpload(file, type) {
  const maxSize = type === 'video' ? 100 : 20
  if (file.raw.size > maxSize * 1024 * 1024) {
    ElMessage.warning(`${type === 'video' ? '视频' : '文件'}大小不能超过 ${maxSize}MB`)
    return
  }
  const url = URL.createObjectURL(file.raw)
  if (type === 'image') sampleImages.value.push({ url, file: file.raw, name: file.name })
  else if (type === 'video') sampleVideos.value.push({ url, file: file.raw, name: file.name })
  else if (type === 'document') sampleDocuments.value.push({ url, file: file.raw, name: file.name })
  ElMessage.success(`已添加样例文件：${file.name}`)
}

function removeSample(type, idx) {
  if (type === 'image') sampleImages.value.splice(idx, 1)
  else if (type === 'video') sampleVideos.value.splice(idx, 1)
  else if (type === 'document') sampleDocuments.value.splice(idx, 1)
}

async function submitCreate() {
  if (!createForm.title || !createForm.course_id || !createForm.deadline) {
    ElMessage.warning('请填写完整')
    return
  }
  creating.value = true
  try {
    // 先上传样例文件
    const allSamples = [...sampleImages.value, ...sampleVideos.value, ...sampleDocuments.value]
    const uploadedSamples = []
    for (const s of allSamples) {
      try {
        const result = await uploadFileChunked(s.file, (p) => {})
        uploadedSamples.push({ name: s.name, type: s.file.type, url: '/' + result.file_path })
      } catch (e) {
        ElMessage.warning(`样例文件 ${s.name} 上传失败，已跳过`)
      }
    }
    createForm.sample_files = uploadedSamples
    await classApi.leaderCreateAssignment(currentClassId.value, createForm)
    ElMessage.success('作业发布成功')
    createVisible.value = false
    loadData()
  } catch (e) {} finally { creating.value = false }
}

async function deleteAssignment(a) {
  try {
    await ElMessageBox.confirm(`确定删除作业「${a.title}」？删除后不可恢复。`, '删除确认', { type: 'warning' })
    await classApi.leaderDeleteAssignment(currentClassId.value, a.id)
    ElMessage.success('已删除')
    loadData()
  } catch (e) {}
}

function downloadAll(a) {
  const url = classApi.leaderDownloadAll(currentClassId.value, a.id)
  downloadFile(url, `${a.title}_提交.zip`)
}

// 编辑作业
const editVisible = ref(false)
const savingEdit = ref(false)
const editingAssignment = ref(null)
const editForm = reactive({
  title: '', deadline: '', allowed_formats: ['pdf', 'docx', 'jpg', 'zip'],
  max_files: 5, max_size_mb: 100, description: '', need_grading: false
})
const editSampleImages = ref([])
const editSampleDocs = ref([])
const editSampleTab = ref('image')

function openEdit(a) {
  editingAssignment.value = a
  editForm.title = a.title
  editForm.deadline = a.deadline
  editForm.allowed_formats = a.allowed_formats || ['pdf', 'docx', 'jpg', 'zip']
  editForm.max_files = a.max_files || 5
  editForm.max_size_mb = a.max_size_mb || 100
  editForm.description = a.description || ''
  editForm.need_grading = !!a.need_grading
  editForm.sample_files = a.sample_files || []
  editSampleImages.value = []
  editSampleDocs.value = []
  editVisible.value = true
}

function handleEditSample(file, type) {
  if (file.raw.size > 20 * 1024 * 1024) { ElMessage.warning('文件大小不能超过 20MB'); return }
  const url = URL.createObjectURL(file.raw)
  if (type === 'image') editSampleImages.value.push({ url, file: file.raw, name: file.name })
  else if (type === 'document') editSampleDocs.value.push({ url, file: file.raw, name: file.name })
  ElMessage.success(`已添加样例文件：${file.name}`)
}

function removeEditSample(type, idx) {
  if (type === 'image') editSampleImages.value.splice(idx, 1)
  else if (type === 'document') editSampleDocs.value.splice(idx, 1)
}

async function saveEdit() {
  if (!editForm.title || !editForm.deadline) {
    ElMessage.warning('请填写完整'); return
  }
  savingEdit.value = true
  try {
    // 上传新加的样例文件
    const allNew = [...editSampleImages.value, ...editSampleDocs.value]
    const uploadedSamples = []
    for (const s of allNew) {
      try {
        const result = await uploadFileChunked(s.file, (p) => {})
        uploadedSamples.push({ name: s.name, type: s.file.type, url: '/' + result.file_path })
      } catch (e) { ElMessage.warning(`样例文件 ${s.name} 上传失败`) }
    }
    // 合并原有样例和新样例
    editForm.sample_files = [...(editForm.sample_files || []), ...uploadedSamples]
    await classApi.leaderUpdateAssignment(currentClassId.value, editingAssignment.value.id, editForm)
    ElMessage.success('修改成功')
    editVisible.value = false
    loadData()
  } catch (e) {} finally { savingEdit.value = false }
}

onMounted(loadPositions)
</script>

<style scoped>
.collect-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px; border-radius: 8px; background: var(--bg);
  margin-bottom: 12px; gap: 16px;
}
.collect-main { flex: 1; min-width: 0; }
.collect-title { font-size: 15px; font-weight: 500; margin-bottom: 8px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.collect-course { font-size: 12px; color: var(--text-light); font-weight: normal; }
.collect-meta { display: flex; gap: 16px; font-size: 12px; color: var(--text-light); flex-wrap: wrap; }
.collect-meta span { display: flex; align-items: center; gap: 4px; }
.collect-actions { display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; }
</style>
