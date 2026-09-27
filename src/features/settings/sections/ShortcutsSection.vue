<script setup lang="ts">
import { computed, ref } from 'vue'
import { commandTitle, commands, formatAccelerator } from '@/lib/app/commands'

const query = ref('')

// every command with a key, whatever mode the app is in: a reference that hid the graph keys while a shader is open would be half a reference
const groups = computed(() => {
  const words = query.value.toLowerCase().split(/\s+/).filter(Boolean)
  const byMenu = new Map<string, Array<{ id: string; title: string; keys: string[]; modes: string }>>()
  for (const command of commands.value) {
    if (!command.accelerator) continue
    const menu = command.menu.join(' › ')
    const keys = [command.accelerator, ...(command.aliases ?? [])].map((text) => formatAccelerator(text))
    const row = { id: command.id, title: commandTitle(command), keys, modes: command.modes?.map((mode) => mode[0].toUpperCase() + mode.slice(1)).join(', ') ?? '' }
    if (!words.every((word) => `${menu} ${row.title} ${keys.join(' ')}`.toLowerCase().includes(word))) continue
    byMenu.set(menu, [...(byMenu.get(menu) ?? []), row])
  }
  return [...byMenu].map(([menu, rows]) => ({ menu, rows }))
})
</script>

<template>
  <div class="sticky top-0 z-10 bg-(--app-floating) pt-3 pb-1">
    <input v-model="query" type="search" class="pref-input w-full" placeholder="Search by command, menu or key" aria-label="Search keyboard shortcuts">
  </div>
  <p v-if="!groups.length" class="py-6 text-center text-[13px] text-muted">No shortcut matches "{{ query }}"</p>
  <table v-else class="shortcuts w-full border-collapse text-[13px]">
    <caption class="sr-only">Keyboard shortcuts, read only</caption>
    <tbody v-for="group in groups" :key="group.menu">
      <tr>
        <th scope="colgroup" colspan="3" class="pref-group-title pt-3 text-start">{{ group.menu }}</th>
      </tr>
      <tr v-for="row in group.rows" :key="row.id" :data-command="row.id" class="border-b border-(--pref-line) last:border-b-0">
        <td class="h-[30px] pe-3">{{ row.title }}</td>
        <td class="pe-3 text-[12px] text-muted">{{ row.modes && `${row.modes} mode` }}</td>
        <td class="whitespace-nowrap text-end">
          <kbd v-for="keys in row.keys" :key="keys" class="pref-kbd">{{ keys }}</kbd>
        </td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.pref-kbd {
  display: inline-block;
  min-width: 22px;
  margin-inline-start: 6px;
  border: 1px solid var(--pref-line);
  border-radius: 4px;
  background: var(--ui-bg);
  padding: 1px 6px;
  font-family: inherit;
  font-size: 12px;
  letter-spacing: 0.04em;
  text-align: center;
  color: var(--ui-text-highlighted);
}
</style>
