<script setup lang="ts">
import GlslCode from '@/features/shader-editor/GlslCode.vue'
import MatchText from './MatchText.vue'
import { socketColor, type Param, type ShaderNode } from '@/lib/shader/catalog'

defineProps<{ node: ShaderNode, query: string, copied: boolean }>()
defineEmits<{ copy: [] }>()

function defaultText(param: Param) {
  const literal = (n: number) => (param.type !== 'int' && Number.isInteger(n) ? n.toFixed(1) : String(n))
  if (Array.isArray(param.default)) return `${param.type}(${param.default.map(literal).join(', ')})`
  return typeof param.default === 'number' ? literal(param.default) : param.default
}

function noteText(param: Param) {
  if (param.min !== undefined) return `${param.min} to ${param.max}`
  return param.isColor ? 'RGB color' : ''
}
</script>

<template>
  <div
    class="group scroll-mt-9 border-b border-(--app-hairline) px-6 py-5 focus:bg-(--app-hover) focus:shadow-[inset_2px_0_0_var(--ui-primary)] focus:outline-none"
    tabindex="0"
    :data-entry="node.name"
  >
    <div class="max-w-[720px]">
      <div class="flex items-baseline gap-2.5">
        <h3 class="text-[15px] font-semibold leading-5 text-highlighted"><MatchText :text="node.title" :query="query" /></h3>
        <MatchText class="min-w-0 truncate font-mono text-[12px] text-muted" :text="node.name" :query="query" />
        <span class="shrink-0 text-[11px] text-dimmed">{{ node.kind }}</span>
        <button
          type="button"
          class="app-button ms-auto self-center opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus:opacity-100"
          @click="$emit('copy')"
        >
          {{ copied ? 'Copied' : 'Copy' }}
        </button>
      </div>

      <div class="mt-3 rounded-md bg-(--app-chrome) px-3.5 py-2.5">
        <GlslCode :code="node.signature" class="block text-[12.5px] leading-[1.7] text-highlighted" />
      </div>

      <p class="mt-3 max-w-[56ch] text-[13px] leading-[1.65] text-default"><MatchText :text="node.doc" :query="query" /></p>

      <div
        v-if="node.kind === 'function'"
        class="mt-4 grid gap-x-4 gap-y-1.5 text-[12px] leading-5 @min-[520px]:grid-cols-[84px_minmax(0,1fr)] @min-[520px]:gap-y-3"
      >
        <template v-if="node.params.length">
          <div class="text-muted">Parameters</div>
          <dl data-params class="grid grid-cols-[80px_84px_max-content_minmax(0,1fr)] gap-x-4 gap-y-1 font-mono">
            <div v-for="param in node.params" :key="param.name" class="col-span-4 grid grid-cols-subgrid">
              <dt class="truncate text-highlighted">{{ param.name }}</dt>
              <dd class="flex items-center gap-1.5 text-toned">
                <span class="size-2 shrink-0 rounded-full" :style="{ background: socketColor(param.type) }" />
                {{ param.type }}
              </dd>
              <dd v-if="param.default === undefined" class="font-sans text-dimmed">required</dd>
              <dd v-else class="text-toned"><span class="text-dimmed">= </span>{{ defaultText(param) }}</dd>
              <dd class="font-sans text-muted">{{ noteText(param) }}</dd>
            </div>
          </dl>
        </template>

        <div class="text-muted" :class="{ 'mt-1.5 @min-[520px]:mt-0': node.params.length }">Returns</div>
        <dl data-returns class="grid grid-cols-[80px_84px] gap-x-4 font-mono">
          <dt class="truncate text-highlighted">{{ node.output.name }}</dt>
          <dd class="flex items-center gap-1.5 text-toned">
            <span class="size-2 shrink-0 rounded-full" :style="{ background: socketColor(node.returns) }" />
            {{ node.returns }}
          </dd>
        </dl>
      </div>
    </div>
  </div>
</template>
