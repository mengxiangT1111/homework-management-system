<template>
  <div class="page-container">
    <div class="page-title">
      作业管理
      <el-button type="primary" style="margin-left:auto" @click="$router.push('/teacher/assignments/create')">
        <el-icon><Plus /></el-icon>发布作业
      </el-button>
    </div>

    <div class="card-section">
      <div class="filter-bar">
        <el-input v-model="keyword" placeholder="搜索作业标题" clearable style="width:240px" @keyup.enter="loadData" @clear="loadData">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-button type="primary" @click="loadData">搜索</el-button>
      </div>

      <div v-if="list.length === 0" class="empty-box">
        <el-icon :size="48"><Document /></el-icon>
        <p style="margin-top:12px">还没有发布作业</p>
      </div>

      <el-table v-else :data="list" stripe>
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
        <el-table-column label="操作" width="220" align="center" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="$router.push(`/teacher/assignments/${row.id}/review`)">批阅</el-button>
            <el-button link type="success" @click="downloadAll(row)">打包下载</el-button>
            <el-button link type="warning" @click="exportExcel(row)">导出未交</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-if="total > 0" background layout="prev, pager, next, total"
        :total="total" :page-size="pageSize" :current-page="page"
        style="margin-top:20px; justify-content:center; display:flex"
        @current-change="handlePage"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus, Search, Document } from '@element-plus/icons-vue'
import { assignmentApi, submissionApi, downloadFile } from '@/api'

const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 10
const keyword = ref('')

function formatTime(t) { return new Date(t).toLocaleString('zh-CN') }

async function loadData() {
  const res = await assignmentApi.list({ page: page.value, pageSize, keyword: keyword.value })
  list.value = res.data.list
  total.value = res.data.total
}
function handlePage(p) { page.value = p; loadData() }

function downloadAll(row) {
  if (!row.submit_count) { ElMessage.warning('暂无提交，无法下载'); return }
  const token = localStorage.getItem('token')
  downloadFile(submissionApi.downloadAll(row.id), `${row.title}_提交.zip`)
}

function exportExcel(row) {
  downloadFile(submissionApi.exportExcel(row.id), `${row.title}_未交名单.xlsx`)
}

onMounted(loadData)
</script>
