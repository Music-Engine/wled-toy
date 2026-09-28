import type { Check } from '@/lib/graph/compile/context'

/** Pixel state targets hold `floats` floats; names the first node ending past them */
export const checkBufferAllowance = (floats: number): Check => ({
  name: 'checkBufferAllowance',
  reads: ['state'],
  check: (ctx) => {
    const crossing = ctx.order.find((id) => Object.entries(ctx.slots.pixel[id] ?? {}).some(([name, slot]) => slot.offset + ctx.nodes[id].shape.state![name].dim! > floats))
    return crossing ? [{ nodeId: crossing, message: `Too many pixel state values reach the shader; it keeps ${floats}` }] : []
  },
})
