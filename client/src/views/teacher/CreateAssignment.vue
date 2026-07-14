<template>
  <div class="page-container">
    <div class="page-title">发布新作业</div>

    <div class="card-section" style="max-width:720px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="120px">
        <el-form-item label="作业标题" prop="title">
          <el-input v-model="form.title" placeholder="如：第三次平时作业" maxlength="100" show-word-limit />
        </el-form-item>

        <el-form-item label="所属课程" prop="course_id">
          <el-select v-model="form.course_id" placeholder="选择课程" style="width:100%" filterable>
            <el-option v-for="c in courses" :key="c.id"
              :label="`${c.name}（${c.class?.name || ''}）`" :value="c.id" />
          </el-select>
        </el-form-item>

        <el-form-item label="截止时间" prop="deadline">
          <el-date-picker v-model="form.deadline" type="datetime" placeholder="选择截止时间"
            format="YYYY-MM-DD HH:mm" value-format="YYYY-MM-DD HH:mm:ss"
            :disabled-date="(d)=>d<new Date(Date.now()-86400000)" style="width:100%" />
        </el-form-item>

        <el-form-item label="允许格式">
          <el-select v-model="form.allowed_formats" multiple placeholder="留空则允许全部" style="width:100%">
            <el-option v-for="f in formatOptions" :key="f" :label="f" :value="f" />
          </el-select>
        </el-form-item>

        <el-form-item label="最大文件数">
          <el-input-number v-model="form.max_files" :min="1" :max="20" />
        </el-form-item>

        <el-form-item label="单文件上限(MB)">
          <el-input-number v-model="form.max_size_mb" :min="1" :max="500" />
        </el-form-item>

        <el-form-item label="作业要求">
          <el-input v-model="form.description" type="textarea" :rows="5"
            placeholder="详细描述作业内容、提交要求等" maxlength="2000" show-word-limit />
        </el-form-item>

        <el-form-item>
          <el-button type="primary" size="large" :loading="submitting" @click="submit">发布作业</el-button>
          <el-button size="large" @click="$router.back()">取消</el-button>
        </el-form-item>
      </el-form>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { courseApi, assignmentApi } from '@/api'

const router = useRouter()
const formRef = ref()
const submitting = ref(false)
const courses = ref([])

const formatOptions = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'jpg', 'jpeg', 'png', 'gif', 'zip', 'rar', 'txt']

const form = reactive({
  title: '',
  course_id: null,
  deadline: '',
  allowed_formats: ['pdf', 'doc', 'docx', 'jpg', 'png', 'zip'],
  max_files: 5,
  max_size_mb: 100,
  description: ''
})

const rules = {
  title: [{ required: true, message: '请输入作业标题', trigger: 'blur' }],
  course_id: [{ required: true, message: '请选择课程', trigger: 'change' }],
  deadline: [{ required: true, message: '请选择截止时间', trigger: 'change' }]
}

async function loadCourses() {
  const res = await courseApi.myTeaching()
  courses.value = res.data
}

async function submit() {
  await formRef.value.validate(async (valid) => {
    if (!valid) return
    submitting.value = true
    try {
      await assignmentApi.create(form)
      ElMessage.success('作业发布成功')
      router.push('/teacher/assignments')
    } catch (e) {} finally { submitting.value = false }
  })
}

onMounted(loadCourses)
</script>
