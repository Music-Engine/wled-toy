/** Size of the uniform block graph mode fills from the CPU each frame: this many vec4, four floats each. */
export const CONTROL_VECTORS = 64

/** Layers of per-pixel state a shader can write, as `outState1` on: WebGL2 guarantees 4 draw buffers and the color takes one. */
export const STATE_TARGETS = 3

/** Analyses a graph can run besides the default one; each has its own band and history texture. */
export const AUDIO_EXTRA_SLOTS = 3

// GLSL ES 3.00 indexes sampler arrays with constants only, so a slot picks its texture through a branch per slot
const perSlot = (call: (sampler: (name: string) => string, head: string) => string) => [
  ...Array.from({ length: AUDIO_EXTRA_SLOTS }, (_, i) => `  if (slot == ${i + 1}) return ${call((name) => `${name}Extra[${i}]`, `iAudioHistoryHeadExtra[${i}]`)};`),
  `  return ${call((name) => name, 'iAudioHeads.x')};`,
].join('\n')

/** Layers of `iImages`: how many different images one graph can show, and the size each is resampled to. */
export const IMAGE_LAYERS = 8
export const IMAGE_LAYER_SIZE = 512

export const PRELUDE = `#version 300 es
precision highp float;

uniform vec3  iResolution;
uniform float iTime;
uniform int   iFrame;
uniform float iLedCount;
uniform float iScanY;
uniform sampler2D iAudio;
uniform sampler2D iImage;
// the images a graph's Image Texture nodes use, one layer each, all resampled to one size
uniform highp sampler2DArray iImages;
// row 0: band levels (log or mel spaced), row 1: the 12 pitch classes from C
uniform sampler2D iAudioBands;
// one row of bands per analysis hop, a ring; iAudioHeads.x is the newest row
uniform sampler2D iAudioHistory;
// the same two textures for the extra FFT nodes of a graph (slots 1 and up), and the newest history row of each
uniform sampler2D iAudioBandsExtra[${AUDIO_EXTRA_SLOTS}];
uniform sampler2D iAudioHistoryExtra[${AUDIO_EXTRA_SLOTS}];
uniform float iAudioHistoryHeadExtra[${AUDIO_EXTRA_SLOTS}];
// recent samples, a ring in row-major order; iAudioHeads.y is the next sample to be written, .z the sample rate
uniform sampler2D iAudioWave;
uniform vec3 iAudioHeads;
// x, y, z and segment index of every LED in wire order; iLayoutCount is 0 when the LEDs are a plain strip
uniform sampler2D iLayout;
uniform float iLayoutCount;
// what this pass drew last time: one texel per LED in the LED pass, the whole picture in the preview
uniform sampler2D iPrevFrame;
// seconds since this pass last drew
uniform float iTimeDelta;
// per-frame values computed on the CPU by graph mode; slot k is iControl[k / 4][k % 4]
uniform vec4 iControl[${CONTROL_VECTORS}];

layout(location = 0) out vec4 outColor;

bool isLedPass() { return iResolution.y < 1.5; }
// position (xyz) and segment (w) of an LED; in the 2D preview there are no LEDs, so this is the pixel itself
vec4 ledLayout(float ledIndex) {
  if (isLedPass() && iLayoutCount > 0.5) return texelFetch(iLayout, ivec2(int(ledIndex), 0), 0);
  return vec4(gl_FragCoord.xy / iResolution.xy, 0.0, 0.0);
}

// the color this pixel (or the LED ledOffset LEDs further along the wire) had on the previous frame
vec3 previousFrame(float ledOffset) {
  if (isLedPass()) return texelFetch(iPrevFrame, ivec2(clamp(int(gl_FragCoord.x) + int(ledOffset), 0, int(iResolution.x) - 1), 0), 0).rgb;
  return texture(iPrevFrame, gl_FragCoord.xy / iResolution.xy + vec2(ledOffset / iLedCount, 0.0)).rgb;
}

float fft(float f) { return texture(iAudio, vec2(f, 0.25)).r; }
float waveform(float x) { return texture(iAudio, vec2(x, 0.75)).r * 2.0 - 1.0; }
float bandLevel(float lo, float hi) {
  float s = 0.0;
  for (int i = 0; i < 8; i++) s += fft(mix(lo, hi, (float(i) + 0.5) / 8.0));
  return s / 8.0;
}
float historyRow(sampler2D history, float head, float x, float age) {
  float rows = float(textureSize(history, 0).y);
  return texture(history, vec2(x, (head + 0.5 - clamp(age, 0.0, 1.0) * (rows - 1.0)) / rows)).r;
}
// slot 0 is the default analysis; graph FFT nodes with other settings use slots 1 and up
float bandsAt(int slot, float x) {
${perSlot((sampler) => `texture(${sampler('iAudioBands')}, vec2(x, 0.25)).r`)}
}
float chromaAt(int slot, float pitchClass) {
${perSlot((sampler) => `texelFetch(${sampler('iAudioBands')}, ivec2(int(mod(pitchClass, 12.0)), 1), 0).r`)}
}
// age 0 is now, 1 the oldest row kept
float historyAt(int slot, float x, float age) {
${perSlot((sampler, head) => `historyRow(${sampler('iAudioHistory')}, ${head}, x, age)`)}
}
float bands(float x) { return bandsAt(0, x); }
float chroma(float pitchClass) { return chromaAt(0, pitchClass); }
float history(float x, float age) { return historyAt(0, x, age); }
// the waveform this many samples back, -1 to 1
float waveformAt(float samplesAgo) {
  ivec2 size = textureSize(iAudioWave, 0);
  int total = size.x * size.y;
  int index = (int(iAudioHeads.y) - 1 - int(clamp(samplesAgo, 0.0, float(total - 1))) + total) % total;
  return (texelFetch(iAudioWave, ivec2(index % size.x, index / size.x), 0).r * 255.0 - 128.0) / 127.0;
}
float bass()   { return bandLevel(0.00, 0.06); }
float mid()    { return bandLevel(0.06, 0.30); }
float treble() { return bandLevel(0.30, 0.80); }

vec4 image(vec2 uv) { return texture(iImage, vec2(uv.x, 1.0 - uv.y)); }
vec4 imageScroll(vec2 uv, vec2 speed) { return image(fract(uv + speed * iTime)); }
vec4 imagePixelate(vec2 uv, float cells) { return image((floor(uv * cells) + 0.5) / cells); }

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
vec3 palette(float t, vec3 a, vec3 b, vec3 c, vec3 d) { return a + b * cos(6.28318 * (c * t + d)); }
vec3 rainbow(float t) { return palette(t, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67)); }
mat2 rotate2d(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + 1.0), u.x), u.y);
}
vec3 gammaCorrect(vec3 c, float g) { return pow(max(c, 0.0), vec3(g)); }

float sawWave(float t) { return fract(t); }
float triangleWave(float t) { return 1.0 - abs(fract(t) * 2.0 - 1.0); }
float squareWave(float t, float duty) { return step(fract(t), duty); }
float sineWave(float t) { return 0.5 + 0.5 * sin(6.28318 * t); }
float easeInOut(float t) { t = clamp(t, 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
float bounce(float t) { return abs(sin(3.14159 * t)); }
float pulse(float x, float center, float width) { float d = (x - center) / max(width, 1e-4); return exp(-d * d); }

float remap(float v, float inLo, float inHi, float outLo, float outHi) { return outLo + (v - inLo) * (outHi - outLo) / (inHi - inLo); }
float saturate(float x) { return clamp(x, 0.0, 1.0); }
float band(float x, float lo, float hi, float soft) { return smoothstep(lo - soft, lo, x) * (1.0 - smoothstep(hi, hi + soft, x)); }
vec2 tile(vec2 uv, float n) { return fract(uv * n); }
vec2 polar(vec2 uv) { vec2 p = uv - 0.5; return vec2(atan(p.y, p.x) / 6.28318 + 0.5, length(p) * 2.0); }

float fromCenter(float x) { return abs(x - 0.5) * 2.0; }
float mirror(float x) { return 1.0 - abs(2.0 * x - 1.0); }
float stripes(float x, float count) { return step(0.5, fract(x * count)); }
float chase(float ledIndex, float spacing, float speed) { return step(mod(ledIndex + floor(iTime * speed), spacing), 0.5); }
float scanner(float x, float speed, float width) { return pulse(x, triangleWave(iTime * speed * 0.5), width); }
float sparkle(float ledIndex, float density, float speed) {
  float t = iTime * speed + hash(vec2(ledIndex, 7.0)) * 100.0;
  float on = step(1.0 - density, hash(vec2(ledIndex, floor(t))));
  return on * sin(fract(t) * 3.14159);
}

float luminance(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
vec3 hueShift(vec3 c, float shift) { vec3 h = rgb2hsv(c); h.x = fract(h.x + shift); return hsv2rgb(h); }
vec3 saturation(vec3 c, float amount) { return mix(vec3(luminance(c)), c, amount); }
vec3 brightnessContrast(vec3 c, float brightness, float contrast) { return (c - 0.5) * contrast + 0.5 + brightness; }
vec3 heatColor(float t) { t = clamp(t, 0.0, 1.0) * 3.0; return clamp(vec3(t, t - 1.0, t - 2.0), 0.0, 1.0); }
// Tanner Helland's blackbody fit, good enough for picking LED white points
vec3 kelvin(float k) {
  float t = clamp(k, 1000.0, 40000.0) / 100.0;
  float r = t <= 66.0 ? 1.0 : clamp(1.29293618606 * pow(t - 60.0, -0.1332047592), 0.0, 1.0);
  float g = t <= 66.0 ? clamp(0.39008157876 * log(t) - 0.63184144378, 0.0, 1.0) : clamp(1.12989086089 * pow(t - 60.0, -0.0755148492), 0.0, 1.0);
  float b = t >= 66.0 ? 1.0 : (t <= 19.0 ? 0.0 : clamp(0.54320678911 * log(t - 10.0) - 1.19625408914, 0.0, 1.0));
  return vec3(r, g, b);
}

float random(float seed) { return hash(vec2(seed, 0.0)); }
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; }
  return v;
}
float voronoi(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float d = 8.0;
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(x, y);
      vec2 o = vec2(hash(i + g), hash(i + g + 19.1));
      d = min(d, length(g + o - f));
    }
  return d;
}
float checkerboard(vec2 uv, float n) { vec2 c = floor(uv * n); return mod(c.x + c.y, 2.0); }

float energy() { return bandLevel(0.0, 0.8); }
float fftLog(float x) { return fft((pow(2.0, x * 9.0) - 1.0) / 511.0); }
float beat(float threshold) { return smoothstep(threshold, threshold + 0.15, bass()); }
// names from before the audio functions lost their prefix; shaders written then keep compiling
float audioFFT(float f) { return fft(f); }
float audioFFTLog(float x) { return fftLog(x); }
float audioWave(float x) { return waveform(x); }
float audioWaveAt(float samplesAgo) { return waveformAt(samplesAgo); }
float audioBand(float lo, float hi) { return bandLevel(lo, hi); }
float audioBands(float x) { return bands(x); }
float audioBandsAt(int slot, float x) { return bandsAt(slot, x); }
float audioBass() { return bass(); }
float audioMid() { return mid(); }
float audioTreble() { return treble(); }
float audioEnergy() { return energy(); }
float audioBeat(float threshold) { return beat(threshold); }
float audioHistory(float x, float age) { return history(x, age); }
float audioHistoryAt(int slot, float x, float age) { return historyAt(slot, x, age); }
float audioChroma(float pitchClass) { return chroma(pitchClass); }
float audioChromaAt(int slot, float pitchClass) { return chromaAt(slot, pitchClass); }

vec4 imageMirror(vec2 uv) { return image(vec2(1.0 - abs(uv.x * 2.0 - 1.0), uv.y)); }
vec4 imageZoom(vec2 uv, float zoom, vec2 center) { return image((uv - center) / zoom + center); }
float imageLuma(vec2 uv) { return luminance(image(uv).rgb); }

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
