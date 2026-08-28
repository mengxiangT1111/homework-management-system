<template>
  <div class="auth-brand">
    <div class="auth-brand-inner">
      <BrandLogo :size="44" />
      <div class="ab-name">作业管理系统</div>
      <p class="ab-tagline">面向校园的作业收发与 AI 批改工作台</p>
      <ul class="ab-features">
        <li>
          <el-icon><UploadFilled /></el-icon>
          <span>作业在线提交与收集，打包下载一键完成</span>
        </li>
        <li>
          <el-icon><MagicStick /></el-icon>
          <span>AI 智能批改，多维评分与改进建议</span>
        </li>
        <li>
          <el-icon><Aim /></el-icon>
          <span>图片查重与拓扑对比，可疑提交早发现</span>
        </li>
      </ul>
    </div>
    <i class="ab-ring r1" aria-hidden="true"></i>
    <i class="ab-ring r2" aria-hidden="true"></i>
    <i class="ab-ring r3" aria-hidden="true"></i>
  </div>
</template>

<script setup>
import BrandLogo from './BrandLogo.vue'
import { UploadFilled, MagicStick, Aim } from '@element-plus/icons-vue'
</script>

<style scoped>
.auth-brand {
  flex: 0 0 45%;
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  padding: 48px;
  background: linear-gradient(160deg, var(--brand-800) 0%, var(--brand-900) 100%);
  color: #fff;
}
.auth-brand-inner { position: relative; z-index: 1; max-width: 380px; }
.ab-name { font-size: 24px; font-weight: 650; letter-spacing: -0.01em; margin-top: 20px; }
.ab-tagline { margin-top: 10px; font-size: 14px; line-height: 1.7; color: rgba(255, 255, 255, 0.72); }

.ab-features {
  list-style: none;
  margin: 36px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.ab-features li {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  font-size: 14px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.88);
}
.ab-features .el-icon {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.10);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 装饰性同心圆环 */
.ab-ring { position: absolute; border: 1px solid rgba(255, 255, 255, 0.07); border-radius: 50%; }
.r1 { width: 520px; height: 520px; right: -180px; bottom: -220px; }
.r2 { width: 360px; height: 360px; right: -100px; bottom: -140px; }
.r3 { width: 200px; height: 200px; right: -20px; bottom: -60px; background: rgba(255, 255, 255, 0.03); }

@media (max-width: 900px) {
  .auth-brand { display: none; }
}
</style>
