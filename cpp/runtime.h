#pragma once

#include "vecmath.h"

namespace wledtoy {

// Slot's components as references into its layer, so a body reads or writes one (outState1.yzw.x) as GLSL allows
template <int N>
struct slotComponents;
template <>
struct slotComponents<2> {
  float &x, &y;
  slotComponents(vec4& layer, int first) : x(layer.c[first]), y(layer.c[first + 1]) {}
};
template <>
struct slotComponents<3> {
  float &x, &y, &z;
  slotComponents(vec4& layer, int first) : x(layer.c[first]), y(layer.c[first + 1]), z(layer.c[first + 2]) {}
};
template <>
struct slotComponents<4> {
  float &x, &y, &z, &w;
  slotComponents(vec4& layer, int first) : x(layer.c[first]), y(layer.c[first + 1]), z(layer.c[first + 2]), w(layer.c[first + 3]) {}
};

// Multi-float state slot (outState1.yzw) read as a vector, assigned in place. Proxy, not swizzle member: union member
// assignment must stay trivial, so swizzle-to-swizzle would copy the whole layer
template <class V>
struct stateSlot : slotComponents<components<V>()> {
  vec4& layer;
  int first;
  stateSlot(vec4& layer, int first) : slotComponents<components<V>()>(layer, first), layer(layer), first(first) {}
  operator V() const {
    V v;
    for (int i = 0; i < components<V>(); i++) v.c[i] = layer.c[first + i];
    return v;
  }
  stateSlot& operator=(V v) {
    for (int i = 0; i < components<V>(); i++) layer.c[first + i] = v.c[i];
    return *this;
  }
  stateSlot& operator=(const stateSlot& other) { return *this = V(other); }
  stateSlot& operator+=(V v) { return *this = V(*this) + v; }
  stateSlot& operator-=(V v) { return *this = V(*this) - v; }
  stateSlot& operator*=(V v) { return *this = V(*this) * v; }
  stateSlot& operator/=(V v) { return *this = V(*this) / v; }
};

// C++17 inline variables: one definition across every unit. Host fills them before each frame; on LEDs iResolution = (LED count, 1, 1)
inline vec3 iResolution;
inline float iTime = 0.0f;
inline int iFrame = 0;
// Seconds since prev frame: the step stateful nodes integrate over
inline float iTimeDelta = 0.0f;
inline float iLedCount = 1.0f;
inline float iScanY = 0.5f;
// AudioReactive's 16 GEQ bands (fftResult) scaled 0..1: fft()'s source and slot 0's bands
constexpr int audioBands = 16;
inline float iAudioBands[audioBands] = {};
// GLSL textures of the same names as arrays at usermod resolution: extra slots' bands, a ring of band rows per slot,
// a ring of samples -1 to 1. iAudioHeads = (newest history row, next wave sample idx, sample rate Hz). Fewer analyses:
// define WLEDTOY_AUDIO_EXTRA_SLOTS before the include; slots past it read silence
#ifndef WLEDTOY_AUDIO_EXTRA_SLOTS
#define WLEDTOY_AUDIO_EXTRA_SLOTS 3
#endif
constexpr int audioExtraSlots = WLEDTOY_AUDIO_EXTRA_SLOTS;
constexpr int audioHistoryRows = 256;
constexpr int audioWaveSamples = 1024 * 16;
inline float iAudioBandsExtra[audioExtraSlots][audioBands] = {};
inline float iAudioHistory[audioHistoryRows][audioBands] = {};
inline float iAudioHistoryExtra[audioExtraSlots][audioHistoryRows][audioBands] = {};
inline float iAudioHistoryHeadExtra[audioExtraSlots] = {};
inline float iAudioWave[audioWaveSamples] = {};
// Each analysis's linear spectrum 0..1, row per slot, lowest bin first, and bins per row (half the window, 8192 max);
// 64 KB at defaults; a device build defines WLEDTOY_SPECTRUM_BINS smaller and the host fills at most that many
#ifndef WLEDTOY_SPECTRUM_BINS
#define WLEDTOY_SPECTRUM_BINS 4096
#endif
constexpr int audioSpectrumBins = WLEDTOY_SPECTRUM_BINS;
inline float iAudioSpectra[audioExtraSlots + 1][audioSpectrumBins] = {};
inline int iAudioSpectrumBins[audioExtraSlots + 1] = {};
inline vec3 iAudioHeads;
// Audio node outputs for slot 0 in AUDIO_FEATURES order (src/lib/audio/features.ts), four to a vector
inline vec4 iAudioFeatures[4];
// x, y, z, segment per LED in wire order from segment geometry; iLayoutCount 0 = plain strip
inline const vec4* iLayout = nullptr;
inline float iLayoutCount = 0.0f;

}
