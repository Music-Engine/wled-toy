import { describe, expect, it } from 'vitest'
import type { FrameSource } from './frame-pass'
import { ShaderRenderer, type FrameParams } from './renderer'

// Adds `step` to r of each texel below `texels`; g keeps the width the frame pass draws
const counter = (texels: number, step: string): FrameSource => ({
  code: `#version 300 es
precision highp float;
uniform highp sampler2D iGlobal;
uniform vec3 iResolution;
out vec4 outGlobal;
void main() {
  float last = texelFetch(iGlobal, ivec2(gl_FragCoord.xy), 0).r;
  outGlobal = vec4(last + ${step}, iResolution.x, 0.0, 0.0);
}`,
  texels,
  probes: [0, 15, 16, 31].filter((texel) => texel < texels),
})

// Slot 0 in red, over 255 so the 8-bit canvas holds it exactly
const READER = `uniform highp sampler2D iGlobal;
void mainImage(out vec4 c, vec2 uv, float ledIndex) { c = vec4(texelFetch(iGlobal, ivec2(0, 0), 0).r / 255.0, 0.0, 0.0, 1.0); }`
const PLAIN = 'void mainImage(out vec4 c, vec2 uv, float ledIndex) { c = vec4(uv, 0.0, 1.0); }'

const params: FrameParams = { time: 0, frame: 0, ledCount: 4, scanY: 0.5 }
const floatTargets = !!document.createElement('canvas').getContext('webgl2')?.getExtension('EXT_color_buffer_float')

function setup() {
  const canvas = document.createElement('canvas')
  const renderer = new ShaderRenderer(canvas)
  const gl = canvas.getContext('webgl2')!
  // ledTick's order
  const tick = () => {
    renderer.renderGlobalState(params)
    const leds = renderer.renderLeds(params)
    renderer.readProbes()
    return leds
  }
  return { renderer, gl, tick }
}

describe.skipIf(!floatTargets)('global state (needs EXT_color_buffer_float)', () => {
  it('a frame pass counting LED ticks reads 30 after 30, in the LED pass, the preview pass and the probe', () => {
    const { renderer, gl, tick } = setup()
    renderer.compile(READER, counter(16, 'float(gl_FragCoord.x < 1.0)'))
    const leds = Array.from({ length: 30 }, tick)[29]
    expect(Math.round(leds[0] * 255)).toBe(30)

    renderer.renderPreview(params)
    const pixel = new Uint8Array(4)
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
    expect(pixel[0]).toBe(30)
    // Preview reads global state, never advances it
    renderer.renderPreview(params)
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
    expect(pixel[0]).toBe(30)

    expect(Array.from(renderer.readProbes()!.subarray(0, 4))).toEqual([30, 16, 0, 0])
    expect(gl.getError()).toBe(gl.NO_ERROR)
    renderer.dispose()
  })

  it('growing from 16 to 32 texels keeps the first 16 values', () => {
    const { renderer, gl, tick } = setup()
    renderer.compile(READER, counter(16, '1.0'))
    for (let i = 0; i < 3; i++) tick()
    expect(Array.from(renderer.readProbes()!)).toEqual([3, 16, 0, 0, 3, 16, 0, 0])

    renderer.compile(READER, counter(17, '1.0'))
    tick()
    expect(Array.from(renderer.readProbes()!)).toEqual([4, 17, 0, 0, 4, 17, 0, 0, 1, 17, 0, 0])
    expect(gl.getError()).toBe(gl.NO_ERROR)
    renderer.dispose()
  })

  it('a pixel body that fails to link keeps the previous program and frame pass, and deletes the new frame program', () => {
    const { renderer, gl, tick } = setup()
    const created: WebGLProgram[] = []
    const createProgram = gl.createProgram.bind(gl)
    gl.createProgram = () => {
      const program = createProgram()
      created.push(program)
      return program
    }
    renderer.compile(READER, counter(16, 'float(gl_FragCoord.x < 1.0)'))
    tick()
    tick()
    created.length = 0
    expect(() => renderer.compile('void mainImage(out vec4 c, vec2 uv, float ledIndex) { c = oops; }', counter(16, '5.0'))).toThrow()
    expect(created).toHaveLength(1)
    expect(gl.isProgram(created[0])).toBe(false)
    expect(renderer.ready).toBe(true)
    expect(Math.round(tick()[0] * 255)).toBe(3)
    expect(renderer.readProbes()![0]).toBe(3)
    expect(gl.getError()).toBe(gl.NO_ERROR)
    renderer.dispose()
  })

  it('the probe readback fills the one array made at compile', () => {
    const { renderer, tick } = setup()
    renderer.compile(READER, counter(16, '1.0'))
    const probes = renderer.readProbes()
    tick()
    tick()
    expect(renderer.readProbes()).toBe(probes)
    renderer.dispose()
  })
})

it('asking for global state without EXT_color_buffer_float fails the compile and keeps the previous program', () => {
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2')!
  const getExtension = gl.getExtension.bind(gl)
  gl.getExtension = ((name: string) => (name === 'EXT_color_buffer_float' ? null : getExtension(name))) as typeof gl.getExtension
  const renderer = new ShaderRenderer(canvas)
  renderer.compile(PLAIN)
  expect(() => renderer.compile(READER, counter(16, '1.0'))).toThrow('this GPU cannot keep global state')
  expect(renderer.ready).toBe(true)
  renderer.renderGlobalState(params)
  expect(Math.round(renderer.renderLeds({ ...params, ledCount: 1 })[1] * 100)).toBe(50)
  expect(renderer.readProbes()).toBeNull()
  expect(gl.getError()).toBe(gl.NO_ERROR)
  renderer.dispose()
})

it('a program without a frame pass creates no texture, no framebuffer and no extra draw', () => {
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2')!
  const calls = { createTexture: 0, createFramebuffer: 0, drawArrays: 0, readPixels: 0 }
  for (const name of Object.keys(calls) as (keyof typeof calls)[]) {
    const original = gl[name].bind(gl) as (...args: unknown[]) => unknown
    ;(gl as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
      calls[name]++
      return original(...args)
    }
  }
  const renderer = new ShaderRenderer(canvas)
  renderer.compile(PLAIN)
  Object.keys(calls).forEach((name) => (calls[name as keyof typeof calls] = 0))
  const frames = () => {
    renderer.renderGlobalState(params)
    renderer.renderLeds(params)
    renderer.readProbes()
    renderer.renderPreview(params)
  }

  frames()
  frames()
  expect(renderer.readProbes()).toBeNull()
  // One LED and one preview draw per tick, plus the LED readback
  expect(calls).toEqual({ createTexture: 0, createFramebuffer: 0, drawArrays: 4, readPixels: 2 })

  if (floatTargets) {
    Object.keys(calls).forEach((name) => (calls[name as keyof typeof calls] = 0))
    renderer.compile(READER, counter(16, '1.0'))
    frames()
    frames()
    // Two copies and the probes' float row, a frame pass draw per tick, probes riding the LED readback
    expect(calls).toEqual({ createTexture: 3, createFramebuffer: 3, drawArrays: 6, readPixels: 2 })
  }
  expect(gl.getError()).toBe(gl.NO_ERROR)
  renderer.dispose()
})
