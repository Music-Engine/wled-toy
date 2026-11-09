import { AUDIO_EXTRA_SLOTS } from './uniforms'

// GLSL ES 3.00 indexes sampler arrays w/ constants only, so one branch per slot
const branchPerSlot = (call: (sampler: (name: string) => string, head: string) => string) =>
  [
    ...Array.from(
      { length: AUDIO_EXTRA_SLOTS },
      (_, i) => `  if (slot == ${i + 1}) return ${call((name) => `${name}Extra[${i}]`, `iAudioHistoryHeadExtra[${i}]`)};`,
    ),
    `  return ${call((name) => name, 'iAudioHeads.x')};`,
  ].join('\n')

/** Audio node features, band levels and spectrum peaks per slot; also pasted alone into a frame pass, which lacks the prelude */
export const AUDIO_READS = `// the Audio node's outputs for the default analysis, in the order of AUDIO_FEATURES, four to a vector
uniform vec4 iAudioFeatures[4];
// slot 0 is the default analysis; graph FFT nodes with other settings use slots 1 and up
float bandsAt(int slot, float x) {
${branchPerSlot((sampler) => `texture(${sampler('iAudioBands')}, vec2(x, 0.25)).r`)}
}
int bandCountAt(int slot) {
${branchPerSlot((sampler) => `textureSize(${sampler('iAudioBands')}, 0).x`)}
}
// the loudest of the bands that output number band of count covers, as the Bands node folds them
float bandsPeak(int slot, int band, int count) {
  int total = bandCountAt(slot);
  int from = band * total / count;
  int to = max(from + 1, (band + 1) * total / count);
  float peak = 0.0;
  for (int k = from; k < to; k++) peak = max(peak, bandsAt(slot, (float(k) + 0.5) / float(total)));
  return peak;
}
// the loudest bin of an analysis's own spectrum between lo and hi Hz, as the Band Split node reads it: the bins either
// side of the range included, as the frame body it replaced took them
float spectrumPeak(int slot, float lo, float hi) {
  int bins = int(iAudioSpectrumBins[slot]);
  float hz = iAudioHeads.z / (2.0 * float(bins));
  int last = min(min(bins, textureSize(iAudioSpectra, 0).x) - 1, int(ceil(max(lo, hi) / hz)));
  float peak = 0.0;
  for (int i = max(1, int(min(lo, hi) / hz)); i <= last; i++) peak = max(peak, texelFetch(iAudioSpectra, ivec2(i, slot), 0).r);
  return peak;
}
`

/** Prelude audio functions: analysis textures per slot and helpers over them */
export const AUDIO_LIBRARY = `float fft(float f) { return texture(iAudio, vec2(f, 0.25)).r; }
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
${AUDIO_READS}float chromaAt(int slot, float pitchClass) {
${branchPerSlot((sampler) => `texelFetch(${sampler('iAudioBands')}, ivec2(int(mod(pitchClass, 12.0)), 1), 0).r`)}
}
// age 0 is now, 1 the oldest row kept
float historyAt(int slot, float x, float age) {
${branchPerSlot((sampler, head) => `historyRow(${sampler('iAudioHistory')}, ${head}, x, age)`)}
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
float treble() { return bandLevel(0.30, 0.80); }`
