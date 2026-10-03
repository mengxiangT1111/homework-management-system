<template>
  <div class="page-container">
    <div class="page-title">提示词版本管理</div>

    <div class="card-section">
      <el-alert type="info" :closable="false" style="margin-bottom:16px">
        批改提示词按版本库全量快照存储：切换稳定版即全量生效；灰度按任务 ID 确定性分流（同一任务重试不漂移）。
        路由约 30 秒缓存过期后生效。修改提示词属高风险操作，建议先灰度小比例观察批改质量再全量。
      </el-alert>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h3 style="margin:0">grading.main 版本列表</h3>
        <el-button type="primary" @click="openCreate">新建版本</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column label="版本" prop="version" width="110" />
        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusText(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="变更说明" prop="change_log" min-width="220" show-overflow-tooltip />
        <el-table-column label="创建时间" width="170">
          <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="210" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="viewVersion(row)">查看</el-button>
            <el-button v-if="row.status !== 'stable'" link type="success" @click="setStable(row)">设为稳定版</el-button>
            <el-button v-if="row.status !== 'stable'" link type="warning" @click="setCanary(row)">设为灰度</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 查看版本内容 -->
    <el-dialog v-model="viewVisible" :title="`版本 ${viewing?.version || ''}`" width="760px" top="5vh">
      <template v-if="viewing">
        <el-descriptions :column="2" size="small" border style="margin-bottom:12px">
          <el-descriptions-item label="状态">{{ statusText(viewing.status) }}</el-descriptions-item>
          <el-descriptions-item label="创建时间">{{ formatTime(viewing.created_at) }}</el-descriptions-item>
        </el-descriptions>
        <div class="section-label">System Prompt</div>
        <pre class="prompt-pre">{{ viewing.system_prompt }}</pre>
        <div class="section-label">评语风格修饰（modifiers）</div>
        <pre class="prompt-pre">{{ formatModifiers(viewing.modifiers) }}</pre>
        <div v-if="viewing.change_log" class="section-label">变更说明</div>
        <div v-if="viewing.change_log" style="font-size:13px;color:var(--text-light)">{{ viewing.change_log }}</div>
      </template>
    </el-dialog>

    <!-- 新建版本 -->
    <el-dialog v-model="createVisible" title="新建提示词版本" width="760px" top="5vh">
      <el-form :model="form" label-width="100px">
        <el-form-item label="版本号" required>
          <el-input v-model="form.version" placeholder="语义化版本，如 1.2.0" style="width:200px" />
        </el-form-item>
        <el-form-item label="变更说明" required>
          <el-input v-model="form.change_log" type="textarea" :rows="2" placeholder="本次改了什么、为什么改" />
        </el-form-item>
        <el-form-item label="System Prompt" required>
          <el-input v-model="form.system_prompt" type="textarea" :rows="12"
            placeholder="完整提示词全文（创建后为 draft 状态，不生效；设为稳定版或灰度后才投入使用）" />
        </el-form-item>
        <el-form-item label="风格修饰">
          <el-input v-model="form.modifiers" type="textarea" :rows="6"
            placeholder='JSON 对象，键为 balanced/strict/encouraging，值为对应模式的追加指令' />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="doCreate">创建（draft）</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { gradingApi } from '@/api'

const list = ref([])
const loading = ref(false)
const viewVisible = ref(false)
const viewing = ref(null)
const createVisible = ref(false)
const creating = ref(false)
const form = reactive({ version: '', change_log: '', system_prompt: '', modifiers: '{\n  "balanced": "",\n  "strict": "",\n  "encouraging": ""\n}' })

async function load() {
  loading.value = true
  try {
    const res = await gradingApi.prompts({ prompt_key: 'grading.main' })
    list.value = res.data || []
  } catch (e) {} finally { loading.value = false }
}

function statusType(s) {
  return { stable: 'success', canary: 'warning', draft: 'info', retired: 'info' }[s] || 'info'
}
function statusText(s) {
  return { stable: '稳定版', canary: '灰度中', draft: '草稿', retired: '已退役' }[s] || s
}
function formatTime(t) {
  const d = new Date(t)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('zh-CN')
}
function formatModifiers(m) {
  if (!m) return '（无）'
  try { return JSON.stringify(typeof m === 'string' ? JSON.parse(m) : m, null, 2) } catch (e) { return String(m) }
}

function viewVersion(row) {
  viewing.value = row
  viewVisible.value = true
}

async function setStable(row) {
  try {
    await ElMessageBox.confirm(
      `将版本 ${row.version} 设为稳定版（全量生效，原稳定版自动退役）？`,
      '切换稳定版',
      { type: 'warning' }
    )
  } catch (e) { return }
  try {
    const res = await gradingApi.updatePromptRouting({ prompt_key: 'grading.main', stable_version_id: row.id })
    ElMessage.success(res.message || '已切换')
    load()
  } catch (e) {}
}

async function setCanary(row) {
  let percent
  try {
    const { value } = await ElMessageBox.prompt(
      `版本 ${row.version} 的灰度比例（任务 ID 确定性分流，输入 0 关闭灰度）`,
      '设置灰度',
      {
        inputValue: '10',
        inputPattern: /^(100|[1-9]?\d)$/,
        inputErrorMessage: '请输入 0-100 的整数'
      }
    )
    percent = Number(value)
  } catch (e) { return }
  try {
    const res = await gradingApi.updatePromptRouting({
      prompt_key: 'grading.main',
      canary_version_id: row.id,
      canary_percent: percent
    })
    ElMessage.success(res.message || '已更新灰度路由')
    load()
  } catch (e) {}
}

function openCreate() {
  form.version = ''
  form.change_log = ''
  form.system_prompt = ''
  form.modifiers = '{\n  "balanced": "",\n  "strict": "",\n  "encouraging": ""\n}'
  createVisible.value = true
}

async function doCreate() {
  if (!/^\d+\.\d+\.\d+$/.test(form.version)) { ElMessage.warning('版本号需为语义化格式，如 1.2.0'); return }
  if (!form.change_log.trim()) { ElMessage.warning('请填写变更说明'); return }
  if (!form.system_prompt.trim()) { ElMessage.warning('请填写 System Prompt'); return }
  let modifiers = null
  const mTrim = form.modifiers.trim()
  if (mTrim) {
    try { modifiers = JSON.parse(mTrim) } catch (e) { ElMessage.warning('风格修饰必须是合法 JSON 对象'); return }
  }
  creating.value = true
  try {
    const res = await gradingApi.createPromptVersion({
      prompt_key: 'grading.main',
      version: form.version,
      system_prompt: form.system_prompt,
      modifiers,
      change_log: form.change_log
    })
    ElMessage.success(res.message || '已创建')
    createVisible.value = false
    load()
  } catch (e) {} finally { creating.value = false }
}

onMounted(load)
</script>

<style scoped>
.section-label { font-weight: 600; font-size: 13px; margin: 12px 0 6px; }
.prompt-pre {
  background: var(--bg, #f6f8fa);
  border: 1px solid var(--ink-100, #e5e7eb);
  border-radius: 6px;
  padding: 12px;
  font-size: 12.5px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 320px;
  overflow: auto;
  margin: 0;
}
</style>
