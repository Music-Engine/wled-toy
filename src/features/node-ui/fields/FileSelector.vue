<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

export interface FileListing {
  id: string
  name: string
  thumbnailUrl?: string
  /** Built-in entries cannot be renamed. */
  fixed?: boolean
}

const props = defineProps<{ modelValue: string | null; files: FileListing[]; label: string; accept: string; linkable?: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [id: string | null]
  upload: [file: File]
  link: [url: string]
  rename: [id: string, name: string]
}>()

const root = ref<HTMLElement>()
const upload = ref<HTMLInputElement>()
const search = ref<HTMLInputElement>()
const open = ref(false)
const linking = ref(false)
const filter = ref('')
const draftName = ref('')

const selected = computed(() => props.files.find((file) => file.id === props.modelValue) ?? null)
const shown = computed(() => props.files.filter((file) => file.name.toLowerCase().includes(filter.value.toLowerCase())))

watch(selected, (file) => (draftName.value = file?.name ?? ''), { immediate: true })

function choose(id: string) {
  emit('update:modelValue', id)
  open.value = false
}

function onUpload(event: Event) {
  const input = event.target as HTMLInputElement
  for (const file of input.files ?? []) emit('upload', file)
  input.value = ''
}

function commitName() {
  if (selected.value && !selected.value.fixed && draftName.value.trim() && draftName.value !== selected.value.name) emit('rename', selected.value.id, draftName.value)
  else draftName.value = selected.value?.name ?? ''
}

async function show(link: boolean) {
  linking.value = link
  open.value = true
  filter.value = ''
  await nextTick()
  search.value?.focus()
}

function onSearchEnter(event: KeyboardEvent) {
  const input = event.target as HTMLInputElement
  if (linking.value && input.value.trim()) {
    emit('link', input.value.trim())
    open.value = false
  } else if (!linking.value && shown.value.length === 1) {
    choose(shown.value[0].id)
  }
}

const closeOnOutside = (event: PointerEvent) => {
  if (!root.value?.contains(event.target as Node)) open.value = false
}
watch(open, (isOpen) => {
  if (isOpen) document.addEventListener('pointerdown', closeOnOutside, true)
  else document.removeEventListener('pointerdown', closeOnOutside, true)
})
onBeforeUnmount(() => document.removeEventListener('pointerdown', closeOnOutside, true))
</script>

<template>
  <div ref="root" class="nui-file nodrag nowheel" :class="{ 'is-open': open }" :title="label" @keydown.esc="open = false">
    <input ref="upload" type="file" :accept="accept" multiple hidden @change="onUpload">
    <div class="nui-button-group">
      <button type="button" class="nui-button nui-file-browse" :aria-label="`Browse ${label}`" :aria-expanded="open" @click="open ? (open = false) : show(false)">
        <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="M4 18l5-5 3 3 3-3 5 5" /></svg>
        <svg class="nui-file-caret" viewBox="0 0 10 10"><path d="M2 3l3 4 3-4" /></svg>
      </button>
      <input
        v-if="selected"
        v-model="draftName"
        class="nui-input nui-file-name"
        :readonly="selected.fixed"
        :aria-label="`${label} name`"
        spellcheck="false"
        @blur="commitName"
        @keydown.enter="($event.target as HTMLInputElement).blur()"
      >
      <!-- with a file chosen the actions shrink to icons, the way Blender's image field does -->
      <button v-if="linkable" type="button" class="nui-button" :class="{ 'is-wide': !selected }" aria-label="Link an image by URL" @click="show(true)">
        <svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>
        <span v-if="!selected">Link</span>
      </button>
      <button type="button" class="nui-button" :class="{ 'is-wide': !selected }" aria-label="Open a file" @click="upload?.click()">
        <svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3zM3 10h18l-2 9H5z" /></svg>
        <span v-if="!selected">Open</span>
      </button>
      <button v-if="selected" type="button" class="nui-button" aria-label="Clear" @click="emit('update:modelValue', null)">
        <svg viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" /></svg>
      </button>
    </div>

    <div v-if="open" class="nui-file-menu">
      <div v-if="!linking" class="nui-file-list" role="listbox">
        <div
          v-for="file in shown"
          :key="file.id"
          class="nui-dropdown-option nui-file-item"
          :class="{ 'is-selected': file.id === modelValue }"
          role="option"
          :aria-selected="file.id === modelValue"
          @click="choose(file.id)"
        >
          <img v-if="file.thumbnailUrl" :src="file.thumbnailUrl" alt="">
          <span class="nui-label">{{ file.name }}</span>
        </div>
        <p v-if="!shown.length" class="nui-note">Nothing matches "{{ filter }}"</p>
      </div>
      <label class="nui-field nui-text">
        <span class="nui-label">{{ linking ? 'URL' : 'Search' }}</span>
        <input ref="search" v-model="filter" class="nui-input" :placeholder="linking ? 'https://...' : ''" spellcheck="false" @keydown.enter="onSearchEnter">
      </label>
    </div>
  </div>
</template>
