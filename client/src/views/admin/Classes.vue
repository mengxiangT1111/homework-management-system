<template>
  <div class="page-container">
    <div class="page-title">
      班级管理
      <el-button type="primary" style="margin-left:auto" @click="openCreate">
        <el-icon><Plus /></el-icon>新增班级
      </el-button>
    </div>

    <div class="card-section">
      <div class="filter-bar">
        <el-input v-model="keyword" placeholder="搜索班级名称/年级" clearable style="width:240px" @keyup.enter="loadData" @clear="loadData">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-button type="primary" @click="loadData">搜索</el-button>
      </div>

      <el-table :data="list" stripe>
        <el-table-column label="班级名称" prop="name" min-width="180" />
        <el-table-column label="年级" prop="grade" width="120" />
        <el-table-column label="班主任" width="120">
          <template #default="{ row }">{{ row.headTeacher?.real_name || '未指定' }}</template>
        </el-table-column>
        <el-table-column label="学生数" prop="student_count" width="80" align="center" />
        <el-table-column label="课程数" prop="course_count" width="80" align="center" />
        <el-table-column label="描述" prop="description" min-width="150" show-overflow-tooltip />
        <el-table-column label="操作" width="240" align="center" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="viewStudents(row)">学生管理</el-button>
            <el-button link type="warning" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" @click="removeCls(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination v-if="total > 0" background layout="prev, pager, next, total"
        :total="total" :page-size="pageSize" :current-page="page"
        style="margin-top:20px; justify-content:center; display:flex"
        @current-change="handlePage" />
    </div>

    <!-- 新增/编辑对话框 -->
    <el-dialog v-model="formVisible" :title="editId ? '编辑班级' : '新增班级'" width="500px">
      <el-form :model="form" label-width="90px">
        <el-form-item label="班级名称" required>
          <el-input v-model="form.name" placeholder="如：计算机科学与技术1班" />
        </el-form-item>
        <el-form-item label="年级" required>
          <el-input v-model="form.grade" placeholder="如：2024级" />
        </el-form-item>
        <el-form-item label="班主任">
          <el-select v-model="form.teacher_id" placeholder="选择班主任（选填）" clearable filterable style="width:100%">
            <el-option v-for="t in teachers" :key="t.id" :label="t.real_name" :value="t.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveClass">保存</el-button>
      </template>
    </el-dialog>

    <!-- 学生管理对话框 -->
    <el-dialog v-model="studentVisible" :title="`${currentClass?.name} - 学生管理`" width="700px">
      <div style="margin-bottom:12px;display:flex;gap:8px">
        <el-button type="primary" size="small" @click="openAddStudent">+ 添加学生</el-button>
        <span style="color:var(--text-light);font-size:13px;line-height:32px">共 {{ students.length }} 名学生</span>
      </div>
      <el-table :data="students" stripe size="small" max-height="400">
        <el-table-column label="学号" prop="username" width="120" />
        <el-table-column label="姓名" prop="real_name" width="100" />
        <el-table-column label="职务" width="100" align="center">
          <template #default="{ row }">
            <el-tag v-if="getPos(row) === 'monitor'" size="small" type="warning">班长</el-tag>
            <el-tag v-else-if="getPos(row) === 'commissary'" size="small" type="success">学委</el-tag>
            <el-tag v-else size="small" type="info" effect="plain">学生</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="邮箱" prop="email" min-width="160" />
        <el-table-column label="操作" width="200" align="center">
          <template #default="{ row }">
            <el-dropdown @command="(cmd) => setPosition(row, cmd)" trigger="click">
              <el-button link type="primary" size="small">设职务<el-icon class="el-icon--right"><CaretBottom /></el-icon></el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="none" :disabled="getPos(row)==='none'">设为普通学生</el-dropdown-item>
                  <el-dropdown-item command="monitor" :disabled="getPos(row)==='monitor'">设为班长</el-dropdown-item>
                  <el-dropdown-item command="commissary" :disabled="getPos(row)==='commissary'">设为学委</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <el-button link type="danger" @click="removeStudent(row)">移除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>

    <!-- 添加学生对话框 -->
    <el-dialog v-model="addStudentVisible" title="添加学生到班级" width="500px">
      <el-select v-model="selectedStudents" multiple filterable placeholder="搜索并选择学生" style="width:100%">
        <el-option v-for="s in allStudents" :key="s.id" :label="`${s.real_name}（${s.username}）`" :value="s.id" />
      </el-select>
      <template #footer>
        <el-button @click="addStudentVisible = false">取消</el-button>
        <el-button type="primary" :loading="addingStudents" @click="confirmAddStudents">添加</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Search, CaretBottom } from '@element-plus/icons-vue'
import { classApi, userApi } from '@/api'

// 获取学生在班级中的职务（数据在 classes[0].ClassStudent.position）
function getPos(row) {
  return row.classes?.[0]?.ClassStudent?.position || 'none'
}

const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 10
const keyword = ref('')
const teachers = ref([])

const formVisible = ref(false)
const editId = ref(null)
const saving = ref(false)
const form = reactive({ name: '', grade: '', teacher_id: null, description: '' })

const studentVisible = ref(false)
const currentClass = ref(null)
const students = ref([])

const addStudentVisible = ref(false)
const allStudents = ref([])
const selectedStudents = ref([])
const addingStudents = ref(false)

async function loadData() {
  const res = await classApi.list({ page: page.value, pageSize, keyword: keyword.value })
  list.value = res.data.list
  total.value = res.data.total
}
function handlePage(p) { page.value = p; loadData() }

async function loadTeachers() {
  const res = await userApi.teachers()
  teachers.value = res.data
}

function openCreate() {
  editId.value = null
  form.name = ''; form.grade = ''; form.teacher_id = null; form.description = ''
  formVisible.value = true
}

function openEdit(row) {
  editId.value = row.id
  form.name = row.name; form.grade = row.grade
  form.teacher_id = row.teacher_id; form.description = row.description || ''
  formVisible.value = true
}

async function saveClass() {
  if (!form.name || !form.grade) { ElMessage.warning('请填写班级名称和年级'); return }
  saving.value = true
  try {
    if (editId.value) {
      await classApi.update(editId.value, form)
      ElMessage.success('修改成功')
    } else {
      await classApi.create(form)
      ElMessage.success('创建成功')
    }
    formVisible.value = false
    loadData()
  } catch (e) {} finally { saving.value = false }
}

async function removeCls(row) {
  try {
    await ElMessageBox.confirm(`确定删除班级「${row.name}」？`, '删除确认', { type: 'warning' })
    await classApi.remove(row.id)
    ElMessage.success('删除成功')
    loadData()
  } catch (e) {}
}

async function viewStudents(row) {
  currentClass.value = row
  const res = await classApi.students(row.id)
  students.value = res.data.students
  studentVisible.value = true
}

async function openAddStudent() {
  selectedStudents.value = []
  const res = await userApi.students({ keyword: '' })
  allStudents.value = res.data
  addStudentVisible.value = true
}

async function confirmAddStudents() {
  if (selectedStudents.value.length === 0) { ElMessage.warning('请选择学生'); return }
  addingStudents.value = true
  try {
    const res = await classApi.addStudents(currentClass.value.id, selectedStudents.value)
    ElMessage.success(res.message)
    addStudentVisible.value = false
    // 刷新学生列表
    const r = await classApi.students(currentClass.value.id)
    students.value = r.data.students
  } catch (e) {} finally { addingStudents.value = false }
}

async function removeStudent(row) {
  try {
    await ElMessageBox.confirm(`确定将「${row.real_name}」移出班级？`, '提示', { type: 'warning' })
    await classApi.removeStudent(currentClass.value.id, row.id)
    ElMessage.success('已移除')
    const r = await classApi.students(currentClass.value.id)
    students.value = r.data.students
  } catch (e) {}
}

async function setPosition(row, position) {
  try {
    const res = await classApi.setPosition(currentClass.value.id, row.id, position)
    ElMessage.success(res.message)
    // 刷新学生列表
    const r = await classApi.students(currentClass.value.id)
    students.value = r.data.students
  } catch (e) {}
}

onMounted(() => {
  loadData()
  loadTeachers()
})
</script>
