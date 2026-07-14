<template>
  <div class="auth-container">
    <div class="auth-box">
      <div class="auth-logo">
        <div class="logo-icon">📚</div>
        <h1>注册新账号</h1>
        <p>加入校园作业管理系统</p>
      </div>

      <el-form ref="formRef" :model="form" :rules="rules" size="large" @submit.prevent="handleRegister">
        <el-form-item prop="username">
          <el-input v-model="form.username" placeholder="用户名（3-50字符）" :prefix-icon="User" />
        </el-form-item>
        <el-form-item prop="real_name">
          <el-input v-model="form.real_name" placeholder="真实姓名" :prefix-icon="Postcard" />
        </el-form-item>
        <el-form-item prop="password">
          <el-input v-model="form.password" type="password" placeholder="密码（至少6位）" :prefix-icon="Lock" show-password />
        </el-form-item>
        <el-form-item prop="confirmPassword">
          <el-input v-model="form.confirmPassword" type="password" placeholder="确认密码" :prefix-icon="Lock" show-password />
        </el-form-item>
        <el-form-item prop="role">
          <el-radio-group v-model="form.role" style="width:100%">
            <el-radio-button value="student" style="width:50%">🎓 我是学生</el-radio-button>
            <el-radio-button value="teacher" style="width:50%">👨‍🏫 我是教师</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item prop="email">
          <el-input v-model="form.email" placeholder="邮箱（选填）" :prefix-icon="Message" />
        </el-form-item>

        <el-button type="primary" size="large" :loading="loading" style="width:100%" @click="handleRegister">
          注 册
        </el-button>
      </el-form>

      <div class="auth-footer">
        <span>已有账号？</span>
        <router-link to="/login" class="link">返回登录</router-link>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { User, Lock, Postcard, Message } from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const authStore = useAuthStore()
const formRef = ref()
const loading = ref(false)

const form = reactive({
  username: '', real_name: '', password: '', confirmPassword: '',
  role: 'student', email: ''
})

const validatePass2 = (rule, value, callback) => {
  if (value !== form.password) callback(new Error('两次输入的密码不一致'))
  else callback()
}

const rules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 3, max: 50, message: '长度 3-50 字符', trigger: 'blur' }
  ],
  real_name: [{ required: true, message: '请输入真实姓名', trigger: 'blur' }],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '至少 6 位', trigger: 'blur' }
  ],
  confirmPassword: [
    { required: true, message: '请确认密码', trigger: 'blur' },
    { validator: validatePass2, trigger: 'blur' }
  ],
  role: [{ required: true, message: '请选择角色', trigger: 'change' }]
}

async function handleRegister() {
  await formRef.value.validate(async (valid) => {
    if (!valid) return
    loading.value = true
    try {
      const data = await authStore.register({
        username: form.username,
        real_name: form.real_name,
        password: form.password,
        role: form.role,
        email: form.email
      })
      ElMessage.success('注册成功')
      router.push(`/${data.user.role}`)
    } catch (e) {} finally {
      loading.value = false
    }
  })
}
</script>

<style scoped>
.auth-footer {
  text-align: center; margin-top: 20px;
  font-size: 14px; color: var(--text-light);
}
.link { color: var(--primary); margin-left: 4px; }
.link:hover { text-decoration: underline; }
</style>
