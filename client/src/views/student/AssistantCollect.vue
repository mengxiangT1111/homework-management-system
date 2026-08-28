<template>
  <div class="page-container">
    <div class="page-title">课代表 · 作业收集</div>

    <el-alert v-if="courses.length > 0" type="success" :closable="false" style="margin-bottom:20px">
      你是
      <span v-for="(c, i) in courses" :key="c.course_id">
        <strong>{{ c.course?.name }}</strong>（{{ c.course?.class?.name }}）的课代表<span v-if="i < courses.length - 1">、</span>
      </span>
      ，可在此协助老师收发本课程作业。
    </el-alert>

    <!-- 切换课程 -->
    <div class="card-section" v-if="courses.length > 1">
      <el-radio-group v-model="currentCourseId" @change="loadData">
        <el-radio-button v-for="c in courses" :key="c.course_id" :value="c.course_id">
          {{ c.course?.name }}（{{ c.course?.class?.name }}）
        </el-radio-button>
      </el-radio-group>
    </div>

    <div v-if="courses.length === 0" class="card-section">
      <EmptyState type="empty" title="暂无权限" description="你目前不是任何课程的课代表" />
    </div>

    <!-- 作业提交进度 -->
    <div v-else class="card-section">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h3 style="margin:0"><el-icon><DataLine /></el-icon>作业提交进度</h3>
        <el-button type="primary" @click="openCreateDialog">
          <el-icon><Plus /></el-icon> 发布作业
        </el-button>
      </div>
      <div v-if="assignments.length === 0" class="empty-box">
        <el-icon :size="48"><Document /></el-icon>
        <p style="margin-top:12px">本课程暂无作业</p>
      </div>

      <div v-for="a in assignments" :key="a.id" class="collect-item">
        <div class="collect-main">
          <div class="collect-title">
            {{ a.title }}
            <el-tag v-if="a.is_overdue" type="info" size="small">已截止</el-tag>
            <el-tag v-else type="success" size="small">进行中</el-tag>
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
    <el-dialog v-model="unsubVisible" :title="`未交名单 - ${currentAssignment?.title || ''}`" width="600px">
      <div v-if="unsubData">
        <el-alert type="warning" :closable="false" style="margin-bottom:16px">
          共 {{ unsubData.total_students }} 人，已交 {{ unsubData.submitted_count }} 人，未交 <strong>{{ unsubData.unsubmitted_count }}</strong> 人
        </el-alert>
        <el-table :data="unsubData.list" stripe size="small" max-height="360">
          <el-table-column type="index" label="#" width="50" />
          <el-table-column label="学号" prop="username" width="120" />
          <el-table-column label="姓名" prop="real_name" width="100" />
          <el-table-column label="班级职务" width="90">
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
import { Document, Clock, Plus } from '@element-plus/icons-vue'
import { courseApi, downloadFile } from '@/api'
import { toPickerValue, rateColor } from '@/utils/format'

const courses = ref([])
const currentCourseId = ref(null)
const assignments = ref([])
const unsubVisible = ref(false)
const currentAssignment = ref(null)
const unsubData = ref(null)
const reminding = ref(false)

function formatTime(t) { return new Date(t).toLocaleString('zh-CN') }

async function loadCourses() {
  const res = await courseApi.myAssistantships()
  courses.value = res.data
  if (res.data.length > 0) {
    currentCourseId.value = res.data[0].course_id
    await loadData()
  }
}

// 请求序号守卫：快速切换课程时丢弃过期响应，避免显示与当前选中不符的数据
let loadDataSeq = 0
async function loadData() {
  if (!currentCourseId.value) return
  const seq = ++loadDataSeq
  const res = await courseApi.assistantAssignments(currentCourseId.value)
  if (seq !== loadDataSeq) return
  assignments.value = res.data.assignments
}

async function viewUnsubmitted(a) {
  currentAssignment.value = a
  const res = await courseApi.assistantUnsubmitted(a.id, currentCourseId.value)
  unsubData.value = res.data
  unsubVisible.value = true
}

async function remind(a) {
  try {
    await ElMessageBox.confirm(`确定向 ${a.unsubmitted_count} 名未交同学发送催交通知？`, '催交提醒', { type: 'warning' })
    reminding.value = true
    const res = await courseApi.assistantRemind(a.id, currentCourseId.value)
    ElMessage.success(res.message)
    loadData()
  } catch (e) {} finally { reminding.value = false }
}

function downloadAll(a) {
  const url = courseApi.assistantDownloadAll(a.id, currentCourseId.value)
  downloadFile(url, `${a.title}_提交.zip`)
}

async function deleteAssignment(a) {
  try {
    await ElMessageBox.confirm(`确定删除作业「${a.title}」？删除后不可恢复。`, '删除确认', { type: 'warning' })
    await courseApi.assistantDeleteAssignment(a.id, currentCourseId.value)
    ElMessage.success('已删除')
    loadData()
  } catch (e) {}
}

// 发布作业
const createVisible = ref(false)
const creating = ref(false)
const createForm = reactive({
  title: '',
  deadline: '',
  allowed_formats: ['pdf', 'docx', 'jpg', 'zip'],
  description: '',
  need_grading: false
})

function openCreateDialog() {
  createForm.title = ''
  createForm.deadline = ''
  createForm.description = ''
  createForm.need_grading = false
  createVisible.value = true
}

async function submitCreate() {
  if (!createForm.title || !createForm.deadline) {
    ElMessage.warning('请填写完整')
    return
  }
  creating.value = true
  try {
    await courseApi.assistantCreateAssignment({ course_id: currentCourseId.value, ...createForm })
    ElMessage.success('作业发布成功')
    createVisible.value = false
    loadData()
  } catch (e) {} finally { creating.value = false }
}

// 编辑作业
const editVisible = ref(false)
const savingEdit = ref(false)
const editingAssignment = ref(null)
const editForm = reactive({
  title: '', deadline: '', allowed_formats: ['pdf', 'docx', 'jpg', 'zip'],
  max_files: 5, max_size_mb: 100, description: '', need_grading: false
})

function openEdit(a) {
  editingAssignment.value = a
  editForm.title = a.title
  // 后端返回 ISO 串，须转为 picker 的 value-format，否则回显为空
  editForm.deadline = toPickerValue(a.deadline)
  editForm.allowed_formats = a.allowed_formats || ['pdf', 'docx', 'jpg', 'zip']
  editForm.max_files = a.max_files || 5
  editForm.max_size_mb = a.max_size_mb || 100
  editForm.description = a.description || ''
  editForm.need_grading = !!a.need_grading
  editVisible.value = true
}

async function saveEdit() {
  if (!editForm.title || !editForm.deadline) {
    ElMessage.warning('请填写完整'); return
  }
  savingEdit.value = true
  try {
    await courseApi.assistantUpdateAssignment(editingAssignment.value.id, { course_id: currentCourseId.value, ...editForm })
    ElMessage.success('修改成功')
    editVisible.value = false
    loadData()
  } catch (e) {} finally { savingEdit.value = false }
}

onMounted(loadCourses)
</script>

<style scoped>
.collect-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px; border-radius: 8px; background: var(--bg);
  margin-bottom: 12px; gap: 16px;
}
.collect-main { flex: 1; min-width: 0; }
.collect-title { font-size: 15px; font-weight: 500; margin-bottom: 8px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.collect-meta { display: flex; gap: 16px; font-size: 12px; color: var(--text-light); flex-wrap: wrap; }
.collect-meta span { display: flex; align-items: center; gap: 4px; }
.collect-actions { display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; }
</style>
