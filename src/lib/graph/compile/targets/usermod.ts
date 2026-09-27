import type { CompileContext, PassCode, Target } from '@/lib/graph/compile/context'
import type { Spelling } from '@/lib/graph/compile/emit'
import { countVectors, declareStateTargets, emitPixelShaderLines, joinLines, loadStateLayers, toChunks, toComponents } from './glsl'
import { toGlslForm } from './glsl-form'

/** One C++ unit against cpp/wledtoy.h: GLSL target text read through the header, from the passes `cppParity` emitted */
export const createUsermodTarget = ({ leds }: { leds: number }): Target<UsermodProgram> => ({
  name: 'usermod',
  reads: ['width', 'pass', 'state', 'resources', 'cppParity'],
  emit: (ctx) => ({ code: emitUnit(ctx, ctx.cpp!.frame, ctx.cpp!.pixel, leds) }),
})

export interface UsermodProgram {
  /** `renderFrame(time, frameIndex, colors)` shades `ledCount` LEDs */
  code: string
}

// Header's vec4 has no swizzled runs, so a run of floats is a stateSlot over its texel
export const CPP: Spelling = {
  toForm: toGlslForm,
  toGlobalSlot: (offset, dim) => {
    const texel = `globalState[${Math.floor(offset / 4)}]`
    return dim === 1 ? `${texel}.${toComponents(offset, dim)}` : `stateSlot<vec${dim}>{${texel}, ${offset % 4}}`
  },
  toUniform: ({ offset }) => `iControl[${Math.floor(offset / 4)}].${'xyzw'[offset % 4]}`,
}

function emitUnit(ctx: CompileContext, frame: PassCode, pixel: PassCode, leds: number): string {
  const layers = countVectors(ctx.slots.pixel)
  const texels = countVectors(ctx.slots.global)
  const framePass = texels > 0 ? ['void framePass() {', ...frame.lines.map((line) => `  ${line.text}`), '}', ''] : []
  const chunks = texels > 0 ? [...toChunks(frame), ...toChunks(pixel)] : toChunks(pixel)
  const source = joinLines(emitPixelShaderLines(pixel, { chunks, globals: [...declareStateTargets(layers), ...declareControlBlock(ctx)], beforeMain: framePass, locals: loadStateLayers(layers) }))
  const definitions = [
    `constexpr int ledCount = ${leds};`,
    ...(layers ? [`vec4 pixelState[ledCount][${layers}] = {};`] : []),
    ...(texels ? [`vec4 globalState[${texels}] = {};`] : []),
    toCppSource(readPixelStatePerLed(source)),
    ...declareRenderFrame(texels > 0),
  ]
  return ['#include "wledtoy.h"', '', 'namespace wledtoy {', '', definitions.join('\n'), '}', ''].join('\n')
}

/** Prelude's `iControl` at defaults for the host to overwrite */
function declareControlBlock(ctx: CompileContext): string[] {
  const defaults = ctx.uniforms.map((uniform) => uniform.default)
  if (defaults.length === 0) return []
  const vectors = Array.from({ length: Math.ceil(defaults.length / 4) }, (_, vector) => `vec4(${[0, 1, 2, 3].map((component) => defaults[vector * 4 + component] ?? 0).join(', ')})`)
  return [`vec4 iControl[${vectors.length}] = { ${vectors.join(', ')} };`]
}

/** Each state layer becomes the LED's `pixelState` entry; multi-float slots go through `stateSlot`, C++ can't assign a run */
function readPixelStatePerLed(code: string): string {
  return code
    .replace(/^(uniform highp sampler2DArray iState;|layout\(location = \d+\) out vec4 outState\d+;)\n/gm, '')
    .replace(/^ {2}(outState\d+) = texelFetch\(iState, ivec3\(gl_FragCoord\.xy, (\d+)\), 0\);$/gm, '  [[maybe_unused]] vec4& $1 = pixelState[int(ledIndex)][$2];')
    .replace(/\b(outState\d+)\.([xyzw]{2,4})\b/g, (_, layer: string, run: string) => `stateSlot<vec${run.length}>{${layer}, ${'xyzw'.indexOf(run[0])}}`)
}

// `out` param as reference; `n_` variables may go unread, so only stray locals warn as unused
// Whole-source text match, sound only because bodies emit no string literals
const toCppSource = (code: string) =>
  code.replace(/\bout\s+(float|int|vec[234])\s/g, '$1& ').replace(/\b(float|int|vec[234]) (n_\w+)(?=\s*[=;])/g, '[[maybe_unused]] $1 $2')

// Prelude main()'s LED pass, after the frame pass if any: each LED at its layout position, else along the scanline
const declareRenderFrame = (framePass: boolean) => [
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
