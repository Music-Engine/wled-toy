import { describe, expect, it, vi } from 'vitest'
import { graph, node } from '@/lib/graph/testing'
import { buildProgram, generateGlsl } from './compile'

// the registry has no hook for kinds of its own, so the test kinds are served beside the catalog
vi.mock('@/lib/graph/registry', async (importOriginal) => {
  const registry = await importOriginal<typeof import('@/lib/graph/registry')>()
  const { Color, defineNode, Float } = await import('@/lib/graph/authoring')
  const kinds = [
    defineNode('stateFloat', {
      title: 'State Float', description: 'test', category: 'signal', stateScope: 'pixel',
      input: { rate: Float }, output: { value: Float }, state: { value: Float },
      pixel: ({ rate }, ctx) => {
        ctx.emit(`${ctx.state.value.expr} += ${rate.expr};`)
        return { value: ctx.state.value }
      },
    }),
    defineNode('stateColor', {
      title: 'State Color', description: 'test', category: 'signal', stateScope: 'pixel',
      input: { color: Color }, output: { color: Color }, state: { tint: Color },
      pixel: ({ color }, ctx) => {
        ctx.emit(`${ctx.state.tint.expr} = ${color.expr};`)
        return { color: ctx.state.tint }
      },
    }),
  ]
  return { ...registry, nodeItem: (kind: string) => kinds.find((item) => item.id === kind) ?? registry.nodeItem(kind) }
})

/** The kinds in a chain, the first feeding the second and the last feeding an Output: `a`, `b`, ... in emission order. */
function chain(kinds: string[]) {
  const ids = kinds.map((_, i) => 'abcdefgh'[i])
  const port = (kind: string) => (kind === 'stateFloat' ? { in: 'rate', out: 'value' } : { in: 'color', out: 'color' })
  const links = ids.map((id, i): [string, string] => [`${id}.${port(kinds[i]).out}`, i + 1 < ids.length ? `${ids[i + 1]}.${port(kinds[i + 1]).in}` : 'o.color'])
  return graph([...ids.map((id, i) => node(id, kinds[i])), node('o', 'output')], links)
}

const FIVE = ['stateFloat', 'stateColor', 'stateColor', 'stateFloat', 'stateColor']

describe('pixel state in the Program', () => {
  it('numbers the floats in emission order, and moves a vector that would straddle two layers to the next one', () => {
    const { state, error } = buildProgram(chain(FIVE), {})
    expect(error).toBeNull()
    expect(state).toEqual({
      a: { scope: 'pixel', slots: { value: 'float' }, offsets: { value: 0 } },
      b: { scope: 'pixel', slots: { tint: 'color' }, offsets: { tint: 1 } },
      c: { scope: 'pixel', slots: { tint: 'color' }, offsets: { tint: 4 } },
      d: { scope: 'pixel', slots: { value: 'float' }, offsets: { value: 7 } },
      e: { scope: 'pixel', slots: { tint: 'color' }, offsets: { tint: 8 } },
    })
  })

  it('is an error on the node whose slot no longer fits in the 12 floats', () => {
    expect(buildProgram(chain([...FIVE, 'stateColor']), {})).toMatchObject({ errorNode: 'f', error: 'Too many pixel state values reach the shader; it keeps 12' })
  })

  it('survives JSON', () => {
    const program = buildProgram(chain(FIVE), {})
    expect(JSON.parse(JSON.stringify(program))).toStrictEqual(program)
  })

  it('never reaches a frame consumer', () => {
    const doc = graph([node('s', 'stateFloat'), node('i', 'integrator'), node('o', 'output')], [['s.value', 'i.rate'], ['i.value', 'o.color']])
    expect(buildProgram(doc, {})).toMatchObject({ errorNode: 'i', error: 'Rate needs one value per frame, but State Float changes per pixel' })
  })
})

describe('pixel state in the shader', () => {
  it('declares iState and one output per layer the slots reach, and hands each body its components', () => {
    const { code, error } = generateGlsl(chain(FIVE))
    expect(error).toBeNull()
    expect(code).toContain(['uniform highp sampler2DArray iState;', 'layout(location = 1) out vec4 outState1;', 'layout(location = 2) out vec4 outState2;', 'layout(location = 3) out vec4 outState3;'].join('\n'))
    expect(code).toContain('  outState3 = texelFetch(iState, ivec3(gl_FragCoord.xy, 2), 0);')
    expect(code).toContain('outState1.x += ')
    expect(code).toContain('outState1.yzw = ')
    expect(code).toContain('outState3.xyz = ')
  })

  it('declares only the layers used', () => {
    const { code } = generateGlsl(chain(['stateFloat']))
    expect(code).toContain('layout(location = 1) out vec4 outState1;')
    expect(code).not.toContain('outState2')
  })

  it('leaves iState and outState out of a graph without pixel state', () => {
    const { code } = generateGlsl(graph([node('i', 'integrator'), node('m', 'math'), node('o', 'output')], [['i.value', 'm.a'], ['m.result', 'o.color']]))
    expect(code).not.toMatch(/iState|outState/)
  })
})
