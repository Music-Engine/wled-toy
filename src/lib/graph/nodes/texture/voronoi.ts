import { Color, defineNode, Float, Vec3 } from '@/lib/graph/authoring'
import { commonChunk } from '@/lib/graph/nodes/glsl/common'
import { textureVector } from '@/lib/graph/nodes/shared/sockets'

export const voronoiNode = defineNode('voronoi', {
  title: 'Voronoi Texture',
  description: 'Cells around random points: Distance to the nearest point, its Color, and its Position. Randomness 0 makes a regular grid.',
  category: 'noise',
  includes: [commonChunk],
  input: {
    vector: textureVector,
    scale: { type: Float, default: 5, props: { step: 0.1, decimals: 2 } },
    randomness: { type: Float, default: 1, props: { min: 0, max: 1 } },
  },
  output: { distance: Float, color: Color, position: Vec3 },
  pixel: ({ vector, scale, randomness }, ctx) => {
    const p = ctx.declare('vec2', `${vector.expr}.xy * ${scale.expr}`, 'p').expr
    const cell = ctx.declare('vec2', `floor(${p})`, 'cell').expr
    const best = ctx.variable('best')
    const nearest = ctx.variable('nearest')
    ctx.emit(`float ${best} = 8.0; vec2 ${nearest} = ${cell};`)
    ctx.emit(`for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {`)
    ctx.emit(`  vec2 g = ${cell} + vec2(float(i), float(j));`)
    ctx.emit(`  vec2 o = g + 0.5 + (vec2(node_hash(g), node_hash(g + 19.1)) - 0.5) * ${randomness.expr};`)
    ctx.emit(`  float d = distance(o, ${p});`)
    ctx.emit(`  if (d < ${best}) { ${best} = d; ${nearest} = o; }`)
    ctx.emit('}')
    return {
      distance: ctx.declare('float', best, 'distance'),
      color: ctx.declare('vec3', `vec3(node_hash(${nearest}), node_hash(${nearest} + 7.7), node_hash(${nearest} + 13.9))`, 'color'),
      position: ctx.declare('vec3', `vec3(${nearest} / ${scale.expr}, 0.0)`, 'position'),
    }
  },
})
