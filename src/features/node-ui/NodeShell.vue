<script setup lang="ts">
defineProps<{ title: string; color: string; collapsed: boolean; selected?: boolean; warnings?: string[]; source?: boolean; wide?: boolean }>()
defineEmits<{ toggle: [] }>()
</script>

<template>
  <div class="nui nui-node" :class="{ 'is-selected': selected, 'is-error': warnings?.length, 'is-collapsed': collapsed, 'is-source': source, 'is-wide': wide }">
    <div class="nui-header" :style="{ background: color }">
      <!-- a collapsed node keeps its sockets, spread along the header's edges, so links stay attached -->
      <div v-if="collapsed" class="nui-folded is-in"><slot name="folded-in" /></div>
      <button type="button" class="nui-collapse nodrag" :aria-label="collapsed ? 'Expand node' : 'Collapse node'" :aria-expanded="!collapsed" @click="$emit('toggle')">
        <svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      <span class="nui-title">{{ title }}</span>
      <svg v-if="warnings?.length" class="nui-warning" viewBox="0 0 24 24" fill="currentColor" role="img" :aria-label="warnings.join('. ')">
        <title>{{ warnings.join('\n') }}</title>
        <path d="M12 2 1 21h22L12 2zm-1 7h2v6h-2V9zm0 8h2v2h-2v-2z" />
      </svg>
      <div v-if="collapsed" class="nui-folded is-out"><slot name="folded-out" /></div>
    </div>
    <div v-if="!collapsed" class="nui-content">
      <slot />
    </div>
  </div>
</template>
