<script setup>
import { onLaunch } from '@dcloudio/uni-app'
import { useAuthStore } from './stores/auth'

onLaunch(() => {
  const auth = useAuthStore()
  // 自动登录由入口页（login）接管：登录页能据此展示"正在自动进入"状态，
  // 避免已登录用户冷启动先看到可交互的登录表单闪现。
  // 这里只负责一件事：请求层 401 清 Storage 后，同步清 pinia 内存登录态
  // （reLaunch 前的窗口期内页面不会再读到过期登录态）。
  uni.$on('auth:unauthorized', () => auth.logout())
})
</script>

<style>
/* ============================================================
   设计系统 —— 与网页端 client/src/assets/style.css 设计令牌对齐
   bg=ink-50 #f7faf8 · 正文=ink-800 #2c3e50 · 次要=ink-600 #5f6f68
   品牌锚点 #52c4a0 · 实心按钮 #3da884(brand-600) · 文字级品牌 #2f8065(brand-700)
   卡片 = 白底 + 1px ink-100 边框 + 阴影 rgba(30,77,68,.05)（纯黑影弃用）
   ============================================================ */
view, text, button, input, textarea, image, picker {
  box-sizing: border-box;
}

page {
  background: #f7faf8;
  color: #2c3e50;
  font-size: 28rpx;
}

/* ---- 卡片（对齐 .card-section：边框 + 极浅品牌阴影） ---- */
.card {
  background: #ffffff;
  border: 1rpx solid #f0f5f2;
  border-radius: 24rpx;
  padding: 28rpx;
  margin: 0 20rpx 20rpx;
  box-shadow: 0 2rpx 8rpx rgba(30, 77, 68, 0.05);
}

/* ---- 页面级标题（对齐 .page-title：渐变竖条前缀） ---- */
.pt {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 28rpx 24rpx 8rpx;
}
.pt-bar {
  width: 8rpx;
  height: 40rpx;
  border-radius: 4rpx;
  background: linear-gradient(180deg, #52c4a0, #2f8065);
}
.pt-text {
  font-size: 38rpx;
  font-weight: 650;
  color: #2c3e50;
  letter-spacing: -0.5rpx;
}
.pt-desc {
  display: block;
  padding: 8rpx 24rpx 0 48rpx;
  font-size: 25rpx;
  color: #5f6f68;
}

/* ---- 区块标题行 ---- */
.sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 22rpx;
}
.sec-title {
  font-size: 29rpx;
  font-weight: 600;
  color: #2c3e50;
}
.sec-act {
  font-size: 24rpx;
  color: #2f8065;
  font-weight: 500;
}

/* ---- 状态胶囊（对齐 Element Plus tag：light-9 底 + dark-2 文字） ---- */
.tag {
  display: inline-flex;
  align-items: center;
  gap: 8rpx;
  padding: 6rpx 18rpx;
  border-radius: 999rpx;
  font-size: 22rpx;
  font-weight: 500;
  line-height: 1.5;
  flex-shrink: 0;
}
.tag-primary { color: #419d80; background: #edf9f5; }
.tag-success { color: #308669; background: #ebf6f2; }
.tag-warning { color: #b88130; background: #fcf5eb; }
.tag-danger  { color: #c45656; background: #fef0f0; }
.tag-info    { color: #73757a; background: #f3f3f3; }

/* ---- 按钮（实心 brand-600，对齐 .el-button--primary 升档） ---- */
button { padding: 0; }
button::after { border: none; }
.btn-primary {
  height: 88rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 16rpx;
  background: #3da884;
  box-shadow: 0 4rpx 12rpx rgba(61, 168, 132, 0.28);
  color: #ffffff;
  font-size: 30rpx;
  font-weight: 600;
}
.btn-ghost {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #ffffff;
  color: #47544e;
  border: 1rpx solid #d3e0d9;
  border-radius: 16rpx;
  font-size: 26rpx;
  font-weight: 500;
}
.btn-danger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #fef0f0;
  color: #c45656;
  border: 1rpx solid #fde1e1;
  border-radius: 16rpx;
  font-size: 26rpx;
  font-weight: 500;
}
/* 触摸反馈：配 hover-class="hv" 使用 */
.hv {
  opacity: 0.55;
  transform: scale(0.97);
  filter: brightness(0.97);
}

/* ---- 图标块 / 头像（Element Plus light-9 底色体系） ---- */
.icon-tile {
  width: 72rpx;
  height: 72rpx;
  border-radius: 16rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 36rpx;
  flex-shrink: 0;
}
.tile-mint  { background: #edf9f5; }
.tile-blue  { background: #ecf5fe; }
.tile-amber { background: #fcf5eb; }
.tile-slate { background: #f3f3f3; }
.tile-red   { background: #fef0f0; }

.avatar {
  flex-shrink: 0;
  position: relative;
  border-radius: 50%;
  background: #e1f5ec;
  color: #2f8065;
  font-weight: 600;
  overflow: hidden;
}
/* 绝对定位居中：规避 flex 对 CJK 字形的偏上渲染 */
.avatar text {
  position: absolute;
  left: 50%;
  top: 54%;
  transform: translate(-50%, -50%);
  line-height: 1;
}
.av-56 { width: 56rpx; height: 56rpx; font-size: 24rpx; }
.av-72 { width: 72rpx; height: 72rpx; font-size: 28rpx; }
.av-96 { width: 96rpx; height: 96rpx; font-size: 36rpx; }

/* ---- 进度条（EP progress：primary 实色填充） ---- */
.prog-track {
  height: 14rpx;
  background: #f0f5f2;
  border-radius: 999rpx;
  overflow: hidden;
}
.prog-fill {
  height: 100%;
  border-radius: 999rpx;
  background: #52c4a0;
  transition: width 0.3s;
}

/* ---- 列表行 / 菜单格 ---- */
.cell {
  display: flex;
  align-items: center;
  gap: 22rpx;
  padding: 24rpx 0;
  border-bottom: 1rpx solid #f0f5f2;
}
.cell:last-child { border-bottom: none; }
.cell-main { flex: 1; min-width: 0; }
.cell-title {
  display: block;
  font-size: 29rpx;
  font-weight: 500;
  color: #2c3e50;
}
.cell-sub {
  display: block;
  font-size: 24rpx;
  color: #7d918a;
  margin-top: 6rpx;
}
.cell-arrow {
  color: #a8bdb4;
  font-size: 30rpx;
  flex-shrink: 0;
}

/* ---- 文字（ink 色阶） ---- */
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.meta { font-size: 24rpx; color: #7d918a; }
.hint { font-size: 24rpx; color: #7d918a; line-height: 1.6; }
.danger-text { color: #f56c6c; }
.ellipsis { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ellipsis-2 {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

/* ---- 格式 chips ---- */
.chips { display: flex; flex-wrap: wrap; gap: 14rpx; }
.chip {
  padding: 8rpx 24rpx;
  border-radius: 999rpx;
  font-size: 24rpx;
  background: #f0f5f2;
  color: #47544e;
}
.chip.active {
  background: #e1f5ec;
  color: #2f8065;
  font-weight: 500;
}

/* ---- 表单（对齐 auth 输入框：浅底 + ink-300 描边；原生 input 必须显式高度） ---- */
.form-item { margin-bottom: 30rpx; }
.form-label {
  display: block;
  font-size: 26rpx;
  color: #5f6f68;
  margin-bottom: 14rpx;
}
.form-input {
  width: 100%;
  box-sizing: border-box;
  height: 88rpx;
  background: #fbfdfc;
  border: 1rpx solid #d3e0d9;
  border-radius: 16rpx;
  padding: 0 24rpx;
  font-size: 28rpx;
  color: #2c3e50;
}
.form-textarea {
  width: 100%;
  box-sizing: border-box;
  height: 180rpx;
  background: #fbfdfc;
  border: 1rpx solid #d3e0d9;
  border-radius: 16rpx;
  padding: 20rpx 24rpx;
  font-size: 28rpx;
  line-height: 1.6;
  color: #2c3e50;
}
.picker-value {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 88rpx;
  background: #fbfdfc;
  border: 1rpx solid #d3e0d9;
  border-radius: 16rpx;
  padding: 0 24rpx;
  font-size: 28rpx;
  color: #2c3e50;
}
.picker-value.placeholder { color: #a8bdb4; }

/* ---- 底部固定操作条 ---- */
.fixbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 20rpx 20rpx calc(20rpx + env(safe-area-inset-bottom));
  background: rgba(247, 250, 248, 0.96);
  border-top: 1rpx solid #f0f5f2;
  z-index: 10;
}

/* ---- 底部弹层（对齐 el-dialog：radius-xl + shadow-lg + 深绿蒙层） ---- */
.sheet-mask {
  position: fixed;
  inset: 0;
  background: rgba(23, 43, 36, 0.42);
  z-index: 99;
  display: flex;
  align-items: flex-end;
}
.sheet {
  width: 100%;
  background: #ffffff;
  border-radius: 32rpx 32rpx 0 0;
  padding: 36rpx 32rpx calc(32rpx + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  max-height: 80vh;
}
.sheet-title {
  font-size: 32rpx;
  font-weight: 700;
  color: #2c3e50;
  margin-bottom: 28rpx;
  text-align: center;
}

.loading-more {
  text-align: center;
  color: #7d918a;
  font-size: 24rpx;
  padding: 26rpx 0;
  animation: pulse 1.4s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
}
</style>
