import { describe, expect, it } from 'vitest'
import { ShaderRenderer } from '@/lib/engine/renderer'
import { generateGlsl } from '@/lib/graph'
import { graph, node, toByte } from '@/lib/graph/testing'

/** A 2 x 2 picture: red, green on top; blue, white (half transparent) below. */
function picture(): OffscreenCanvas {
  const canvas = new OffscreenCanvas(2, 2)
  const ctx = canvas.getContext('2d')!
  const pixels = ctx.createImageData(2, 2)
  pixels.data.set([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 128])
  ctx.putImageData(pixels, 0, 0)
  return canvas
}

function render(values: object, output: 'color' | 'alpha', { leds = 2, scanY = 0.75, layers = [picture()] } = {}) {
  const shader = generateGlsl(graph([node('i', 'imageTexture', values as never), node('o', 'output')], [[`i.${output}`, 'o.color']]))
  expect(shader.error).toBeNull()
  const canvas = document.createElement('canvas')
  const renderer = new ShaderRenderer(canvas)
  renderer.compile(shader.code)
  layers.forEach((image, layer) => renderer.setImageLayer(layer, image))
  const colors = renderer.renderLeds({ time: 0, frame: 0, ledCount: leds, scanY })
  expect(canvas.getContext('webgl2')!.getError()).toBe(0)
  renderer.dispose()
  return { shader, leds: Array.from({ length: leds }, (_, i) => [...colors.subarray(i * 3, i * 3 + 3)].map(toByte)) }
}

// resampling a picture into its layer goes through a 2D canvas, which can be off by one in a channel
const near = (actual: number[][], expected: number[][]) =>
  actual.forEach((led, i) => led.forEach((c, k) => expect(Math.abs(c - expected[i][k]), `LED ${i}: ${led} vs ${expected[i]}`).toBeLessThanOrEqual(1)))

describe('Image Texture', () => {
  it('Closest shows the pixels of the picture, top row at the top', () => {
    near(render({ interpolation: 'closest' }, 'color').leds, [[255, 0, 0], [0, 255, 0]])
    near([render({ interpolation: 'closest' }, 'color', { scanY: 0.25 }).leds[0]], [[0, 0, 255]])
  })

  it('Linear blends between them', () => {
    const [left] = render({}, 'color', { leds: 8, scanY: 0.75 }).leds.slice(3)
    expect(left[0]).toBeGreaterThan(60)
    expect(left[1]).toBeGreaterThan(60)
  })

  it('alpha comes out straight, or as 1 when the node is told to ignore it', () => {
    expect(render({ interpolation: 'closest' }, 'alpha', { scanY: 0.25 }).leds.map(([a]) => a)).toEqual([255, 128])
    expect(render({ interpolation: 'closest', alphaMode: 'none' }, 'alpha', { scanY: 0.25 }).leds.map(([a]) => a)).toEqual([255, 255])
  })

  it('sRGB decodes to linear light; the default leaves the numbers alone', () => {
    const grey = new OffscreenCanvas(1, 1)
    const ctx = grey.getContext('2d')!
    ctx.fillStyle = 'rgb(128 128 128)'
    ctx.fillRect(0, 0, 1, 1)
    expect(render({}, 'color', { leds: 1, layers: [grey] }).leds[0][0]).toBe(128)
    expect(render({ colorSpace: 'srgb' }, 'color', { leds: 1, layers: [grey] }).leds[0][0]).toBe(55)
  })

  it('past the edge the picture repeats, mirrors or holds its last pixel', () => {
    // sample at x = 1.25 and 1.75 by scaling the strip into the second tile
    const at = (extension: string) => {
      const shader = generateGlsl(graph(
        [node('uv', 'uv'), node('m', 'math', { op: 'add', b: 1 }), node('i', 'imageTexture', { interpolation: 'closest', extension }), node('o', 'output')],
        [['uv.uv', 'm.a'], ['m.result', 'i.vector'], ['i.color', 'o.color']],
      ))
      const renderer = new ShaderRenderer(document.createElement('canvas'))
      renderer.compile(shader.code)
      renderer.setImageLayer(0, picture())
      const colors = renderer.renderLeds({ time: 0, frame: 0, ledCount: 2, scanY: 0.75 })
      return [0, 1].map((i) => [...colors.subarray(i * 3, i * 3 + 3)].map(toByte))
    }
    // y = 1.75: repeat wraps to the top row, mirror reflects to the bottom row, extend holds the top row's edge
    near(at('repeat'), [[255, 0, 0], [0, 255, 0]])
    near(at('mirror'), [[255, 255, 255], [0, 0, 255]])
    near(at('extend'), [[0, 255, 0], [0, 255, 0]])
  })

  it('each image of a graph gets a layer; two nodes showing the same image share one', () => {
    const { frame: plan, code } = generateGlsl(graph(
      [node('a', 'imageTexture', { filename: 'cat.png' }), node('b', 'imageTexture', { filename: 'dog.png' }), node('c', 'imageTexture', { filename: 'cat.png' }),
        node('m', 'colorMix'), node('n', 'colorMix'), node('o', 'output')],
      [['a.color', 'm.color1'], ['b.color', 'm.color2'], ['m.color', 'n.color1'], ['c.color', 'n.color2'], ['n.color', 'o.color']],
    ))
    expect(plan.resources.image).toEqual(['cat.png', 'dog.png'])
    const layers = [...code.matchAll(/texture\(iImages, vec3\(.*?, (\d)\.0\)\)/g)].map((m) => m[1])
    expect(layers.sort()).toEqual(['0', '0', '1'])
  })
})
