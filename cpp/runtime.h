// What a WLED usermod supplies to a pixel body: the uniforms and the pixel state slots. C++17 for inline variables: the
// globals live in this header alone, one definition across every unit that includes it.
#pragma once

#include "vecmath.h"

namespace wledtoy {

// A pixel state slot of two or more floats, which GLSL writes as a run of one state layer's components (outState1.yzw),
// read as a vector and assigned in place. A proxy, not a swizzle member: a union member's assignment has to stay trivial,
// so assigning one swizzle to another of its type would copy the whole layer.
// A slot's components as references into its layer, as many as it has, so a body can read or write one
// (outState1.yzw.x) as GLSL allows.
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

// The uniforms, filled by whoever runs the program before each frame; on the LEDs iResolution is (LED count, 1, 1).
inline vec3 iResolution;
inline float iTime = 0.0f;
inline int iFrame = 0;
// seconds since the previous frame, as GLSL's iTimeDelta: the step stateful nodes integrate over
inline float iTimeDelta = 0.0f;
inline float iLedCount = 1.0f;
inline float iScanY = 0.5f;
// The 16 GEQ bands WLED's AudioReactive usermod publishes as fftResult, scaled to 0..1: what fft() reads where GLSL
// samples the spectrum texture, and the bands of slot 0 where GLSL reads the band texture.
constexpr int audioBands = 16;
inline float iAudioBands[audioBands] = {};
// The GLSL textures of the same names as arrays at the usermod's resolution: the bands of the extra analyses (slots 1 to
// 3), one ring of band rows per slot with its newest row, and a ring of samples, -1 to 1. iAudioHeads is (newest row of
// iAudioHistory, index of the next sample to be written to iAudioWave, sample rate in Hz). A build with fewer analyses
// defines WLEDTOY_AUDIO_EXTRA_SLOTS before the include; a slot past it reads as silence.
#ifndef WLEDTOY_AUDIO_EXTRA_SLOTS
#define WLEDTOY_AUDIO_EXTRA_SLOTS 3
#endif
constexpr int audioExtraSlots = WLEDTOY_AUDIO_EXTRA_SLOTS;
constexpr int audioHistoryRows = 64;
constexpr int audioWaveSamples = 4096;
inline float iAudioBandsExtra[audioExtraSlots][audioBands] = {};
inline float iAudioHistory[audioHistoryRows][audioBands] = {};
inline float iAudioHistoryExtra[audioExtraSlots][audioHistoryRows][audioBands] = {};
inline float iAudioHistoryHeadExtra[audioExtraSlots] = {};
inline float iAudioWave[audioWaveSamples] = {};
// GLSL's iAudioSpectra and iAudioSpectrumBins: each analysis's own linear spectrum as levels 0 to 1, a row per slot from 0,
// lowest frequency first, and how many bins each row holds, half its window; 8192 samples is the largest window.
// (WLEDTOY_AUDIO_EXTRA_SLOTS + 1) x WLEDTOY_SPECTRUM_BINS floats: 64 KB at the defaults. A device build defines
// WLEDTOY_SPECTRUM_BINS before the include to shrink it; the host then fills at most that many bins per row.
#ifndef WLEDTOY_SPECTRUM_BINS
#define WLEDTOY_SPECTRUM_BINS 4096
#endif
constexpr int audioSpectrumBins = WLEDTOY_SPECTRUM_BINS;
inline float iAudioSpectra[audioExtraSlots + 1][audioSpectrumBins] = {};
inline int iAudioSpectrumBins[audioExtraSlots + 1] = {};
inline vec3 iAudioHeads;
// The Audio node's outputs for slot 0 in the order of AUDIO_FEATURES (src/lib/audio/features.ts), four to a vector.
inline vec4 iAudioFeatures[4];
// x, y, z and segment of every LED in wire order, from the usermod's segment geometry; iLayoutCount 0 means a plain strip.
inline const vec4* iLayout = nullptr;
inline float iLayoutCount = 0.0f;

}
