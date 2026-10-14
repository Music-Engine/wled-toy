import { EXAMPLE } from './example'

export interface ShaderExample {
  name: string
  description: string
  icon: string
  code: string
}

export const EXAMPLES: ShaderExample[] = [
  {
    name: 'Audio Rainbow',
    description: 'The starter shader: rainbow, image, waveform and a comet',
    icon: 'i-lucide-audio-lines',
    code: EXAMPLE,
  },
  {
    name: 'Fire',
    description: 'Flickering flames that flare with the bass',
    icon: 'i-lucide-flame',
    code: `// Flickering fire, hottest at the start of the strip
void mainImage(out vec4 c, vec2 uv, float ledIndex) {
  float heat = fbm(vec2(uv.x * 6.0, iTime * 1.5));
  heat *= 1.2 - uv.x * 0.6;
  heat += bass() * 0.4;
  c = vec4(heatColor(heat), 1.0);
}
`,
  },
  {
    name: 'Ocean Waves',
    description: 'Deep blue swells with bright foam',
    icon: 'i-lucide-waves',
    code: `// Slow rolling waves: a travelling sine plus drifting noise
void mainImage(out vec4 c, vec2 uv, float ledIndex) {
  float wave = sineWave(uv.x * 2.0 - iTime * 0.2) * 0.5
             + fbm(vec2(uv.x * 4.0 - iTime * 0.3, iTime * 0.1)) * 0.5;
  vec3 deep = vec3(0.0, 0.08, 0.25);
  vec3 foam = vec3(0.3, 0.9, 0.9);
  c = vec4(mix(deep, foam, pow(wave, 2.0)), 1.0);
}
`,
  },
  {
    name: 'Spectrum Analyzer',
    description: 'Bass to treble along the strip, bars in the preview',
    icon: 'i-lucide-chart-column',
    code: `// Log spectrum: each LED shows the level of one frequency band
void mainImage(out vec4 c, vec2 uv, float ledIndex) {
  float level = fftLog(uv.x) * 1.3;
  vec3 color = hsv2rgb(vec3(0.7 - uv.x * 0.7, 1.0, 1.0));
  // the strip is one pixel tall, so it shows level as brightness; the preview draws bars
  float bar = iResolution.y > 1.5 ? step(uv.y, level) : level;
  c = vec4(color * bar, 1.0);
}
`,
  },
  {
    name: 'Twinkle Night',
    description: 'Warm and cool stars twinkling on a dark sky',
    icon: 'i-lucide-sparkles',
    code: `// Random per-LED twinkles with a slightly different tint per star
void mainImage(out vec4 c, vec2 uv, float ledIndex) {
  vec3 sky = vec3(0.0, 0.01, 0.04);
  float star = sparkle(ledIndex, 0.12, 0.8);
  vec3 tint = mix(vec3(1.0, 0.85, 0.6), vec3(0.7, 0.8, 1.0), random(ledIndex));
  c = vec4(sky + tint * star, 1.0);
}
`,
  },
  {
    name: 'Larson Scanner',
    description: 'A red eye sweeping back and forth with a soft trail',
    icon: 'i-lucide-scan-line',
    code: `// Knight Rider style scanner: a sharp eye over a wider dim glow
void mainImage(out vec4 c, vec2 uv, float ledIndex) {
  float eye = scanner(uv.x, 0.6, 0.03);
  float trail = scanner(uv.x, 0.6, 0.12) * 0.25;
  c = vec4(vec3(1.0, 0.05, 0.0) * (eye + trail), 1.0);
}
`,
  },
  {
    name: 'Beat Pulse',
    description: 'Rings leave the center, the whole strip flashes on beats',
    icon: 'i-lucide-heart-pulse',
    code: `// Rings expand from the middle; beats light up the center
void mainImage(out vec4 c, vec2 uv, float ledIndex) {
  float d = fromCenter(uv.x);
  float hit = beat(0.45);
  float ring = pulse(d, fract(iTime * 0.8), 0.08);
  vec3 color = rainbow(iTime * 0.1 + d * 0.3);
  c = vec4(color * (ring + hit * (1.0 - d)), 1.0);
}
`,
  },
  {
    name: 'Plasma',
    description: 'Classic demoscene plasma in soft cosine colors',
    icon: 'i-lucide-orbit',
    code: `// Three overlapping sine fields mapped through a cosine palette
void mainImage(out vec4 c, vec2 uv, float ledIndex) {
  vec2 p = uv * 6.0;
  float v = sin(p.x + iTime)
          + sin((p.y + p.x) * 0.7 - iTime * 1.3)
          + sin(length(p - 3.0) * 1.5 - iTime);
  vec3 color = palette(v * 0.2 + iTime * 0.05, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.1, 0.2));
  c = vec4(color, 1.0);
}
`,
  },
  {
    name: 'Image Scroller',
    description: 'The image texture scrolling, hue nudged by the mids',
    icon: 'i-lucide-image',
    code: `// Scroll the image along the strip and punch up its colors
void mainImage(out vec4 c, vec2 uv, float ledIndex) {
  vec3 img = imageScroll(uv, vec2(0.08, 0.0)).rgb;
  img = saturation(img, 1.6);
  img = hueShift(img, mid() * 0.3);
  c = vec4(gammaCorrect(img, 2.2), 1.0);
}
`,
  },
  {
    name: 'Candlelight',
    description: 'Warm 1800K glow that flickers gently',
    icon: 'i-lucide-flame-kindling',
    code: `// Candle color temperature with a slow flicker, brightest in the middle
void mainImage(out vec4 c, vec2 uv, float ledIndex) {
  float flicker = 0.7 + 0.3 * fbm(vec2(iTime * 5.0, ledIndex * 0.2));
  float glow = 1.0 - fromCenter(uv.x) * 0.6;
  c = vec4(kelvin(1800.0) * flicker * glow, 1.0);
}
`,
  },
  {
    name: 'Police Lights',
    description: 'Red and blue halves strobing in turn',
    icon: 'i-lucide-siren',
    code: `// Each half strobes fast while taking turns every half second
void mainImage(out vec4 c, vec2 uv, float ledIndex) {
  float side = step(0.5, uv.x);
  float flash = squareWave(iTime * 6.0, 0.5) * squareWave(iTime + side * 0.5, 0.5);
  c = vec4(mix(vec3(1.0, 0.0, 0.0), vec3(0.0, 0.1, 1.0), side) * flash, 1.0);
}
`,
  },
  {
    name: 'Theater Chase',
    description: 'Every third LED marching along in slowly shifting color',
    icon: 'i-lucide-spotlight',
    code: `// Marquee lights: a chase pattern tinted by a slow rainbow
void mainImage(out vec4 c, vec2 uv, float ledIndex) {
  vec3 color = rainbow(iTime * 0.1);
  c = vec4(color * chase(ledIndex, 3.0, 8.0), 1.0);
}
`,
  },
]
