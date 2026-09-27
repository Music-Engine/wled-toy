// The usermod target: one C++ translation unit against cpp/wledtoy.h for a WLED usermod. It is the GLSL target's text
// read through the header: the frame pass becomes `framePass`, run once per frame before the LEDs are shaded, global
// state a global array, and pixel state one set of layers per LED. With no frame pass it is the old backend's unit.
import { cppSource, pixelStateReads } from '@/lib/graph/compile/cpp/cpp'
import { GraphError } from '@/lib/graph/compile/front-end/program'
import type { CompileContext, Target } from '@/lib/graph/compile/next/context'
import { emitPass, type PassCode, type Spelling } from '@/lib/graph/compile/next/emit'
import { components, emitPixelShader, vectorsReached } from './glsl'
import { glslForm } from '@/lib/graph/compile/glsl/glsl-types'

export const usermod = ({ leds }: { leds: number }): Target<UsermodProgram> => ({
  name: 'usermod',
  reads: ['width', 'pass', 'state', 'resources'],
  emit: (ctx) => {
    const frame = emitPass(ctx, CPP, 'frame')
    const pixel = emitPass(ctx, CPP, 'pixel')
    rejectGlslOnly(ctx, [frame, pixel])
    return { code: unit(ctx, frame, pixel, leds) }
  },
})

export interface UsermodProgram {
  /** The translation unit: `renderFrame(time, frameIndex, colors)` shades `ledCount` LEDs. */
  code: string
}

// the header's vec4 has x, y, z and w but no swizzled runs, so a run of several floats is a stateSlot over its texel
const CPP: Spelling = {
  form: glslForm,
  globalSlot: (offset, dim) => {
    const texel = `globalState[${Math.floor(offset / 4)}]`
    return dim === 1 ? `${texel}.${components(offset, dim)}` : `stateSlot<vec${dim}>{${texel}, ${offset % 4}}`
  },
}

function rejectGlslOnly(ctx: CompileContext, passes: PassCode[]): void {
  const id = passes.flatMap((code) => code.glslOnly)[0]
  if (id) throw new GraphError(`${ctx.nodes[id].shape.title} samples a texture or takes a derivative, which C++ has no pixels for`, id)
}

function unit(ctx: CompileContext, frame: PassCode, pixel: PassCode, leds: number): string {
  const layers = vectorsReached(ctx.slots.pixel)
  const texels = vectorsReached(ctx.slots.global)
  const framePass = texels > 0 ? ['void framePass() {', ...frame.lines.map((l) => `  ${l.text}`), '}', ''] : []
  const chunks = texels > 0 ? [...frame.chunks, ...pixel.chunks] : pixel.chunks
  const source = emitPixelShader(ctx, pixel, { chunks, globals: controlBlock(ctx), beforeMain: framePass })
  const definitions = [
    `constexpr int ledCount = ${leds};`,
    ...(layers ? [`vec4 pixelState[ledCount][${layers}] = {};`] : []),
    ...(texels ? [`vec4 globalState[${texels}] = {};`] : []),
    cppSource(pixelStateReads(source)),
    ...renderFrame(texels > 0),
  ]
  return ['#include "wledtoy.h"', '', 'namespace wledtoy {', '', definitions.join('\n'), '}', ''].join('\n')
}

/** The uniforms the prelude declares for GLSL, here at their defaults for the host to overwrite. */
function controlBlock(ctx: CompileContext): string[] {
  const defaults = ctx.uniforms.map((uniform) => uniform.default)
  if (defaults.length === 0) return []
  const vectors = Array.from({ length: Math.ceil(defaults.length / 4) }, (_, v) => `vec4(${[0, 1, 2, 3].map((c) => defaults[v * 4 + c] ?? 0).join(', ')})`)
  return [`vec4 iControl[${vectors.length}] = { ${vectors.join(', ')} };`]
}

// the LED pass of the GLSL prelude's main(), after the frame pass when there is one: each LED shaded where it sits, or
// along the scanline without a layout
const renderFrame = (framePass: boolean) => [
  '',
  'void renderFrame(float time, int frameIndex, vec3* colors) {',
  '  iTime = time;',
  '  iFrame = frameIndex;',
  '  iLedCount = float(ledCount);',
  '  iResolution = vec3(float(ledCount), 1.0f, 1.0f);',
  ...(framePass ? ['  framePass();'] : []),
  '  for (int i = 0; i < ledCount; i++) {',
  '    float ledIndex = float(i);',
  '    vec2 uv = iLayoutCount > 0.5f ? vec2(ledLayout(ledIndex).xy) : vec2((ledIndex + 0.5f) / iLedCount, iScanY);',
  '    vec4 c(0.0f, 0.0f, 0.0f, 1.0f);',
  '    mainImage(c, uv, ledIndex);',
  '    colors[i] = clamp(vec3(c.xyz), 0.0f, 1.0f);',
  '  }',
  '}',
  '',
]
