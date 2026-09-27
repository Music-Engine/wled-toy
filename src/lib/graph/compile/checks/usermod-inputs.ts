import type { Check, CompileContext } from '@/lib/graph/compile/context'

/** What a usermod has no host for: probes, MIDI, OSC, knobs past `sliders` (taken in topo order) */
export const checkUsermodInputs = ({ sliders }: { sliders: number }): Check => ({
  name: 'checkUsermodInputs',
  reads: ['resources'],
  check: (ctx) => {
    const unslid = new Set(ctx.uniforms.filter((uniform) => uniform.kind === 'knob').slice(sliders).map((uniform) => uniform.node))
    return ctx.order.flatMap((id) => {
      const reason = findUnsupportedInput(ctx, id) ?? (unslid.has(id) ? `has no slider left; the effect has ${sliders}` : undefined)
      return reason ? [{ nodeId: id, message: `${ctx.nodes[id].shape.title} ${reason}` }] : []
    })
  },
})

function findUnsupportedInput(ctx: CompileContext, id: string): string | undefined {
  const kinds = ctx.uniforms.filter((uniform) => uniform.node === id).map((uniform) => uniform.kind)
  if (ctx.nodes[id].shape.probe) return 'is read back by the host, which a usermod does not do'
  if (kinds.includes('midi')) return 'reads MIDI, which a usermod has no input for'
  if (kinds.includes('osc')) return 'reads OSC, which a usermod has no input for'
}
