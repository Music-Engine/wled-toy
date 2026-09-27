import type { Check } from '@/lib/graph/compile/next/context'

/** The pixel state render targets hold `floats` floats; the first node whose slots end past them is reported. */
export const bufferAllowance = (floats: number): Check => ({
  name: 'bufferAllowance',
  reads: ['state'],
  check: (ctx) => {
    const crossing = ctx.order.find((id) => Object.entries(ctx.slots.pixel[id] ?? {}).some(([name, slot]) => slot.offset + ctx.nodes[id].shape.state![name].dim! > floats))
    return crossing ? [{ nodeId: crossing, message: `Too many pixel state values reach the shader; it keeps ${floats}` }] : []
  },
})
