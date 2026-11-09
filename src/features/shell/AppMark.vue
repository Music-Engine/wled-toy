<template>
  <!-- the same drawing as src-tauri/app-icon.svg, without the margin an app icon keeps around its tile -->
  <svg class="app-mark shrink-0" viewBox="100 100 824 824" aria-hidden="true">
    <defs>
      <linearGradient id="app-mark-ember" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ff8a4f" />
        <stop offset="1" stop-color="#e2502a" />
      </linearGradient>
    </defs>
    <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#app-mark-ember)" />
    <path d="M272 352 L380 680 L512 420 L644 680 L752 352" fill="none" stroke="#1c1412" stroke-width="84" stroke-linecap="round" stroke-linejoin="round" />
    <g fill="#fff4e8">
      <circle v-for="[x, y] in [[272, 352], [380, 680], [512, 420], [644, 680], [752, 352]]" :key="x" :cx="x" :cy="y" r="20" />
    </g>
  </svg>
</template>
