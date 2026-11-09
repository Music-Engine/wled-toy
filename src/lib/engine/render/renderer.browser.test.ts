import { describe, expect, it } from 'vitest'
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

// each LED adds its index + 1 to layer 0 every frame and shows the total over 100
const COUNTER = `uniform highp sampler2DArray iState;
layout(location = 1) out vec4 outState1;
void mainImage(out vec4 c, vec2 uv, float ledIndex) {
  float n = texelFetch(iState, ivec3(gl_FragCoord.xy, 0), 0).r + ledIndex + 1.0;
  outState1 = vec4(n, 0.0, 0.0, 0.0);
  c = vec4(n / 100.0, 0.0, 0.0, 1.0);
}`

// layer 0 counts up by 1 and layer 1 by 10, shown in red and green
const TWO_COUNTERS = `uniform highp sampler2DArray iState;
layout(location = 1) out vec4 outState1;
layout(location = 2) out vec4 outState2;
void mainImage(out vec4 c, vec2 uv, float ledIndex) {
  float a = texelFetch(iState, ivec3(gl_FragCoord.xy, 0), 0).r + 1.0;
  float b = texelFetch(iState, ivec3(gl_FragCoord.xy, 1), 0).r + 10.0;
  outState1 = vec4(a);
  outState2 = vec4(b);
  c = vec4(a / 100.0, b / 100.0, 0.0, 1.0);
}`

const PLAIN = 'void mainImage(out vec4 c, vec2 uv, float ledIndex) { c = vec4(uv, 0.0, 1.0); }'
const TRAILS = 'void mainImage(out vec4 c, vec2 uv, float ledIndex) { c = vec4(previousFrame(0.0) * 0.5, 1.0); }'

const floatTargets = !!document.createElement('canvas').getContext('webgl2')?.getExtension('EXT_color_buffer_float')

function setup(code: string) {
  const canvas = document.createElement('canvas')
  const renderer = new ShaderRenderer(canvas)
  renderer.compile(code)
  const leds = (ledCount = 4) => Array.from(renderer.renderLeds({ time: 0, frame: 0, ledCount, scanY: 0.5 }), (v) => Math.round(v * 100))
  return { renderer, gl: canvas.getContext('webgl2')!, leds }
}

describe.skipIf(!floatTargets)('per-pixel state (needs EXT_color_buffer_float)', () => {
  it('each LED keeps its own count across frames, and renderLeds returns the color, not the state', () => {
    const { renderer, gl, leds } = setup(COUNTER)
    expect(leds()).toEqual([1, 0, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0])
    expect(leds()).toEqual([2, 0, 0, 4, 0, 0, 6, 0, 0, 8, 0, 0])
    expect(leds()).toEqual([3, 0, 0, 6, 0, 0, 9, 0, 0, 12, 0, 0])
    renderer.renderPreview({ time: 0, frame: 0, ledCount: 4, scanY: 0.5 })
    expect(gl.getError()).toBe(gl.NO_ERROR)
    renderer.dispose()
  })

  it('two layers count independently', () => {
    const { renderer, gl, leds } = setup(TWO_COUNTERS)
    expect(leds(1)).toEqual([1, 10, 0])
    expect(leds(1)).toEqual([2, 20, 0])
    expect(leds(1)).toEqual([3, 30, 0])
    expect(gl.getError()).toBe(gl.NO_ERROR)
    renderer.dispose()
  })

  it.each([
    ['a recompile', (r: ShaderRenderer) => r.compile(COUNTER), 4],
    ['resetFeedback', (r: ShaderRenderer) => r.resetFeedback(), 4],
    ['a resize', () => {}, 2],
  ] as const)('state starts from 0 again after %s', (_, reset, ledCount) => {
    const { renderer, gl, leds } = setup(COUNTER)
    leds()
    leds()
    reset(renderer)
    expect(leds(ledCount).slice(0, 4)).toEqual([1, 0, 0, 2])
    expect(gl.getError()).toBe(gl.NO_ERROR)
    renderer.dispose()
  })
})

it('a shader without outState allocates no state target and makes no drawBuffers call', () => {
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2')!
  const calls = { drawBuffers: 0, texStorage3D: 0, framebufferTextureLayer: 0, getExtension: 0 }
  for (const name of Object.keys(calls) as (keyof typeof calls)[]) {
    const original = gl[name].bind(gl) as (...args: unknown[]) => unknown
    ;(gl as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
      calls[name]++
      return original(...args)
    }
  }
  const renderer = new ShaderRenderer(canvas)
  Object.keys(calls).forEach((name) => (calls[name as keyof typeof calls] = 0))
  const frames = () => {
    renderer.renderLeds({ time: 0, frame: 0, ledCount: 4, scanY: 0.5 })
    renderer.renderPreview({ time: 0, frame: 0, ledCount: 4, scanY: 0.5 })
  }

  for (const code of [PLAIN, TRAILS]) {
    renderer.compile(code)
    frames()
    frames()
  }
  expect(calls).toEqual({ drawBuffers: 0, texStorage3D: 0, framebufferTextureLayer: 0, getExtension: 0 })

  // the counters see state when there is some: once per target of the LED and the preview pair
  if (floatTargets) {
    renderer.compile(COUNTER)
    frames()
    frames()
    expect(calls).toEqual({ drawBuffers: 4, texStorage3D: 4, framebufferTextureLayer: 4, getExtension: 0 })
  }
  expect(gl.getError()).toBe(gl.NO_ERROR)
  renderer.dispose()
})

it('asking for state without EXT_color_buffer_float fails the compile and keeps the previous program', () => {
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2')!
  const getExtension = gl.getExtension.bind(gl)
  gl.getExtension = ((name: string) => (name === 'EXT_color_buffer_float' ? null : getExtension(name))) as typeof gl.getExtension
  const renderer = new ShaderRenderer(canvas)
  renderer.compile(PLAIN)
  expect(() => renderer.compile(COUNTER)).toThrow('this GPU cannot keep per-pixel state')
  expect(renderer.ready).toBe(true)
  expect(Math.round(renderer.renderLeds({ time: 0, frame: 0, ledCount: 1, scanY: 0.5 })[1] * 100)).toBe(50)
  renderer.dispose()
})

it('outState indices with a gap fail the compile and keep the previous program', () => {
  const { renderer, leds } = setup(PLAIN)
  const gap = `layout(location = 1) out vec4 outState1;
layout(location = 3) out vec4 outState3;
void mainImage(out vec4 c, vec2 uv, float ledIndex) { outState1 = vec4(1.0); outState3 = vec4(1.0); c = vec4(1.0); }`
  expect(() => renderer.compile(gap)).toThrow('outState indices must be contiguous from 1, found 1, 3')
  expect(leds(1)).toEqual([50, 50, 0])
  renderer.dispose()
})
