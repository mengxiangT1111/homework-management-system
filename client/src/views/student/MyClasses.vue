<template>
  <div class="page-container">
    <div class="page-title">我的班级</div>

    <div class="card-section">
      <div v-if="classes.length === 0" class="empty-box">
        <el-icon :size="48"><School /></el-icon>
        <p style="margin-top:12px">你还没有加入任何班级</p>
        <el-button type="primary" style="margin-top:16px" @click="showJoin = true">加入班级</el-button>
      </div>

      <el-row :gutter="20">
        <el-col v-for="cls in classes" :key="cls.id" :xs="24" :sm="12" :md="8">
          <div class="class-card">
            <div class="class-icon">🏫</div>
            <h3>{{ cls.name }}</h3>
            <p class="class-grade">{{ cls.grade }}</p>
            <p class="class-teacher">班主任：{{ cls.headTeacher?.real_name || '未指定' }}</p>
            <el-button type="danger" plain size="small" style="margin-top:12px" @click="leaveClass(cls)">退出班级</el-button>
          </div>
        </el-col>
      </el-row>

      <div v-if="classes.length > 0" style="margin-top:16px">
        <el-button type="primary" plain @click="showJoin = true">+ 加入更多班级</el-button>
      </div>
    </div>

    <!-- 加入班级对话框 -->
    <el-dialog v-model="showJoin" title="选择班级加入" width="500px">
      <el-select v-model="selectedClass" placeholder="请选择班级" style="width:100%" filterable>
        <el-option v-for="c in availableClasses" :key="c.id" :label="`${c.grade} - ${c.name}`" :value="c.id" />
      </el-select>
      <template #footer>
        <el-button @click="showJoin = false">取消</el-button>
        <el-button type="primary" :loading="joining" @click="joinClass">确认加入</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { School } from '@element-plus/icons-vue'
import { classApi } from '@/api'

const classes = ref([])
const allClasses = ref([])
const showJoin = ref(false)
const selectedClass = ref(null)
const joining = ref(false)

const myClassIds = computed(() => new Set(classes.value.map(c => c.id)))
const availableClasses = computed(() => allClasses.value.filter(c => !myClassIds.value.has(c.id)))

async function loadData() {
  const [my, all] = await Promise.all([classApi.myClasses(), classApi.all()])
  classes.value = my.data
  allClasses.value = all.data
}

async function joinClass() {
  if (!selectedClass.value) { ElMessage.warning('请选择班级'); return }
  joining.value = true
  try {
    await classApi.join(selectedClass.value)
    ElMessage.success('加入成功')
    showJoin.value = false
    selectedClass.value = null
    loadData()
  } catch (e) {} finally { joining.value = false }
}

async function leaveClass(cls) {
  try {
    await ElMessageBox.confirm(`确定退出「${cls.name}」？退出后需重新加入才能查看班级课程。`, '退出确认', { type: 'warning' })
    await classApi.leave(cls.id)
    ElMessage.success('已退出班级')
    loadData()
  } catch (e) {}
}

onMounted(loadData)
</script>

<style scoped>
.class-card {
  background: var(--bg); border-radius: var(--radius); padding: 24px;
  text-align: center; margin-bottom: 16px; transition: all 0.3s;
}
.class-card:hover { box-shadow: var(--shadow-hover); transform: translateY(-2px); }
.class-icon { font-size: 40px; }
.class-card h3 { margin: 12px 0 6px; }
.class-grade { color: var(--text-light); font-size: 13px; }
.class-teacher { color: var(--text-light); font-size: 13px; margin-top: 4px; }
</style>
