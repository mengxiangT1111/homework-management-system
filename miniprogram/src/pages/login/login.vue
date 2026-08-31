<template>
  <view class="auth-page">
    <!-- 品牌头（对齐网页端左侧深翠绿品牌面板） -->
    <view class="brand-head">
      <view class="brand-grid"></view>
      <view class="brand-glow g1"></view>
      <view class="brand-glow g2"></view>
      <view class="brand-inner">
        <view class="brand-row">
          <image class="brand-logo" src="/static/logo.png" mode="aspectFill" />
          <view class="brand-name">
            <text class="brand-name-cn">信衡</text>
            <text class="brand-name-en">XINHENG · AI 智能批改工作台</text>
          </view>
        </view>
        <view class="brand-slogan">
          <text class="slogan-line">衡量每一次努力，</text>
          <text class="slogan-line slogan-em">信守每一分公正。</text>
        </view>
      </view>
    </view>

    <!-- 登录卡（对齐网页端右侧 auth-box） -->
    <view class="auth-box">
      <text class="box-title">欢迎回来</text>
      <text class="box-sub">登录以继续使用信衡</text>

      <view class="field-label">学校</view>
      <picker mode="selector" :range="schoolNames" :value="schoolIndex" @change="onSchoolChange">
        <view class="field" :class="{ 'field-focus': focusedField === 'school' }">
          <text class="field-icon">🏫</text>
          <text class="field-value" :class="{ 'field-ph': schoolIndex < 0 }">
            {{ schoolIndex >= 0 ? schoolNames[schoolIndex] : '选择学校' }}
          </text>
          <text class="field-arrow">▾</text>
        </view>
      </picker>

      <view class="field-label">学号 / 工号</view>
      <view class="field" :class="{ 'field-focus': focusedField === 'username' }">
        <text class="field-icon">👤</text>
        <input
          v-model="username"
          class="field-input"
          placeholder="请输入学号或工号"
          placeholder-class="input-ph"
          @focus="focusedField = 'username'"
          @blur="focusedField = ''"
        />
      </view>

      <view class="field-label">密码</view>
      <view class="field" :class="{ 'field-focus': focusedField === 'password' }">
        <text class="field-icon">🔒</text>
        <input
          v-model="password"
          class="field-input"
          password
          placeholder="请输入密码"
          placeholder-class="input-ph"
          @focus="focusedField = 'password'"
          @blur="focusedField = ''"
        />
      </view>

      <button class="auth-btn" hover-class="hv" :class="{ disabled: loading }" :disabled="loading" @click="handleLogin">
        {{ loading ? '登录中…' : '登 录' }}
      </button>

      <view class="to-register">
        <text class="to-register-q">还没有账号？</text>
        <text class="link" @click="goRegister">立即注册</text>
      </view>
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
const username = ref('')
const password = ref('')
const loading = ref(false)
// 纯视图状态：聚焦字段
const focusedField = ref('')

const schoolNames = computed(() => schools.value.map((s) => s.name))

onShow(() => {
  loadSchools()
})

async function loadSchools() {
  try {
    const list = await get('/api/schools/all', null, { silent: true })
    schools.value = list || []
    // 恢复上次选择的学校
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

async function handleLogin() {
  if (loading.value) return
  const school = schools.value[schoolIndex.value]
  if (!school) return uni.showToast({ title: '请选择学校', icon: 'none' })
  if (!username.value.trim()) return uni.showToast({ title: '请输入学号或工号', icon: 'none' })
  if (!password.value) return uni.showToast({ title: '请输入密码', icon: 'none' })

  loading.value = true
  try {
    await auth.login(username.value.trim(), password.value, school.id)
    uni.setStorageSync('lastSchoolId', school.id)
    uni.reLaunch({ url: '/pages/index/index' })
  } catch (e) {
    // 错误提示已在请求层/登录逻辑内处理
  } finally {
    loading.value = false
  }
}

function goRegister() {
  uni.navigateTo({ url: '/pages/register/register' })
}
</script>

<style scoped>
.auth-page {
  min-height: 100vh;
  background: #f7faf8;
}

/* ---- 品牌头：对齐网页端 .auth-brand 深翠绿面板 ---- */
.brand-head {
  position: relative;
  z-index: 0;
  overflow: hidden;
  border-radius: 0 0 40rpx 40rpx;
  padding: 64rpx 44rpx 96rpx;
  background:
    radial-gradient(500rpx 340rpx at 84% 4%, rgba(0, 225, 143, 0.16), transparent 60%),
    radial-gradient(420rpx 360rpx at -8% 100%, rgba(0, 190, 125, 0.18), transparent 58%),
    linear-gradient(158deg, #0d4a37 0%, #093426 55%, #072a1e 100%);
}
/* 点阵纹理（对齐 .ab-grid） */
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
  width: 420rpx;
  height: 420rpx;
  top: -140rpx;
  right: -120rpx;
  background: radial-gradient(circle, rgba(0, 225, 143, 0.32), transparent 65%);
}
.g2 {
  width: 340rpx;
  height: 340rpx;
  bottom: -160rpx;
  left: -120rpx;
  background: radial-gradient(circle, rgba(0, 190, 120, 0.25), transparent 65%);
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
  width: 96rpx;
  height: 96rpx;
  border-radius: 24rpx;
  box-shadow: 0 16rpx 40rpx -12rpx rgba(0, 225, 143, 0.45);
}
.brand-name { display: flex; flex-direction: column; gap: 4rpx; }
.brand-name-cn {
  font-size: 38rpx;
  font-weight: 650;
  color: #ffffff;
  letter-spacing: 2rpx;
}
.brand-name-en {
  font-size: 22rpx;
  letter-spacing: 1rpx;
  color: rgba(255, 255, 255, 0.62);
}
.brand-slogan {
  margin-top: 48rpx;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}
.slogan-line {
  font-size: 44rpx;
  font-weight: 700;
  line-height: 1.42;
  color: #ffffff;
  letter-spacing: 1rpx;
}
/* 对齐 .ab-headline em 的亮绿强调 */
.slogan-em {
  color: #4de8ae;
}

/* ---- 登录卡：叠在品牌头上 ---- */
.auth-box {
  position: relative;
  z-index: 2;
  margin: -64rpx 32rpx 0;
  background: #ffffff;
  border-radius: 40rpx;
  padding: 52rpx 48rpx 48rpx;
  box-shadow: 0 32rpx 96rpx -32rpx rgba(16, 80, 52, 0.35);
}
.box-title {
  display: block;
  font-size: 40rpx;
  font-weight: 700;
  color: #2c3e50;
  text-align: center;
}
.box-sub {
  display: block;
  text-align: center;
  margin-top: 10rpx;
  margin-bottom: 20rpx;
  font-size: 25rpx;
  color: #7d918a;
}

.field-label {
  font-size: 26rpx;
  color: #5f6f68;
  margin: 28rpx 4rpx 12rpx;
}
.field {
  display: flex;
  align-items: center;
  height: 96rpx;
  background: #fbfdfc;
  border: 2rpx solid #d3e0d9;
  border-radius: 24rpx;
  padding: 0 26rpx;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}
.field-focus {
  border-color: #00b867;
  box-shadow: 0 0 0 6rpx rgba(0, 225, 143, 0.17);
}
.field-icon {
  font-size: 28rpx;
  margin-right: 16rpx;
  flex-shrink: 0;
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

/* 对齐网页端 auth 主按钮：亮绿渐变 */
.auth-btn {
  width: 100%;
  height: 96rpx;
  margin-top: 48rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 24rpx;
  background: linear-gradient(135deg, #06dc8b 0%, #00b867 100%);
  box-shadow: 0 24rpx 52rpx -20rpx rgba(0, 184, 103, 0.55);
  color: #ffffff;
  font-size: 32rpx;
  font-weight: 600;
  letter-spacing: 8rpx;
}
.auth-btn.disabled { opacity: 0.7; }

.to-register {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6rpx;
  margin-top: 36rpx;
  font-size: 26rpx;
  color: #5f6f68;
}
/* 对齐 .auth-footer .link */
.link {
  color: #00794e;
  font-weight: 600;
}

.auth-copyright {
  display: block;
  text-align: center;
  margin: 40rpx 0;
  font-size: 22rpx;
  letter-spacing: 1rpx;
  color: #a8bdb4;
}
</style>
