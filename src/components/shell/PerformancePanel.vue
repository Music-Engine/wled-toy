<script setup lang="ts">
import { computed } from 'vue'
import Sparkline from '@/components/panels/Sparkline.vue'
import type { BridgeStats, HistoryKey } from '@/lib/bridge/bridge-client'
import { Format } from '@/lib/util/format'

const props = defineProps<{
  stats: BridgeStats
  history: Record<HistoryKey, number[]>
  targetFps: number
  streaming: boolean
}>()

type Status = 'warning' | 'error' | null

interface Metric {
  id: string
  label: string
  value: string
  unit?: string
  status: Status
  series?: number[]
}

const latency = (v: number | null, warn: number, bad: number): Status => (v == null || v < warn ? null : v < bad ? 'warning' : 'error')

const groups = computed<{ title: string; metrics: Metric[] }[]>(() => {
  const s = props.stats
  const frameBudget = 1000 / props.targetFps
  return [
    {
      title: 'Render',
      metrics: [
        { id: 'renderFps', label: 'Preview', value: Format.fixed(s.renderFps, 0), unit: 'fps', status: s.renderFps >= 50 ? null : s.renderFps >= 24 ? 'warning' : 'error', series: props.history.renderFps },
        { id: 'ledRenderMs', label: 'LED render', value: Format.fixed(s.ledRenderMs, 2), unit: 'ms', status: latency(s.ledRenderMs, frameBudget * 0.25, frameBudget * 0.6), series: props.history.ledRenderMs },
      ],
    },
    {
      title: 'Link',
      metrics: [
        { id: 'sendFps', label: 'Send rate', value: Format.fixed(s.sendFps, 1), unit: `/ ${props.targetFps} fps`, status: props.streaming && s.sendFps < props.targetFps * 0.9 ? 'warning' : null, series: props.history.sendFps },
        { id: 'kbps', label: 'Throughput', value: Format.fixed(s.kbps, 0), unit: 'kbit/s', status: null, series: props.history.kbps },
        { id: 'rttMs', label: 'Bridge RTT', value: Format.fixed(s.rttMs, 1), unit: 'ms', status: latency(s.rttMs, 10, 40), series: props.history.rttMs },
        { id: 'udpMs', label: 'UDP send', value: Format.fixed(s.udpMs, 2), unit: 'ms', status: latency(s.udpMs, 1, 5), series: props.history.udpMs },
      ],
    },
    {
      title: 'Device',
      metrics: [
        { id: 'deviceMs', label: 'WLED HTTP', value: Format.fixed(s.deviceMs, 0), unit: 'ms', status: latency(s.deviceMs, 100, 400), series: props.history.deviceMs },
        { id: 'deviceFps', label: 'WLED output', value: s.deviceFps == null ? '-' : String(s.deviceFps), unit: 'fps', status: null },
        { id: 'framesSent', label: 'Frames sent', value: s.framesSent.toLocaleString(), status: null },
        { id: 'framesDropped', label: 'Dropped', value: s.framesDropped.toLocaleString(), status: s.framesDropped > 0 ? 'warning' : null },
      ],
    },
  ]
})
</script>

<template>
  <div class="performance-panel grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] text-[12px]">
    <table v-for="group in groups" :key="group.title" class="w-full border-collapse self-start">
      <thead>
        <tr class="h-(--app-row-dense-h)">
          <th colspan="3" class="px-2.5 text-start text-[11px] font-medium text-dimmed">{{ group.title }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="metric in group.metrics" :key="metric.id" class="h-(--app-row-dense-h) hover:bg-(--app-hover)" :data-metric="metric.id">
          <td class="truncate ps-2.5 text-muted">{{ metric.label }}</td>
          <td class="whitespace-nowrap px-2 text-end font-mono tabular-nums">
            <span class="metric-value" :class="metric.status === 'error' ? 'text-error' : metric.status === 'warning' ? 'text-warning' : 'text-highlighted'" :data-status="metric.status ?? 'ok'">{{ metric.value }}</span>
            <span v-if="metric.unit" class="ms-1 text-dimmed">{{ metric.unit }}</span>
          </td>
          <td class="w-[82px] pe-2.5 text-dimmed">
            <Sparkline v-if="metric.series" :values="metric.series" />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
