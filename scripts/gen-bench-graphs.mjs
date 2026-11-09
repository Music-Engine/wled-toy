#!/usr/bin/env node
// Writes graphs/bench/*.wledgraph. Sizes live in SIZES; run `node scripts/gen-bench-graphs.mjs` after changing them.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'graphs', 'bench')

const SIZES = {
  gpuHeavyLayers: 6,
  sharedConsumers: 16,
  controlChains: 20,
  controlChainLength: 16,
  wideNodes: 500,
  kitchenControlChains: 4,
  kitchenWideNodes: 60,
}

// the type colors the editor writes on a link, by the source socket's type (graphs/AUTHORING.md "File format")
const STROKE = {
  float: '#a1a1a1',
  int: '#4772b3',
  vec2: '#6363c7',
  vec3: '#6363c7',
  color: '#c7c729',
  texture: '#29c7c7',
  audio: '#e0853d',
  spectrum: '#d9568b',
}

class Builder {
  constructor() {
    this.nodes = []
    this.edges = []
  }

  add(id, kind, values = {}) {
    this.nodes.push({ id, type: 'shader', position: { x: 0, y: 0 }, data: { kind, values } })
    return id
  }

  link(from, to, type = 'float') {
    const [source, sourceHandle] = from.split('.')
    const [target, targetHandle] = to.split('.')
    this.edges.push({
      id: `e-${source}-${sourceHandle}-${target}-${targetHandle}`,
      source,
      sourceHandle,
      target,
      targetHandle,
      style: { stroke: STROKE[type], strokeWidth: 2 },
    })
  }

  // a plain grid in creation order: 320 px columns are wider than any node, so only the row pitch has to clear the tallest one
  build() {
    const cols = Math.max(1, Math.ceil(Math.sqrt(this.nodes.length)))
    this.nodes.forEach((node, i) => {
      node.position = { x: (i % cols) * 320, y: Math.floor(i / cols) * 460 }
    })
    return { app: 'wledtoy', formatVersion: 1, graph: { version: 3, nodes: this.nodes, edges: this.edges } }
  }
}

function baseline() {
  const b = new Builder()
  b.add('uv', 'uv')
  b.add('out', 'output')
  b.link('uv.x', 'out.color')
  return b
}

function gpuHeavy() {
  const b = new Builder()
  b.add('time', 'time')
  b.add('drift', 'combineXYZ', { x: 0, y: 0, z: 0 })
  b.link('time.time', 'drift.z')
  b.add('uv', 'uv')

  let stack = null
  for (let layer = 0; layer < SIZES.gpuHeavyLayers; layer++) {
    const p = `l${layer}`
    b.add(`${p}map`, 'mapping', { location: [0, 0, 0], rotation: 0.05 * layer, scale: [1 + layer, 1 + layer, 1], pivot: [0.5, 0.5, 0] })
    b.link('drift.vector', `${p}map.location`, 'vec3')
    b.add(`${p}noise`, 'noiseTexture', { scale: 6 + layer, detail: 15, roughness: 0.85, distortion: 2 })
    b.link(`${p}map.vector`, `${p}noise.vector`, 'vec3')
    b.add(`${p}voronoi`, 'voronoi', { scale: 8 + layer, randomness: 1 })
    b.link(`${p}map.vector`, `${p}voronoi.vector`, 'vec3')
    b.add(`${p}magic`, 'magicTexture', { depth: 10, scale: 7 + layer, distortion: 2 })
    b.link(`${p}map.vector`, `${p}magic.vector`, 'vec3')
    b.add(`${p}brick`, 'brickTexture', { scale: 6 + layer, mortarSize: 0.04, mortarSmooth: 0.5, brickWidth: 0.5, rowHeight: 0.25 })
    b.link(`${p}map.vector`, `${p}brick.vector`, 'vec3')
    b.add(`${p}wave`, 'waveTexture', {
      type: 'rings',
      ringsDirection: 'spherical',
      profile: 'triangle',
      scale: 9 + layer,
      distortion: 2,
      detail: 15,
      detailScale: 2,
      detailRoughness: 0.7,
    })
    b.link(`${p}map.vector`, `${p}wave.vector`, 'vec3')

    b.add(`${p}ramp`, 'colorRamp', {
      ramp: {
        interpolation: 'spline',
        stops: [
          { position: 0, color: [0, 0, 0.2] },
          { position: 0.35, color: [0.8, 0.1, 0.4] },
          { position: 0.7, color: [1, 0.7, 0.1] },
          { position: 1, color: [0.9, 1, 1] },
        ],
      },
    })
    b.link(`${p}noise.fac`, `${p}ramp.fac`)
    b.add(`${p}mixA`, 'colorMix', { mode: 'overlay', factor: 0.6 })
    b.link(`${p}ramp.color`, `${p}mixA.color1`, 'color')
    b.link(`${p}voronoi.color`, `${p}mixA.color2`, 'color')
    b.add(`${p}mixB`, 'colorMix', { mode: 'screen', factor: 0.5 })
    b.link(`${p}mixA.color`, `${p}mixB.color1`, 'color')
    b.link(`${p}magic.color`, `${p}mixB.color2`, 'color')
    b.add(`${p}mixC`, 'colorMix', { mode: 'softLight', factor: 0.4 })
    b.link(`${p}mixB.color`, `${p}mixC.color1`, 'color')
    b.link(`${p}brick.color`, `${p}mixC.color2`, 'color')
    b.add(`${p}mixD`, 'colorMix', { mode: 'linearLight', factor: 0.5 })
    b.link(`${p}mixC.color`, `${p}mixD.color1`, 'color')
    b.link(`${p}wave.color`, `${p}mixD.color2`, 'color')

    if (stack === null) stack = `${p}mixD.color`
    else {
      b.add(`${p}stack`, 'colorMix', { mode: 'add', factor: 0.5 })
      b.link(stack, `${p}stack.color1`, 'color')
      b.link(`${p}mixD.color`, `${p}stack.color2`, 'color')
      stack = `${p}stack.color`
    }
  }

  b.add('ceiling', 'brightnessCeiling', { ceiling: 0.9 })
  b.link(stack, 'ceiling.color', 'color')
  b.add('out', 'output')
  b.link('ceiling.color', 'out.color', 'color')
  return b
}

function sharedSubgraph() {
  const b = new Builder()
  b.add('time', 'time')
  b.add('drift', 'combineXYZ', { x: 0, y: 0, z: 0 })
  b.link('time.time', 'drift.z')
  b.add('map', 'mapping', { rotation: 0.1, scale: [3, 3, 1], pivot: [0.5, 0.5, 0] })
  b.link('drift.vector', 'map.location', 'vec3')
  // the one expensive value: if it is emitted per consumer the fan-out below multiplies its cost
  b.add('noise', 'noiseTexture', { scale: 8, detail: 15, roughness: 0.9, distortion: 2 })
  b.link('map.vector', 'noise.vector', 'vec3')
  b.add('voronoi', 'voronoi', { scale: 12, randomness: 1 })
  b.link('map.vector', 'voronoi.vector', 'vec3')
  b.add('magic', 'magicTexture', { depth: 10, scale: 9, distortion: 2 })
  b.link('map.vector', 'magic.vector', 'vec3')
  b.add('blend', 'colorMix', { mode: 'overlay', factor: 0.5 })
  b.link('noise.color', 'blend.color1', 'color')
  b.link('voronoi.color', 'blend.color2', 'color')
  b.add('shared', 'colorMix', { mode: 'screen', factor: 0.5 })
  b.link('blend.color', 'shared.color1', 'color')
  b.link('magic.color', 'shared.color2', 'color')

  const taps = []
  for (let i = 0; i < SIZES.sharedConsumers; i++) {
    const id = `tap${i}`
    b.add(id, 'hueSaturation', { hue: i / SIZES.sharedConsumers, saturation: 1, value: 1, factor: 1 })
    b.link('shared.color', `${id}.color`, 'color')
    taps.push(`${id}.color`)
  }
  let level = taps
  let round = 0
  while (level.length > 1) {
    const next = []
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 === level.length) {
        next.push(level[i])
        continue
      }
      const id = `sum${round}_${i}`
      b.add(id, 'colorMix', { mode: 'add', factor: 0.5 })
      b.link(level[i], `${id}.color1`, 'color')
      b.link(level[i + 1], `${id}.color2`, 'color')
      next.push(`${id}.color`)
    }
    level = next
    round++
  }
  b.add('ceiling', 'brightnessCeiling', { ceiling: 0.9 })
  b.link(level[0], 'ceiling.color', 'color')
  b.add('out', 'output')
  b.link('ceiling.color', 'out.color', 'color')
  return b
}

// one control-rate step: which input takes the chain, which output continues it
const CONTROL_STEPS = [
  { kind: 'envelopeFollower', values: { attack: 0.02, release: 0.25 }, in: 'signal', out: 'envelope' },
  { kind: 'slewLimiter', values: { rise: 4, fall: 1.5 }, in: 'signal', out: 'value' },
  { kind: 'math', values: { op: 'multiply', b: 0.95 }, in: 'a', out: 'result' },
  { kind: 'wave', values: { shape: 'sine', frequency: 1.5, phase: 0 }, in: 'input', out: 'value' },
  { kind: 'peakHold', values: { hold: 0.15, decay: 0.6 }, in: 'signal', out: 'peak' },
  { kind: 'remap', values: { clamp: true, inLow: 0, inHigh: 1, outLow: 0.1, outHigh: 0.9 }, in: 'value', out: 'result' },
  { kind: 'curve', values: { curve: 'smooth' }, in: 'value', out: 'result' },
  { kind: 'schmittTrigger', values: { low: 0.35, high: 0.6 }, in: 'signal', out: 'gate' },
  { kind: 'sampleHold', values: {}, in: 'trigger', out: 'value' },
  { kind: 'counter', values: { steps: 8 }, in: 'trigger', out: 'phase' },
  { kind: 'stepSequencer', values: { steps: '1 0.25 0.75 0 0.5' }, in: 'trigger', out: 'value' },
  { kind: 'integrator', values: { wrap: true, rate: 1 }, in: 'rate', out: 'value' },
  { kind: 'clockDivider', values: { divide: 3 }, in: 'trigger', out: 'phase' },
  { kind: 'toggle', values: {}, in: 'trigger', out: 'state' },
  { kind: 'envelope', values: { mode: 'ad', attack: 0.02, decay: 0.3, sustain: 0.5, release: 0.3 }, in: 'gate', out: 'envelope' },
  { kind: 'math', values: { op: 'add', b: 0.05, clamp: true }, in: 'a', out: 'result' },
]

const AUDIO_TAPS = [
  'level',
  'kick',
  'sub',
  'lowMid',
  'vocal',
  'presence',
  'air',
  'beatPhase',
  'centroid',
  'flatness',
  'rms',
  'peak',
  'gate',
  'onset',
  'beat',
  'bpm',
]

/** Adds `chains` chains of `length` control nodes hanging off the Audio node, and returns a handle for their sum. */
function controlChains(b, chains, length, prefix) {
  const ends = []
  for (let chain = 0; chain < chains; chain++) {
    let handle = `audio.${AUDIO_TAPS[chain % AUDIO_TAPS.length]}`
    for (let i = 0; i < length; i++) {
      const step = CONTROL_STEPS[(chain + i) % CONTROL_STEPS.length]
      const id = `${prefix}c${chain}s${i}`
      b.add(id, step.kind, step.values)
      b.link(handle, `${id}.${step.in}`)
      // Sample and Hold would otherwise latch its default 0 forever
      if (step.kind === 'sampleHold') b.link(handle, `${id}.signal`)
      handle = `${id}.${step.out}`
    }
    ends.push(handle)
  }
  let level = ends
  let round = 0
  while (level.length > 1) {
    const next = []
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 === level.length) {
        next.push(level[i])
        continue
      }
      const id = `${prefix}sum${round}_${i}`
      b.add(id, 'math', { op: 'add', clamp: true })
      b.link(level[i], `${id}.a`)
      b.link(level[i + 1], `${id}.b`)
      next.push(`${id}.result`)
    }
    level = next
    round++
  }
  return level[0]
}

function controlChain() {
  const b = new Builder()
  b.add('source', 'audioSource')
  b.add('audio', 'audio')
  b.link('source.audio', 'audio.audio', 'audio')
  const sum = controlChains(b, SIZES.controlChains, SIZES.controlChainLength, '')
  b.add('uv', 'uv')
  b.add('tint', 'math', { op: 'multiply' })
  b.link('uv.x', 'tint.a')
  b.link(sum, 'tint.b')
  b.add('out', 'output')
  b.link('tint.result', 'out.color')
  return b
}

// distinct FFT settings each take one of the 3 slots next to the default analysis (MAX_ANALYSES = 4)
const FFT_SETTINGS = [
  { windowSize: '8192', hop: '128', window: 'hann', scale: 'mel', bands: 256, fmin: 40, fmax: 16000 },
  { windowSize: '8192', hop: '128', window: 'hamming', scale: 'mel', bands: 256, fmin: 40, fmax: 16000 },
  { windowSize: '8192', hop: '128', window: 'blackman', scale: 'log', bands: 256, fmin: 40, fmax: 16000 },
]

function audioMultiFft() {
  const b = new Builder()
  b.add('source', 'audioSource')
  b.add('uv', 'uv')
  const colors = []
  const levels = []
  FFT_SETTINGS.forEach((settings, i) => {
    b.add(`fft${i}`, 'fft', settings)
    b.link('source.audio', `fft${i}.audio`, 'audio')
    b.add(`spec${i}`, 'spectrum', { age: i * 0.2 })
    b.link(`fft${i}.spectrum`, `spec${i}.spectrum`, 'spectrum')
    b.add(`chroma${i}`, 'chroma')
    b.link(`fft${i}.spectrum`, `chroma${i}.spectrum`, 'spectrum')
    b.add(`bands${i}`, 'bands', { count: '16' })
    b.link(`fft${i}.spectrum`, `bands${i}.spectrum`, 'spectrum')
    b.add(`split${i}`, 'bandSplit', { low: 60 + i * 400, high: 400 + i * 1200 })
    b.link(`fft${i}.spectrum`, `split${i}.spectrum`, 'spectrum')

    b.add(`ramp${i}`, 'colorRamp', {
      ramp: {
        interpolation: 'linear',
        stops: [
          { position: 0, color: [0, 0, 0] },
          { position: 0.5, color: [0.2, 0.6, 1] },
          { position: 1, color: [1, 0.9, 0.4] },
        ],
      },
    })
    b.link(`spec${i}.level`, `ramp${i}.fac`)
    b.add(`chromaMul${i}`, 'math', { op: 'multiply' })
    b.link(`chroma${i}.level`, `chromaMul${i}.a`)
    b.link(`split${i}.level`, `chromaMul${i}.b`)
    b.add(`tint${i}`, 'colorMix', { mode: 'add', factor: 0.5 })
    b.link(`ramp${i}.color`, `tint${i}.color1`, 'color')
    b.add(`chromaColor${i}`, 'combineColor', { mode: 'hsv', a: i / 3, b: 1, c: 1 })
    b.link(`chromaMul${i}.result`, `chromaColor${i}.c`)
    b.link(`chromaColor${i}.color`, `tint${i}.color2`, 'color')
    colors.push(`tint${i}.color`)

    // every one of the 16 per-frame band outputs is consumed, so no analysis is planned and then ignored
    let sum = null
    for (let band = 1; band <= 16; band++) {
      const id = `bandSum${i}_${band}`
      b.add(id, 'math', { op: 'add', clamp: true })
      if (sum) b.link(sum, `${id}.a`)
      else b.link(`bands${i}.band1`, `${id}.a`)
      b.link(`bands${i}.band${band}`, `${id}.b`)
      sum = `${id}.result`
    }
    levels.push(sum)
  })

  // the default analysis (slot 0) is the fourth, through the Audio node
  b.add('audio', 'audio')
  b.link('source.audio', 'audio.audio', 'audio')
  b.add('defaultSpec', 'spectrum')
  b.add('defaultRamp', 'colorRamp', {
    ramp: {
      interpolation: 'ease',
      stops: [
        { position: 0, color: [0, 0, 0] },
        { position: 1, color: [1, 0.3, 0.1] },
      ],
    },
  })
  b.link('defaultSpec.level', 'defaultRamp.fac')
  colors.push('defaultRamp.color')

  let level = colors
  let round = 0
  while (level.length > 1) {
    const next = []
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 === level.length) {
        next.push(level[i])
        continue
      }
      const id = `mix${round}_${i}`
      b.add(id, 'colorMix', { mode: 'screen', factor: 0.5 })
      b.link(level[i], `${id}.color1`, 'color')
      b.link(level[i + 1], `${id}.color2`, 'color')
      next.push(`${id}.color`)
    }
    level = next
    round++
  }

  let gain = 'audio.level'
  levels.forEach((handle, i) => {
    const id = `gain${i}`
    b.add(id, 'math', { op: 'add', clamp: true })
    b.link(gain, `${id}.a`)
    b.link(handle, `${id}.b`)
    gain = `${id}.result`
  })
  b.add('pump', 'colorMix', { mode: 'multiply', factor: 1 })
  b.link(level[0], 'pump.color1', 'color')
  b.add('gainColor', 'combineColor', { mode: 'rgb', a: 1, b: 1, c: 1 })
  b.link(gain, 'gainColor.a')
  b.link(gain, 'gainColor.b')
  b.link(gain, 'gainColor.c')
  b.link('gainColor.color', 'pump.color2', 'color')
  b.add('out', 'output')
  b.link('pump.color', 'out.color', 'color')
  return b
}

function feedback() {
  const b = new Builder()
  b.add('source', 'audioSource')
  b.add('audio', 'audio')
  b.link('source.audio', 'audio.audio', 'audio')
  b.add('time', 'time')
  b.add('scan', 'scanner', { speed: 2, width: 0.05 })
  b.add('sparkle', 'sparkle', { density: 0.15, speed: 3 })
  b.add('pal', 'gradientPalette', { palette: 'lava', repeat: true })
  b.link('time.time', 'pal.position')
  b.add('spark', 'colorMix', { mode: 'multiply', factor: 1 })
  b.link('pal.color', 'spark.color1', 'color')
  b.add('sparkColor', 'combineColor', { mode: 'rgb', a: 1, b: 1, c: 1 })
  b.link('sparkle.out', 'sparkColor.a')
  b.link('sparkle.out', 'sparkColor.b')
  b.link('sparkle.out', 'sparkColor.c')
  b.link('sparkColor.color', 'spark.color2', 'color')
  b.add('scanColor', 'combineColor', { mode: 'rgb', a: 1, b: 1, c: 1 })
  b.link('scan.out', 'scanColor.a')
  b.link('scan.out', 'scanColor.b')
  b.link('scan.out', 'scanColor.c')
  b.add('seed', 'colorMix', { mode: 'add', factor: 0.6 })
  b.link('spark.color', 'seed.color1', 'color')
  b.link('scanColor.color', 'seed.color2', 'color')

  b.add('trails', 'trails', { decay: 1.5, offset: 1 })
  b.link('seed.color', 'trails.color', 'color')
  b.add('blur', 'stripBlur', { spread: 8, decay: 0.8 })
  b.link('trails.color', 'blur.color', 'color')
  b.add('prev1', 'previousFrame', { offset: 3 })
  b.add('prev2', 'previousFrame', { offset: -3 })
  b.add('echo', 'colorMix', { mode: 'lighten', factor: 0.5 })
  b.link('prev1.color', 'echo.color1', 'color')
  b.link('prev2.color', 'echo.color2', 'color')
  b.add('stack', 'colorMix', { mode: 'screen', factor: 0.45 })
  b.link('blur.color', 'stack.color1', 'color')
  b.link('echo.color', 'stack.color2', 'color')
  b.add('trails2', 'trails', { decay: 0.6, offset: -1 })
  b.link('stack.color', 'trails2.color', 'color')
  b.add('lift', 'colorMix', { mode: 'multiply', factor: 1 })
  b.link('trails2.color', 'lift.color1', 'color')
  b.add('liftColor', 'combineColor', { mode: 'rgb', a: 1, b: 1, c: 1 })
  b.link('audio.level', 'liftColor.a')
  b.link('audio.level', 'liftColor.b')
  b.link('audio.level', 'liftColor.c')
  b.link('liftColor.color', 'lift.color2', 'color')
  b.add('out', 'output')
  b.link('lift.color', 'out.color', 'color')
  return b
}

// cheap per-pixel links, cycled: each takes the chain on one input and keeps it per-pixel
const WIDE_STEPS = [
  { kind: 'math', values: { op: 'multiply', b: 1.01 }, in: 'a', out: 'result' },
  { kind: 'math', values: { op: 'add', b: 0.003 }, in: 'a', out: 'result' },
  { kind: 'clamp', values: { type: 'minMax', min: 0, max: 1 }, in: 'value', out: 'result' },
  { kind: 'mix', values: { mode: 'mix', b: 1 }, in: 'a', out: 'result' },
  { kind: 'math', values: { op: 'fraction' }, in: 'a', out: 'result' },
  { kind: 'math', values: { op: 'smoothMax', b: 0.2, c: 0.1 }, in: 'a', out: 'result' },
  { kind: 'math', values: { op: 'sine' }, in: 'a', out: 'result' },
  { kind: 'math', values: { op: 'absolute' }, in: 'a', out: 'result' },
  { kind: 'smoothstep', values: { low: 0, high: 1 }, in: 'value', out: 'out' },
  { kind: 'math', values: { op: 'wrap', b: 0, c: 1 }, in: 'a', out: 'result' },
]

/** Adds `count` cheap per-pixel nodes as four parallel chains off uv, and returns a handle for their average. */
function wideChain(b, count, prefix) {
  const lanes = 4
  const ends = []
  for (let lane = 0; lane < lanes; lane++) {
    let handle = lane % 2 === 0 ? 'uv.x' : 'uv.y'
    const length = Math.floor(count / lanes)
    for (let i = 0; i < length; i++) {
      const step = WIDE_STEPS[(lane + i) % WIDE_STEPS.length]
      const id = `${prefix}w${lane}_${i}`
      b.add(id, step.kind, step.values)
      b.link(handle, `${id}.${step.in}`)
      handle = `${id}.${step.out}`
    }
    ends.push(handle)
  }
  let level = ends
  let round = 0
  while (level.length > 1) {
    const next = []
    for (let i = 0; i < level.length; i += 2) {
      const id = `${prefix}wsum${round}_${i}`
      b.add(id, 'math', { op: 'add', clamp: true })
      b.link(level[i], `${id}.a`)
      b.link(level[i + 1], `${id}.b`)
      next.push(`${id}.result`)
    }
    level = next
    round++
  }
  return level[0]
}

function wide() {
  const b = new Builder()
  b.add('uv', 'uv')
  const handle = wideChain(b, SIZES.wideNodes, '')
  b.add('pal', 'gradientPalette', { palette: 'party', repeat: true })
  b.link(handle, 'pal.position')
  b.add('out', 'output')
  b.link('pal.color', 'out.color', 'color')
  return b
}

function kitchenSink() {
  const b = new Builder()
  b.add('source', 'audioSource')
  b.add('audio', 'audio')
  b.link('source.audio', 'audio.audio', 'audio')
  b.add('uv', 'uv')
  b.add('time', 'time')

  b.add('fft0', 'fft', { windowSize: '4096', hop: '256', window: 'hann', scale: 'mel', bands: 128, fmin: 40, fmax: 16000 })
  b.link('source.audio', 'fft0.audio', 'audio')
  b.add('spec0', 'spectrum')
  b.link('fft0.spectrum', 'spec0.spectrum', 'spectrum')
  b.add('fft1', 'fft', { windowSize: '1024', hop: '256', window: 'blackman', scale: 'log', bands: 64, fmin: 200, fmax: 12000 })
  b.link('source.audio', 'fft1.audio', 'audio')
  b.add('split1', 'bandSplit', { low: 2000, high: 8000 })
  b.link('fft1.spectrum', 'split1.spectrum', 'spectrum')

  const control = controlChains(b, SIZES.kitchenControlChains, 12, 'k')
  const wideHandle = wideChain(b, SIZES.kitchenWideNodes, 'k')

  b.add('drift', 'combineXYZ', { x: 0, y: 0, z: 0 })
  b.link('time.time', 'drift.z')
  b.add('map', 'mapping', { rotation: 0.05, scale: [2, 2, 1], pivot: [0.5, 0.5, 0] })
  b.link('drift.vector', 'map.location', 'vec3')
  b.add('noise', 'noiseTexture', { scale: 6, detail: 8, roughness: 0.6, distortion: 1 })
  b.link('map.vector', 'noise.vector', 'vec3')
  b.add('voronoi', 'voronoi', { scale: 10, randomness: 1 })
  b.link('map.vector', 'voronoi.vector', 'vec3')
  b.add('ramp', 'colorRamp', {
    ramp: {
      interpolation: 'ease',
      stops: [
        { position: 0, color: [0, 0, 0.1] },
        { position: 0.5, color: [0.6, 0.1, 0.8] },
        { position: 1, color: [1, 0.9, 0.5] },
      ],
    },
  })
  b.link('noise.fac', 'ramp.fac')
  b.add('tex', 'colorMix', { mode: 'overlay', factor: 0.5 })
  b.link('ramp.color', 'tex.color1', 'color')
  b.link('voronoi.color', 'tex.color2', 'color')

  b.add('specColor', 'combineColor', { mode: 'hsv', a: 0.6, b: 0.8, c: 1 })
  b.link('spec0.level', 'specColor.c')
  b.add('layer', 'layerMix', { mode: 'screen', opacity: 0.8 })
  b.link('tex.color', 'layer.base', 'color')
  b.link('specColor.color', 'layer.layer', 'color')
  b.link(wideHandle, 'layer.mask')

  b.add('gainMix', 'math', { op: 'add', clamp: true })
  b.link(control, 'gainMix.a')
  b.link('split1.level', 'gainMix.b')
  b.add('lift', 'hueSaturation', { hue: 0, saturation: 1, value: 1, factor: 1 })
  b.link('gainMix.result', 'lift.hue')
  b.link('layer.color', 'lift.color', 'color')

  b.add('trails', 'trails', { decay: 0.8, offset: 1 })
  b.link('lift.color', 'trails.color', 'color')
  b.add('blur', 'stripBlur', { spread: 4, decay: 0.5 })
  b.link('trails.color', 'blur.color', 'color')
  b.add('ceiling', 'brightnessCeiling', { ceiling: 0.9 })
  b.link('blur.color', 'ceiling.color', 'color')
  b.add('out', 'output', { gamma: 2.2 })
  b.link('ceiling.color', 'out.color', 'color')
  return b
}

const GRAPHS = {
  'bench-baseline': baseline,
  'bench-gpu-heavy': gpuHeavy,
  'bench-gpu-shared-subgraph': sharedSubgraph,
  'bench-control-chain': controlChain,
  'bench-audio-multi-fft': audioMultiFft,
  'bench-feedback': feedback,
  'bench-wide': wide,
  'bench-kitchen-sink': kitchenSink,
}

mkdirSync(OUT, { recursive: true })
for (const [name, make] of Object.entries(GRAPHS)) {
  const file = make().build()
  writeFileSync(resolve(OUT, `${name}.wledgraph`), `${JSON.stringify(file, null, 2)}\n`)
  console.log(`${name}: ${file.graph.nodes.length} nodes, ${file.graph.edges.length} edges`)
}
