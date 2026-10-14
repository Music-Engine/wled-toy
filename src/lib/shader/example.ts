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
