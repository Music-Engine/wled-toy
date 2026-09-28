import { describe, expect, it, vi } from 'vitest'
import { GRAPH_VERSION, type NodeGraph } from '@/lib/graph/model/doc'
import { graph, node } from '@/lib/graph/testing'
import { bufferAllowance } from '@/lib/graph/compile/next/checks/buffer-allowance'
import { createCompiler } from '@/lib/graph/compile/next/create-compiler'
import { glslCompiler } from '@/lib/graph/compile/next/compilers'
import { pass } from '@/lib/graph/compile/next/annotations/pass'
import { resources } from '@/lib/graph/compile/next/annotations/resources'
import { state } from '@/lib/graph/compile/next/annotations/state'
import { width } from '@/lib/graph/compile/next/annotations/width'
import { glsl } from '@/lib/graph/compile/next/targets/glsl'
import type { Stage } from '@/lib/graph/compile/next/context'

// the registry has no hook for kinds of its own, so the test kinds are served beside the catalog
vi.mock('@/lib/graph/registry', async (importOriginal) => {
  const registry = await importOriginal<typeof import('@/lib/graph/registry')>()
  const { Color, defineNode, Float } = await import('@/lib/graph/authoring')
  const kinds = [
    defineNode('stateFloat', {
      title: 'State Float', description: 'test', category: 'signal',
      input: { step: Float }, output: { value: Float }, state: { value: Float },
      body: ({ step }, ctx) => {
        ctx.emit(`${ctx.state.value.expr} += ${step.expr};`)
        return { value: ctx.state.value }
      },
    }),
    defineNode('stateColor', {
      title: 'State Color', description: 'test', category: 'signal',
      input: { color: Color }, output: { color: Color }, state: { tint: Color },
      body: ({ color }, ctx) => {
        ctx.emit(`${ctx.state.tint.expr} = ${color.expr};`)
        return { color: ctx.state.tint }
      },
    }),
    defineNode('probed', {
      title: 'Probed', description: 'test', category: 'signal', probe: 'value',
      input: { value: Float }, output: { value: Float },
      body: ({ value }) => ({ value }),
    }),
  ]
  return { ...registry, nodeItem: (kind: string) => kinds.find((item) => item.id === kind) ?? registry.nodeItem(kind) }
})

const port = (kind: string) => (kind === 'stateFloat' ? { in: 'step', out: 'value' } : { in: 'color', out: 'color' })

/** `uv.x` into a chain of the kinds, ids in `ids`, the last feeding an Output, so every node runs per pixel. */
function chain(kinds: string[], ids = kinds.map((_, i) => 'abcdefgh'[i])): NodeGraph {
  const links = ids.map((id, i): [string, string] => [`${id}.${port(kinds[i]).out}`, i + 1 < ids.length ? `${ids[i + 1]}.${port(kinds[i + 1]).in}` : 'o.color'])
  return graph([node('uv', 'uv'), ...ids.map((id, i) => node(id, kinds[i])), node('o', 'output')], [[`uv.x`, `${ids[0]}.${port(kinds[0]).in}`], ...links])
}

const FIVE = ['stateFloat', 'stateColor', 'stateColor', 'stateFloat', 'stateColor']
const pixelOffsets = (slots: ReturnType<ReturnType<typeof glslCompiler>['compile']>['slots']) =>
  Object.fromEntries(Object.entries(slots.pixel).map(([id, entry]) => [id, Object.values(entry).map((slot) => slot.offset)]))

describe('createCompiler', () => {
  it('refuses a doc of another version with one issue and no program', () => {
    const doc = { ...graph([node('o', 'output')]), version: GRAPH_VERSION + 1 }
    expect(glslCompiler().compile(doc)).toMatchObject({ program: null, issues: [{ nodeId: null, message: `This graph is version ${GRAPH_VERSION + 1}; the compiler reads version ${GRAPH_VERSION}` }] })
    expect(glslCompiler().compile(doc).issues).toHaveLength(1)
  })

  it('throws when an annotation is listed before one it reads, naming both', () => {
    const config = { version: GRAPH_VERSION, target: glsl(), checks: [], optimize: [] }
    expect(() => createCompiler({ ...config, annotations: [resources(), state(), width(), pass()] })).toThrow('state reads width, so width must be listed before state')
    expect(() => createCompiler({ ...config, annotations: [resources(), width(), pass()] })).toThrow('glsl reads state, which no annotation provides')
    expect(() => createCompiler({ ...config, annotations: [resources(), width(), pass()], checks: [bufferAllowance(12)] })).toThrow('bufferAllowance reads state, which no annotation provides')
  })

  it('fires every hook once per compile with its stage and the context', () => {
    const stages: Stage[] = ['lint', 'topo', 'annotations', 'checks', 'optimize', 'target']
    const hooks = Object.fromEntries(stages.map((stage) => [stage, vi.fn()]))
    const compiler = createCompiler({ version: GRAPH_VERSION, target: glsl(), annotations: [resources(), width(), pass(), state()], checks: [], optimize: [], hooks })
    compiler.compile(chain(['stateFloat']))
    for (const stage of stages) {
      expect(hooks[stage]).toHaveBeenCalledTimes(1)
      expect(hooks[stage]).toHaveBeenCalledWith(stage, expect.objectContaining({ output: 'o' }))
    }
    expect(hooks.target.mock.calls[0][1].order).toEqual(['uv', 'a', 'o'])
  })
})

describe('pass', () => {
  const passes = (doc: NodeGraph) => {
    const seen: Record<string, string | undefined> = {}
    createCompiler({ version: GRAPH_VERSION, target: glsl(), annotations: [resources(), width(), pass(), state()], checks: [], optimize: [], hooks: {
      annotations: (_, ctx) => Object.values(ctx.nodes).forEach((n) => (seen[n.id] = n.pass)),
    } }).compile(doc)
    return seen
  }

  it('runs a node per frame unless it varies per pixel or reads something that does', () => {
    expect(passes(graph([node('m', 'math'), node('o', 'output')], [['m.result', 'o.color']]))).toEqual({ m: 'frame', o: 'pixel' })
    expect(passes(graph([node('u', 'uv'), node('m', 'math'), node('o', 'output')], [['u.x', 'm.a'], ['m.result', 'o.color']]))).toEqual({ u: 'pixel', m: 'pixel', o: 'pixel' })
  })

  it('reads an unlinked implicit default as per pixel unless it also exists per frame', () => {
    expect(passes(graph([node('r', 'random'), node('o', 'output')], [['r.value', 'o.color']]))).toMatchObject({ r: 'pixel' })
    expect(passes(graph([node('w', 'wave'), node('o', 'output')], [['w.value', 'o.color']]))).toMatchObject({ w: 'frame' })
  })
})

describe('state', () => {
  it('numbers pixel floats in topo order, moving a vector that would straddle two layers to the next one', () => {
    expect(pixelOffsets(glslCompiler().compile(chain(FIVE)).slots)).toEqual({ a: [0], b: [1], c: [4], d: [7], e: [8] })
  })

  it('reuses the previous offsets of a node with the same id and slot types, and appends a new node after the last used slot', () => {
    const { slots } = glslCompiler().compile(chain(['stateFloat', 'stateColor', 'stateFloat'], ['a', 'b', 'c']))
    const edited = glslCompiler().compile(chain(['stateFloat', 'stateFloat', 'stateColor'], ['x', 'a', 'b']), { slots })
    expect(pixelOffsets(edited.slots)).toEqual({ x: [4], a: [0], b: [1] })
  })

  it('moves a node whose slot types changed under the same id', () => {
    const { slots } = glslCompiler().compile(chain(['stateFloat', 'stateColor'], ['a', 'b']))
    expect(pixelOffsets(glslCompiler().compile(chain(['stateColor', 'stateColor'], ['a', 'b']), { slots }).slots)).toEqual({ a: [4], b: [1] })
  })

  it('reports the node that crosses 12 pixel floats and returns no program', () => {
    const { program, issues } = glslCompiler().compile(chain([...FIVE, 'stateColor']))
    expect(program).toBeNull()
    expect(issues).toEqual([{ nodeId: 'f', message: 'Too many pixel state values reach the shader; it keeps 12' }])
  })

  it('keeps a frame node\'s state in global state beside the outputs the pixel pass reads, and lists a probe', () => {
    const doc = graph([node('a', 'stateFloat'), node('p', 'probed'), node('o', 'output')], [['a.value', 'p.value'], ['p.value', 'o.color']])
    const { program, slots } = glslCompiler().compile(doc)
    expect(slots.global).toEqual({ 'a': { value: { type: 'float', offset: 0 } }, 'p:value': { value: { type: 'float', offset: 1 } } })
    expect(program).toMatchObject({ probes: { p: 1 }, frame: { texels: 1, probes: [0] } })
    expect(program!.frame!.code).toContain('  globalState[0].x += 0.5;')
    expect(program!.pixel).toContain('c = vec4(vec3(texelFetch(iGlobal, ivec2(0, 0), 0).y), 1.0);')
  })
})
