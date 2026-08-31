<template>
  <view class="page">
    <view class="card" style="margin-top: 24rpx;">
      <view class="pwd-head">
        <view class="icon-tile tile-amber"><text>🔑</text></view>
        <view>
          <text class="sec-title" style="margin-bottom:4rpx;">修改密码</text>
          <text class="cell-sub">修改成功后需重新登录</text>
        </view>
      </view>
      <view class="form-item" style="margin-top:32rpx;">
        <text class="form-label">原密码</text>
        <input v-model="oldPassword" class="form-input" password placeholder="请输入原密码" placeholder-class="input-ph" />
      </view>
      <view class="form-item">
        <text class="form-label">新密码（不少于 6 位）</text>
        <input v-model="newPassword" class="form-input" password placeholder="请输入新密码" placeholder-class="input-ph" />
      </view>
      <view class="form-item">
        <text class="form-label">确认新密码</text>
        <input v-model="confirmPassword" class="form-input" password placeholder="请再次输入新密码" placeholder-class="input-ph" />
      </view>
      <button class="btn-primary save-btn" :class="{ hv: saving }" :disabled="saving" @click="save">
        {{ saving ? '保存中…' : '确认修改' }}
      </button>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { put } from '../../utils/request'
import { useAuthStore } from '../../stores/auth'

const auth = useAuthStore()
const oldPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const saving = ref(false)

async function save() {
  if (saving.value) return
  if (!oldPassword.value) return uni.showToast({ title: '请输入原密码', icon: 'none' })
  if (newPassword.value.length < 6) return uni.showToast({ title: '新密码不能少于 6 位', icon: 'none' })
  if (newPassword.value !== confirmPassword.value) {
    return uni.showToast({ title: '两次输入的新密码不一致', icon: 'none' })
  }
  saving.value = true
  try {
    await put('/api/auth/password', {
      old_password: oldPassword.value,
      new_password: newPassword.value
    })
    uni.showToast({ title: '修改成功，请重新登录', icon: 'none' })
    // 服务端不会主动失效旧 JWT，前端清空本地登录态并回登录页
    setTimeout(() => {
      auth.logout()
      uni.reLaunch({ url: '/pages/login/login' })
    }, 800)
  } catch (e) {
    // 错误已提示
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.pwd-head {
  display: flex;
  align-items: center;
  gap: 20rpx;
}
.save-btn { margin-top: 16rpx; }
.input-ph { color: #a8bdb4; }
</style>
