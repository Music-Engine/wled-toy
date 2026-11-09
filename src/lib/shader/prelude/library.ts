/** Prelude reads of the pass's prev frame and LED positions */
export const PASS_READS = `bool isLedPass() { return iResolution.y < 1.5; }
// position (xyz) and segment (w) of an LED; in the 2D preview there are no LEDs, so this is the pixel itself
vec4 ledLayout(float ledIndex) {
  if (isLedPass() && iLayoutCount > 0.5) return texelFetch(iLayout, ivec2(int(ledIndex), 0), 0);
  return vec4(gl_FragCoord.xy / iResolution.xy, 0.0, 0.0);
}

// the color this pixel (or the LED ledOffset LEDs further along the wire) had on the previous frame
vec3 previousFrame(float ledOffset) {
  if (isLedPass()) return texelFetch(iPrevFrame, ivec2(clamp(int(gl_FragCoord.x) + int(ledOffset), 0, int(iResolution.x) - 1), 0), 0).rgb;
  return texture(iPrevFrame, gl_FragCoord.xy / iResolution.xy + vec2(ledOffset / iLedCount, 0.0)).rgb;
}`

/** Functions every shader and pixel pass can call */
export const LIBRARY = `vec4 image(vec2 uv) { return texture(iImage, vec2(uv.x, 1.0 - uv.y)); }
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
float imageLuma(vec2 uv) { return luminance(image(uv).rgb); }`
