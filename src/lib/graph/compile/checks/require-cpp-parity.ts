import type { Check } from '@/lib/graph/compile/context'

/** Names the first node w/o a C++ twin */
export const requireCppParity = (): Check => ({
  name: 'requireCppParity',
  reads: ['cppParity'],
  check: (ctx) => {
    const id = ctx.order.find((id) => !ctx.nodes[id].cppParity)
    return id ? [{ nodeId: id, message: `${ctx.nodes[id].shape.title} reads a texture or a GLSL-only helper, which a C++ unit has nothing for` }] : []
  },
})
