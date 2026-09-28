import type { Check, CompileContext } from '@/lib/graph/compile/next/context'

/**
 * What a WLED usermod has no host for: a probe to read back, MIDI, OSC, and a knob past the effect's `sliders`, which
 * knobs take in topo order. Each is an issue on its node, by name.
 */
export const usermodInputs = ({ sliders }: { sliders: number }): Check => ({
  name: 'usermodInputs',
  reads: ['resources'],
  check: (ctx) => {
    const unslid = new Set(ctx.uniforms.filter((uniform) => uniform.kind === 'knob').slice(sliders).map((uniform) => uniform.node))
    return ctx.order.flatMap((id) => {
      const reason = unsupported(ctx, id) ?? (unslid.has(id) ? `has no slider left; the effect has ${sliders}` : undefined)
      return reason ? [{ nodeId: id, message: `${ctx.nodes[id].shape.title} ${reason}` }] : []
    })
  },
})

function unsupported(ctx: CompileContext, id: string): string | undefined {
  const kinds = ctx.uniforms.filter((uniform) => uniform.node === id).map((uniform) => uniform.kind)
  if (ctx.nodes[id].shape.probe) return 'is read back by the host, which a usermod does not do'
  if (kinds.includes('midi')) return 'reads MIDI, which a usermod has no input for'
  if (kinds.includes('osc')) return 'reads OSC, which a usermod has no input for'
}
