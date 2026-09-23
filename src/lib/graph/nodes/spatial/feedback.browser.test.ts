import { describe, expect, it } from 'vitest'
import { ShaderRenderer } from '@/lib/engine/renderer'
import { FrameRunner, generateGlsl } from '@/lib/graph'
import { graph, node, toByte } from '@/lib/graph/testing'

/** Renders `frames` LED frames at `fps`; `knob(frame)` sets the graph's knob each frame. Returns the red byte of every LED per frame. */
function run(doc: ReturnType<typeof graph>, frames: number, fps: number, knob: (frame: number) => number, leds = 1): number[][] {
  const canvas = document.createElement('canvas')
  const renderer = new ShaderRenderer(canvas)
  const gl = canvas.getContext('webgl2')!
  const runner = new FrameRunner()
  const out: number[][] = []
  for (let frame = 0; frame < frames; frame++) {
    doc.nodes.find((n) => n.data.kind === 'knob')!.data.values.value = knob(frame)
    const shader = generateGlsl(doc)
    expect(shader.error).toBeNull()
    if (frame === 0) renderer.compile(shader.code)
    runner.load(shader.frame)
    renderer.setControls(runner.step({ time: frame / fps, dt: 1 / fps, frameIndex: frame }))
    const colors = renderer.renderLeds({ time: frame / fps, dt: 1 / fps, frame, ledCount: leds, scanY: 0.5 })
    out.push(Array.from({ length: leds }, (_, i) => toByte(colors[i * 3])))
  }
  // reading from the texture being drawn into is the classic feedback mistake; GL reports it as an error
  expect(gl.getError()).toBe(gl.NO_ERROR)
  renderer.dispose()
  return out
}

describe('Trails', () => {
  const doc = () => graph([node('k', 'knob'), node('t', 'trails', { decay: 1 }), node('o', 'output')], [['k.value', 't.color'], ['t.color', 'o.color']])

  it.each([30, 60])('a one-frame flash has faded to about 37% a second later, at %i fps', (fps) => {
    const frames = run(doc(), fps + 1, fps, (frame) => (frame === 0 ? 1 : 0))
    expect(frames[0][0]).toBe(255)
    expect(frames[fps][0] / 255).toBeCloseTo(1 / Math.E, 1)
    // a smooth fade: no frame is brighter than the one before, and it never stalls on the way down
    expect(frames.every(([r], i) => i === 0 || r < frames[i - 1][0])).toBe(true)
  })

  it('starts from black after a recompile', () => {
    const renderer = new ShaderRenderer(document.createElement('canvas'))
    const shader = generateGlsl(graph([node('k', 'knob', { value: 0 }), node('t', 'trails', { decay: 5 }), node('o', 'output')], [['k.value', 't.color'], ['t.color', 'o.color']]))
    const lit = generateGlsl(graph([node('k', 'knob', { value: 1 }), node('t', 'trails', { decay: 5 }), node('o', 'output')], [['k.value', 't.color'], ['t.color', 'o.color']]))
    const runner = new FrameRunner()
    const frame = (s: typeof shader) => {
      runner.load(s.frame)
      renderer.setControls(runner.step({ time: 0, dt: 1 / 30, frameIndex: 0 }))
      return toByte(renderer.renderLeds({ time: 0, dt: 1 / 30, frame: 0, ledCount: 1, scanY: 0.5 })[0])
    }
    renderer.compile(shader.code)
    expect(frame(lit)).toBe(255)
    expect(frame(shader)).toBeGreaterThan(200)
    renderer.compile(shader.code)
    expect(frame(shader)).toBe(0)
  })
})

describe('Strip Blur', () => {
  it('spreads one lit LED evenly to both sides and never adds light', () => {
    // LED index 4 of 9 is lit for the first frame only: the knob gates a Compare-free mask built from the LED index
    const doc = graph(
      [node('k', 'knob'), node('i', 'ledLayout'), node('d', 'math', { op: 'subtract', b: 4 }), node('a', 'math', { op: 'absolute' }), node('s', 'math', { op: 'greaterThan', b: 0.5 }), node('inv', 'math', { op: 'subtract', a: 1 }),
        node('gate', 'math', { op: 'multiply' }), node('b', 'stripBlur', { spread: 1, decay: 1000 }), node('o', 'output')],
      [['i.index', 'd.a'], ['d.result', 'a.a'], ['a.result', 's.a'], ['s.result', 'inv.b'], ['inv.result', 'gate.a'], ['k.value', 'gate.b'], ['gate.result', 'b.color'], ['b.color', 'o.color']],
    )
    const frames = run(doc, 4, 30, (frame) => (frame === 0 ? 1 : 0), 9)
    expect(frames[0]).toEqual([0, 0, 0, 0, 255, 0, 0, 0, 0])
    expect(frames[1].slice(3, 6)).toEqual([64, 128, 64])
    frames.forEach((leds) => expect(leds).toEqual([...leds].reverse()))
    const light = frames.map((leds) => leds.reduce((a, b) => a + b, 0))
    expect(light.every((total, i) => i === 0 || total <= light[i - 1] + 2)).toBe(true)
  })
})

describe('Previous Frame', () => {
  it('with an offset of -1 the picture walks one LED along the wire per frame', () => {
    const doc = graph(
      [node('k', 'knob'), node('i', 'ledLayout'), node('s', 'math', { op: 'greaterThan', b: 0.5 }), node('inv', 'math', { op: 'subtract', a: 1 }), node('gate', 'math', { op: 'multiply' }),
        node('p', 'previousFrame', { offset: -1 }), node('m', 'math', { op: 'maximum' }), node('o', 'output')],
      [['i.index', 's.a'], ['s.result', 'inv.b'], ['inv.result', 'gate.a'], ['k.value', 'gate.b'], ['gate.result', 'm.a'], ['p.color', 'm.b'], ['m.result', 'o.color']],
    )
    const frames = run(doc, 3, 30, (frame) => (frame === 0 ? 1 : 0), 4)
    expect(frames).toEqual([[255, 0, 0, 0], [255, 255, 0, 0], [255, 255, 255, 0]])
  })
})
