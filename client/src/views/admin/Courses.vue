<template>
  <div class="page-container">
    <div class="page-title">
      课程管理
      <el-button type="primary" style="margin-left:auto" @click="openCreate">
        <el-icon><Plus /></el-icon>新增课程
      </el-button>
    </div>

    <div class="card-section">
      <div class="filter-bar">
        <el-select v-model="schoolFilter" placeholder="全部学校" clearable style="width:180px" @change="loadData">
          <el-option v-for="s in schools" :key="s.id" :label="s.name" :value="s.id" />
        </el-select>
        <el-select v-model="classFilter" placeholder="按班级筛选" clearable style="width:180px" @change="loadData">
          <el-option v-for="c in classes" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
        <el-input v-model="keyword" placeholder="搜索课程名" clearable style="width:220px" @keyup.enter="loadData" @clear="loadData">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-button type="primary" @click="loadData">搜索</el-button>
      </div>

      <el-table v-loading="loading" :data="list" stripe>
        <el-table-column label="课程名" prop="name" min-width="150" />
        <el-table-column label="学校" width="150">
          <template #default="{ row }">{{ row.school?.name || '-' }}</template>
        </el-table-column>
        <el-table-column label="班级" min-width="150">
          <template #default="{ row }">
            <div>{{ row.class?.name }}</div>
            <div style="font-size:12px;color:var(--text-light)">{{ row.class?.grade }}</div>
          </template>
        </el-table-column>
        <el-table-column label="任课教师" width="120">
          <template #default="{ row }">{{ row.teacher?.real_name }}</template>
        </el-table-column>
        <el-table-column label="学期" prop="semester" width="120" />
        <el-table-column label="作业数" prop="assignment_count" width="80" align="center" />
        <el-table-column label="操作" width="160" align="center" fixed="right">
          <template #default="{ row }">
            <el-button link type="warning" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" @click="removeCourse(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination v-if="total > 0" background layout="prev, pager, next, total"
        :total="total" :page-size="pageSize" :current-page="page"
        class="table-footer"
        @current-change="handlePage" />
    </div>

    <!-- 新增/编辑 -->
    <el-dialog v-model="formVisible" :title="editId ? '编辑课程' : '新增课程'" width="560px">
      <el-form :model="form" label-width="90px">
        <el-form-item label="课程名" required>
          <el-input v-model="form.name" placeholder="如：高等数学" />
        </el-form-item>
        <el-form-item label="所属学校" required>
          <el-select v-model="form.school_id" placeholder="选择学校" filterable style="width:100%" @change="onSchoolChange">
            <el-option v-for="s in schools" :key="s.id" :label="s.name" :value="s.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="所属班级" required>
          <el-select v-model="form.class_id" placeholder="选择班级" filterable style="width:100%" :disabled="!form.school_id">
            <el-option v-for="c in formClasses" :key="c.id" :label="`${c.grade} - ${c.name}`" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="任课教师" required>
          <el-select v-model="form.teacher_id" placeholder="选择教师" filterable style="width:100%" :disabled="!form.school_id">
            <el-option v-for="t in formTeachers" :key="t.id" :label="t.real_name" :value="t.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="学期">
          <el-input v-model="form.semester" placeholder="如 2024-2025-1" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Search } from '@element-plus/icons-vue'
import { courseApi, classApi, userApi, schoolApi } from '@/api'

const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 10
const loading = ref(false)
const keyword = ref('')
const classFilter = ref('')
const classes = ref([])
const teachers = ref([])
const schools = ref([])
const schoolFilter = ref(null)

// 对话框内的班级/教师选项跟随所选学校
const formClasses = computed(() => classes.value.filter(c => c.school_id === form.school_id))
const formTeachers = computed(() => teachers.value.filter(t => t.school_id === form.school_id))

const formVisible = ref(false)
const editId = ref(null)
const saving = ref(false)
const form = reactive({ name: '', school_id: null, class_id: null, teacher_id: null, semester: '', description: '' })

async function loadData() {
  loading.value = true
  try {
    const res = await courseApi.list({ page: page.value, pageSize, keyword: keyword.value, class_id: classFilter.value, school_id: schoolFilter.value || undefined })
    list.value = res.data.list
    total.value = res.data.total
  } finally { loading.value = false }
}
function handlePage(p) { page.value = p; loadData() }

function onSchoolChange() {
  form.class_id = null
  form.teacher_id = null
}

function openCreate() {
  editId.value = null
  Object.assign(form, { name: '', school_id: schoolFilter.value, class_id: null, teacher_id: null, semester: '', description: '' })
  formVisible.value = true
}

function openEdit(row) {
  editId.value = row.id
  Object.assign(form, { name: row.name, school_id: row.school_id, class_id: row.class_id, teacher_id: row.teacher_id, semester: row.semester || '', description: row.description || '' })
  formVisible.value = true
}

async function save() {
  if (!form.name || !form.school_id || !form.class_id || !form.teacher_id) { ElMessage.warning('请填写完整（含所属学校）'); return }
  saving.value = true
  try {
    if (editId.value) {
      await courseApi.update(editId.value, form)
      ElMessage.success('修改成功')
    } else {
      await courseApi.create(form)
      ElMessage.success('创建成功')
    }
    formVisible.value = false
    loadData()
  } catch (e) {} finally { saving.value = false }
}

async function removeCourse(row) {
  try {
    await ElMessageBox.confirm(`确定删除课程「${row.name}」？`, '提示', { type: 'warning' })
    await courseApi.remove(row.id)
    ElMessage.success('已删除')
    loadData()
  } catch (e) {}
}

onMounted(async () => {
  loadData()
  const [c, t, s] = await Promise.all([classApi.all(), userApi.teachers(), schoolApi.all()])
  classes.value = c.data
  teachers.value = t.data
  schools.value = s.data
})
</script>
