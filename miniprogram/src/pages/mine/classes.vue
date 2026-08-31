<template>
  <view class="page">
    <view class="card" style="margin-top: 24rpx;">
      <view class="sec-head">
        <text class="sec-title">我的班级</text>
        <text class="meta" v-if="myClasses.length">{{ myClasses.length }} 个</text>
      </view>
      <template v-if="myClasses.length">
        <view class="cls-item" v-for="c in myClasses" :key="c.id">
          <view class="icon-tile tile-blue"><text>🏫</text></view>
          <view class="cell-main">
            <text class="cell-title">{{ c.name }}</text>
            <text class="cell-sub">
              <template v-if="c.grade">{{ c.grade }} · </template>
              <template v-if="c.headTeacher">班主任 {{ c.headTeacher.real_name }}</template>
            </text>
          </view>
          <button class="btn-danger cls-btn" hover-class="hv" @click="leave(c)">退出班级</button>
        </view>
      </template>
      <empty-state v-else icon="🏫" text="还没有加入班级" />
    </view>

    <view class="card">
      <view class="sec-head">
        <text class="sec-title">浏览可加入的班级</text>
        <text class="meta" v-if="allClasses.length">{{ allClasses.length }} 个</text>
      </view>
      <template v-if="allClasses.length">
        <view class="cls-item" v-for="c in allClasses" :key="c.id">
          <view class="icon-tile tile-slate"><text>🎓</text></view>
          <view class="cell-main">
            <text class="cell-title">{{ c.name }}</text>
            <text class="cell-sub">
              <template v-if="c.grade">{{ c.grade }} · </template>
              <template v-if="c.headTeacher">班主任 {{ c.headTeacher.real_name }}</template>
            </text>
          </view>
          <text v-if="isJoined(c)" class="tag tag-success">已加入</text>
          <button v-else-if="!myClasses.length" class="btn-ghost cls-btn" hover-class="hv" @click="join(c)">加入</button>
        </view>
        <text class="hint" v-if="myClasses.length" style="display:block;margin-top:16rpx;">
          每位学生只能加入一个班级；如需换班请先退出当前班级
        </text>
      </template>
      <empty-state v-else icon="🔍" text="暂无可加入的班级" />
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { get, post } from '../../utils/request'

const myClasses = ref([])
const allClasses = ref([])

onShow(() => {
  load()
})

async function load() {
  try {
    myClasses.value = (await get('/api/classes/my/list')) || []
  } catch (e) {
    myClasses.value = []
  }
  try {
    // 服务端已按登录用户学校过滤
    allClasses.value = (await get('/api/classes/all/list')) || []
  } catch (e) {
    allClasses.value = []
  }
}

function isJoined(c) {
  return myClasses.value.some((m) => m.id === c.id)
}

function join(c) {
  uni.showModal({
    title: '加入班级',
    content: `确定加入「${c.name}」吗？`,
    success: async (r) => {
      if (!r.confirm) return
      try {
        await post('/api/classes/' + c.id + '/join')
        uni.showToast({ title: '加入成功', icon: 'success' })
        await load()
      } catch (e) {
        // 错误已提示（如"一个学生只能加入一个班级"）
      }
    }
  })
}

function leave(c) {
  uni.showModal({
    title: '退出班级',
    content: `确定退出「${c.name}」吗？退出后将无法提交该班课程作业`,
    success: async (r) => {
      if (!r.confirm) return
      try {
        await post('/api/classes/' + c.id + '/leave')
        uni.showToast({ title: '已退出', icon: 'none' })
        await load()
      } catch (e) {
        // 错误已提示
      }
    }
  })
}
</script>

<style scoped>
.cls-item {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 22rpx 0;
  border-bottom: 1rpx solid #f0f5f2;
}
.cls-item:last-child { border-bottom: none; }
.cls-btn {
  height: 68rpx;
  font-size: 24rpx;
  padding: 0 28rpx;
  flex-shrink: 0;
}
</style>
