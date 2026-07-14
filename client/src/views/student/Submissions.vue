<template>
  <div class="page-container">
    <div class="page-title">我的提交记录</div>

    <div class="card-section">
      <div v-if="list.length === 0" class="empty-box">
        <el-icon :size="48"><UploadFilled /></el-icon>
        <p style="margin-top:12px">还没有提交记录</p>
      </div>

      <el-table v-else :data="list" stripe>
        <el-table-column label="作业" min-width="200">
          <template #default="{ row }">
            <div class="sub-title">{{ row.assignment?.title }}</div>
            <div class="sub-course">{{ row.assignment?.course?.name }}</div>
          </template>
        </el-table-column>
        <el-table-column label="提交时间" width="170">
          <template #default="{ row }">{{ formatTime(row.submitted_at) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusText(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="分数" width="80">
          <template #default="{ row }">
            <span v-if="row.score !== null" class="score">{{ row.score }}</span>
            <span v-else style="color:#ccc">—</span>
          </template>
        </el-table-column>
        <el-table-column label="老师评语" min-width="200">
          <template #default="{ row }">
            <span v-if="row.comment">{{ row.comment }}</span>
            <span v-else style="color:#ccc">暂无</span>
          </template>
        </el-table-column>
        <el-table-column label="文件数" width="80" align="center">
          <template #default="{ row }">{{ row.files?.length || 0 }}</template>
        </el-table-column>
        <el-table-column label="操作" width="100" align="center">
          <template #default="{ row }">
            <el-button link type="primary" @click="$router.push(`/student/assignments/${row.assignment_id}`)">查看</el-button>
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
import { UploadFilled } from '@element-plus/icons-vue'
import { submissionApi } from '@/api'

const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 10

function formatTime(t) { return new Date(t).toLocaleString('zh-CN') }
function statusText(s) { return { submitted: '待批改', graded: '已评分', returned: '已退回' }[s] || s }
function statusType(s) { return { submitted: 'warning', graded: 'success', returned: 'info' }[s] || 'info' }

async function loadData() {
  const res = await submissionApi.myList({ page: page.value, pageSize })
  list.value = res.data.list
  total.value = res.data.total
}
function handlePage(p) { page.value = p; loadData() }

onMounted(loadData)
</script>

<style scoped>
.sub-title { font-weight: 500; }
.sub-course { font-size: 12px; color: var(--text-light); margin-top: 2px; }
.score { font-size: 16px; font-weight: 700; color: var(--primary); }
</style>
