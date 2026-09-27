import { Color, defineNode, Enum, toEnumIndex, Float } from '@/lib/graph/authoring'
import { textureVector } from '@/lib/graph/nodes/shared/sockets'
import { waveTextureChunk } from './chunks/wave-texture-chunk'

const TYPES = [{ value: 'bands', label: 'Bands' }, { value: 'rings', label: 'Rings' }] as const
const BANDS_DIRECTIONS = [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z' }, { value: 'diagonal', label: 'Diagonal' }] as const
const RINGS_DIRECTIONS = [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z' }, { value: 'spherical', label: 'Spherical' }] as const
const PROFILES = [{ value: 'sine', label: 'Sine' }, { value: 'saw', label: 'Saw' }, { value: 'triangle', label: 'Triangle' }] as const

const amount = { min: 0, step: 0.1, decimals: 2 }

export const waveTextureNode = defineNode('waveTexture', {
  title: 'Wave Texture',
  description: 'Bands or rings with a sine, saw or triangle profile, optionally distorted by noise. Link Time into Phase to make it travel.',
  category: 'noise',
  includes: [waveTextureChunk],
  input: {
    type: { type: Enum(TYPES), label: '', linkable: false, props: { label: 'Type' } },
    // Shader reads one direction per type, so each keeps its own choice
    bandsDirection: { type: Enum(BANDS_DIRECTIONS), label: 'Bands Direction', linkable: false },
    ringsDirection: { type: Enum(RINGS_DIRECTIONS), label: 'Rings Direction', linkable: false },
    profile: { type: Enum(PROFILES), label: '', linkable: false, props: { label: 'Profile' } },
    vector: textureVector,
    scale: { type: Float, default: 5, props: amount },
    distortion: { type: Float, default: 0, props: amount },
    detail: { type: Float, default: 0, props: { ...amount, max: 15 } },
    detailScale: { type: Float, default: 1, props: amount },
    detailRoughness: { type: Float, default: 0, props: { ...amount, max: 1 } },
    phase: { type: Float, default: 0, props: { step: 1, decimals: 2 } },
  },
  output: { fac: Float, color: Color },
  body: (input, ctx) => ctx.call('wave_texture', [
    toEnumIndex(TYPES, input.type), toEnumIndex(BANDS_DIRECTIONS, input.bandsDirection), toEnumIndex(RINGS_DIRECTIONS, input.ringsDirection), toEnumIndex(PROFILES, input.profile),
    input.scale.expr, input.distortion.expr, input.detail.expr, input.detailScale.expr, input.detailRoughness.expr, input.phase.expr, input.vector.expr,
  ], { fac: 'float', color: 'vec3' }),
})
