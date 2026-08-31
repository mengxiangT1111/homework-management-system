<template>
  <div class="auth-brand">
    <i class="ab-grid" aria-hidden="true"></i>
    <i class="ab-glow g1" aria-hidden="true"></i>
    <i class="ab-glow g2" aria-hidden="true"></i>

    <div class="auth-brand-inner">
      <div class="ab-brand-row">
        <BrandLogo :size="46" class="ab-logo" />
        <div class="ab-brand-name">
          <strong>信衡</strong>
          <span>XINHENG · AI 智能批改工作台</span>
        </div>
      </div>

      <h2 class="ab-headline">
        衡量每一次努力，
        <br />
        信守<em>每一分公正</em>。
      </h2>
      <p class="ab-tagline">面向校园的一站式作业平台：在线提交、自动收集、图片查重、<span class="ab-nowrap">AI 批改</span>，全流程打通。</p>

      <ul class="ab-features">
        <li>
          <span class="ab-feat-icon"><el-icon><UploadFilled /></el-icon></span>
          <span>作业在线提交与收集，打包下载一键完成</span>
        </li>
        <li>
          <span class="ab-feat-icon"><el-icon><MagicStick /></el-icon></span>
          <span>AI 智能批改，多维评分与改进建议</span>
        </li>
        <li>
          <span class="ab-feat-icon"><el-icon><Aim /></el-icon></span>
          <span>图片查重与拓扑对比，可疑提交早发现</span>
        </li>
      </ul>

      <div class="ab-card" aria-hidden="true">
        <div class="ab-card-head">
          <span class="ab-card-badge">
            <el-icon><MagicStick /></el-icon>
            AI 批改报告
          </span>
          <span class="ab-card-score">92<i>分</i></span>
        </div>
        <div class="ab-card-bar"><i></i></div>
        <p class="ab-card-note">解题步骤完整、逻辑清晰，建议补充最后一步的推导过程。</p>
        <div class="ab-card-dims">
          <span>正确性 A</span>
          <span>规范性 A-</span>
          <span>创新性 B+</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import BrandLogo from './BrandLogo.vue'
import { UploadFilled, MagicStick, Aim } from '@element-plus/icons-vue'
</script>

<style scoped>
.auth-brand {
  flex: 0 0 46%;
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  padding: 56px 52px;
  background:
    radial-gradient(760px 500px at 84% 4%, rgba(0, 225, 143, 0.16), transparent 60%),
    radial-gradient(620px 520px at -8% 100%, rgba(0, 190, 125, 0.18), transparent 58%),
    linear-gradient(158deg, #0d4a37 0%, #093426 55%, #072a1e 100%);
  color: #fff;
}

.auth-brand-inner {
  position: relative;
  z-index: 1;
  max-width: 420px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

/* ---- 背景纹理与光晕 ---- */
.ab-grid {
  position: absolute;
  inset: 0;
  background-image: radial-gradient(rgba(255, 255, 255, 0.10) 1px, transparent 1px);
  background-size: 26px 26px;
  -webkit-mask-image: radial-gradient(620px 440px at 72% 28%, rgba(0, 0, 0, 0.55), transparent 75%);
  mask-image: radial-gradient(620px 440px at 72% 28%, rgba(0, 0, 0, 0.55), transparent 75%);
  pointer-events: none;
}
.ab-glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(70px);
  pointer-events: none;
}
.g1 {
  width: 480px;
  height: 480px;
  top: -160px;
  right: -140px;
  background: radial-gradient(circle, rgba(0, 225, 143, 0.38), transparent 65%);
  animation: ab-breathe 9s ease-in-out infinite;
}
.g2 {
  width: 420px;
  height: 420px;
  bottom: -180px;
  left: -160px;
  background: radial-gradient(circle, rgba(0, 180, 120, 0.30), transparent 65%);
  animation: ab-breathe 11s ease-in-out 1.5s infinite;
}

/* ---- 品牌行 ---- */
.ab-brand-row { display: flex; align-items: center; gap: 14px; }
.ab-logo { border-radius: 12px; box-shadow: 0 10px 26px -8px rgba(0, 225, 143, 0.45); }
.ab-brand-name strong { display: block; font-size: 19px; font-weight: 650; letter-spacing: 0.01em; }
.ab-brand-name span { display: block; margin-top: 2px; font-size: 12.5px; letter-spacing: 0.05em; color: rgba(255, 255, 255, 0.62); }

/* ---- 主标语 ---- */
.ab-headline {
  margin: 48px 0 0;
  font-size: clamp(26px, 2.3vw, 33px);
  line-height: 1.42;
  font-weight: 700;
  letter-spacing: 0.015em;
}
.ab-headline em {
  font-style: normal;
  background: linear-gradient(100deg, #6bffc4 0%, #00e18f 90%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.ab-tagline {
  margin: 14px 0 0;
  font-size: 14px;
  line-height: 1.8;
  color: rgba(255, 255, 255, 0.68);
}
.ab-nowrap { white-space: nowrap; }

/* ---- 特性列表（玻璃碎片卡） ---- */
.ab-features {
  list-style: none;
  margin: 30px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ab-features li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 16px 9px 10px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.10);
  backdrop-filter: blur(6px);
  font-size: 13.5px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.86);
}
.ab-feat-icon {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  font-size: 16px;
  background: linear-gradient(140deg, rgba(0, 225, 143, 0.32), rgba(0, 225, 143, 0.10));
  border: 1px solid rgba(0, 225, 143, 0.28);
  color: #7dffcf;
}

/* ---- AI 批改报告预览卡 ---- */
.ab-card {
  margin: 36px 6px 0 auto;
  width: 320px;
  padding: 16px 18px 15px;
  border-radius: 18px;
  background: linear-gradient(150deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.06));
  border: 1px solid rgba(255, 255, 255, 0.22);
  backdrop-filter: blur(10px);
  box-shadow: 0 24px 48px -20px rgba(0, 40, 25, 0.55);
  animation: ab-float 7s ease-in-out infinite;
}
.ab-card-head { display: flex; align-items: center; justify-content: space-between; }
.ab-card-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: #a9ffdd;
}
.ab-card-badge .el-icon { font-size: 15px; }
.ab-card-score {
  font-size: 26px;
  font-weight: 750;
  line-height: 1;
  background: linear-gradient(120deg, #7dffcf, #00e18f);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.ab-card-score i { font-style: normal; font-size: 13px; font-weight: 500; margin-left: 2px; }
.ab-card-bar {
  height: 6px;
  margin-top: 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
  overflow: hidden;
}
.ab-card-bar i {
  display: block;
  height: 100%;
  width: 92%;
  border-radius: inherit;
  background: linear-gradient(90deg, #00e18f, #7dffcf);
}
.ab-card-note {
  margin: 10px 0 0;
  font-size: 13px;
  line-height: 1.65;
  color: rgba(255, 255, 255, 0.78);
}
.ab-card-dims { display: flex; gap: 8px; margin-top: 12px; }
.ab-card-dims span {
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 999px;
  background: rgba(0, 225, 143, 0.14);
  border: 1px solid rgba(0, 225, 143, 0.25);
  color: #8affd0;
  white-space: nowrap;
}

/* ---- 动效 ---- */
@keyframes ab-float {
  0%, 100% { transform: translateY(0) rotate(-1.2deg); }
  50% { transform: translateY(-9px) rotate(-1.2deg); }
}
@keyframes ab-breathe {
  0%, 100% { opacity: 0.9; }
  50% { opacity: 0.55; }
}
@media (prefers-reduced-motion: reduce) {
  .ab-card, .ab-glow { animation: none; }
}

@media (max-width: 900px) {
  .auth-brand { display: none; }
}
</style>
