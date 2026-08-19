<template>
  <div class="page-container">
    <div class="page-title">
      用户管理
      <el-button type="primary" style="margin-left:auto" @click="openCreate('teacher')">
        <el-icon><Plus /></el-icon>新增教师
      </el-button>
      <el-button type="success" @click="openCreate('student')">新增学生</el-button>
    </div>

    <div class="card-section">
      <div class="filter-bar">
        <el-select v-model="roleFilter" placeholder="角色" clearable style="width:120px" @change="search">
          <el-option label="全部" value="" />
          <el-option label="学生" value="student" />
          <el-option label="教师" value="teacher" />
          <el-option label="管理员" value="admin" />
        </el-select>
        <el-select v-model="statusFilter" placeholder="状态" clearable style="width:140px" @change="search">
          <el-option label="全部" value="" />
          <el-option label="启用" :value="1" />
          <el-option label="待审核/禁用" :value="0" />
        </el-select>
        <el-input v-model="keyword" placeholder="搜索学号/姓名/邮箱" clearable style="width:260px" @keyup.enter="search" @clear="search">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-button type="primary" @click="search">搜索</el-button>
      </div>

      <el-table :data="list" stripe>
        <el-table-column label="学号" prop="username" width="130" />
        <el-table-column label="姓名" prop="real_name" width="120" />
        <el-table-column label="学校" width="150">
          <template #default="{ row }">{{ row.school ? row.school.name : '—' }}</template>
        </el-table-column>
        <el-table-column label="角色" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="roleType(row.role)" size="small">{{ roleText(row.role) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="邮箱" prop="email" min-width="180" show-overflow-tooltip />
        <el-table-column label="手机" prop="phone" width="130" />
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.status === 1" type="success" size="small">启用</el-tag>
            <el-tag v-else-if="row.role === 'teacher'" type="warning" size="small">待审核</el-tag>
            <el-tag v-else type="info" size="small">禁用</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="注册时间" width="160">
          <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="240" align="center" fixed="right">
          <template #default="{ row }">
            <el-button link type="warning" @click="resetPwd(row)">重置密码</el-button>
            <el-button v-if="row.role !== 'admin'" link :type="row.status === 1 ? 'info' : 'success'" @click="toggleStatus(row)">
              {{ row.status === 1 ? '禁用' : (row.role === 'teacher' ? '通过审核' : '启用') }}
            </el-button>
            <el-button v-if="row.role !== 'admin'" link type="danger" @click="removeUser(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination v-if="total > 0" background layout="prev, pager, next, total"
        :total="total" :page-size="pageSize" :current-page="page"
        style="margin-top:20px; justify-content:center; display:flex"
        @current-change="handlePage" />
    </div>

    <!-- 新增对话框 -->
    <el-dialog v-model="createVisible" :title="createRole === 'teacher' ? '新增教师账号' : '新增学生账号'" width="480px">
      <el-form :model="createForm" label-width="90px">
        <el-form-item label="学校" required>
          <el-select v-model="createForm.school_id" placeholder="选择学校" style="width:100%">
            <el-option v-for="s in schools" :key="s.id" :label="`${s.name}（${s.code}）`" :value="s.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="学号" required>
          <el-input v-model="createForm.username" placeholder="登录账号" />
        </el-form-item>
        <el-form-item label="姓名" required>
          <el-input v-model="createForm.real_name" />
        </el-form-item>
        <el-form-item label="初始密码" required>
          <el-input v-model="createForm.password" placeholder="至少6位" show-password />
        </el-form-item>
        <el-form-item label="邮箱">
          <el-input v-model="createForm.email" />
        </el-form-item>
        <el-form-item label="手机">
          <el-input v-model="createForm.phone" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="confirmCreate">创建</el-button>
      </template>
    </el-dialog>

    <!-- 重置密码对话框 -->
    <el-dialog v-model="pwdVisible" title="重置密码" width="420px">
      <p style="margin-bottom:12px">正在为 <strong>{{ currentUser?.real_name }}</strong>（{{ currentUser?.username }}）重置密码</p>
      <el-input v-model="newPwd" placeholder="输入新密码（留空则重置为 123456）" show-password />
      <template #footer>
        <el-button @click="pwdVisible = false">取消</el-button>
        <el-button type="warning" :loading="resetting" @click="confirmReset">确认重置</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Search } from '@element-plus/icons-vue'
import { userApi, schoolApi } from '@/api'

const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 10
const keyword = ref('')
const roleFilter = ref('')
const statusFilter = ref('')

const createVisible = ref(false)
const createRole = ref('teacher')
const createForm = reactive({ username: '', real_name: '', password: '', email: '', phone: '', school_id: null })
const saving = ref(false)
const schools = ref([])

const pwdVisible = ref(false)
const currentUser = ref(null)
const newPwd = ref('')
const resetting = ref(false)

function formatTime(t) { return new Date(t).toLocaleString('zh-CN') }
function roleText(r) { return { student: '学生', teacher: '教师', admin: '管理员' }[r] }
function roleType(r) { return { student: 'success', teacher: 'warning', admin: 'danger' }[r] }

async function loadData() {
  const res = await userApi.list({
    page: page.value, pageSize,
    keyword: keyword.value, role: roleFilter.value, status: statusFilter.value
  })
  list.value = res.data.list
  total.value = res.data.total
}
function handlePage(p) { page.value = p; loadData() }

// 搜索/筛选时重置到第一页，避免停留在超出结果页数的空页
function search() { page.value = 1; loadData() }

function openCreate(role) {
  createRole.value = role
  Object.assign(createForm, { username: '', real_name: '', password: '', email: '', phone: '', school_id: null })
  createVisible.value = true
}

async function confirmCreate() {
  if (!createForm.username || !createForm.real_name || !createForm.password || !createForm.school_id) {
    ElMessage.warning('请填写完整（含学校）'); return
  }
  saving.value = true
  try {
    const api = createRole.value === 'teacher' ? userApi.createTeacher : userApi.createStudent
    await api(createForm)
    ElMessage.success('创建成功')
    createVisible.value = false
    loadData()
  } catch (e) {} finally { saving.value = false }
}

function resetPwd(row) {
  currentUser.value = row
  newPwd.value = ''
  pwdVisible.value = true
}

async function confirmReset() {
  resetting.value = true
  try {
    await userApi.resetPassword(currentUser.value.id, { new_password: newPwd.value })
    // 后端出于安全不回传新密码，这里根据是否自定义给出明确提示
    ElMessageBox.alert(
      newPwd.value ? `新密码为：${newPwd.value}` : '密码已重置为默认密码 123456，请通知用户尽快登录修改',
      '重置成功',
      { type: 'success' }
    )
    pwdVisible.value = false
  } catch (e) {} finally { resetting.value = false }
}

async function toggleStatus(row) {
  try {
    const action = row.status === 1 ? '禁用' : (row.role === 'teacher' ? '通过审核并启用' : '启用')
    await ElMessageBox.confirm(`确定${action}账号「${row.real_name}」？`, '提示', { type: 'warning' })
    await userApi.toggleStatus(row.id)
    ElMessage.success('操作成功')
    loadData()
  } catch (e) {}
}

async function removeUser(row) {
  try {
    await ElMessageBox.confirm(`确定删除用户「${row.real_name}」？此操作不可恢复`, '危险操作', { type: 'error' })
    await userApi.remove(row.id)
    ElMessage.success('已删除')
    // 删除的是当前页最后一条时回退一页，避免停留在空页
    if (list.value.length === 1 && page.value > 1) page.value -= 1
    loadData()
  } catch (e) {}
}

onMounted(async () => {
  loadData()
  try {
    const res = await schoolApi.all()
    schools.value = res.data
  } catch (e) {}
})
</script>
