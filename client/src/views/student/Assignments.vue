<template>
  <div class="page-container">
    <div class="page-title">作业列表</div>

    <div class="card-section">
      <div class="filter-bar">
        <el-input v-model="keyword" placeholder="搜索作业标题" clearable style="width:240px" @clear="search" @keyup.enter="search">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-button type="primary" @click="search">搜索</el-button>
      </div>

      <div v-if="list.length === 0" class="empty-box">
        <el-icon :size="48"><Document /></el-icon>
        <p style="margin-top:12px">暂无作业</p>
      </div>

      <div v-for="item in list" :key="item.id" class="assignment-item">
        <div class="item-main">
          <div class="item-title">
            {{ item.title }}
            <el-tag v-if="item.my_submission" type="success" size="small" effect="plain">已提交</el-tag>
            <el-tag v-else-if="item.is_overdue" type="danger" size="small" effect="plain">已逾期</el-tag>
            <el-tag v-else type="warning" size="small" effect="plain">待提交</el-tag>
          </div>
          <div class="item-meta">
            <span><el-icon><Reading /></el-icon>{{ item.course?.name }}</span>
            <span><el-icon><School /></el-icon>{{ item.course?.class?.name }}</span>
            <span :class="{ overdue: item.is_overdue }">
              <el-icon><Clock /></el-icon>{{ formatTime(item.deadline) }}
            </span>
          </div>
        </div>
        <el-button type="primary" size="small" @click="$router.push(`/student/assignments/${item.id}`)">
          {{ item.my_submission ? '查看' : '去提交' }}
        </el-button>
      </div>

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
import { Search, Document, Reading, School, Clock } from '@element-plus/icons-vue'
import { assignmentApi } from '@/api'

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

// 搜索时重置到第一页，避免停留在超出结果页数的空页
function search() { page.value = 1; loadData() }

onMounted(loadData)
</script>

<style scoped>
.assignment-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px; border-radius: 8px; background: var(--bg);
  margin-bottom: 10px; transition: all 0.2s;
}
.assignment-item:hover { box-shadow: var(--shadow); }
.item-title { font-size: 15px; font-weight: 500; margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
.item-meta { display: flex; gap: 16px; font-size: 12px; color: var(--text-light); flex-wrap: wrap; }
.item-meta span { display: flex; align-items: center; gap: 4px; }
.overdue { color: var(--danger) !important; font-weight: 600; }
</style>
