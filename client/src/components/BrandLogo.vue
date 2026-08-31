<template>
  <img
    :src="logoUrl"
    :width="size"
    :height="size"
    class="brand-logo"
    alt="信衡"
    draggable="false"
  />
</template>

<script setup>
import logoUrl from '@/assets/logo.png'

defineProps({
  size: { type: [Number, String], default: 28 }
})
</script>

<style scoped>
.brand-logo {
  display: inline-block;
  flex-shrink: 0;
  object-fit: contain;
  /* PNG 已带圆角透明通道，这里保持一致的圆角比例兜底 */
  border-radius: 23%;
}
</style>
