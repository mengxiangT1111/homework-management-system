<template>
  <div class="page-container">
    <div class="page-title">个人中心</div>

    <el-row :gutter="20">
      <el-col :xs="24" :md="10">
        <div class="card-section">
          <div class="avatar-area">
            <el-avatar :size="80" class="big-avatar">{{ authStore.realName.charAt(0) }}</el-avatar>
            <h3>{{ authStore.realName }}</h3>
            <el-tag :type="roleTagType" effect="plain">{{ roleText }}</el-tag>
            <p class="username">@{{ authStore.user?.username }}</p>
          </div>
        </div>
      </el-col>

      <el-col :xs="24" :md="14">
        <div class="card-section">
          <h3 style="margin-bottom:20px">基本信息</h3>
          <el-form :model="form" label-width="80px">
            <el-form-item label="姓名">
              <el-input v-model="form.real_name" />
            </el-form-item>
            <el-form-item label="邮箱">
              <el-input v-model="form.email" placeholder="请输入邮箱" />
            </el-form-item>
            <el-form-item label="手机">
              <el-input v-model="form.phone" placeholder="请输入手机号" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="saving" @click="saveProfile">保存修改</el-button>
            </el-form-item>
          </el-form>
        </div>

        <div class="card-section">
          <h3 style="margin-bottom:20px">修改密码</h3>
          <el-form :model="pwdForm" label-width="80px">
            <el-form-item label="原密码">
              <el-input v-model="pwdForm.old_password" type="password" show-password />
            </el-form-item>
            <el-form-item label="新密码">
              <el-input v-model="pwdForm.new_password" type="password" show-password />
            </el-form-item>
            <el-form-item>
              <el-button type="warning" :loading="changingPwd" @click="changePwd">修改密码</el-button>
            </el-form-item>
          </el-form>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { authApi } from '@/api'
import { ROLE, statusOf } from '@/utils/statusMaps'

const authStore = useAuthStore()

const form = reactive({ real_name: '', email: '', phone: '' })
const pwdForm = reactive({ old_password: '', new_password: '' })
const saving = ref(false)
const changingPwd = ref(false)

const roleText = computed(() => statusOf(ROLE, authStore.role).text)
const roleTagType = computed(() => statusOf(ROLE, authStore.role).type)

onMounted(() => {
  const u = authStore.user
  if (u) {
    form.real_name = u.real_name
    form.email = u.email || ''
    form.phone = u.phone || ''
  }
})

async function saveProfile() {
  saving.value = true
  try {
    await authApi.updateProfile(form)
    await authStore.fetchProfile()
    ElMessage.success('保存成功')
  } catch (e) {} finally { saving.value = false }
}

async function changePwd() {
  if (!pwdForm.old_password || !pwdForm.new_password) {
    ElMessage.warning('请填写完整'); return
  }
  changingPwd.value = true
  try {
    await authApi.changePassword(pwdForm)
    ElMessage.success('密码修改成功')
    pwdForm.old_password = ''
    pwdForm.new_password = ''
  } catch (e) {} finally { changingPwd.value = false }
}
</script>

<style scoped>
.avatar-area { text-align: center; padding: 20px 0; }
.big-avatar { background: var(--primary); color: white; font-size: 32px; font-weight: 600; margin-bottom: 16px; }
.avatar-area h3 { margin: 8px 0; justify-content: center; }
.username { color: var(--text-light); font-size: 13px; margin-top: 8px; }
</style>
