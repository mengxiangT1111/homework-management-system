<template>
  <div class="page-container">
    <div class="page-title">
      作业管理
      <el-button type="primary" style="margin-left:auto" @click="$router.push('/teacher/assignments/create')">
        <el-icon><Plus /></el-icon>发布作业
      </el-button>
    </div>

    <div class="card-section">
      <div class="table-toolbar">
        <div class="toolbar-filters">
          <el-input v-model="keyword" placeholder="搜索作业标题，回车搜索" clearable style="width:260px" @keyup.enter="search" @clear="search">
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
        </div>
        <span class="toolbar-meta">共 {{ total }} 个作业</span>
      </div>

      <div v-if="list.length === 0" class="empty-box">
        <el-icon :size="48"><Document /></el-icon>
        <p style="margin-top:12px">还没有发布作业</p>
      </div>

      <el-table v-else v-loading="loading" :data="list" stripe>
        <el-table-column label="作业标题" min-width="180">
          <template #default="{ row }">
            <div style="font-weight:500">{{ row.title }}</div>
          </template>
        </el-table-column>
        <el-table-column label="课程 / 班级" min-width="180">
          <template #default="{ row }">
            <div>{{ row.course?.name }}</div>
            <div style="font-size:12px;color:var(--text-light)">{{ row.course?.class?.name }}</div>
          </template>
        </el-table-column>
        <el-table-column label="截止时间" width="170">
          <template #default="{ row }">
            <span :style="{ color: row.is_overdue ? 'var(--danger)' : '' }">{{ formatTime(row.deadline) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="提交情况" width="120" align="center">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ row.submit_count || 0 }} 人提交</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="row.is_overdue ? 'info' : 'success'" size="small">
              {{ row.is_overdue ? '已截止' : '进行中' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="210" align="center" fixed="right">
          <template #default="{ row }">
            <div class="op-row">
              <el-button link type="primary" @click="$router.push(`/teacher/assignments/${row.id}/review`)">批阅</el-button>
              <el-button link type="success" @click="downloadAll(row)">打包下载</el-button>
              <el-dropdown trigger="click" @command="(cmd) => rowCommand(cmd, row)">
                <el-button link type="primary" class="more-btn">
                  更多<el-icon><ArrowDown /></el-icon>
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="export">导出未交名单</el-dropdown-item>
                    <el-dropdown-item command="edit">编辑</el-dropdown-item>
                    <el-dropdown-item v-if="row.submit_count === 0" command="delete" divided>
                      <span style="color:var(--color-danger)">删除</span>
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-if="total > 0" background layout="prev, pager, next, total"
        :total="total" :page-size="pageSize" :current-page="page"
        class="table-footer"
        @current-change="handlePage"
      />
    </div>

    <!-- 编辑作业对话框 -->
    <el-dialog v-model="editVisible" title="修改作业" width="720px" top="5vh">
      <el-form :model="editForm" label-width="110px">
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
            <el-option v-for="f in formatOptions" :key="f" :label="f" :value="f" />
          </el-select>
        </el-form-item>
        <el-form-item label="最大文件数">
          <el-input-number v-model="editForm.max_files" :min="1" :max="20" />
        </el-form-item>
        <el-form-item label="单文件上限(MB)">
          <el-input-number v-model="editForm.max_size_mb" :min="1" :max="500" />
        </el-form-item>
        <el-form-item label="是否需要批改">
          <el-switch v-model="editForm.need_grading" active-text="需要批改" inactive-text="提交即通过" />
        </el-form-item>
        <el-form-item label="作业要求">
          <el-input v-model="editForm.description" type="textarea" :rows="4" maxlength="2000" show-word-limit />
        </el-form-item>
        <el-form-item label="提交样例">
          <div class="sample-section">
            <el-tabs v-model="editSampleTab" type="border-card">
              <el-tab-pane label="图片样例" name="image">
                <div class="sample-upload-area">
                  <el-upload action="#" :auto-upload="false" :show-file-list="false" accept="image/*" @change="(file) => handleEditSample(file, 'image')">
                    <div class="upload-placeholder">
                      <el-icon size="32"><Plus /></el-icon>
                      <span>上传图片样例</span>
                      <span class="upload-tip">支持 JPG、PNG 格式</span>
                    </div>
                  </el-upload>
                  <div v-if="existingImages.length || editSampleImages.length" class="sample-preview-grid">
                    <div v-for="s in existingImages" :key="'e-' + s.url" class="sample-item">
                      <img :src="fileUrl(s.url)" alt="样例图片" />
                      <div class="sample-actions"><el-button type="danger" size="small" circle @click="removeExisting(s)"><el-icon><Delete /></el-icon></el-button></div>
                    </div>
                    <div v-for="(img, idx) in editSampleImages" :key="'n-' + idx" class="sample-item">
                      <img :src="img.url" alt="样例图片" />
                      <div class="sample-actions"><el-button type="danger" size="small" circle @click="removeEditSample('image', idx)"><el-icon><Delete /></el-icon></el-button></div>
                    </div>
                  </div>
                </div>
              </el-tab-pane>
              <el-tab-pane label="视频样例" name="video">
                <div class="sample-upload-area">
                  <el-upload action="#" :auto-upload="false" :show-file-list="false" accept="video/*" @change="(file) => handleEditSample(file, 'video')">
                    <div class="upload-placeholder">
                      <el-icon size="32"><Plus /></el-icon>
                      <span>上传视频样例</span>
                      <span class="upload-tip">支持 MP4、AVI、MOV 格式，最大 100MB</span>
                    </div>
                  </el-upload>
                  <div v-if="existingVideos.length || editSampleVideos.length" class="sample-video-list">
                    <div v-for="s in existingVideos" :key="'e-' + s.url" class="video-item">
                      <video :src="fileUrl(s.url)" controls></video>
                      <el-button type="danger" size="small" @click="removeExisting(s)"><el-icon><Delete /></el-icon> 删除</el-button>
                    </div>
                    <div v-for="(v, idx) in editSampleVideos" :key="'n-' + idx" class="video-item">
                      <video :src="v.url" controls></video>
                      <el-button type="danger" size="small" @click="removeEditSample('video', idx)"><el-icon><Delete /></el-icon> 删除</el-button>
                    </div>
                  </div>
                </div>
              </el-tab-pane>
              <el-tab-pane label="文档样例" name="document">
                <div class="sample-upload-area">
                  <el-upload action="#" :auto-upload="false" :show-file-list="false" accept=".doc,.docx,.pdf" @change="(file) => handleEditSample(file, 'document')">
                    <div class="upload-placeholder">
                      <el-icon size="32"><Plus /></el-icon>
                      <span>上传文档样例</span>
                      <span class="upload-tip">支持 Word、PDF 格式</span>
                    </div>
                  </el-upload>
                  <div v-if="existingDocs.length || editSampleDocs.length" class="sample-document-list">
                    <div v-for="s in existingDocs" :key="'e-' + s.url" class="document-item">
                      <el-icon><Document /></el-icon>
                      <span class="doc-name">{{ s.name }}</span>
                      <el-button type="danger" size="small" @click="removeExisting(s)"><el-icon><Delete /></el-icon></el-button>
                    </div>
                    <div v-for="(doc, idx) in editSampleDocs" :key="'n-' + idx" class="document-item">
                      <el-icon><Document /></el-icon>
                      <span class="doc-name">{{ doc.name }}</span>
                      <el-button type="danger" size="small" @click="removeEditSample('document', idx)"><el-icon><Delete /></el-icon></el-button>
                    </div>
                  </div>
                </div>
              </el-tab-pane>
            </el-tabs>
            <div class="sample-note">删除已有样例并保存后生效；新上传的样例在保存时才上传服务器</div>
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
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Search, Document, Delete, InfoFilled, ArrowDown } from '@element-plus/icons-vue'
import { assignmentApi, submissionApi, downloadFile } from '@/api'
import { uploadFileChunked } from '@/utils/upload'
import { toPickerValue } from '@/utils/format'
import { fileUrl } from '@/utils/fileUrl'

const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 10
const loading = ref(false)
const keyword = ref('')

const editVisible = ref(false)
const savingEdit = ref(false)
const editingId = ref(null)
const editForm = reactive({
  title: '', deadline: '', allowed_formats: ['pdf', 'doc', 'docx', 'jpg', 'png', 'zip'],
  max_files: 5, max_size_mb: 100, description: '', need_grading: false, sample_files: []
})
const editSampleImages = ref([])
const editSampleVideos = ref([])
const editSampleDocs = ref([])
const editSampleTab = ref('image')
const formatOptions = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'jpg', 'jpeg', 'png', 'gif', 'zip', 'rar', 'txt']

function formatTime(t) { return new Date(t).toLocaleString('zh-CN') }

async function loadData() {
  loading.value = true
  try {
    const res = await assignmentApi.list({ page: page.value, pageSize, keyword: keyword.value })
    list.value = res.data.list
    total.value = res.data.total
  } finally { loading.value = false }
}
function handlePage(p) { page.value = p; loadData() }

// 操作列"更多"下拉命令分发
function rowCommand(cmd, row) {
  if (cmd === 'export') exportExcel(row)
  else if (cmd === 'edit') openEdit(row)
  else if (cmd === 'delete') deleteAssignment(row)
}

// 搜索时重置到第一页，避免停留在超出结果页数的空页
function search() { page.value = 1; loadData() }

function openEdit(row) {
  editingId.value = row.id
  editForm.title = row.title
  // 后端返回 ISO 串，须转为 picker 的 value-format，否则回显为空
  editForm.deadline = toPickerValue(row.deadline)
  editForm.allowed_formats = row.allowed_formats || ['pdf', 'doc', 'docx', 'jpg', 'png', 'zip']
  editForm.max_files = row.max_files || 5
  editForm.max_size_mb = row.max_size_mb || 100
  editForm.description = row.description || ''
  editForm.need_grading = !!row.need_grading
  editForm.sample_files = row.sample_files || []
  editSampleImages.value = []
  editSampleDocs.value = []
  editVisible.value = true
}

function handleEditSample(file, type) {
  const maxSize = type === 'video' ? 100 : 20
  if (file.raw.size > maxSize * 1024 * 1024) { ElMessage.warning(`文件大小不能超过 ${maxSize}MB`); return }
  const url = URL.createObjectURL(file.raw)
  if (type === 'image') editSampleImages.value.push({ url, file: file.raw, name: file.name })
  else if (type === 'video') editSampleVideos.value.push({ url, file: file.raw, name: file.name })
  else if (type === 'document') editSampleDocs.value.push({ url, file: file.raw, name: file.name })
  ElMessage.success(`已添加样例文件：${file.name}`)
}

function removeEditSample(type, idx) {
  if (type === 'image') editSampleImages.value.splice(idx, 1)
  else if (type === 'video') editSampleVideos.value.splice(idx, 1)
  else if (type === 'document') editSampleDocs.value.splice(idx, 1)
}

// 已保存样例按类型分组（type 为创建时记录的 MIME，空缺时按扩展名兜底）
function sampleKind(s) {
  const t = (s.type || '').toLowerCase()
  const n = (s.name || '').toLowerCase()
  if (t.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/.test(n)) return 'image'
  if (t.startsWith('video/') || /\.(mp4|avi|mov|mkv|webm)$/.test(n)) return 'video'
  return 'document'
}
const existingImages = computed(() => editForm.sample_files.filter(s => sampleKind(s) === 'image'))
const existingVideos = computed(() => editForm.sample_files.filter(s => sampleKind(s) === 'video'))
const existingDocs = computed(() => editForm.sample_files.filter(s => sampleKind(s) === 'document'))

// 移除已保存样例（点保存后才真正生效）
function removeExisting(s) {
  editForm.sample_files = editForm.sample_files.filter(x => x !== s)
}

async function saveEdit() {
  if (!editForm.title || !editForm.deadline) {
    ElMessage.warning('请填写完整'); return
  }
  savingEdit.value = true
  try {
      // 上传新加的样例文件
      const allNew = [...editSampleImages.value, ...editSampleVideos.value, ...editSampleDocs.value]
    const uploadedSamples = []
    for (const s of allNew) {
      try {
        const result = await uploadFileChunked(s.file, (p) => {})
        uploadedSamples.push({ name: s.name, type: s.file.type, url: result.file_path })
      } catch (e) { ElMessage.warning(`样例文件 ${s.name} 上传失败`) }
    }
    editForm.sample_files = [...(editForm.sample_files || []), ...uploadedSamples]
    await assignmentApi.update(editingId.value, editForm)
    ElMessage.success('修改成功')
    editVisible.value = false
    loadData()
  } catch (e) {} finally { savingEdit.value = false }
}

function downloadAll(row) {
  if (!row.submit_count) { ElMessage.warning('暂无提交，无法下载'); return }
  downloadFile(submissionApi.downloadAll(row.id), `${row.title}_提交.zip`)
}

function exportExcel(row) {
  downloadFile(submissionApi.exportExcel(row.id), `${row.title}_未交名单.xlsx`)
}

async function deleteAssignment(row) {
  try {
    await ElMessageBox.confirm(`确定删除作业「${row.title}」？删除后不可恢复。`, '删除确认', { type: 'warning' })
    await assignmentApi.remove(row.id)
    ElMessage.success('已删除')
    // 删除的是当前页最后一条时回退一页，避免停留在空页
    if (list.value.length === 1 && page.value > 1) page.value -= 1
    loadData()
  } catch (e) {}
}

onMounted(loadData)
</script>

<style scoped>
/* 操作列：flex 居中对齐，消除 el-dropdown 触发器与相邻按钮的行内基线错位 */
.op-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.op-row :deep(.el-button + .el-button),
.op-row :deep(.el-button + .el-dropdown) {
  margin-left: 0;
}
.more-btn :deep(.el-icon) {
  margin-left: 2px;
}

/* ===== 编辑弹窗：提交样例区（与 CreateAssignment 保持一致） ===== */
.upload-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 120px;
  border: 2px dashed var(--ink-300);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
  color: var(--text-light);
  background: var(--ink-50);
}
.upload-placeholder:hover {
  border-color: var(--brand-400);
  color: var(--brand-600);
}
.upload-placeholder span {
  margin-top: 8px;
  font-size: 14px;
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
  background: var(--ink-100);
  border: 1px solid var(--ink-100);
}
.sample-item img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.sample-actions {
  position: absolute;
  top: 4px;
  right: 4px;
}
.sample-document-list {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.document-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--ink-100);
  border-radius: 8px;
  background: var(--ink-50);
  font-size: 13px;
}
.document-item .doc-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sample-section { width: 100%; }
.sample-upload-area { min-height: 120px; }
.upload-tip { margin-top: 4px; font-size: 12px; color: var(--ink-500); }
.sample-note {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-light);
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
</style>
