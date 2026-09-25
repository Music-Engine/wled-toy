<script setup lang="ts">
import { useEngine } from '@/lib/engine/engine'
import { config } from '@/lib/app/config'

const { stats } = useEngine().bridge
</script>

<template>
  <span class="live">
    <span class="live-dot" />
    <span class="live-label">Live</span>
    <span class="live-readout">{{ stats.sendFps.toFixed(0) }}/{{ config.fps }} fps</span>
  </span>
</template>

<!-- plain CSS, not utilities: the browser test reads these computed styles without the Tailwind pipeline -->
<style scoped>
.live {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.live-dot {
  position: relative;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ui-primary);
}

.live-dot::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: var(--ui-primary);
  animation: live-pulse 1.6s ease-out infinite;
}

.live-label {
  color: var(--ui-primary);
  font-weight: 600;
}

.live-readout {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

@keyframes live-pulse {
  from { opacity: 0.7; transform: scale(1); }
  to { opacity: 0; transform: scale(3.2); }
}

@media (prefers-reduced-motion: reduce) {
  .live-dot::after { animation: none; opacity: 0; }
}
</style>
