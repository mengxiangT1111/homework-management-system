<template>
  <div class="page-container">
    <div class="page-title">我的课程</div>

    <div class="card-section">
      <div v-if="courses.length === 0" class="empty-box">
        <el-icon :size="48"><Reading /></el-icon>
        <p style="margin-top:12px">还没有任课课程</p>
        <p style="font-size:13px;color:var(--text-light);margin-top:4px">请联系管理员为你分配课程</p>
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
          </div>
        </el-col>
      </el-row>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { Reading } from '@element-plus/icons-vue'
import { courseApi } from '@/api'

const courses = ref([])

async function loadData() {
  const res = await courseApi.myTeaching()
  courses.value = res.data
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
