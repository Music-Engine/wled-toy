import { Vec3 } from '@/lib/graph/authoring'

/** Every texture samples a 3D point; on a strip that is the uv plane at z = 0 unless something else is linked. */
export const textureVector = { type: Vec3, label: 'Vector', default: { expr: 'vec3(uv, 0.0)', label: 'uv' } } as const
