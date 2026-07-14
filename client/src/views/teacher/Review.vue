<template>
  <div class="page-container">
    <div class="page-title">
      <el-button link @click="$router.back()"><el-icon><ArrowLeft /></el-icon>返回</el-button>
      作业批阅
    </div>

    <!-- 作业信息 -->
    <div v-if="data" class="card-section">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
        <div>
          <h2>{{ data.assignment.title }}</h2>
          <div class="info-row">
            <span>班级：{{ classInfo }}</span>
            <span>截止：{{ formatTime(data.assignment.deadline) }}</span>
            <span>总人数：{{ data.total_students }}</span>
            <span>已交：{{ data.submitted_count }}</span>
            <span style="color:var(--danger)">未交：{{ data.unsubmitted_count }}</span>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <el-button type="success" @click="downloadAll" :disabled="data.submitted_count === 0">打包下载</el-button>
          <el-button type="warning" @click="exportExcel">导出未交名单</el-button>
          <el-button type="primary" plain @click="remindUnsubmitted" :disabled="data.unsubmitted_count === 0">催交</el-button>
        </div>
      </div>
    </div>

    <!-- 学生列表 -->
    <div class="card-section">
      <el-table :data="data?.students || []" stripe>
        <el-table-column label="学号" prop="username" width="120" />
        <el-table-column label="姓名" prop="real_name" width="100" />
        <el-table-column label="提交状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.submitted" type="success" size="small">已提交</el-tag>
            <el-tag v-else type="danger" size="small">未提交</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="提交时间" width="170">
          <template #default="{ row }">{{ row.submission ? formatTime(row.submission.submitted_at) : '—' }}</template>
        </el-table-column>
        <el-table-column label="文件数" width="80" align="center">
          <template #default="{ row }">{{ row.submission?.files?.length || 0 }}</template>
        </el-table-column>
        <el-table-column label="分数" width="80" align="center">
          <template #default="{ row }">
            <span v-if="row.submission?.score !== null && row.submission?.score !== undefined" class="score">{{ row.submission.score }}</span>
            <span v-else style="color:#ccc">—</span>
          </template>
        </el-table-column>
        <el-table-column label="评语" min-width="150">
          <template #default="{ row }">
            <span v-if="row.submission?.comment" class="comment-text">{{ row.submission.comment }}</span>
            <span v-else style="color:#ccc">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" align="center" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.submitted" link type="primary" @click="openGrade(row)">批阅</el-button>
            <span v-else style="color:var(--text-light)">—</span>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 批阅对话框 -->
    <el-dialog v-model="gradeVisible" title="批阅作业" width="700px" top="5vh">
      <div v-if="current" class="grade-content">
        <div class="grade-student">
          <strong>{{ current.real_name }}</strong>（{{ current.username }}）
          <span style="margin-left:12px;color:var(--text-light)">提交于 {{ current.submission && formatTime(current.submission.submitted_at) }}</span>
        </div>

        <!-- 文件列表 -->
        <div class="grade-files">
          <div class="files-title">提交的文件（{{ current.submission?.files?.length || 0 }}）：</div>
          <div v-for="f in (current.submission?.files || [])" :key="f.id" class="grade-file">
            <el-icon><Document /></el-icon>
            <span class="fname">{{ f.original_name }}</span>
            <el-button link type="primary" @click="previewFile(f)">预览</el-button>
            <el-button link type="primary" @click="downloadF(f)">下载</el-button>
          </div>
        </div>

        <el-divider />

        <!-- 打分 -->
        <el-form label-width="80px">
          <el-form-item label="分数">
            <el-input-number v-model="gradeForm.score" :min="0" :max="100" :precision="1" />
            <span style="margin-left:8px;color:var(--text-light)">/ 100</span>
          </el-form-item>
          <el-form-item label="评语">
            <el-input v-model="gradeForm.comment" type="textarea" :rows="4" placeholder="请输入评语" />
          </el-form-item>
          <el-form-item label="状态">
            <el-radio-group v-model="gradeForm.status">
              <el-radio value="graded">已评分</el-radio>
              <el-radio value="returned">退回重做</el-radio>
            </el-radio-group>
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button @click="gradeVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveGrade">保存批阅</el-button>
      </template>
    </el-dialog>

    <!-- 预览组件 -->
    <FilePreview v-model="previewVisible" :file-path="previewPath" :file-name="previewName" />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Document } from '@element-plus/icons-vue'
import FilePreview from '@/components/FilePreview.vue'
import { assignmentApi, submissionApi, downloadFile } from '@/api'

const route = useRoute()
const data = ref(null)
const gradeVisible = ref(false)
const current = ref(null)
const saving = ref(false)
const gradeForm = reactive({ score: 0, comment: '', status: 'graded' })

const previewVisible = ref(false)
const previewPath = ref('')
const previewName = ref('')

const classInfo = computed(() => {
  return data.value?.students?.length ? `${data.value.assignment.title}` : ''
})

function formatTime(t) { return new Date(t).toLocaleString('zh-CN') }

async function loadData() {
  const res = await assignmentApi.submissions(route.params.id)
  data.value = res.data
}

function openGrade(row) {
  current.value = row
  gradeForm.score = row.submission?.score ?? 0
  gradeForm.comment = row.submission?.comment || ''
  gradeForm.status = row.submission?.status === 'returned' ? 'returned' : 'graded'
  gradeVisible.value = true
}

async function saveGrade() {
  saving.value = true
  try {
    await submissionApi.grade(current.value.submission.id, { ...gradeForm })
    ElMessage.success('批阅成功')
    gradeVisible.value = false
    loadData()
  } catch (e) {} finally { saving.value = false }
}

function previewFile(f) {
  previewPath.value = f.file_path
  previewName.value = f.original_name
  previewVisible.value = true
}

function downloadF(f) {
  downloadFile('/' + f.file_path, f.original_name)
}

function downloadAll() {
  downloadFile(submissionApi.downloadAll(route.params.id), '提交打包.zip')
}

function exportExcel() {
  downloadFile(submissionApi.exportExcel(route.params.id), '未交名单.xlsx')
}

async function remindUnsubmitted() {
  try {
    await ElMessageBox.confirm(`确定向 ${data.value.unsubmitted_count} 名未交学生发送催交通知？`, '催交提醒', { type: 'warning' })
    const res = await submissionApi.remind(route.params.id)
    ElMessage.success(res.message)
  } catch (e) {}
}

onMounted(loadData)
</script>

<style scoped>
.info-row { display: flex; gap: 16px; flex-wrap: wrap; font-size: 13px; color: var(--text-light); margin-top: 8px; }
.score { font-size: 16px; font-weight: 700; color: var(--primary); }
.comment-text { display: inline-block; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.grade-student { margin-bottom: 16px; }
.grade-files { background: var(--bg); padding: 12px; border-radius: 8px; }
.files-title { font-weight: 500; margin-bottom: 8px; font-size: 14px; }
.grade-file { display: flex; align-items: center; gap: 8px; padding: 6px 0; font-size: 13px; }
.grade-file .fname { flex: 1; }
</style>
