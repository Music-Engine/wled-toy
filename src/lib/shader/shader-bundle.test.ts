import { describe, expect, it } from 'vitest'
import { PRELUDE } from './prelude'
import { UNIFORM_CONTRACT, bundleShader } from './shader-bundle'

const shader = (body: string) => `void mainImage(out vec4 c, vec2 uv, float ledIndex) {\n  ${body}\n}`
const defines = (bundle: string, name: string) => new RegExp(`^\\w+ ${name}\\(`, 'm').test(bundle)
const declares = (bundle: string, name: string) => new RegExp(`^uniform .*\\b${name}\\b`, 'm').test(bundle)

describe('bundleShader', () => {
  it('brings a helper with everything it calls, and nothing the code does not reach', () => {
    const bundle = bundleShader(shader('c = vec4(vec3(fbm(uv * 4.0)), 1.0);'))
    for (const name of ['fbm', 'noise', 'hash']) expect(defines(bundle, name), name).toBe(true)
    for (const name of ['voronoi', 'rainbow', 'palette', 'fft', 'image', 'random']) expect(defines(bundle, name), name).toBe(false)
    expect(bundle.indexOf('float hash(')).toBeLessThan(bundle.indexOf('float noise('))
    expect(bundle.indexOf('float noise(')).toBeLessThan(bundle.indexOf('float fbm('))
    expect(bundle.indexOf('float fbm(')).toBeLessThan(bundle.indexOf('void mainImage('))
    expect(bundle.indexOf('void mainImage(')).toBeLessThan(bundle.indexOf('void main()'))
  })

  it('declares the uniforms the code and its helpers read, next to the ones main needs, and documents exactly those', () => {
    const plain = bundleShader(shader('c = vec4(uv, 0.0, 1.0);'))
    for (const name of ['iResolution', 'iLedCount', 'iScanY', 'iLayout', 'iLayoutCount']) expect(declares(plain, name), name).toBe(true)
    for (const name of ['iTime', 'iAudio', 'iImage', 'iImages', 'iAudioBands', 'iPrevFrame', 'iControl']) expect(declares(plain, name), name).toBe(false)
    expect(plain).not.toContain('//   iAudio')

    const audio = bundleShader(shader('c = vec4(vec3(bass() * sineWave(iTime)), 1.0);'))
    for (const name of ['bass', 'bandLevel', 'fft', 'sineWave']) expect(defines(audio, name), name).toBe(true)
    expect(declares(audio, 'iAudio')).toBe(true)
    expect(declares(audio, 'iTime')).toBe(true)
    expect(declares(audio, 'iImage')).toBe(false)
    expect(audio).toMatch(/^\/\/ {3}iAudio +R8 texture, 512 x 2/m)
  })

  it('a name that only a comment mentions brings nothing', () => {
    const bundle = bundleShader(shader('// rainbow(uv.x) was here\n  /* voronoi(uv) too */ c = vec4(1.0);'))
    expect(defines(bundle, 'rainbow')).toBe(false)
    expect(defines(bundle, 'voronoi')).toBe(false)
    expect(bundle).toContain('// rainbow(uv.x) was here')
  })

  it('keeps iControl declared when the code reads it, and says what it is', () => {
    const bundle = bundleShader(shader('c = vec4(iControl[0][1]);'))
    expect(declares(bundle, 'iControl')).toBe(true)
    expect(bundle).toMatch(/^\/\/ {3}iControl +64 vec4 .*does not carry what computes them/m)
  })

  it('is one shader from the version line on: no second version, precision or line directive, and the code is kept as written', () => {
    const code = shader('c = vec4(image(uv).rgb, 1.0);')
    const bundle = bundleShader(code, 'fire.glsl')
    expect(bundle.startsWith('#version 300 es\n// fire.glsl\n')).toBe(true)
    expect(bundle.match(/#version/g)).toHaveLength(1)
    expect(bundle.match(/^precision /gm)).toHaveLength(1)
    expect(bundle).not.toContain('#line')
    expect(bundle.match(/void mainImage\(/g)).toHaveLength(1)
    expect(bundle).toContain(code)
    expect(bundle).toContain('out vec4 outColor;')
  })

  it('has a contract for every uniform of the prelude', () => {
    const names = [...PRELUDE.matchAll(/^uniform\s+(?:highp\s+)?\w+\s+(\w+)/gm)].map((m) => m[1])
    expect(names.length).toBeGreaterThan(15)
    expect(Object.keys(UNIFORM_CONTRACT).sort()).toEqual([...names].sort())
  })
})
