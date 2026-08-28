<template>
  <div class="page-container">
    <div class="page-title">
      批改模板管理
      <el-button type="primary" style="margin-left:auto" @click="openCreate">
        <el-icon><Plus /></el-icon> 新建模板
      </el-button>
    </div>

    <!-- 筛选 -->
    <div class="card-section">
      <div class="table-toolbar">
        <div class="toolbar-filters">
          <el-select v-model="filterSubject" placeholder="科目筛选" clearable style="width:140px" @change="search">
            <el-option v-for="s in subjects" :key="s" :label="s" :value="s" />
          </el-select>
          <el-select v-model="filterStatus" placeholder="状态筛选" clearable style="width:140px" @change="search">
            <el-option label="草稿" value="draft" />
            <el-option label="已发布" value="published" />
            <el-option label="已停用" value="disabled" />
          </el-select>
        </div>
        <span class="toolbar-meta">共 {{ total }} 个模板</span>
      </div>

      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column label="模板名称" prop="name" min-width="180" />
        <el-table-column label="归属" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="row.school_id === null ? 'primary' : row.is_mine ? 'success' : 'info'" size="small">
              {{ row.school_id === null ? '平台' : row.is_mine ? '我的' : '本校' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="科目" prop="subject" width="80" />
        <el-table-column label="满分" width="70" align="center">
          <template #default="{ row }">{{ row.full_score }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">
              {{ statusText(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="版本" width="60" align="center">
          <template #default="{ row }">v{{ row.version }}</template>
        </el-table-column>
        <el-table-column label="更新时间" width="170">
          <template #default="{ row }">{{ formatTime(row.updated_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="270" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" :disabled="row.status !== 'draft' && !row.is_mine" @click="openEdit(row)">编辑</el-button>
            <el-button v-if="row.status === 'draft' && row.is_mine" link type="success" @click="publish(row)">发布</el-button>
            <el-button v-if="row.status !== 'draft'" link @click="clone(row)">克隆</el-button>
            <el-button v-if="row.status !== 'draft' && row.is_mine" link type="warning" @click="toggle(row)">
              {{ row.status === 'published' ? '停用' : '启用' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-if="total > pageSize" background layout="prev, pager, next, total"
        :total="total" :page-size="pageSize" :current-page="page"
        class="table-footer"
        @current-change="handlePage"
      />
    </div>

    <!-- 编辑器对话框 -->
    <el-dialog v-model="editorVisible" :title="editingId ? '编辑模板（草稿）' : '新建模板'" width="980px" top="3vh">
      <el-form :model="form" label-width="80px" size="small">
        <el-row :gutter="12">
          <el-col :span="8"><el-form-item label="名称" required><el-input v-model="form.name" placeholder="如：高中议论文批改" /></el-form-item></el-col>
          <el-col :span="5"><el-form-item label="科目"><el-input v-model="form.subject" placeholder="语文/通用" /></el-form-item></el-col>
          <el-col :span="6">
            <el-form-item label="类型">
              <el-select v-model="form.content_type">
                <el-option label="议论文/作文" value="essay" />
                <el-option label="主观题" value="subjective" />
                <el-option label="实验报告" value="experiment" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="5"><el-form-item label="满分" required><el-input-number v-model="form.full_score" :min="1" :max="1000" style="width:100%" /></el-form-item></el-col>
        </el-row>
        <el-form-item label="说明"><el-input v-model="form.description" placeholder="何时使用本模板（可选）" /></el-form-item>
      </el-form>

      <!-- 权重合计条 -->
      <el-alert
        :type="weightSum === 100 ? 'success' : 'error'" :closable="false" style="margin-bottom:12px"
        :title="`维度权重合计：${weightSum} / 100 ${weightSum === 100 ? '（正确）' : '（必须等于100才能发布）'}`"
      />

      <!-- 维度卡片 -->
      <div style="max-height:52vh;overflow-y:auto;padding-right:6px">
        <el-card v-for="(dim, i) in form.dimensions" :key="i" shadow="never" style="margin-bottom:12px">
          <template #header>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <el-input v-model="dim.name" placeholder="维度名称（必填）" style="width:170px" size="small" />
              <el-input v-model="dim.code" placeholder="编码（如 content）" style="width:140px" size="small" />
              <span style="font-size:12px;color:var(--el-text-color-secondary)">权重</span>
              <el-input-number v-model="dim.weight" :min="0.5" :max="100" :step="5" size="small" style="width:115px" />
              <el-tag size="small" type="info">满分 {{ dimMax(dim) }}</el-tag>
              <el-button link type="danger" style="margin-left:auto" @click="form.dimensions.splice(i, 1)">删除维度</el-button>
            </div>
          </template>
          <el-input v-model="dim.description" placeholder="维度说明：该维度关注什么（可选）" size="small" style="margin-bottom:8px" />

          <!-- Rubric 档位表 -->
          <el-table :data="dim.rubrics" size="small" border>
            <el-table-column label="档位" width="80">
              <template #default="{ row }"><el-input v-model="row.level" size="small" placeholder="A" /></template>
            </el-table-column>
            <el-table-column label="最低分" width="120">
              <template #default="{ row }">
                <el-input-number v-model="row.score_range[0]" :min="0" :max="dimMax(dim)" :precision="1" size="small" style="width:100%" controls-position="right" />
              </template>
            </el-table-column>
            <el-table-column label="最高分" width="120">
              <template #default="{ row }">
                <el-input-number v-model="row.score_range[1]" :min="0" :max="dimMax(dim)" :precision="1" size="small" style="width:100%" controls-position="right" />
              </template>
            </el-table-column>
            <el-table-column label="档位描述（什么表现落在此档）">
              <template #default="{ row }"><el-input v-model="row.descriptor" type="textarea" :rows="1" size="small" /></template>
            </el-table-column>
            <el-table-column label="" width="60">
              <template #default="{ $index }">
                <el-button link type="danger" size="small" @click="dim.rubrics.splice($index, 1)">删</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-button size="small" style="margin-top:6px" @click="addLevel(dim)">+ 添加档位</el-button>

          <!-- 扣分规则 -->
          <div style="margin-top:10px">
            <div v-for="(rule, j) in dim.deduction_rules" :key="j" style="display:flex;gap:6px;margin-bottom:6px;align-items:center;flex-wrap:wrap">
              <el-input v-model="rule.description" placeholder="扣分情形，如：每处错别字" size="small" style="flex:1;min-width:200px" />
              <el-input-number v-model="rule.penalty" :min="0" :precision="1" size="small" placeholder="扣分" style="width:105px" controls-position="right" />
              <el-input-number v-model="rule.max_penalty" :min="0" :precision="1" size="small" placeholder="累计上限" style="width:115px" controls-position="right" />
              <el-button link type="danger" size="small" @click="dim.deduction_rules.splice(j, 1)">删</el-button>
            </div>
            <el-button size="small" @click="dim.deduction_rules.push({ description: '', penalty: 1, max_penalty: null })">+ 添加扣分规则</el-button>
          </div>
        </el-card>

        <el-button style="width:100%" @click="addDimension">+ 添加评分维度</el-button>
      </div>

      <template #footer>
        <el-button @click="editorVisible = false">取消</el-button>
        <el-button type="primary" plain :loading="saving" @click="save(false)">保存草稿</el-button>
        <el-button type="primary" :loading="saving" @click="save(true)">保存并发布</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { gradingApi } from '@/api'
import { TEMPLATE_STATUS, statusOf } from '@/utils/statusMaps'

const subjects = ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治', '通用']

const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false)
const filterSubject = ref('')
const filterStatus = ref('')

const editorVisible = ref(false)
const editingId = ref(null)
const saving = ref(false)

const emptyForm = () => ({
  name: '',
  subject: '通用',
  content_type: 'essay',
  full_score: 100,
  description: '',
  dimensions: []
})

const form = reactive(emptyForm())

// 维度满分实时换算：满分 × 权重 / 100
const dimMax = (dim) => Math.round(form.full_score * (Number(dim.weight) || 0) / 100 * 10) / 10
const weightSum = computed(() =>
  Math.round(form.dimensions.reduce((s, d) => s + (Number(d.weight) || 0), 0) * 10) / 10
)

const statusText = (s) => statusOf(TEMPLATE_STATUS, s).text
const statusType = (s) => statusOf(TEMPLATE_STATUS, s).type
const formatTime = (t) => new Date(t).toLocaleString('zh-CN')

// 新增档位：默认占位区间（教师可改），低于当前最低档
function addLevel(dim) {
  const maxScore = dimMax(dim)
  const lowest = dim.rubrics.length
    ? Math.min(...dim.rubrics.map(r => Number(r.score_range[0])))
    : Math.round(maxScore * 0.6 * 10) / 10
  const width = Math.max(1, Math.round(lowest / 2 * 10) / 10)
  dim.rubrics.push({
    level: '',
    score_range: [Math.max(0, Math.round((lowest - width) * 10) / 10), lowest],
    descriptor: ''
  })
}

// 新增维度：预置 A/B/C/D 四档占位区间（教师可改），权重自动均衡
function addDimension() {
  const idx = form.dimensions.length + 1
  const count = form.dimensions.length + 1
  const weight = Math.max(1, Math.round(100 / count))
  const maxScore = Math.round(form.full_score * weight / 100 * 10) / 10
  form.dimensions.push({
    code: `dim${idx}`,
    name: '',
    weight,
    description: '',
    rubrics: [
      { level: 'A', score_range: [Math.round(maxScore * 0.85 * 10) / 10, maxScore], descriptor: '' },
      { level: 'B', score_range: [Math.round(maxScore * 0.7 * 10) / 10, Math.round(maxScore * 0.8 * 10) / 10], descriptor: '' },
      { level: 'C', score_range: [Math.round(maxScore * 0.4 * 10) / 10, Math.round(maxScore * 0.65 * 10) / 10], descriptor: '' },
      { level: 'D', score_range: [0, Math.round(maxScore * 0.35 * 10) / 10], descriptor: '' }
    ],
    deduction_rules: []
  })
}

async function loadList() {
  loading.value = true
  try {
    const params = { page: page.value, pageSize }
    if (filterSubject.value) params.subject = filterSubject.value
    if (filterStatus.value) params.status = filterStatus.value
    const res = await gradingApi.templates(params)
    list.value = res.data.list
    total.value = res.data.total
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '加载模板列表失败')
  } finally { loading.value = false }
}
// 筛选切换须回到第 1 页，避免停留在大页码时列表空白
function search() { page.value = 1; loadList() }

function handlePage(p) { page.value = p; loadList() }

function openCreate() {
  editingId.value = null
  Object.assign(form, emptyForm())
  editorVisible.value = true
}

async function openEdit(row) {
  try {
    const res = await gradingApi.templateDetail(row.id)
    const j = res.data.json
    editingId.value = row.id
    Object.assign(form, {
      name: j.name,
      subject: j.subject,
      content_type: j.content_type,
      full_score: j.full_score,
      description: j.description,
      dimensions: j.dimensions
    })
    if (row.status !== 'draft') {
      ElMessage.info('该模板已发布锁定，保存将失败；请先"克隆"出副本再修改')
    }
    editorVisible.value = true
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '加载模板详情失败')
  }
}

async function save(publishAfter) {
  saving.value = true
  try {
    // 服务端校验（权威校验，错误信息直接回显）
    const check = await gradingApi.validateTemplate(JSON.parse(JSON.stringify(form)))
    if (!check.data.valid) {
      ElMessage.error(check.data.errors.join('；'))
      return
    }
    if (editingId.value) {
      await gradingApi.updateTemplate(editingId.value, JSON.parse(JSON.stringify(form)))
    } else {
      const res = await gradingApi.createTemplate(JSON.parse(JSON.stringify(form)))
      editingId.value = res.data.id
    }
    if (publishAfter) {
      const res = await gradingApi.publishTemplate(editingId.value)
      ElMessage.success(res.message)
    } else {
      ElMessage.success('模板已保存')
    }
    editorVisible.value = false
    loadList()
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '保存失败')
  } finally { saving.value = false }
}

async function publish(row) {
  try {
    await ElMessageBox.confirm('发布后模板将锁定，不可再编辑（可克隆修改）。确认发布？', '发布模板', { type: 'warning' })
    const res = await gradingApi.publishTemplate(row.id)
    ElMessage.success(res.message)
    loadList()
  } catch (e) {
    if (e !== 'cancel' && e?.message) ElMessage.error(e.response?.data?.message || e.message)
  }
}

async function clone(row) {
  try {
    const res = await gradingApi.cloneTemplate(row.id)
    ElMessage.success(res.message)
    loadList()
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '克隆失败')
  }
}

async function toggle(row) {
  try {
    const res = await gradingApi.toggleTemplate(row.id)
    ElMessage.success(res.message)
    loadList()
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '操作失败')
  }
}

onMounted(loadList)
</script>
