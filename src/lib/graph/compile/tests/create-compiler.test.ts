import { describe, expect, it, vi } from 'vitest'
import { GRAPH_VERSION, type NodeGraph } from '@/lib/graph/model/doc'
import { graph, node } from '@/lib/graph/testing'
import { checkBufferAllowance } from '@/lib/graph/compile/checks/buffer-allowance'
import { createCompiler } from '@/lib/graph/compile/create-compiler'
import { createGlslCompiler } from '@/lib/graph/compile/compilers'
import { choosePass } from '@/lib/graph/compile/annotations/pass'
import { resolveResources } from '@/lib/graph/compile/annotations/resources'
import { allocateState } from '@/lib/graph/compile/annotations/state'
import { inferWidth } from '@/lib/graph/compile/annotations/width'
import { createGlslTarget } from '@/lib/graph/compile/targets/glsl'
import type { Stage } from '@/lib/graph/compile/context'

// Registry has no hook for test kinds, so they're served beside the catalog, lint's lookups included
vi.mock('@/lib/graph/registry', async (importOriginal) => {
  const registry = await importOriginal<typeof import('@/lib/graph/registry')>()
  const { Color, defineNode, Float } = await import('@/lib/graph/authoring')
  const kinds = [
    defineNode('stateFloat', {
      title: 'State Float',
      description: 'test',
      category: 'signal',
      input: { step: Float },
      output: { value: Float },
      state: { value: Float },
      body: ({ step }, ctx) => {
        ctx.emit(`${ctx.state.value.expr} += ${step.expr};`)
        return { value: ctx.state.value }
      },
    }),
    defineNode('stateColor', {
      title: 'State Color',
      description: 'test',
      category: 'signal',
      input: { color: Color },
      output: { color: Color },
      state: { tint: Color },
      body: ({ color }, ctx) => {
        ctx.emit(`${ctx.state.tint.expr} = ${color.expr};`)
        return { color: ctx.state.tint }
      },
    }),
    defineNode('probed', {
      title: 'Probed',
      description: 'test',
      category: 'signal',
      probe: 'value',
      input: { value: Float },
      output: { value: Float },
      body: ({ value }) => ({ value }),
    }),
  ]
  const findNodeItem = (kind: string) => kinds.find((item) => item.id === kind) ?? registry.findNodeItem(kind)
  const readStoredShape = (data: { kind: string; values: Record<string, unknown> } | undefined) => data && findNodeItem(data.kind)?.shape(data.values)
  return {
    ...registry,
    findNodeItem,
    readStoredShape,
    findInputSocket: (data: never, handle: string) => readStoredShape(data)?.inputs.find((s) => s.linkable && s.name === handle),
    findOutputSocket: (data: never, handle: string) => readStoredShape(data)?.outputs.find((s) => s.name === handle),
  }
})

const findPorts = (kind: string) => (kind === 'stateFloat' ? { in: 'step', out: 'value' } : { in: 'color', out: 'color' })

/** `uv.x` into a chain of `kinds`, last feeding an Output, so every node runs per pixel */
function buildChain(kinds: string[], ids = kinds.map((_, i) => 'abcdefgh'[i])): NodeGraph {
  const links = ids.map((id, i): [string, string] => [
    `${id}.${findPorts(kinds[i]).out}`,
    i + 1 < ids.length ? `${ids[i + 1]}.${findPorts(kinds[i + 1]).in}` : 'o.color',
  ])
  return graph([node('uv', 'uv'), ...ids.map((id, i) => node(id, kinds[i])), node('o', 'output')], [[`uv.x`, `${ids[0]}.${findPorts(kinds[0]).in}`], ...links])
}

const FIVE = ['stateFloat', 'stateColor', 'stateColor', 'stateFloat', 'stateColor']
const readPixelOffsets = (slots: ReturnType<ReturnType<typeof createGlslCompiler>['compile']>['slots']) =>
  Object.fromEntries(Object.entries(slots.pixel).map(([id, entry]) => [id, Object.values(entry).map((slot) => slot.offset)]))

describe('createCompiler', () => {
  it('refuses a doc of another version with one issue and no program', () => {
    const doc = { ...graph([node('o', 'output')]), version: GRAPH_VERSION + 1 }
    expect(createGlslCompiler().compile(doc)).toMatchObject({
      program: null,
      issues: [{ nodeId: null, message: `This graph is version ${GRAPH_VERSION + 1}; the compiler reads version ${GRAPH_VERSION}` }],
    })
    expect(createGlslCompiler().compile(doc).issues).toHaveLength(1)
  })

  it('throws when an annotation is listed before one it reads, naming both', () => {
    const config = { version: GRAPH_VERSION, target: createGlslTarget(), checks: [], optimize: [] }
    expect(() => createCompiler({ ...config, annotations: [resolveResources(), allocateState(), inferWidth(), choosePass()] })).toThrow(
      'state reads width, so width must be listed before state',
    )
    expect(() => createCompiler({ ...config, annotations: [resolveResources(), inferWidth(), choosePass()] })).toThrow(
      'glsl reads state, which no annotation provides',
    )
    expect(() => createCompiler({ ...config, annotations: [resolveResources(), inferWidth(), choosePass()], checks: [checkBufferAllowance(12)] })).toThrow(
      'checkBufferAllowance reads state, which no annotation provides',
    )
  })

  it('fires every hook once per compile with its stage and the context', () => {
    const stages: Stage[] = ['lint', 'topo', 'annotations', 'checks', 'optimize', 'target']
    const hooks = Object.fromEntries(stages.map((stage) => [stage, vi.fn()]))
    const compiler = createCompiler({
      version: GRAPH_VERSION,
      target: createGlslTarget(),
      annotations: [resolveResources(), inferWidth(), choosePass(), allocateState()],
      checks: [],
      optimize: [],
      hooks,
    })
    compiler.compile(buildChain(['stateFloat']))
    for (const stage of stages) {
      expect(hooks[stage]).toHaveBeenCalledTimes(1)
      expect(hooks[stage]).toHaveBeenCalledWith(stage, expect.objectContaining({ output: 'o' }))
    }
    expect(hooks.target.mock.calls[0][1].order).toEqual(['uv', 'a', 'o'])
  })
})

/** Annotated pass and width by node id */
function readAnnotated(doc: NodeGraph): Record<string, { pass?: string; width?: number }> {
  const seen: Record<string, { pass?: string; width?: number }> = {}
  createCompiler({
    version: GRAPH_VERSION,
    target: createGlslTarget(),
    annotations: [resolveResources(), inferWidth(), choosePass(), allocateState()],
    checks: [],
    optimize: [],
    hooks: {
      annotations: (_, ctx) => Object.values(ctx.nodes).forEach((n) => (seen[n.id] = { pass: n.pass, width: n.width })),
    },
  }).compile(doc)
  return seen
}
const readPasses = (doc: NodeGraph) => Object.fromEntries(Object.entries(readAnnotated(doc)).map(([id, n]) => [id, n.pass]))
const readWidths = (doc: NodeGraph) => Object.fromEntries(Object.entries(readAnnotated(doc)).map(([id, n]) => [id, n.width]))

describe('pass', () => {
  it('seeds the frame pass only w/ state, a probe or a frame hint, and pulls in everything upstream of those', () => {
    expect(readPasses(graph([node('m', 'math'), node('o', 'output')], [['m.result', 'o.color']]))).toEqual({ m: 'pixel', o: 'pixel' })
    expect(
      readPasses(
        graph(
          [node('v', 'value'), node('i', 'integrator'), node('o', 'output')],
          [
            ['v.value', 'i.rate'],
            ['i.value', 'o.color'],
          ],
        ),
      ),
    ).toEqual({ v: 'frame', i: 'frame', o: 'pixel' })
    expect(
      readPasses(
        graph(
          [node('u', 'uv'), node('m', 'math'), node('o', 'output')],
          [
            ['u.x', 'm.a'],
            ['m.result', 'o.color'],
          ],
        ),
      ),
    ).toEqual({ u: 'pixel', m: 'pixel', o: 'pixel' })
    expect(
      readPasses(
        graph(
          [node('k', 'knob'), node('u', 'uv'), node('m', 'math'), node('o', 'output')],
          [
            ['k.value', 'm.a'],
            ['u.x', 'm.b'],
            ['m.result', 'o.color'],
          ],
        ),
      ),
    ).toEqual({ k: 'pixel', u: 'pixel', m: 'pixel', o: 'pixel' })
    expect(
      readPasses(
        graph(
          [node('t', 'time'), node('m', 'math'), node('o', 'output')],
          [
            ['t.time', 'm.a'],
            ['m.result', 'o.color'],
          ],
        ),
      ),
    ).toEqual({ t: 'pixel', m: 'pixel', o: 'pixel' })
    expect(readPasses(graph([node('a', 'audio'), node('o', 'output')], [['a.level', 'o.color']]))).toEqual({ a: 'pixel', o: 'pixel' })
  })

  it('keeps a frame-hinted node per frame unless an input varies per pixel', () => {
    expect(readPasses(graph([node('b', 'bandSplit'), node('o', 'output')], [['b.level', 'o.color']]))).toMatchObject({ b: 'frame', o: 'pixel' })
    expect(
      readPasses(
        graph(
          [node('b', 'bandSplit'), node('m', 'math'), node('o', 'output')],
          [
            ['b.level', 'm.a'],
            ['m.result', 'o.color'],
          ],
        ),
      ),
    ).toMatchObject({ b: 'frame', m: 'frame' })
    expect(
      readPasses(
        graph(
          [node('u', 'uv'), node('b', 'bandSplit'), node('m', 'math'), node('o', 'output')],
          [
            ['u.x', 'b.low'],
            ['b.level', 'm.a'],
            ['m.result', 'o.color'],
          ],
        ),
      ),
    ).toMatchObject({ b: 'pixel' })
  })

  it('flows the frame pass downstream until a per-pixel input, pulling in the other inputs of what joins', () => {
    const doc = graph(
      [node('i', 'integrator'), node('t', 'time'), node('m', 'math'), node('n', 'math'), node('u', 'uv'), node('p', 'math'), node('o', 'output')],
      [
        ['i.value', 'm.a'],
        ['t.time', 'm.b'],
        ['m.result', 'n.a'],
        ['n.result', 'p.a'],
        ['u.x', 'p.b'],
        ['p.result', 'o.color'],
      ],
    )
    expect(readPasses(doc)).toEqual({ i: 'frame', t: 'frame', m: 'frame', n: 'frame', u: 'pixel', p: 'pixel', o: 'pixel' })
  })

  it('reads an unlinked implicit default as per pixel unless it also exists per frame', () => {
    expect(readPasses(graph([node('r', 'random'), node('o', 'output')], [['r.value', 'o.color']]))).toMatchObject({ r: 'pixel' })
    expect(
      readPasses(
        graph(
          [node('w', 'wave'), node('i', 'integrator'), node('o', 'output')],
          [
            ['w.value', 'i.rate'],
            ['i.value', 'o.color'],
          ],
        ),
      ),
    ).toMatchObject({ w: 'frame' })
  })

  it('runs a stateful node fed per pixel per pixel, and leaves out a probe fed per pixel with an issue', () => {
    expect(
      readPasses(
        graph(
          [node('u', 'uv'), node('i', 'integrator'), node('o', 'output')],
          [
            ['u.x', 'i.rate'],
            ['i.value', 'o.color'],
          ],
        ),
      ),
    ).toMatchObject({ i: 'pixel' })
    const { program, issues } = createGlslCompiler().compile(graph([node('u', 'uv'), node('s', 'sceneSwitch'), node('o', 'output')], [['u.x', 's.index']]))
    expect(program!.probes).toEqual({})
    expect(issues.at(-1)).toEqual({ nodeId: 's', message: 'Scene Switch is read back once per frame, so it cannot take a value that changes per pixel' })
  })
})

describe('width', () => {
  it('keeps a chain of scalars scalar and widens every generic node downstream of a vec3', () => {
    expect(
      readWidths(
        graph(
          [node('a', 'math'), node('b', 'math'), node('o', 'output')],
          [
            ['a.result', 'b.a'],
            ['b.result', 'o.color'],
          ],
        ),
      ),
    ).toMatchObject({ a: 1, b: 1 })
    expect(
      readWidths(
        graph(
          [node('c', 'color'), node('a', 'math'), node('b', 'math'), node('o', 'output')],
          [
            ['c.color', 'a.a'],
            ['a.result', 'b.b'],
            ['b.result', 'o.color'],
          ],
        ),
      ),
    ).toMatchObject({ a: 3, b: 3 })
  })

  it('takes the wider side where two paths from one source meet', () => {
    const doc = graph(
      [node('t', 'vector2'), node('c', 'color'), node('l', 'math'), node('r', 'math'), node('j', 'math'), node('o', 'output')],
      [
        ['t.vector', 'l.a'],
        ['t.vector', 'r.a'],
        ['c.color', 'r.b'],
        ['l.result', 'j.a'],
        ['r.result', 'j.b'],
        ['j.result', 'o.color'],
      ],
    )
    expect(readWidths(doc)).toMatchObject({ l: 2, r: 3, j: 3 })
  })

  it('reads an unlinked generic node from what it stores, and a knob-fed one from its stored vector', () => {
    const drawn = (values: Record<string, number | number[]>) => graph([node('m', 'math', values), node('o', 'output')], [['m.result', 'o.color']])
    expect(readWidths(drawn({}))).toMatchObject({ m: 1 })
    expect(readWidths(drawn({ b: [0.1, 0.2] }))).toMatchObject({ m: 2 })
    expect(
      readWidths(
        graph(
          [node('k', 'knob'), node('m', 'math', { b: [0.2, 0.4, 0.6] }), node('o', 'output')],
          [
            ['k.value', 'm.a'],
            ['m.result', 'o.color'],
          ],
        ),
      ),
    ).toMatchObject({ m: 3 })
  })
})

describe('state', () => {
  it('numbers pixel floats in topo order, moving a vector that would straddle two layers to the next one', () => {
    expect(readPixelOffsets(createGlslCompiler().compile(buildChain(FIVE)).slots)).toEqual({ a: [0], b: [1], c: [4], d: [7], e: [8] })
  })

  it('reuses the previous offsets of a node with the same id and slot types, and gives a new node the first free floats', () => {
    const { slots } = createGlslCompiler().compile(buildChain(['stateFloat', 'stateColor', 'stateFloat'], ['a', 'b', 'c']))
    const edited = createGlslCompiler().compile(buildChain(['stateFloat', 'stateFloat', 'stateColor'], ['x', 'a', 'b']), { slots })
    expect(readPixelOffsets(edited.slots)).toEqual({ x: [4], a: [0], b: [1] })
  })

  it('moves a node whose slot types changed under the same id', () => {
    const { slots } = createGlslCompiler().compile(buildChain(['stateFloat', 'stateColor'], ['a', 'b']))
    expect(readPixelOffsets(createGlslCompiler().compile(buildChain(['stateColor', 'stateColor'], ['a', 'b']), { slots }).slots)).toEqual({ a: [4], b: [1] })
  })

  it('gives floats a changed or deleted node freed to the next node that fits them, and stays in the reach when it can', () => {
    const { slots } = createGlslCompiler().compile(buildChain(['stateColor', 'stateFloat'], ['a', 'b']))
    const rekinded = createGlslCompiler().compile(buildChain(['stateFloat', 'stateFloat'], ['a', 'b']), { slots })
    expect(readPixelOffsets(rekinded.slots)).toEqual({ a: [0], b: [3] })
    const added = createGlslCompiler().compile(buildChain(['stateFloat', 'stateFloat', 'stateColor'], ['a', 'b', 'c']), { slots: rekinded.slots })
    expect(readPixelOffsets(added.slots)).toEqual({ a: [0], b: [3], c: [4] })
  })

  it('reports the node that crosses 12 pixel floats and returns no program', () => {
    const { program, issues } = createGlslCompiler().compile(buildChain([...FIVE, 'stateColor']))
    expect(program).toBeNull()
    expect(issues).toEqual([{ nodeId: 'f', message: 'Too many pixel state values reach the shader; it keeps 12' }])
  })

  it("keeps a frame node's state in global state beside the outputs the pixel pass reads, and lists a probe", () => {
    const doc = graph(
      [node('a', 'stateFloat'), node('p', 'probed'), node('o', 'output')],
      [
        ['a.value', 'p.value'],
        ['p.value', 'o.color'],
      ],
    )
    const { program, slots } = createGlslCompiler().compile(doc)
    expect(slots.global).toEqual({
      a: { value: { type: 'float', dim: 1, offset: 0, kind: 'stateFloat' } },
      'p:value': { value: { type: 'float', dim: 1, offset: 1, kind: 'probed' } },
    })
    expect(program).toMatchObject({ probes: { p: 1 }, frame: { texels: 1, probes: [0] } })
    expect(program!.frame!.code).toContain('  globalState[0].x += 0.5;')
    expect(program!.pixel).toContain('c = vec4(vec3(texelFetch(iGlobal, ivec2(0, 0), 0).y), 1.0);')
  })
  it('declares iState and one output per layer the slots reach, hands each body its components, and leaves both out without pixel state', () => {
    const { pixel } = createGlslCompiler().compile(buildChain(FIVE)).program!
    expect(pixel).toContain(
      [
        'uniform highp sampler2DArray iState;',
        'layout(location = 1) out vec4 outState1;',
        'layout(location = 2) out vec4 outState2;',
        'layout(location = 3) out vec4 outState3;',
      ].join('\n'),
    )
    expect(pixel).toContain('  outState3 = texelFetch(iState, ivec3(gl_FragCoord.xy, 2), 0);')
    expect(pixel).toContain('outState1.x += ')
    expect(pixel).toContain('outState1.yzw = ')
    expect(pixel).toContain('outState3.xyz = ')
    expect(createGlslCompiler().compile(buildChain(['stateFloat'])).program!.pixel).not.toContain('outState2')
    const framed = createGlslCompiler().compile(
      graph(
        [node('i', 'integrator'), node('m', 'math'), node('o', 'output')],
        [
          ['i.value', 'm.a'],
          ['m.result', 'o.color'],
        ],
      ),
    ).program!
    expect(framed.pixel).not.toMatch(/iState|outState/)
  })
})
