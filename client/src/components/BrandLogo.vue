<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    class="brand-logo"
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="brandLogoG" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
        <stop stop-color="#52c4a0" />
        <stop offset="1" stop-color="#3da884" />
      </linearGradient>
    </defs>
    <rect width="64" height="64" rx="16" fill="url(#brandLogoG)" />
    <path
      d="M20 33.5 29 42.5 45 24.5"
      stroke="#fff"
      stroke-width="6.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</template>

<script setup>
defineProps({
  size: { type: [Number, String], default: 28 }
})
</script>

<style scoped>
.brand-logo {
  display: inline-block;
  flex-shrink: 0;
}
</style>
