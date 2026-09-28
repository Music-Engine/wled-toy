// The prelude helpers the catalog nodes and the standalone audio stand-ins call, ported from src/lib/shader/prelude.ts.
#pragma once

#include "runtime.h"

namespace wledtoy {

inline vec4 ledLayout(float ledIndex) {
  if (iLayoutCount > 0.5f) return iLayout[int(ledIndex)];
  return vec4((ledIndex + 0.5f) / iLedCount, 0.5f, 0.0f, 0.0f);
}

// the nearest of the 16 bands, the resolution the usermod has
inline float fft(float f) {
  int band = int(clamp(f, 0.0f, 1.0f) * 16.0f);
  return iAudioBands[band < 15 ? band : 15];
}
inline float bandLevel(float lo, float hi) {
  float s = 0.0f;
  for (int i = 0; i < 8; i++) s += fft(mix(lo, hi, (float(i) + 0.5f) / 8.0f));
  return s / 8.0f;
}
// bandsAt, historyAt and waveformAt read the arrays as GLSL samples the textures: linear between bands, and between
// history rows, which wrap
inline const float* bandRow(int slot) { return slot >= 1 && slot <= audioExtraSlots ? iAudioBandsExtra[slot - 1] : iAudioBands; }
inline float bandsAcross(const float* row, float x) {
  float t = clamp(x * float(audioBands) - 0.5f, 0.0f, float(audioBands - 1));
  int band = int(t);
  return mix(row[band], row[band < audioBands - 1 ? band + 1 : band], t - float(band));
}
inline float bandsAt(int slot, float x) { return bandsAcross(bandRow(slot), x); }
inline int bandCountAt(int) { return audioBands; }
inline float bandsPeak(int slot, int band, int count) {
  int from = band * audioBands / count;
  int to = (band + 1) * audioBands / count;
  float peak = 0.0f;
  for (int k = from; k < (to > from ? to : from + 1); k++) peak = max(peak, bandsAt(slot, (float(k) + 0.5f) / float(audioBands)));
  return peak;
}
inline float spectrumPeak(int slot, float lo, float hi) {
  if (slot < 0 || slot > audioExtraSlots) return 0.0f;
  int bins = iAudioSpectrumBins[slot];
  float hz = iAudioHeads.z / (2.0f * float(bins));
  int first = int(min(lo, hi) / hz);
  int last = int(ceil(max(lo, hi) / hz));
  float peak = 0.0f;
  for (int i = first > 1 ? first : 1; i <= (last < bins - 1 ? last : bins - 1); i++) peak = max(peak, iAudioSpectra[slot][i]);
  return peak;
}
inline float historyAt(int slot, float x, float age) {
  bool extra = slot >= 1 && slot <= audioExtraSlots;
  const float(*rows)[audioBands] = extra ? iAudioHistoryExtra[slot - 1] : iAudioHistory;
  float y = (extra ? iAudioHistoryHeadExtra[slot - 1] : iAudioHeads.x) - clamp(age, 0.0f, 1.0f) * float(audioHistoryRows - 1);
  int row = int(floor(y));
  float older = bandsAcross(rows[(row % audioHistoryRows + audioHistoryRows) % audioHistoryRows], x);
  float newer = bandsAcross(rows[((row + 1) % audioHistoryRows + audioHistoryRows) % audioHistoryRows], x);
  return mix(older, newer, y - floor(y));
}
inline float waveformAt(float samplesAgo) {
  int back = int(clamp(samplesAgo, 0.0f, float(audioWaveSamples - 1)));
  return iAudioWave[(int(iAudioHeads.y) - 1 - back + audioWaveSamples) % audioWaveSamples];
}

inline float bass() { return bandLevel(0.00f, 0.06f); }
inline float mid() { return bandLevel(0.06f, 0.30f); }
inline float treble() { return bandLevel(0.30f, 0.80f); }
inline float energy() { return bandLevel(0.0f, 0.8f); }
inline float beat(float threshold) { return smoothstep(threshold, threshold + 0.15f, bass()); }

inline vec3 palette(float t, vec3 a, vec3 b, vec3 c, vec3 d) { return a + b * cos(6.28318f * (c * t + d)); }
inline float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1f, 311.7f))) * 43758.5453f); }
inline float triangleWave(float t) { return 1.0f - abs(fract(t) * 2.0f - 1.0f); }
inline float pulse(float x, float center, float width) {
  float d = (x - center) / max(width, 1e-4f);
  return exp(-d * d);
}
inline float stripes(float x, float count) { return step(0.5f, fract(x * count)); }
inline float chase(float ledIndex, float spacing, float speed) { return step(mod(ledIndex + floor(iTime * speed), spacing), 0.5f); }
inline float scanner(float x, float speed, float width) { return pulse(x, triangleWave(iTime * speed * 0.5f), width); }
inline float sparkle(float ledIndex, float density, float speed) {
  float t = iTime * speed + hash(vec2(ledIndex, 7.0f)) * 100.0f;
  float on = step(1.0f - density, hash(vec2(ledIndex, floor(t))));
  return on * sin(fract(t) * 3.14159f);
}
inline float luminance(vec3 c) { return dot(c, vec3(0.2126f, 0.7152f, 0.0722f)); }
// Tanner Helland's blackbody fit, good enough for picking LED white points
inline vec3 kelvin(float k) {
  float t = clamp(k, 1000.0f, 40000.0f) / 100.0f;
  float r = t <= 66.0f ? 1.0f : clamp(1.29293618606f * pow(t - 60.0f, -0.1332047592f), 0.0f, 1.0f);
  float g = t <= 66.0f ? clamp(0.39008157876f * log(t) - 0.63184144378f, 0.0f, 1.0f) : clamp(1.12989086089f * pow(t - 60.0f, -0.0755148492f), 0.0f, 1.0f);
  float b = t >= 66.0f ? 1.0f : (t <= 19.0f ? 0.0f : clamp(0.54320678911f * log(t - 10.0f) - 1.19625408914f, 0.0f, 1.0f));
  return vec3(r, g, b);
}

}
