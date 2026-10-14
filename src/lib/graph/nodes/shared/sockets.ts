import { Float, Vec3 } from '@/lib/graph/authoring'

/** A duration input in seconds, for smoothing and timing nodes. */
export const seconds = (fallback: number) => ({ type: Float, default: fallback, props: { min: 0, step: 0.01, decimals: 3 } })

/** Every texture samples a 3D point, as does whatever moves or splits one; on a strip that is the uv plane at z = 0 unless something else is linked. */
export const textureVector = { type: Vec3, label: 'Vector', default: { expr: 'vec3(uv, 0.0)', label: 'uv' } } as const
