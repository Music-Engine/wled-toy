/** Size of the uniform block graph mode fills from the CPU each frame: this many vec4, four floats each. */
export const CONTROL_VECTORS = 64

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

export const EXAMPLE = `// Strip samples the row at iScanY. Cmd+Enter compiles, Cmd+Shift+A adds a function.
void mainImage(out vec4 c, vec2 uv, float ledIndex) {
  float low = bass();
  float x = uv.x;

  // audio-reactive rainbow that travels along the strip
  vec3 col = rainbow(x * 1.5 - iTime * 0.25);
  float level = fft(x * 0.5);
  col *= 0.25 + 1.25 * level;

  // blend in the image, scrolling
  vec3 img = imageScroll(uv, vec2(0.05, 0.0)).rgb;
  col = mix(col, img, 0.35 + 0.3 * sin(iTime * 0.5));

  // bright waveform line in the 2D preview
  float w = waveform(x) * 0.25 + 0.5;
  col += vec3(1.0) * smoothstep(0.01, 0.0, abs(uv.y - w)) * 0.8;

  // moving comet whose size follows the bass
  float head = fract(iTime * 0.2);
  col += vec3(1.0, 0.6, 0.2) * exp(-abs(x - head) * (60.0 - 50.0 * low));

  c = vec4(col, 1.0);
}
`

export type GlslType = 'float' | 'int' | 'vec2' | 'vec3' | 'vec4' | 'mat2' | 'sampler2D' | 'genType' | 'void'

export type CategoryId = 'input' | 'output' | 'converter' | 'signal' | 'strip' | 'animation' | 'audio' | 'image' | 'color' | 'math' | 'noise' | 'builtin' | 'recipe'

export interface Category {
  id: CategoryId
  label: string
  icon: string
  color: string
}

// header colors follow the node editor theme of project-three: brown textures, purple vectors, blue converters,
// maroon inputs. Its color header is #c7c729, darkened here because white titles are unreadable on it.
export const CATEGORIES: Category[] = [
  { id: 'input', label: 'Input', icon: 'i-lucide-log-in', color: '#83314a' },
  { id: 'output', label: 'Output', icon: 'i-lucide-log-out', color: '#5c5c5c' },
  { id: 'signal', label: 'Signal', icon: 'i-lucide-activity', color: '#b0621a' },
  { id: 'strip', label: 'Strip', icon: 'i-lucide-git-commit-horizontal', color: '#8f3a6f' },
  { id: 'animation', label: 'Animation', icon: 'i-lucide-clapperboard', color: '#2a6f8f' },
  { id: 'audio', label: 'Audio', icon: 'i-lucide-audio-waveform', color: '#1d725e' },
  { id: 'image', label: 'Image', icon: 'i-lucide-image', color: '#79461d' },
  { id: 'color', label: 'Color', icon: 'i-lucide-palette', color: '#8f8f1e' },
  { id: 'math', label: 'Transform', icon: 'i-lucide-move-3d', color: '#6363c7' },
  { id: 'noise', label: 'Texture', icon: 'i-lucide-sparkles', color: '#79461d' },
  { id: 'converter', label: 'Converter', icon: 'i-lucide-arrow-left-right', color: '#4772b3' },
  { id: 'builtin', label: 'GLSL Math', icon: 'i-lucide-sigma', color: '#3d5a80' },
  { id: 'recipe', label: 'Recipes', icon: 'i-lucide-layers', color: '#2f7a3a' },
]

export interface Param {
  name: string
  label: string
  type: GlslType
  /** A vec3 that holds a color, so editors offer a picker instead of three numbers. */
  isColor: boolean
  /** A literal, or a GLSL expression the parameter uses when nothing else is given. */
  default?: number | number[] | string
  min?: number
  max?: number
}

export interface ShaderNode {
  name: string
  title: string
  category: CategoryId
  kind: 'function' | 'uniform' | 'recipe' | 'graph'
  returns: GlslType
  /** What the returned value is, e.g. "Color" or "Level". */
  output: Omit<Param, 'default' | 'min' | 'max'>
  params: Param[]
  doc: string
  signature: string
  snippet: string
}

/** `inLow` reads "In Low", `ledIndex` reads "LED Index". */
export function titleCase(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
  return words.replace(/\b(Led|Uv|Hsv|Hsl|Rgb|Fft|Bpm|Rms|Midi|Osc)\b/g, (w) => w.toUpperCase())
}

function parseDefault(text: string): Param['default'] {
  if (/^-?[\d.]+$/.test(text)) return Number(text)
  const vector = text.match(/^vec([234])\(([-\d., ]+)\)$/)
  if (!vector) return text
  const components = vector[2].split(',').map(Number)
  return components.length === 1 ? Array(Number(vector[1])).fill(components[0]) : components
}

/**
 * One declaration: `type name`, optionally `= default` and `[min, max]`, e.g. `float duty = 0.5 [0, 1]`.
 * The pseudo type `color` is a vec3 edited as a color.
 */
function parseParam(spec: string): Param {
  const match = spec.trim().match(/^(\w+)\s+(\w+)(?:\s*=\s*(.+?))?(?:\s*\[(.+),(.+)\])?$/)
  if (!match) throw new Error(`Cannot parse parameter "${spec}"`)
  const [, type, name, fallback, min, max] = match
  return {
    name,
    label: titleCase(name),
    type: type === 'color' ? 'vec3' : (type as GlslType),
    isColor: type === 'color',
    ...(fallback !== undefined && { default: parseDefault(fallback) }),
    ...(min !== undefined && { min: Number(min), max: Number(max) }),
  }
}

// commas inside vec3(...) defaults do not separate parameters
const parseParams = (spec: string): Param[] => (spec ? spec.split(/,(?![^()]*\))(?![^[]*\])/).map(parseParam) : [])

function fn(name: string, title: string, category: CategoryId, returns: string, params: string, doc: string): ShaderNode {
  const output = parseParam(returns)
  const ps = parseParams(params)
  return {
    name,
    title,
    category,
    kind: 'function',
    returns: output.type,
    output,
    params: ps,
    doc,
    signature: `${output.type} ${name}(${ps.map((p) => `${p.type} ${p.name}`).join(', ')})`,
    snippet: `${name}(${ps.map((p) => `\${${p.name}}`).join(', ')})`,
  }
}

function uniform(name: string, title: string, type: GlslType, doc: string): ShaderNode {
  return { name, title, category: 'input', kind: 'uniform', returns: type, output: { name, label: title, type, isColor: false }, params: [], doc, signature: `uniform ${type} ${name}`, snippet: name }
}

// placeholders must not be bare integers: CodeMirror reads ${2} as a field index, not text
function recipe(name: string, title: string, returns: GlslType, doc: string, snippet: string): ShaderNode {
  return { name, title, category: 'recipe', kind: 'recipe', returns, output: { name, label: title, type: returns, isColor: false }, params: [], doc, signature: snippet.replace(/\$\{([^}]*)\}/g, '$1'), snippet }
}

export const NODES: ShaderNode[] = [
  uniform('iTime', 'Time', 'float', 'Seconds since start (reset with Reset time).'),
  uniform('iResolution', 'Resolution', 'vec3', 'Render target size in pixels. y is 1 when rendering the LED strip.'),
  uniform('iFrame', 'Frame', 'int', 'Frame counter.'),
  uniform('iLedCount', 'LED Count', 'float', 'Number of LEDs on the strip (from Settings).'),
  uniform('iScanY', 'Scan Row', 'float', 'Row of the 2D preview that the strip samples, 0 to 1.'),
  uniform('iAudio', 'Audio Texture', 'sampler2D', 'Audio texture: row y=0.25 is the FFT, y=0.75 the waveform.'),
  uniform('iImage', 'Image Texture', 'sampler2D', 'Image texture.'),

  fn('fft', 'Audio Spectrum', 'audio', 'float level', 'float frequency = uv.x', 'FFT magnitude 0 to 1 at normalized frequency f.'),
  fn('waveform', 'Audio Waveform', 'audio', 'float sample', 'float position = uv.x', 'Waveform sample -1 to 1 at normalized position x.'),
  fn('bandLevel', 'Audio Band', 'audio', 'float level', 'float low = 0 [0, 1], float high = 1 [0, 1]', 'Average FFT magnitude between two normalized frequencies.'),
  fn('bass', 'Bass Level', 'audio', 'float level', '', 'Average low-frequency energy, 0 to 1. Store it under another name (float low = bass();): a variable called bass hides the function for the rest of its scope.'),
  fn('mid', 'Mid Level', 'audio', 'float level', '', 'Average mid-frequency energy, 0 to 1.'),
  fn('treble', 'Treble Level', 'audio', 'float level', '', 'Average high-frequency energy, 0 to 1.'),

  fn('image', 'Image Texture', 'image', 'vec4 color', 'vec2 uv = uv', 'Sample the image at uv (origin bottom-left).'),
  fn('imageScroll', 'Scrolling Image', 'image', 'vec4 color', 'vec2 uv = uv, vec2 speed = vec2(0.1, 0.0)', 'Sample the image scrolling over time, wrapping at the edges.'),
  fn('imagePixelate', 'Pixelated Image', 'image', 'vec4 color', 'vec2 uv = uv, float cells = 16', 'Sample the image quantized to a grid of cells.'),

  fn('hsv2rgb', 'HSV to RGB', 'color', 'color color', 'vec3 hsv = vec3(uv.x, 1.0, 1.0)', 'Convert hue, saturation, value (all 0 to 1) to RGB.'),
  fn('rainbow', 'Rainbow', 'color', 'color color', 'float position = uv.x', 'Smooth cyclic rainbow color for t.'),
  fn('palette', 'Cosine Palette', 'color', 'color color', 'float position = uv.x, vec3 bias = vec3(0.5), vec3 amplitude = vec3(0.5), vec3 frequency = vec3(1.0), vec3 phase = vec3(0.0, 0.33, 0.67)', 'Inigo Quilez cosine palette: a + b * cos(2pi * (c * t + d)).'),
  fn('gammaCorrect', 'Gamma', 'color', 'color color', 'color color, float gamma = 2.2', 'Apply a power curve per channel. LEDs usually look better with gamma above 1.'),

  fn('rotate2d', 'Rotate 2D', 'math', 'mat2 matrix', 'float angle = 0', '2D rotation matrix. Multiply with a vec2: rotate2d(a) * p.'),

  fn('hash', 'White Noise', 'noise', 'float value', 'vec2 point = uv * 8.0', 'Pseudo-random value 0 to 1 per input point.'),
  fn('noise', 'Value Noise', 'noise', 'float value', 'vec2 point = uv * 8.0', 'Smooth value noise 0 to 1.'),

  fn('sin', 'Sine', 'builtin', 'genType result', 'genType value = uv.x', 'Sine of x in radians.'),
  fn('cos', 'Cosine', 'builtin', 'genType result', 'genType value = uv.x', 'Cosine of x in radians.'),
  fn('abs', 'Absolute', 'builtin', 'genType result', 'genType value = uv.x', 'Absolute value.'),
  fn('floor', 'Floor', 'builtin', 'genType result', 'genType value = uv.x', 'Largest integer not greater than x.'),
  fn('fract', 'Fraction', 'builtin', 'genType result', 'genType value = uv.x', 'x minus floor(x).'),
  fn('mod', 'Modulo', 'builtin', 'genType result', 'genType value = uv.x, genType divisor = 1', 'x modulo y.'),
  fn('min', 'Minimum', 'builtin', 'genType result', 'genType a = 0.5, genType b = 1', 'Smaller of a and b.'),
  fn('max', 'Maximum', 'builtin', 'genType result', 'genType a = 0.5, genType b = 0', 'Larger of a and b.'),
  fn('clamp', 'Clamp', 'builtin', 'genType result', 'genType value = uv.x, genType low = 0, genType high = 1', 'Constrain x between lo and hi.'),
  fn('mix', 'Mix', 'builtin', 'genType result', 'genType a = 0, genType b = 1, genType factor = uv.x', 'Linear blend from a to b by t.'),
  fn('step', 'Step', 'builtin', 'genType result', 'genType edge = 0.5, genType value = uv.x', '0 when x < edge, otherwise 1.'),
  fn('smoothstep', 'Smooth Step', 'builtin', 'genType result', 'genType low = 0, genType high = 1, genType value = uv.x', 'Hermite interpolation between two edges.'),
  fn('length', 'Length', 'builtin', 'float length', 'genType vector = uv.x', 'Euclidean length of a vector.'),
  fn('distance', 'Distance', 'builtin', 'float distance', 'genType a = 0.5, genType b = 0.5', 'Distance between two points.'),
  fn('dot', 'Dot Product', 'builtin', 'float product', 'genType a = 0.5, genType b = 0.5', 'Dot product of two vectors.'),
  fn('normalize', 'Normalize', 'builtin', 'genType direction', 'genType vector = uv.x', 'Vector with the same direction and length 1.'),
  fn('pow', 'Power', 'builtin', 'genType result', 'genType base = uv.x, genType exponent = 2', 'x raised to y.'),
  fn('exp', 'Exponent', 'builtin', 'genType result', 'genType value = uv.x', 'e raised to x.'),
  fn('sqrt', 'Square Root', 'builtin', 'genType result', 'genType value = uv.x', 'Square root of x.'),
  fn('atan', 'Arc Tangent', 'builtin', 'genType angle', 'genType y = 1, genType x = uv.x', 'Angle of (x, y) in radians.'),
  fn('texture', 'Texture Sample', 'builtin', 'vec4 color', 'sampler2D texture, vec2 uv = uv', 'Sample a texture at uv.'),

  fn('fromCenter', 'Distance From Center', 'strip', 'float distance', 'float position = uv.x', '0 at the middle of the strip, 1 at both ends. Pass uv.x.'),
  fn('mirror', 'Mirror', 'strip', 'float position', 'float position = uv.x', '0 at both ends, 1 in the middle, so effects play symmetrically.'),
  fn('stripes', 'Stripes', 'strip', 'float mask', 'float position = uv.x, float count = 4', 'Hard on/off stripes along x.'),
  fn('chase', 'Theater Chase', 'strip', 'float mask', 'float ledIndex = ledIndex, float spacing = 3, float speed = 1', '1 on every spacing-th LED, stepping along at speed LEDs per second.'),
  fn('scanner', 'Scanner', 'strip', 'float glow', 'float position = uv.x, float speed = 1, float width = 0.05', 'Glow that bounces back and forth, like a Larson scanner.'),
  fn('sparkle', 'Sparkle', 'strip', 'float glow', 'float ledIndex = ledIndex, float density = 0.1 [0, 1], float speed = 1', 'Random twinkles per LED. density 0 to 1 is the share of LEDs lit.'),

  fn('sawWave', 'Saw Wave', 'animation', 'float value', 'float time = iTime', 'Ramps 0 to 1 then jumps back. Try sawWave(iTime * 0.5).'),
  fn('triangleWave', 'Triangle Wave', 'animation', 'float value', 'float time = iTime', 'Ramps 0 to 1 and back to 0 each cycle.'),
  fn('squareWave', 'Square Wave', 'animation', 'float value', 'float time = iTime, float duty = 0.5 [0, 1]', 'Blinks between 1 and 0; duty is the share of the cycle that is on.'),
  fn('sineWave', 'Sine Wave', 'animation', 'float value', 'float time = iTime', 'Smooth 0 to 1 oscillation, one cycle per unit of t.'),
  fn('easeInOut', 'Ease In Out', 'animation', 'float value', 'float value = uv.x', 'Smooth start and stop for a 0 to 1 value.'),
  fn('bounce', 'Bounce', 'animation', 'float value', 'float time = iTime', 'Bouncing ball curve, 0 to 1.'),
  fn('pulse', 'Gaussian Pulse', 'animation', 'float glow', 'float position = uv.x, float center = 0.5, float width = 0.05', 'Soft bump that peaks at 1 where x equals center.'),

  fn('remap', 'Map Range', 'math', 'float value', 'float value = uv.x, float inLow = 0, float inHigh = 1, float outLow = 0, float outHigh = 1', 'Linearly map a value from one range to another.'),
  fn('saturate', 'Saturate', 'math', 'float value', 'float value = uv.x', 'Clamp to 0 to 1.'),
  fn('band', 'Band', 'math', 'float mask', 'float value = uv.x, float low = 0, float high = 1, float softness = 0.05', '1 between lo and hi with soft edges, else 0.'),
  fn('tile', 'Tile UV', 'math', 'vec2 uv', 'vec2 uv = uv, float count = 4', 'Repeat the UV space n times.'),
  fn('polar', 'Polar UV', 'math', 'vec2 polar', 'vec2 uv = uv', 'Convert to (angle 0 to 1, radius) around the center.'),

  fn('luminance', 'Luminance', 'color', 'float luminance', 'color color', 'Perceived brightness of a color.'),
  fn('rgb2hsv', 'RGB to HSV', 'color', 'vec3 hsv', 'color color', 'Convert RGB to hue, saturation, value.'),
  fn('hueShift', 'Hue Shift', 'color', 'color color', 'color color, float shift = 0.25', 'Rotate the hue; shift of 1 is a full turn.'),
  fn('saturation', 'Saturation', 'color', 'color color', 'color color, float amount = 1.5', '0 is grayscale, 1 unchanged, above 1 more vivid.'),
  fn('brightnessContrast', 'Brightness Contrast', 'color', 'color color', 'color color, float brightness = 0, float contrast = 1', 'Add brightness and scale contrast around mid gray.'),
  fn('heatColor', 'Heat Color', 'color', 'color color', 'float heat = uv.x', 'Black to red to yellow to white, like fire.'),
  fn('kelvin', 'Color Temperature', 'color', 'color color', 'float kelvin = 2700 [1000, 40000]', 'White point for a temperature, e.g. 2700 warm, 6500 daylight.'),

  fn('random', 'Random', 'noise', 'float value', 'float seed = ledIndex', 'Pseudo-random 0 to 1 from a number, e.g. random(ledIndex).'),
  fn('fbm', 'Fractal Noise', 'noise', 'float value', 'vec2 point = uv * 8.0', 'Layered value noise with more detail, 0 to about 1.'),
  fn('voronoi', 'Voronoi', 'noise', 'float distance', 'vec2 point = uv * 8.0', 'Distance to the nearest random cell point.'),
  fn('checkerboard', 'Checkerboard', 'noise', 'float mask', 'vec2 uv = uv, float count = 4', 'Alternating 0 and 1 squares, n per side.'),

  fn('energy', 'Overall Loudness', 'audio', 'float level', '', 'Average energy across the spectrum, 0 to 1.'),
  fn('fftLog', 'Log Spectrum', 'audio', 'float level', 'float position = uv.x', 'Spectrum with a musical (log) frequency scale, so bass is not squashed.'),
  fn('beat', 'Beat Detect', 'audio', 'float hit', 'float threshold = 0.5 [0, 1]', 'Rises to 1 when bass exceeds threshold (try 0.5).'),

  fn('imageMirror', 'Mirrored Image', 'image', 'vec4 color', 'vec2 uv = uv', 'Sample the image mirrored around the middle.'),
  fn('imageZoom', 'Zoomed Image', 'image', 'vec4 color', 'vec2 uv = uv, float zoom = 1.5, vec2 center = vec2(0.5)', 'Sample the image zoomed around center.'),
  fn('imageLuma', 'Image Brightness', 'image', 'float luminance', 'vec2 uv = uv', 'Grayscale brightness of the image at uv.'),

  recipe('beatFlash', 'Beat Flash', 'float', 'Float that snaps to 1 on strong bass hits.', 'float flash = smoothstep(${0.45}, ${0.6}, bass());'),
  recipe('spectrumBars', 'Spectrum Bars', 'vec3', 'Rainbow spectrum analyzer in the 2D preview.', 'vec3 bars = rainbow(uv.x) * step(uv.y, fft(uv.x * ${0.5}));'),
  recipe('comet', 'Comet', 'vec3', 'Glowing dot that travels along the strip.', 'float head = fract(iTime * ${0.25});\nvec3 comet = ${vec3(1.0, 0.6, 0.2)} * exp(-abs(uv.x - head) * ${40.0});'),
  recipe('scrollImage', 'Scrolling Image', 'vec3', 'Image scrolling horizontally along the strip.', 'vec3 img = imageScroll(uv, vec2(${0.1}, 0.0)).rgb;'),
  recipe('kaleido', 'Kaleidoscope UV', 'vec2', 'Rotating mirrored UV coordinates.', 'vec2 k = abs(fract(rotate2d(iTime * ${0.2}) * (uv - 0.5) * ${3.0}) - 0.5);'),
  recipe('fire', 'Fire', 'vec3', 'Flickering fire colors from noise.', 'vec3 fire = palette(noise(vec2(uv.x * ${8.0}, iTime * ${2.0})), vec3(0.5), vec3(0.5), vec3(1.0, 0.7, 0.4), vec3(0.0, 0.15, 0.2));'),
  recipe('checker', 'LED Checker', 'vec3', 'Alternate every other LED, handy for testing wiring.', 'vec3 checker = vec3(mod(ledIndex, ${2.0}));'),
  recipe('vuMeter', 'VU Meter', 'vec3', 'Green to red bar that grows with loudness.', 'vec3 vu = mix(vec3(0.0, 1.0, 0.2), vec3(1.0, 0.1, 0.0), uv.x) * step(uv.x, energy() * ${2.5});'),
  recipe('spectrumStrip', 'Spectrum Along Strip', 'vec3', 'Log spectrum from bass (start) to treble (end) in fire colors.', 'vec3 spectrum = heatColor(fftLog(uv.x) * ${1.2});'),
  recipe('bassBurst', 'Bass Burst', 'vec3', 'Fire that bursts outward from the center on bass.', 'vec3 burst = heatColor(1.0 - fromCenter(uv.x) / max(bass() * ${1.5}, 0.01));'),
  recipe('beatStrobe', 'Beat Strobe', 'vec3', 'Fast white strobe only while the beat hits.', 'vec3 strobe = vec3(1.0) * beat(${0.5}) * squareWave(iTime * ${12.0}, 0.5);'),
  recipe('rainbowChase', 'Rainbow Chase', 'vec3', 'Theater chase with moving rainbow colors.', 'vec3 chaseCol = rainbow(ledIndex / iLedCount + iTime * ${0.2}) * chase(ledIndex, ${3.0}, ${10.0});'),
  recipe('twinkle', 'Twinkle Stars', 'vec3', 'Warm random twinkles.', 'vec3 stars = vec3(1.0, 0.9, 0.7) * sparkle(ledIndex, ${0.08}, ${1.5});'),
  recipe('breathing', 'Breathing', 'vec3', 'Whole strip slowly fades in and out.', 'vec3 breathe = ${vec3(0.2, 0.5, 1.0)} * easeInOut(triangleWave(iTime * ${0.25}));'),
  recipe('larson', 'Larson Scanner', 'vec3', 'Red eye sweeping back and forth.', 'vec3 larson = vec3(1.0, 0.0, 0.0) * scanner(uv.x, ${0.5}, ${0.04});'),
  recipe('police', 'Police Lights', 'vec3', 'Alternating red and blue halves.', 'float side = step(0.5, uv.x);\nvec3 police = mix(vec3(1.0, 0.0, 0.0), vec3(0.0, 0.2, 1.0), side) * squareWave(iTime * ${4.0} + side * 0.5, 0.5);'),
  recipe('colorWipe', 'Color Wipe', 'vec3', 'A color fills the strip from start to end, then repeats.', 'vec3 wipe = mix(${vec3(0.0)}, ${vec3(0.0, 1.0, 0.5)}, step(uv.x, sawWave(iTime * ${0.3})));'),
  recipe('meteor', 'Meteor Rain', 'vec3', 'Bright head with a sparkly fading tail.', 'float meteorHead = sawWave(iTime * ${0.4});\nfloat meteorTail = uv.x < meteorHead ? exp(-(meteorHead - uv.x) * ${12.0}) : 0.0;\nvec3 meteor = vec3(0.8, 0.9, 1.0) * meteorTail * (0.6 + 0.4 * hash(vec2(ledIndex, floor(iTime * 20.0))));'),
  recipe('gradient', 'Moving Gradient', 'vec3', 'Two colors blending back and forth along the strip.', 'vec3 gradient = mix(${vec3(1.0, 0.2, 0.5)}, ${vec3(0.1, 0.4, 1.0)}, sineWave(uv.x - iTime * ${0.1}));'),
  recipe('plasma', 'Plasma', 'vec3', 'Classic demoscene plasma.', 'float plasmaV = sin(uv.x * ${10.0} + iTime) + sin((uv.y + uv.x) * 8.0 - iTime * 1.3) + sin(length(uv - 0.5) * 12.0 - iTime);\nvec3 plasma = rainbow(plasmaV * ${0.15});'),
  recipe('ocean', 'Ocean', 'vec3', 'Slow rolling blue-green waves.', 'vec3 ocean = palette(fbm(vec2(uv.x * ${3.0} - iTime * 0.3, iTime * 0.2)), vec3(0.0, 0.3, 0.5), vec3(0.0, 0.3, 0.4), vec3(1.0), vec3(0.0, 0.1, 0.2));'),
  recipe('lava', 'Lava', 'vec3', 'Glowing molten noise.', 'vec3 lava = heatColor(fbm(vec2(uv.x * ${4.0}, iTime * ${0.3})) * 1.4);'),
  recipe('aurora', 'Aurora', 'vec3', 'Green and teal curtains drifting slowly.', 'vec3 aurora = hsv2rgb(vec3(0.35 + 0.25 * fbm(vec2(uv.x * ${2.0}, iTime * 0.1)), 0.8, smoothstep(0.3, 0.8, fbm(vec2(uv.x * 5.0 + iTime * ${0.2}, 1.0)))));'),
  recipe('candle', 'Candle', 'vec3', 'Warm flickering candlelight.', 'float flicker = 0.75 + 0.25 * fbm(vec2(iTime * ${6.0}, ledIndex * 0.3));\nvec3 candle = kelvin(${1900.0}) * flicker;'),
  recipe('warmWhite', 'Warm White', 'vec3', 'Solid white at a color temperature.', 'vec3 white = kelvin(${2700.0});'),
  recipe('mirrorCenter', 'Mirror From Center', 'vec2', 'UV that is symmetric around the strip center; use mirrored.x in place of uv.x.', 'vec2 mirrored = vec2(fromCenter(uv.x), uv.y);'),
  recipe('hueCycleImage', 'Hue Cycling Image', 'vec3', 'The image with its hue rotating over time.', 'vec3 hueImg = hueShift(image(uv).rgb, iTime * ${0.1});'),
]

export const nodeByName = new Map(NODES.map((n) => [n.name, n]))

export const GLSL_KEYWORDS = ['if', 'else', 'for', 'while', 'do', 'break', 'continue', 'return', 'discard', 'const', 'in', 'out', 'inout', 'uniform', 'precision', 'highp', 'mediump', 'lowp', 'struct', 'true', 'false']
export const GLSL_TYPES = ['void', 'bool', 'int', 'uint', 'float', 'vec2', 'vec3', 'vec4', 'ivec2', 'ivec3', 'ivec4', 'bvec2', 'bvec3', 'bvec4', 'mat2', 'mat3', 'mat4', 'sampler2D']
export const GLSL_EXTRA_BUILTINS = ['sign', 'ceil', 'tan', 'asin', 'acos', 'radians', 'degrees', 'log', 'cross', 'reflect', 'refract', 'texelFetch', 'dFdx', 'dFdy', 'fwidth']

const SOCKET_COLORS: Record<GlslType, string> = {
  float: '#a1a1a1',
  int: '#4772b3',
  genType: '#a1a1a1',
  vec2: '#6363c7',
  vec3: '#6363c7',
  vec4: '#c7c729',
  mat2: '#6363c7',
  sampler2D: '#29c7c7',
  void: '#4b4b4b',
}

export const socketColor = (type: GlslType) => SOCKET_COLORS[type]
export const categoryById = new Map(CATEGORIES.map((c) => [c.id, c]))
