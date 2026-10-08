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
          <el-select v-model="form.school_id" placeholder="选择学校" clearable style="width:100%">
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

        <div style="text-align:right;margin-top:4px">
          <a class="link" style="font-size:13px;cursor:pointer" @click="forgotVisible = true">忘记密码？</a>
        </div>
      </el-form>

      <!-- 密码找回（验证码经绑定邮箱下发，需管理员配置邮件服务） -->
      <el-dialog v-model="forgotVisible" title="找回密码" width="420px" append-to-body>
        <el-form label-width="0">
          <el-form-item>
            <el-input v-model="forgot.account" placeholder="用户名或绑定的邮箱" :prefix-icon="User">
              <template #append>
                <el-button :disabled="codeCooldown > 0" :loading="sendingCode" @click="sendCode">
                  {{ codeCooldown > 0 ? `${codeCooldown}s 后重发` : '发送验证码' }}
                </el-button>
              </template>
            </el-input>
          </el-form-item>
          <el-form-item>
            <el-input v-model="forgot.code" placeholder="6 位邮箱验证码" maxlength="6" />
          </el-form-item>
          <el-form-item>
            <el-input v-model="forgot.new_password" type="password" placeholder="新密码（至少 6 位）" show-password />
          </el-form-item>
          <el-alert type="info" :closable="false" style="margin-bottom:8px">
            验证码将发送到账号绑定的邮箱（可在「个人中心」绑定）；未绑定邮箱请联系管理员重置。
          </el-alert>
        </el-form>
        <template #footer>
          <el-button @click="forgotVisible = false">取消</el-button>
          <el-button type="primary" :loading="resetting" @click="doReset">重置密码</el-button>
        </template>
      </el-dialog>

      <p class="auth-agree-hint">登录即代表您已阅读并同意<a class="link" href="/privacy" target="_blank">《用户隐私保护指引》</a></p>

      <div class="auth-footer">
        <span>还没有账号？</span>
        <router-link to="/register" class="link">立即注册</router-link>
      </div>

      <p class="auth-copyright">信衡 XINHENG · 让每一分都可信</p>
      <a class="auth-beian" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">鲁ICP备2026049690号</a>
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
import { schoolApi, authApi } from '@/api'
import BrandLogo from '@/components/BrandLogo.vue'
import AuthBrand from '@/components/AuthBrand.vue'

const router = useRouter()
const authStore = useAuthStore()
const formRef = ref()
const loading = ref(false)
const schools = ref([])

const form = reactive({ school_id: null, username: '', password: '' })

// 密码找回
const forgotVisible = ref(false)
const sendingCode = ref(false)
const resetting = ref(false)
const codeCooldown = ref(0)
const forgot = reactive({ account: '', code: '', new_password: '' })

async function sendCode() {
  if (!forgot.account.trim()) { ElMessage.warning('请先输入用户名或绑定邮箱'); return }
  sendingCode.value = true
  try {
    const res = await authApi.forgotPassword({ account: forgot.account.trim() })
    ElMessage.success(res.message || '若该账号绑定了邮箱，验证码已发送')
    codeCooldown.value = 60
    const t = setInterval(() => {
      codeCooldown.value--
      if (codeCooldown.value <= 0) clearInterval(t)
    }, 1000)
  } catch (e) { /* request.js 统一提示（含 503 邮件服务未配置） */ }
  finally { sendingCode.value = false }
}

async function doReset() {
  if (!/^\d{6}$/.test(forgot.code)) { ElMessage.warning('请输入 6 位验证码'); return }
  if (forgot.new_password.length < 6) { ElMessage.warning('新密码至少 6 位'); return }
  resetting.value = true
  try {
    const res = await authApi.resetPassword({
      account: forgot.account.trim(),
      code: forgot.code,
      new_password: forgot.new_password
    })
    ElMessage.success(res.message || '密码已重置')
    forgotVisible.value = false
    forgot.code = ''
    forgot.new_password = ''
    form.username = forgot.account.trim()
  } catch (e) {} finally { resetting.value = false }
}
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
