import { Color, defineNode, Enum, enumIndex, Float, type GlslChunk } from '@/lib/graph/authoring'
import { noiseChunk } from '@/lib/graph/nodes/glsl/noise'
import { textureVector } from './vector'

/** Blender wave texture (node_wave_texture.osl, node_noise.h) in GLSL. */
const waveTextureChunk: GlslChunk = {
  id: 'wave-texture',
  requires: [noiseChunk],
  source: /* glsl */ `
// GLSL wave function
float wave(vec3 p_input,
           int type, // 0: bands, 1: rings
           int bands_direction, // 0: x, 1: y, 2: z, 3: diagonal
           int rings_direction, // 0: x, 1: y, 2: z, 3: spherical
           int profile, // 0: sine, 1: saw, 2: tri
           float distortion,
           float detail,
           float dscale,
           float droughness,
           float phase)
{
    vec3 p = (p_input + 0.000001) * 0.999999;
    float n = 0.0;

    if (type == 0) { // bands
        if (bands_direction == 0) n = p.x * 20.0;
        else if (bands_direction == 1) n = p.y * 20.0;
        else if (bands_direction == 2) n = p.z * 20.0;
        else n = (p.x + p.y + p.z) * 10.0;
    }
    else if (type == 1) { // rings
        vec3 rp = p;
        if (rings_direction == 0) rp.x = 0.0;
        else if (rings_direction == 1) rp.y = 0.0;
        else if (rings_direction == 2) rp.z = 0.0;
        n = length(rp) * 20.0;
    }

    n += phase;

    if (distortion != 0.0) {
        n += distortion * (noise_fbm(p * dscale, detail, droughness, 2.0, true) * 2.0 - 1.0);
    }

    if (profile == 0) { // sine
        return 0.5 + 0.5 * sin(n - 1.57079632679);
    } else if (profile == 1) { // saw
        n /= 6.28318530718;
        return fract(n);
    } else { // tri
        n /= 6.28318530718;
        return abs(fract(n + 0.5) - 0.5) * 2.0;
    }
}

void wave_texture(int type,
                    int bands_direction,
                    int rings_direction,
                    int profile,
                    float scale,
                    float distortion,
                    float detail,
                    float detail_scale,
                    float detail_roughness,
                    float phase_offset,
                    vec3 vector,
                    out float fac,
                    out vec3 color)
{
    vec3 p = vector * scale;
    float n = wave(p, type, bands_direction, rings_direction, profile, distortion, detail, detail_scale, detail_roughness, phase_offset);
    fac = n;
    color = vec3(n);
}
`,
}

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
    type: { type: Enum(TYPES), label: '', connectable: false, props: { label: 'Type' } },
    // the shader reads one direction per type, so each type keeps its own choice
    bandsDirection: { type: Enum(BANDS_DIRECTIONS), label: 'Bands Direction', connectable: false },
    ringsDirection: { type: Enum(RINGS_DIRECTIONS), label: 'Rings Direction', connectable: false },
    profile: { type: Enum(PROFILES), label: '', connectable: false, props: { label: 'Profile' } },
    vector: textureVector,
    scale: { type: Float, default: 5, props: amount },
    distortion: { type: Float, default: 0, props: amount },
    detail: { type: Float, default: 0, props: { ...amount, max: 15 } },
    detailScale: { type: Float, default: 1, props: amount },
    detailRoughness: { type: Float, default: 0, props: { ...amount, max: 1 } },
    phase: { type: Float, default: 0, props: { step: 1, decimals: 2 } },
  },
  output: { fac: Float, color: Color },
  exec: (input, ctx) => ctx.call('wave_texture', [
    enumIndex(TYPES, input.type), enumIndex(BANDS_DIRECTIONS, input.bandsDirection), enumIndex(RINGS_DIRECTIONS, input.ringsDirection), enumIndex(PROFILES, input.profile),
    input.scale.expr, input.distortion.expr, input.detail.expr, input.detailScale.expr, input.detailRoughness.expr, input.phase.expr, input.vector.expr,
  ], { fac: 'float', color: 'vec3' }),
})
