import type { Check } from '@/lib/graph/compile/context'
import { collectCrossPassReads, isExportable, listReadBack } from '@/lib/graph/compile/annotations/state'

/** Frame output read per pixel or by host that no state slot can hold */
export const checkExportableOutputs = (): Check => ({
  name: 'checkExportableOutputs',
  reads: ['state'],
  check: (ctx) => {
    const read = collectCrossPassReads(ctx)
    return ctx.order.flatMap((id) => {
      const node = ctx.nodes[id]
      const unfit = listReadBack(node, read).find((output) => !isExportable(node, output))
      const type = unfit && node.shape.outputs.find((output) => output.name === unfit)!.type
      return type ? [{ nodeId: id, message: `${node.shape.title} puts out ${type.label} once per frame, which the pixel pass cannot read` }] : []
    })
  },
})
