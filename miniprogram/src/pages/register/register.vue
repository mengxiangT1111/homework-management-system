<template>
  <view class="auth-page">
    <!-- 品牌头（对齐网页端深翠绿品牌面板，紧凑版） -->
    <view class="brand-head">
      <view class="brand-grid"></view>
      <view class="brand-glow g1"></view>
      <view class="brand-inner">
        <view class="brand-row">
          <image class="brand-logo" src="/static/logo.png" mode="aspectFill" />
          <view class="brand-name">
            <text class="brand-name-cn">信衡</text>
            <text class="brand-name-en">XINHENG · AI 智能批改工作台</text>
          </view>
        </view>
      </view>
    </view>

    <view class="auth-box">
      <text class="box-title">创建账号</text>
      <text class="box-sub">学生即时生效 · 教师需管理员审核</text>

      <!-- 身份选择（对齐网页端 radio-button 选中态：绿渐变） -->
      <view class="role-group">
        <view
          class="role-item"
          :class="{ active: role === 'student' }"
          hover-class="hv"
          @click="role = 'student'"
        >
          <text>👨‍🎓 学生</text>
        </view>
        <view
          class="role-item"
          :class="{ active: role === 'teacher' }"
          hover-class="hv"
          @click="role = 'teacher'"
        >
          <text>👨‍🏫 教师</text>
        </view>
      </view>

      <view class="field-label">学校</view>
      <picker mode="selector" :range="schoolNames" :value="schoolIndex" @change="onSchoolChange">
        <view class="field" :class="{ 'field-focus': focusedField === 'school' }">
          <text class="field-value" :class="{ 'field-ph': schoolIndex < 0 }">
            {{ schoolIndex >= 0 ? schoolNames[schoolIndex] : '请选择学校' }}
          </text>
          <text class="field-arrow">▾</text>
        </view>
      </picker>

      <view class="field-label">学号 / 工号</view>
      <view class="field" :class="{ 'field-focus': focusedField === 'username' }">
        <input
          v-model="username"
          class="field-input"
          placeholder="3-50 个字符，同校内唯一"
          placeholder-class="input-ph"
          @focus="focusedField = 'username'"
          @blur="focusedField = ''"
        />
      </view>

      <view class="field-label">真实姓名</view>
      <view class="field" :class="{ 'field-focus': focusedField === 'realName' }">
        <input
          v-model="realName"
          class="field-input"
          placeholder="请输入真实姓名"
          placeholder-class="input-ph"
          @focus="focusedField = 'realName'"
          @blur="focusedField = ''"
        />
      </view>

      <view class="field-label">密码（不少于 6 位）</view>
      <view class="field" :class="{ 'field-focus': focusedField === 'password' }">
        <input
          v-model="password"
          class="field-input"
          password
          placeholder="请设置密码"
          placeholder-class="input-ph"
          @focus="focusedField = 'password'"
          @blur="focusedField = ''"
        />
      </view>

      <view class="field-label">确认密码</view>
      <view class="field" :class="{ 'field-focus': focusedField === 'confirm' }">
        <input
          v-model="confirmPassword"
          class="field-input"
          password
          placeholder="请再次输入密码"
          placeholder-class="input-ph"
          @focus="focusedField = 'confirm'"
          @blur="focusedField = ''"
        />
      </view>

      <view class="field-label">手机号（选填）</view>
      <view class="field" :class="{ 'field-focus': focusedField === 'phone' }">
        <input
          v-model="phone"
          class="field-input"
          type="number"
          maxlength="11"
          placeholder="用于联系，可留空"
          placeholder-class="input-ph"
          @focus="focusedField = 'phone'"
          @blur="focusedField = ''"
        />
      </view>

      <button class="auth-btn" :class="{ disabled: loading }" :disabled="loading" @click="handleRegister">
        {{ loading ? '注册中…' : role === 'teacher' ? '提交注册（待审核）' : '注册并登录' }}
      </button>
    </view>

    <view class="auth-footer">
      <text>已有账号？</text>
      <text class="link" @click="goLogin">去登录</text>
    </view>
    <text class="auth-copyright">信衡 XINHENG · 让每一分都可信</text>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { get } from '../../utils/request'
import { useAuthStore } from '../../stores/auth'

const auth = useAuthStore()
const schools = ref([])
const schoolIndex = ref(-1)
const role = ref('student')
const username = ref('')
const realName = ref('')
const password = ref('')
const confirmPassword = ref('')
const phone = ref('')
const loading = ref(false)
// 纯视图状态：聚焦字段（对齐网页端输入框绿色聚焦光环）
const focusedField = ref('')

const schoolNames = computed(() => schools.value.map((s) => s.name))

onShow(() => {
  loadSchools()
})

async function loadSchools() {
  try {
    const list = await get('/api/schools/all', null, { silent: true })
    schools.value = list || []
    const lastId = uni.getStorageSync('lastSchoolId')
    if (lastId) {
      const idx = schools.value.findIndex((s) => s.id === lastId)
      if (idx >= 0) schoolIndex.value = idx
    }
  } catch (e) {
    schools.value = []
  }
}

function onSchoolChange(e) {
  schoolIndex.value = Number(e.detail.value)
}

async function handleRegister() {
  if (loading.value) return
  const school = schools.value[schoolIndex.value]
  if (!school) return uni.showToast({ title: '请选择学校', icon: 'none' })
  const name = username.value.trim()
  if (!name) return uni.showToast({ title: '请输入学号/工号', icon: 'none' })
  if (name.length < 3 || name.length > 50) {
    return uni.showToast({ title: '学号/工号长度需在 3-50 个字符之间', icon: 'none' })
  }
  if (!realName.value.trim()) return uni.showToast({ title: '请输入真实姓名', icon: 'none' })
  if (password.value.length < 6) return uni.showToast({ title: '密码不能少于 6 位', icon: 'none' })
  if (password.value !== confirmPassword.value) {
    return uni.showToast({ title: '两次输入的密码不一致', icon: 'none' })
  }
  if (phone.value && !/^1[3-9]\d{9}$/.test(phone.value)) {
    return uni.showToast({ title: '手机号格式不正确', icon: 'none' })
  }

  loading.value = true
  try {
    const result = await auth.register({
      username: name,
      password: password.value,
      real_name: realName.value.trim(),
      role: role.value,
      school_id: school.id,
      phone: phone.value || undefined
    })
    if (result.pendingReview) {
      uni.showModal({
        title: '注册成功',
        content: '教师账号需管理员审核通过后才能登录，请耐心等待',
        showCancel: false,
        success: () => goLogin()
      })
    } else {
      uni.setStorageSync('lastSchoolId', school.id)
      uni.showToast({ title: '注册成功', icon: 'success' })
      setTimeout(() => uni.reLaunch({ url: '/pages/index/index' }), 600)
    }
  } catch (e) {
    // 错误已提示（如"该学号/工号已在该校注册"、限流等）
  } finally {
    loading.value = false
  }
}

function goLogin() {
  uni.navigateBack()
}
</script>

<style scoped>
/* 与登录页同一套品牌视觉 */
.auth-page {
  min-height: 100vh;
  background: #f7faf8;
  padding-bottom: 40rpx;
}
.brand-head {
  position: relative;
  overflow: hidden;
  border-radius: 0 0 40rpx 40rpx;
  padding: 44rpx 44rpx 72rpx;
  background:
    radial-gradient(500rpx 340rpx at 84% 4%, rgba(0, 225, 143, 0.16), transparent 60%),
    linear-gradient(158deg, #0d4a37 0%, #093426 55%, #072a1e 100%);
}
.brand-grid {
  position: absolute;
  inset: 0;
  background-image: radial-gradient(rgba(255, 255, 255, 0.1) 2rpx, transparent 2rpx);
  background-size: 52rpx 52rpx;
  opacity: 0.55;
}
.brand-glow {
  position: absolute;
  border-radius: 50%;
}
.g1 {
  width: 380rpx;
  height: 380rpx;
  top: -130rpx;
  right: -110rpx;
  background: radial-gradient(circle, rgba(0, 225, 143, 0.32), transparent 65%);
}
.brand-inner {
  position: relative;
  z-index: 1;
}
.brand-row {
  display: flex;
  align-items: center;
  gap: 22rpx;
}
.brand-logo {
  width: 88rpx;
  height: 88rpx;
  border-radius: 22rpx;
  box-shadow: 0 16rpx 40rpx -12rpx rgba(0, 225, 143, 0.45);
}
.brand-name { display: flex; flex-direction: column; gap: 4rpx; }
.brand-name-cn {
  font-size: 36rpx;
  font-weight: 650;
  color: #ffffff;
  letter-spacing: 2rpx;
}
.brand-name-en {
  font-size: 21rpx;
  letter-spacing: 1rpx;
  color: rgba(255, 255, 255, 0.62);
}

.auth-box {
  position: relative;
  z-index: 2;
  margin: -48rpx 32rpx 0;
  background: #ffffff;
  border-radius: 40rpx;
  padding: 48rpx 48rpx 48rpx;
  box-shadow: 0 32rpx 96rpx -32rpx rgba(16, 80, 52, 0.35);
}
.box-title {
  display: block;
  font-size: 38rpx;
  font-weight: 700;
  color: #2c3e50;
  text-align: center;
}
.box-sub {
  display: block;
  text-align: center;
  margin-top: 10rpx;
  margin-bottom: 24rpx;
  font-size: 25rpx;
  color: #7d918a;
}

/* 身份切换（对齐网页端 radio-button 选中绿渐变） */
.role-group {
  display: flex;
  gap: 18rpx;
  margin-bottom: 10rpx;
}
.role-item {
  flex: 1;
  height: 88rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 24rpx;
  border: 2rpx solid #d3e0d9;
  background: #fbfdfc;
  font-size: 28rpx;
  color: #5f6f68;
  transition: all 0.18s ease;
}
.role-item.active {
  background: linear-gradient(135deg, #06dc8b, #00b867);
  border-color: transparent;
  color: #ffffff;
  font-weight: 600;
  box-shadow: 0 16rpx 36rpx -16rpx rgba(0, 184, 103, 0.55);
}

.field-label {
  font-size: 26rpx;
  color: #5f6f68;
  margin: 26rpx 4rpx 12rpx;
}
.field {
  display: flex;
  align-items: center;
  height: 88rpx;
  background: #fbfdfc;
  border: 2rpx solid #d3e0d9;
  border-radius: 22rpx;
  padding: 0 26rpx;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}
.field-focus {
  border-color: #00b867;
  box-shadow: 0 0 0 6rpx rgba(0, 225, 143, 0.17);
}
.field-value {
  flex: 1;
  font-size: 28rpx;
  color: #2c3e50;
}
.field-ph { color: #a8bdb4; }
.field-arrow {
  color: #a8bdb4;
  font-size: 26rpx;
  margin-left: 12rpx;
}
.field-input {
  flex: 1;
  height: 100%;
  font-size: 28rpx;
  color: #2c3e50;
}
.input-ph { color: #a8bdb4; }

.auth-btn {
  width: 100%;
  height: 96rpx;
  margin-top: 44rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 24rpx;
  background: linear-gradient(135deg, #06dc8b 0%, #00b867 100%);
  box-shadow: 0 24rpx 52rpx -20rpx rgba(0, 184, 103, 0.55);
  color: #ffffff;
  font-size: 32rpx;
  font-weight: 600;
  letter-spacing: 4rpx;
}
.auth-btn.disabled { opacity: 0.7; }

.auth-footer {
  margin-top: 40rpx;
  font-size: 26rpx;
  color: #5f6f68;
  text-align: center;
}
.link {
  color: #00794e;
  font-weight: 550;
  margin-left: 6rpx;
}
.auth-copyright {
  display: block;
  text-align: center;
  margin-top: 24rpx;
  font-size: 22rpx;
  letter-spacing: 1rpx;
  color: #a8bdb4;
}
</style>
