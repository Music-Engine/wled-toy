import { afterEach, expect, it } from 'vitest'
import { config } from '@/lib/app/config'
import { EXAMPLES } from './examples'
import { NODES, type Param } from './catalog'
import { PRELUDE } from './prelude'
import { bundleShader } from './shader-bundle'
import { standaloneGlsl } from './shader-export'
import { workspace } from '@/lib/app/workspace'

/** A host that knows nothing of this app: its own context, a constant for every plain uniform, a 1x1 texture per sampler. Returns the pixels it drew. */
function runStandalone(fragment: string, size = 4): Uint8Array {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const gl = canvas.getContext('webgl2')!
  const program = gl.createProgram()
  for (const [type, source] of [[gl.VERTEX_SHADER, '#version 300 es\nin vec2 p;\nvoid main() { gl_Position = vec4(p, 0.0, 1.0); }'], [gl.FRAGMENT_SHADER, fragment]] as const) {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'compile failed')
    gl.attachShader(program, shader)
  }
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link failed')
  gl.useProgram(program)

  let unit = 0
  for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i++) {
    const info = gl.getActiveUniform(program, i)!
    const location = gl.getUniformLocation(program, info.name)
    if (info.type === gl.SAMPLER_2D || info.type === gl.SAMPLER_2D_ARRAY) {
      const target = info.type === gl.SAMPLER_2D ? gl.TEXTURE_2D : gl.TEXTURE_2D_ARRAY
      const units = Array.from({ length: info.size }, () => unit++)
      for (const u of units) {
        gl.activeTexture(gl.TEXTURE0 + u)
        gl.bindTexture(target, gl.createTexture())
        if (target === gl.TEXTURE_2D) gl.texImage2D(target, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255]))
        else gl.texImage3D(target, 0, gl.RGBA, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255]))
        gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      }
      gl.uniform1iv(location, units)
    } else if (info.name === 'iResolution') gl.uniform3f(location, size, size, 1)
    else if (info.type === gl.INT) gl.uniform1i(location, 1)
    else if (info.type === gl.FLOAT) gl.uniform1fv(location, new Float32Array(info.size).fill(1))
    else if (info.type === gl.FLOAT_VEC3) gl.uniform3f(location, 0, 0, 48000)
    else if (info.type === gl.FLOAT_VEC4) gl.uniform4fv(location, new Float32Array(info.size * 4).fill(0.5))
    else throw new Error(`No dummy for ${info.name}`)
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(gl.getAttribLocation(program, 'p'))
  gl.vertexAttribPointer(gl.getAttribLocation(program, 'p'), 2, gl.FLOAT, false, 0, 0)
  gl.viewport(0, 0, size, size)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  expect(gl.getError()).toBe(gl.NO_ERROR)
  const pixels = new Uint8Array(size * size * 4)
  gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  gl.getExtension('WEBGL_lose_context')?.loseContext()
  return pixels
}

const code = config.code
afterEach(() => {
  config.code = code
  workspace.mode = 'shader'
})

it('a bundle compiles, links and draws in a WebGL2 context that has never seen the prelude', () => {
  const pixels = runStandalone(bundleShader('void mainImage(out vec4 c, vec2 uv, float ledIndex) {\n  c = vec4(uv.x, step(0.5, uv.y), fbm(uv), 1.0);\n}'))
  const at = (x: number, y: number) => [...pixels.slice((y * 4 + x) * 4, (y * 4 + x) * 4 + 2)]
  expect(at(0, 0)).toEqual([32, 0])
  expect(at(3, 3)).toEqual([223, 255])
})

it('the host is a real check: the same code without its helpers does not compile', () => {
  expect(() => runStandalone('#version 300 es\nprecision highp float;\nout vec4 outColor;\nvoid main() { outColor = vec4(fbm(vec2(0.5))); }')).toThrow(/fbm/)
})

it.each(EXAMPLES.map((example) => [example.name, example.code]))('the example "%s" compiles and draws as a bundle', (_name, source) => {
  expect(runStandalone(bundleShader(source)).some((byte) => byte > 0)).toBe(true)
})

it('a shader that reaches every helper and every uniform of the prelude still compiles', () => {
  const literal = (value: Param['default']) => (value === undefined ? 'vec3(0.5)' : typeof value === 'number' ? value.toFixed(2) : Array.isArray(value) ? `vec${value.length}(${value.map((v) => v.toFixed(2)).join(', ')})` : value)
  const documented = NODES.filter((node) => node.kind === 'function' && node.category !== 'builtin')
  const source = [
    'void mainImage(out vec4 c, vec2 uv, float ledIndex) {',
    ...documented.map((node, i) => `  ${node.returns} v${i} = ${node.name}(${node.params.map((param) => literal(param.default)).join(', ')});`),
    '  c = vec4(previousFrame(1.0) + historyAt(2, uv.x, 0.5) + history(uv.x, 0.1) + bands(uv.x) + chroma(3.0) + waveformAt(4.0), 1.0);',
    '  c.r += texture(iImages, vec3(uv, 0.0)).r + iControl[3].y + iTimeDelta + float(iFrame);',
    '}',
  ].join('\n')
  const bundle = bundleShader(source)
  // the audio* names are aliases kept for old shaders; nothing documented calls them, and they have a test of their own
  const helpers = [...PRELUDE.matchAll(/^\w+ (\w+)\(.*\{/gm)].map((m) => m[1]).filter((name) => name !== 'main' && !name.startsWith('audio'))
  expect(helpers.length).toBeGreaterThan(60)
  for (const name of helpers) expect(bundle, name).toMatch(new RegExp(`^\\w+ ${name}\\(`, 'm'))
  for (const [, name] of PRELUDE.matchAll(/^uniform\s+(?:highp\s+)?\w+\s+(\w+)/gm)) expect(bundle, name).toMatch(new RegExp(`^uniform .*\\b${name}\\b`, 'm'))
  expect(runStandalone(bundle).some((byte) => byte > 0)).toBe(true)
})

it('a shader written with the old audio* names still compiles, and the bundle carries each alias with the function it forwards to', () => {
  const aliases = [...PRELUDE.matchAll(/^float (audio\w+)\(/gm)].map((m) => m[1])
  expect(aliases.length).toBe(16)
  const source = [
    'void mainImage(out vec4 c, vec2 uv, float ledIndex) {',
    '  float v = audioFFT(uv.x) + audioFFTLog(uv.x) + audioWave(uv.x) + audioWaveAt(4.0) + audioBand(0.1, 0.4) + audioBands(uv.x) + audioBandsAt(1, uv.x);',
    '  v += audioBass() + audioMid() + audioTreble() + audioEnergy() + audioBeat(0.5) + audioHistory(uv.x, 0.1) + audioHistoryAt(1, uv.x, 0.1) + audioChroma(3.0) + audioChromaAt(1, 3.0);',
    '  c = vec4(vec3(v) + 0.5, 1.0);',
    '}',
  ].join('\n')
  const bundle = bundleShader(source)
  for (const name of aliases) expect(bundle, name).toMatch(new RegExp(`^float ${name}\\(`, 'm'))
  for (const name of ['fft', 'bandLevel', 'bass', 'historyAt']) expect(bundle, name).toMatch(new RegExp(`^float ${name}\\(`, 'm'))
  expect(runStandalone(bundle).some((byte) => byte > 0)).toBe(true)
})

it('in graph mode the export is the standalone compile of the working graph: no iControl, and it draws', () => {
  workspace.mode = 'graph'
  const { name, text } = standaloneGlsl()
  expect(name).toBe('graph.standalone.glsl')
  expect(text).not.toMatch(/\biControl\b/)
  expect(text).toContain('// Generated by WLEDtoy graph mode')
  expect(runStandalone(text).length).toBe(64)
})

it('in shader mode the export bundles the working copy', () => {
  config.code = 'void mainImage(out vec4 c, vec2 uv, float ledIndex) {\n  c = vec4(kelvin(2700.0), 1.0);\n}'
  const { name, text } = standaloneGlsl()
  expect(name).toBe('shader.standalone.glsl')
  expect(text).toContain(config.code)
  expect(text).toMatch(/^vec3 kelvin\(/m)
  const pixels = runStandalone(text)
  expect(pixels[0]).toBe(255)
  expect(pixels[2]).toBeLessThan(200)
})
