import type { GlslChunk } from '@/lib/graph/define/context'
import { commonChunk } from './common'

/** Value noise in one, two and three dimensions. After https://gist.github.com/patriciogonzalezvivo/670c22f3966e662d2f83 */
export const noiseChunk: GlslChunk = {
  id: 'noise',
  requires: [commonChunk],
  source: /* glsl */ `
// Lattice cells wrap every 256 so the hash argument stays small: sin() of a large float is 0 on some GPUs,
// which painted every negative coordinate one flat value. Wrapping the corners too keeps the seams continuous.
float lattice_hash(float c) { return node_hash(mod(c, 256.0)); }
float lattice_hash(vec2 c) { return node_hash(mod(c, 256.0)); }
float lattice_hash(vec3 c) { return node_hash(dot(mod(c, 256.0), vec3(110, 241, 171))); }

float noise1(float x) {
	float i = floor(x);
	float f = fract(x);
	float u = f * f * (3.0 - 2.0 * f);
	return mix(lattice_hash(i), lattice_hash(i + 1.0), u);
}

float noise2(vec2 x) {
	vec2 i = floor(x);
	vec2 f = fract(x);

	// Four corners in 2D of a tile
	float a = lattice_hash(i);
	float b = lattice_hash(i + vec2(1.0, 0.0));
	float c = lattice_hash(i + vec2(0.0, 1.0));
	float d = lattice_hash(i + vec2(1.0, 1.0));

	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

float noise3(vec3 x) {
	vec3 i = floor(x);
	vec3 f = fract(x);

	vec3 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(mix( lattice_hash(i + vec3(0, 0, 0)), lattice_hash(i + vec3(1, 0, 0)), u.x),
                   mix( lattice_hash(i + vec3(0, 1, 0)), lattice_hash(i + vec3(1, 1, 0)), u.x), u.y),
               mix(mix( lattice_hash(i + vec3(0, 0, 1)), lattice_hash(i + vec3(1, 0, 1)), u.x),
                   mix( lattice_hash(i + vec3(0, 1, 1)), lattice_hash(i + vec3(1, 1, 1)), u.x), u.y), u.z);
}

// GLSL equivalent of noise_fbm
float noise_fbm(vec3 co, float detail, float roughness, float lacunarity, bool use_normalize) {
    vec3 p = co;
    float fscale = 1.0;
    float amp = 1.0;
    float maxamp = 0.0;
    float sum = 0.0;

    // a runtime float as the bound can spin forever on a bad link; 15 octaves is past visible detail
    int octaves = int(clamp(detail, 0.0, 15.0));
    for (int i = 0; i <= octaves; i++) {
        float t = noise3(fscale * p);
        sum += t * amp;
        maxamp += amp;
        amp *= roughness;
        fscale *= lacunarity;
    }

    float rmd = detail - floor(detail);
    if (rmd != 0.0) {
        float t = noise3(fscale * p);
        float sum2 = sum + t * amp;
        return use_normalize ?
               mix(sum / maxamp, sum2 / (maxamp + amp), rmd) :
               mix(sum, sum2, rmd);
    }
    else {
        return use_normalize ? sum / maxamp : sum;
    }
}
`,
}
