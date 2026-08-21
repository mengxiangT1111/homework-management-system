<template>
  <div class="page-container">
    <div class="page-title">
      我的课程
      <el-button type="primary" style="margin-left:auto" @click="openCreate">
        <el-icon><Plus /></el-icon>新增课程
      </el-button>
    </div>

    <div class="card-section">
      <div v-if="courses.length === 0" class="empty-box">
        <el-icon :size="48"><Reading /></el-icon>
        <p style="margin-top:12px">还没有任课课程</p>
        <p style="font-size:13px;color:var(--text-light);margin-top:4px">点击右上角"新增课程"创建，或联系管理员为你分配</p>
        <el-button type="primary" style="margin-top:16px" @click="openCreate">创建第一门课程</el-button>
      </div>

      <el-row :gutter="20">
        <el-col v-for="c in courses" :key="c.id" :xs="24" :sm="12" :md="8">
          <div class="course-card">
            <div class="course-icon">📖</div>
            <h3>{{ c.name }}</h3>
            <p class="course-meta">班级：{{ c.class?.name || '-' }}</p>
            <p class="course-meta">年级：{{ c.class?.grade || '-' }}</p>
            <p v-if="c.semester" class="course-meta">学期：{{ c.semester }}</p>
            <p v-if="c.description" class="course-desc">{{ c.description }}</p>
            <p v-if="c.assistants && c.assistants.length > 0" class="course-meta" style="margin-top:8px">
              课代表：<el-tag v-for="a in c.assistants" :key="a.id" size="small" type="warning" style="margin-right:4px">{{ a.real_name }}</el-tag>
            </p>
            <el-button type="primary" plain size="small" style="margin-top:12px" @click="openAssistants(c)">
              设置课代表
            </el-button>
          </div>
        </el-col>
      </el-row>
    </div>

    <!-- 新增课程对话框 -->
    <el-dialog v-model="createVisible" title="新增课程" width="520px">
      <el-form :model="createForm" label-width="90px">
        <el-form-item label="课程名称" required>
          <el-input v-model="createForm.name" placeholder="如：数据结构" maxlength="100" />
        </el-form-item>
        <el-form-item label="所属班级" required>
          <el-select v-model="createForm.class_id" placeholder="选择班级（本校）" filterable style="width:100%">
            <el-option v-for="c in classes" :key="c.id" :label="`${c.grade} - ${c.name}`" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="学期">
          <el-input v-model="createForm.semester" placeholder="如 2024-2025-1（选填）" />
        </el-form-item>
        <el-form-item label="课程描述">
          <el-input v-model="createForm.description" type="textarea" :rows="3" placeholder="课程简介（选填）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="submitCreate">创建</el-button>
      </template>
    </el-dialog>

    <!-- 课代表管理对话框 -->
    <el-dialog v-model="assistantVisible" :title="`课代表管理 - ${currentCourse?.name || ''}`" width="600px">
      <el-alert type="info" :closable="false" style="margin-bottom:16px">
        课代表可协助你收集本课程作业：查看提交进度、催交未交同学、打包下载提交文件、发布/编辑作业。
      </el-alert>
      <div v-if="assistants.length > 0" style="margin-bottom:16px">
        <h4 style="margin:0 0 8px">当前课代表</h4>
        <el-tag
          v-for="a in assistants" :key="a.id" closable type="warning" size="large"
          style="margin-right:8px;margin-bottom:8px" @close="removeAssistant(a)"
        >{{ a.real_name }}（{{ a.username }}）</el-tag>
      </div>
      <div v-else style="margin-bottom:16px;color:var(--text-light)">尚未设置课代表</div>
      <h4 style="margin:0 0 8px">从本班学生中设置</h4>
      <el-select v-model="selectedStudent" filterable placeholder="搜索并选择学生" style="width:100%">
        <el-option
          v-for="s in classStudents.filter(s => !assistants.some(a => a.id === s.id))"
          :key="s.id" :label="`${s.real_name}（${s.username}）`" :value="s.id"
        />
      </el-select>
      <template #footer>
        <el-button @click="assistantVisible = false">关闭</el-button>
        <el-button type="primary" :disabled="!selectedStudent" :loading="addingAssistant" @click="addAssistant">设为课代表</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Reading, Plus } from '@element-plus/icons-vue'
import { courseApi, classApi } from '@/api'

const courses = ref([])

async function loadData() {
  const res = await courseApi.myTeaching()
  courses.value = res.data
}

// 新增课程（教师自建，只能选本校班级、自任任课教师）
const createVisible = ref(false)
const creating = ref(false)
const classes = ref([])
const createForm = reactive({ name: '', class_id: null, semester: '', description: '' })

async function openCreate() {
  Object.assign(createForm, { name: '', class_id: null, semester: '', description: '' })
  // 班级下拉：教师身份自动只返回本校班级
  const res = await classApi.all()
  classes.value = res.data
  createVisible.value = true
}

async function submitCreate() {
  if (!createForm.name || !createForm.class_id) { ElMessage.warning('请填写课程名称并选择班级'); return }
  creating.value = true
  try {
    const res = await courseApi.create(createForm)
    ElMessage.success(res.message || '课程创建成功')
    createVisible.value = false
    loadData()
  } catch (e) {} finally { creating.value = false }
}

// 课代表管理
const assistantVisible = ref(false)
const currentCourse = ref(null)
const assistants = ref([])
const classStudents = ref([])
const selectedStudent = ref(null)
const addingAssistant = ref(false)

async function openAssistants(c) {
  currentCourse.value = c
  selectedStudent.value = null
  assistantVisible.value = true
  const [a, s] = await Promise.all([
    courseApi.assistants(c.id),
    classApi.students(c.class_id)
  ])
  assistants.value = a.data
  classStudents.value = s.data.students
}

async function addAssistant() {
  if (!selectedStudent.value) return
  addingAssistant.value = true
  try {
    const res = await courseApi.addAssistant(currentCourse.value.id, selectedStudent.value)
    ElMessage.success(res.message)
    selectedStudent.value = null
    const a = await courseApi.assistants(currentCourse.value.id)
    assistants.value = a.data
    loadData()
  } catch (e) {} finally { addingAssistant.value = false }
}

async function removeAssistant(a) {
  try {
    const res = await courseApi.removeAssistant(currentCourse.value.id, a.id)
    ElMessage.success(res.message)
    assistants.value = assistants.value.filter(x => x.id !== a.id)
    loadData()
  } catch (e) {}
}

onMounted(loadData)
</script>

<style scoped>
.course-card {
  background: var(--bg); border-radius: var(--radius); padding: 24px;
  margin-bottom: 16px; transition: all 0.3s;
}
.course-card:hover { box-shadow: var(--shadow-hover); transform: translateY(-2px); }
.course-icon { font-size: 36px; }
.course-card h3 { margin: 12px 0 8px; }
.course-meta { font-size: 13px; color: var(--text-light); margin: 4px 0; }
.course-desc { font-size: 13px; color: var(--text); margin-top: 8px; line-height: 1.6; }
</style>
