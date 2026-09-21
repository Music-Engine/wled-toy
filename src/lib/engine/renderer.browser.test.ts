import { expect, it } from 'vitest'
import { ShaderRenderer } from './renderer'

it('the preview height limit shrinks what is shaded, keeps the canvas shape, and never enlarges it', () => {
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'display: block; width: 400px; height: 200px'
  document.body.append(canvas)
  const renderer = new ShaderRenderer(canvas)
  renderer.compile('void mainImage(out vec4 c, vec2 uv, float ledIndex) { c = vec4(uv, 0.0, 1.0); }')
  const shaded = (maxHeight?: number) => {
    renderer.renderPreview({ time: 0, frame: 0, ledCount: 1, scanY: 0.5 }, maxHeight)
    return [canvas.width, canvas.height]
  }
  const display = [Math.round(400 * devicePixelRatio), Math.round(200 * devicePixelRatio)]

  expect(shaded()).toEqual(display)
  expect(shaded(50)).toEqual([100, 50])
  expect(shaded(100000)).toEqual(display)
  expect(shaded(0)).toEqual(display)
  expect([canvas.clientWidth, canvas.clientHeight]).toEqual([400, 200])
  expect(canvas.getContext('webgl2')!.getError()).toBe(WebGL2RenderingContext.NO_ERROR)
  renderer.dispose()
  canvas.remove()
})
