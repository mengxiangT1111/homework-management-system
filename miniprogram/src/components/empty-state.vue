<template>
  <view class="empty">
    <view class="empty-badge">
      <text class="empty-icon">{{ icon }}</text>
    </view>
    <text class="empty-text">{{ text }}</text>
    <text v-if="sub" class="empty-sub">{{ sub }}</text>
  </view>
</template>

<script setup>
defineProps({
  text: { type: String, default: '暂无数据' },
  sub: { type: String, default: '' },
  icon: { type: String, default: '📭' }
})
</script>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 90rpx 0;
}
.empty-badge {
  width: 132rpx;
  height: 132rpx;
  border-radius: 50%;
  background: #e1f5ec;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 26rpx;
}
.empty-icon {
  font-size: 60rpx;
  line-height: 1;
}
.empty-text {
  color: #5f6f68;
  font-size: 28rpx;
  font-weight: 500;
}
.empty-sub {
  margin-top: 10rpx;
  color: #7d918a;
  font-size: 24rpx;
}
</style>
