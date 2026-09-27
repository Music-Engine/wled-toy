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
// samples the spectrum texture.
inline float iAudioBands[16] = {};
// x, y, z and segment of every LED in wire order, from the usermod's segment geometry; iLayoutCount 0 means a plain strip.
inline const vec4* iLayout = nullptr;
inline float iLayoutCount = 0.0f;

}
