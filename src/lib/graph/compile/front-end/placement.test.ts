import { describe, expect, it } from 'vitest'
import { generateGlsl } from '@/lib/graph'
import type { NodeGraph } from '@/lib/graph/model/doc'
import { graph, node } from '@/lib/graph/testing'
import { FrontEnd, type CompileOptions } from './front-end'
import { placeNodes } from './placement'

function place(doc: NodeGraph, sinks = ['o'], options: CompileOptions = {}) {
  const c = new FrontEnd(doc, options)
  placeNodes(c, sinks)
  return { placement: Object.fromEntries(c.placement), changesPerPixel: [...c.changesPerPixel] }
}

describe('placeNodes', () => {
  it('keeps a node with only a shader body per pixel', () => {
    const doc = graph([node('u', 'uv'), node('o', 'output')], [['u.uv', 'o.color']])
    expect(place(doc).placement).toEqual({ o: 'pixel', u: 'pixel' })
  })

  it('reads a node with only a per-frame body per frame, even into a pixel sink', () => {
    const doc = graph([node('k', 'knob'), node('o', 'output')], [['k.value', 'o.color']])
    expect(place(doc).placement).toEqual({ o: 'pixel', k: 'frame' })
  })

  it('moves a node that runs either way to the frame once everything linked in is per frame', () => {
    const doc = graph([node('k', 'knob'), node('m', 'math'), node('o', 'output')], [['k.value', 'm.a'], ['m.result', 'o.color']])
    expect(place(doc).placement).toEqual({ o: 'pixel', m: 'frame' })
  })

  it('keeps it per pixel when one linked input is per pixel', () => {
    const doc = graph([node('k', 'knob'), node('u', 'uv'), node('m', 'math'), node('o', 'output')], [['k.value', 'm.a'], ['u.x', 'm.b'], ['m.result', 'o.color']])
    expect(place(doc)).toEqual({ placement: { o: 'pixel', m: 'pixel', k: 'frame', u: 'pixel' }, changesPerPixel: ['u', 'm'] })
  })

  it('places a sink with only a per-frame body per frame and walks what it plans', () => {
    const doc = graph([node('k', 'knob'), node('s', 'sceneSwitch')], [['k.value', 's.index']])
    expect(place(doc, ['s'])).toEqual({ placement: { s: 'frame' }, changesPerPixel: [] })
  })

  it('standalone, keeps every node with a shader body per pixel and freezes the rest', () => {
    const doc = graph([node('k', 'knob'), node('m', 'math'), node('o', 'output')], [['k.value', 'm.a'], ['m.result', 'o.color']])
    expect(place(doc, ['o'], { standalone: true }).placement).toEqual({ o: 'pixel', m: 'pixel', k: 'frame' })
  })

  it('reads an unlinked node that runs either way per pixel, while a frame consumer still plans it', () => {
    const doc = graph(
      [node('t', 'time'), node('i', 'integrator'), node('cc', 'combineColor'), node('o', 'output')],
      [['t.delta', 'i.rate'], ['i.value', 'cc.a'], ['t.time', 'cc.b'], ['cc.color', 'o.color']],
    )
    expect(place(doc)).toEqual({ placement: { o: 'pixel', cc: 'pixel', i: 'frame', t: 'pixel' }, changesPerPixel: [] })
    const { code, frame: plan } = generateGlsl(doc)
    expect(code).toContain('vec3 n_cc = vec3(iControl[0].x, iTime, 0.1);')
    expect(plan.steps.map((step) => step.nodeId)).toEqual(['t', 'i'])
  })

  it('reads a per-frame node that a per-pixel value reaches per frame, and its planning reports the per-pixel input', () => {
    const doc = graph([node('u', 'uv'), node('i', 'integrator'), node('o', 'output')], [['u.x', 'i.rate'], ['i.value', 'o.color']])
    expect(place(doc)).toEqual({ placement: { o: 'pixel', i: 'frame' }, changesPerPixel: ['u'] })
    expect(generateGlsl(doc)).toMatchObject({ error: 'Rate needs one value per frame, but UV changes per pixel', errorNode: 'i' })
  })

  it('reports a per-frame consumer of that node on the consumer', () => {
    const doc = graph([node('u', 'uv'), node('i', 'integrator'), node('s', 'sceneSwitch'), node('o', 'output')], [['u.x', 'i.rate'], ['i.value', 's.index']])
    expect(place(doc, ['s'])).toEqual({ placement: { s: 'frame' }, changesPerPixel: ['u', 'i'] })
    expect(generateGlsl(doc)).toMatchObject({ error: 'Index needs one value per frame, but Integrator changes per pixel', errorNode: 's' })
  })

  it('refuses to read the placement of a node the pass did not reach', () => {
    const c = new FrontEnd(graph([node('u', 'uv'), node('k', 'knob'), node('o', 'output')], [['u.uv', 'o.color']]), {})
    placeNodes(c, ['o'])
    expect(() => c.placedAt('k')).toThrow('Node "k" was not placed')
  })
})
