<template>
  <div class="page-container">
    <div class="page-title">
      学校管理
      <el-button type="primary" style="margin-left:auto" @click="openCreate">
        <el-icon><Plus /></el-icon>新增学校
      </el-button>
    </div>

    <div class="card-section">
      <div class="filter-bar">
        <el-input v-model="keyword" placeholder="搜索学校名称/代码" clearable style="width:240px" @keyup.enter="loadData" @clear="loadData">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-button type="primary" @click="loadData">搜索</el-button>
      </div>

      <el-table :data="list" stripe>
        <el-table-column label="学校代码" prop="code" width="120" />
        <el-table-column label="学校名称" prop="name" min-width="220" />
        <el-table-column label="用户数" prop="user_count" width="100" align="center" />
        <el-table-column label="创建时间" width="170">
          <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="160" align="center" fixed="right">
          <template #default="{ row }">
            <el-button link type="warning" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" @click="removeSchool(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination v-if="total > 0" background layout="prev, pager, next, total"
        :total="total" :page-size="pageSize" :current-page="page"
        style="margin-top:20px; justify-content:center; display:flex"
        @current-change="handlePage" />
    </div>

    <!-- 新增/编辑对话框 -->
    <el-dialog v-model="formVisible" :title="editId ? '编辑学校' : '新增学校'" width="460px">
      <el-form :model="form" label-width="90px">
        <el-form-item label="学校代码" required>
          <el-input v-model="form.code" placeholder="如 009" maxlength="10" />
        </el-form-item>
        <el-form-item label="学校名称" required>
          <el-input v-model="form.name" placeholder="如 辽宁科技大学" maxlength="100" />
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
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Search } from '@element-plus/icons-vue'
import { schoolApi } from '@/api'

const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const keyword = ref('')

const formVisible = ref(false)
const editId = ref(null)
const saving = ref(false)
const form = reactive({ name: '', code: '' })

function formatTime(t) { return new Date(t).toLocaleString('zh-CN') }

async function loadData() {
  const res = await schoolApi.list({ page: page.value, pageSize, keyword: keyword.value })
  list.value = res.data.list
  total.value = res.data.total
}
function handlePage(p) { page.value = p; loadData() }

function openCreate() {
  editId.value = null
  form.name = ''
  form.code = ''
  formVisible.value = true
}

function openEdit(row) {
  editId.value = row.id
  form.name = row.name
  form.code = row.code
  formVisible.value = true
}

async function save() {
  if (!form.name || !form.code) { ElMessage.warning('请填写完整'); return }
  saving.value = true
  try {
    if (editId.value) {
      await schoolApi.update(editId.value, form)
      ElMessage.success('修改成功')
    } else {
      await schoolApi.create(form)
      ElMessage.success('创建成功')
    }
    formVisible.value = false
    loadData()
  } catch (e) {} finally { saving.value = false }
}

async function removeSchool(row) {
  try {
    await ElMessageBox.confirm(`确定删除学校「${row.name}」？`, '删除确认', { type: 'warning' })
    await schoolApi.remove(row.id)
    ElMessage.success('已删除')
    loadData()
  } catch (e) {}
}

onMounted(loadData)
</script>
