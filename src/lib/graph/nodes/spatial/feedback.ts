import { Color, defineNode, Float } from '@/lib/graph/authoring'
import { toDecayFactor } from '@/lib/graph/nodes/shared/signal'

export const previousFrameNode = defineNode('previousFrame', {
  title: 'Previous Frame',
  description: 'What the Output showed one frame ago, here or Offset LEDs further along the wire. Mixing it back in makes trails; an offset makes them travel.',
  category: 'output',
  varies: 'pixel',
  input: { offset: { type: Float, label: 'Offset (LEDs)', default: 0, props: { step: 1, decimals: 0 } } },
  output: { color: Color },
  body: ({ offset }, ctx) => ({ color: ctx.declare('vec3', `previousFrame(${offset.expr})`) }),
})

export const trailsNode = defineNode('trails', {
  title: 'Trails',
  description: 'Lets a color linger: the brighter of the new color and the fading previous frame. Decay is the seconds a trail takes to fall to about a third.',
  category: 'output',
  varies: 'pixel',
  input: {
    color: { type: Color, default: [0, 0, 0] },
    decay: { type: Float, label: 'Decay (s)', default: 0.5, props: { min: 0, step: 0.05, decimals: 2 } },
    offset: { type: Float, label: 'Drift (LEDs)', default: 0, props: { step: 1, decimals: 0 } },
  },
  output: { color: Color },
  body: ({ color, decay, offset }, ctx) => ({ color: ctx.declare('vec3', `max(${color.expr}, previousFrame(${offset.expr}) * ${toDecayFactor(decay.expr)})`) }),
})

export const stripBlurNode = defineNode('stripBlur', {
  title: 'Strip Blur',
  description: 'Spreads the previous frame along the wire while it fades, so a lit LED blooms outward. Spread is how many LEDs it reaches per frame.',
  category: 'output',
  varies: 'pixel',
  input: {
    color: { type: Color, default: [0, 0, 0] },
    spread: { type: Float, label: 'Spread (LEDs)', default: 1, props: { min: 0, max: 8, step: 0.5, decimals: 1 } },
    decay: { type: Float, label: 'Decay (s)', default: 0.5, props: { min: 0, step: 0.05, decimals: 2 } },
  },
  output: { color: Color },
  body: ({ color, spread, decay }, ctx) => {
    const reach = ctx.declare('float', spread.expr, 'spread').expr
    // 1-2-1 kernel averages, so the blur never adds light
    const blurred = ctx.declare('vec3', `0.25 * previousFrame(-${reach}) + 0.5 * previousFrame(0.0) + 0.25 * previousFrame(${reach})`, 'blurred').expr
    return { color: ctx.declare('vec3', `max(${color.expr}, ${blurred} * ${toDecayFactor(decay.expr)})`) }
  },
})
