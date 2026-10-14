import { AUDIO_LIBRARY } from './audio-reads'
import { LIBRARY, PASS_READS } from './library'
import { PRELUDE_UNIFORMS } from './uniforms'

export { AUDIO_READS } from './audio-reads'
export { AUDIO_EXTRA_SLOTS, CONTROL_VECTORS, IMAGE_LAYERS, IMAGE_LAYER_SIZE, PRELUDE_UNIFORMS, STATE_TARGETS } from './uniforms'

export const PRELUDE = `#version 300 es
precision highp float;

${PRELUDE_UNIFORMS}

layout(location = 0) out vec4 outColor;

${PASS_READS}

${AUDIO_LIBRARY}

${LIBRARY}

void mainImage(out vec4 fragColor, in vec2 uv, in float ledIndex);

void main() {
  vec2 uv = gl_FragCoord.xy / iResolution.xy;
  float ledIndex = floor(uv.x * iLedCount);
  // the LED target is one pixel per LED: each is shaded where that LED physically sits,
  // or along the configured scanline when no layout is set
  if (isLedPass()) uv = iLayoutCount > 0.5 ? ledLayout(ledIndex).xy : vec2(uv.x, iScanY);
  vec4 c = vec4(0.0, 0.0, 0.0, 1.0);
  mainImage(c, uv, ledIndex);
  outColor = vec4(clamp(c.rgb, 0.0, 1.0), 1.0);
}
#line 1
`
