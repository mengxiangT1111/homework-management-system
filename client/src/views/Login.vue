<template>
  <div class="auth-container">
    <AuthBrand />
    <div class="auth-panel">
      <div class="auth-box">
        <div class="auth-logo">
          <div class="logo-halo"><BrandLogo :size="62" /></div>
          <h1>欢迎回来</h1>
          <p>登录以继续使用信衡</p>
        </div>

      <el-form ref="formRef" :model="form" :rules="rules" size="large" @submit.prevent="handleLogin">
        <el-form-item prop="school_id">
          <el-select v-model="form.school_id" placeholder="选择学校（管理员不选）" clearable style="width:100%">
            <el-option v-for="s in schools" :key="s.id" :label="`${s.name}（${s.code}）`" :value="s.id" />
          </el-select>
        </el-form-item>
        <el-form-item prop="username">
          <el-input v-model="form.username" placeholder="请输入学号或工号" :prefix-icon="User" />
        </el-form-item>
        <el-form-item prop="password">
          <el-input v-model="form.password" type="password" placeholder="请输入密码" :prefix-icon="Lock" show-password
            @keyup.enter="handleLogin" />
        </el-form-item>

        <el-button type="primary" size="large" class="submit-btn" :loading="loading" @click="handleLogin">
          登 录
        </el-button>
      </el-form>

      <div class="auth-footer">
        <span>还没有账号？</span>
        <router-link to="/register" class="link">立即注册</router-link>
      </div>

      <p class="auth-copyright">信衡 XINHENG · 让每一分都可信</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { User, Lock } from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { schoolApi } from '@/api'
import BrandLogo from '@/components/BrandLogo.vue'
import AuthBrand from '@/components/AuthBrand.vue'

const router = useRouter()
const authStore = useAuthStore()
const formRef = ref()
const loading = ref(false)
const schools = ref([])

const form = reactive({ school_id: null, username: '', password: '' })
const rules = {
  username: [{ required: true, message: '请输入学号或工号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
}

onMounted(async () => {
  try {
    const res = await schoolApi.all()
    schools.value = res.data
  } catch (e) {}
})

async function handleLogin() {
  await formRef.value.validate(async (valid) => {
    if (!valid) return
    loading.value = true
    try {
      const data = await authStore.login(form)
      ElMessage.success('登录成功')
      router.push(`/${data.user.role}`)
    } catch (e) {
      // 错误已在拦截器处理
    } finally {
      loading.value = false
    }
  })
}
</script>

<style scoped>
/* 表单控件、按钮、页脚样式统一在 style.css 的认证页公共段维护 */
</style>
