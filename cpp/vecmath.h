// GLSL's vector types, their arithmetic and the built-in functions, in C++. No standard library header: the math comes
// from GCC builtins, which keeps the global math overloads and libc's M_PI away from the chunks that define their own.
#pragma once

namespace wledtoy {

// a read-only swizzle such as .xy or .zyx, laid over the vector's own components in its union
template <class V, int N, int... I>
struct swizzle {
  float c[N];
  operator V() const { return V(c[I]...); }
};

struct vec2 {
  union {
    float c[2];
    struct { float x, y; };
  };
  vec2() : c{0.0f, 0.0f} {}
  explicit vec2(float s) : c{s, s} {}
  vec2(float x_, float y_) : c{x_, y_} {}
  float& operator[](int i) { return c[i]; }
  float operator[](int i) const { return c[i]; }
};

struct vec3 {
  union {
    float c[3];
    struct { float x, y, z; };
    struct { float r, g, b; };
    swizzle<vec2, 3, 0, 1> xy;
    swizzle<vec2, 3, 1, 2> yz;
    swizzle<vec2, 3, 2, 0> zx;
    swizzle<vec3, 3, 0, 1, 2> xyz;
    swizzle<vec3, 3, 1, 0, 2> yxz;
    swizzle<vec3, 3, 2, 1, 0> zyx;
  };
  vec3() : c{0.0f, 0.0f, 0.0f} {}
  explicit vec3(float s) : c{s, s, s} {}
  vec3(float x_, float y_, float z_) : c{x_, y_, z_} {}
  vec3(vec2 v, float z_) : c{v.x, v.y, z_} {}
  vec3(float x_, vec2 v) : c{x_, v.x, v.y} {}
  float& operator[](int i) { return c[i]; }
  float operator[](int i) const { return c[i]; }
};

struct vec4 {
  union {
    float c[4];
    struct { float x, y, z, w; };
    struct { float r, g, b, a; };
    swizzle<vec2, 4, 0, 1> xy;
    swizzle<vec3, 4, 0, 1, 2> xyz;
  };
  vec4() : c{0.0f, 0.0f, 0.0f, 0.0f} {}
  explicit vec4(float s) : c{s, s, s, s} {}
  vec4(float x_, float y_, float z_, float w_) : c{x_, y_, z_, w_} {}
  vec4(vec3 v, float w_) : c{v.x, v.y, v.z, w_} {}
  vec4(float x_, vec3 v) : c{x_, v.x, v.y, v.z} {}
  vec4(vec2 v, float z_, float w_) : c{v.x, v.y, z_, w_} {}
  vec4(vec2 u, vec2 v) : c{u.x, u.y, v.x, v.y} {}
  float& operator[](int i) { return c[i]; }
  float operator[](int i) const { return c[i]; }
};

// GLSL applies arithmetic, and every built-in below, to each component; a float operand stands for all of them
template <class V>
constexpr int components() { return int(sizeof(V::c) / sizeof(float)); }

template <class V, class F>
inline V each(V a, F f) {
  for (float& x : a.c) x = f(x);
  return a;
}

template <class V, class F>
inline V each(V a, V b, F f) {
  for (int i = 0; i < components<V>(); i++) a.c[i] = f(a.c[i], b.c[i]);
  return a;
}

template <class V, class F>
inline V each(V a, V b, V t, F f) {
  for (int i = 0; i < components<V>(); i++) a.c[i] = f(a.c[i], b.c[i], t.c[i]);
  return a;
}

#define WLEDTOY_OPERATORS(V)                                                                             \
  inline V operator+(V a, V b) { return each(a, b, [](float x, float y) { return x + y; }); }           \
  inline V operator-(V a, V b) { return each(a, b, [](float x, float y) { return x - y; }); }           \
  inline V operator*(V a, V b) { return each(a, b, [](float x, float y) { return x * y; }); }           \
  inline V operator/(V a, V b) { return each(a, b, [](float x, float y) { return x / y; }); }           \
  inline V operator+(V a, float s) { return a + V(s); }                                                 \
  inline V operator-(V a, float s) { return a - V(s); }                                                 \
  inline V operator*(V a, float s) { return a * V(s); }                                                 \
  inline V operator/(V a, float s) { return a / V(s); }                                                 \
  inline V operator+(float s, V a) { return V(s) + a; }                                                 \
  inline V operator-(float s, V a) { return V(s) - a; }                                                 \
  inline V operator*(float s, V a) { return V(s) * a; }                                                 \
  inline V operator/(float s, V a) { return V(s) / a; }                                                 \
  inline V operator-(V a) { return each(a, [](float x) { return -x; }); }                               \
  inline V& operator+=(V& a, V b) { return a = a + b; }                                                 \
  inline V& operator-=(V& a, V b) { return a = a - b; }                                                 \
  inline V& operator*=(V& a, V b) { return a = a * b; }                                                 \
  inline V& operator/=(V& a, V b) { return a = a / b; }                                                 \
  inline V& operator+=(V& a, float s) { return a = a + s; }                                             \
  inline V& operator-=(V& a, float s) { return a = a - s; }                                             \
  inline V& operator*=(V& a, float s) { return a = a * s; }                                             \
  inline V& operator/=(V& a, float s) { return a = a / s; }

WLEDTOY_OPERATORS(vec2)
WLEDTOY_OPERATORS(vec3)
WLEDTOY_OPERATORS(vec4)
#undef WLEDTOY_OPERATORS

inline float abs(float x) { return __builtin_fabsf(x); }
inline float sign(float x) { return x > 0.0f ? 1.0f : (x < 0.0f ? -1.0f : 0.0f); }
inline float floor(float x) { return __builtin_floorf(x); }
inline float ceil(float x) { return __builtin_ceilf(x); }
inline float trunc(float x) { return __builtin_truncf(x); }
inline float fract(float x) { return x - floor(x); }
inline float sin(float x) { return __builtin_sinf(x); }
inline float cos(float x) { return __builtin_cosf(x); }
inline float tan(float x) { return __builtin_tanf(x); }
inline float asin(float x) { return __builtin_asinf(x); }
inline float acos(float x) { return __builtin_acosf(x); }
inline float atan(float x) { return __builtin_atanf(x); }
inline float sinh(float x) { return __builtin_sinhf(x); }
inline float cosh(float x) { return __builtin_coshf(x); }
inline float tanh(float x) { return __builtin_tanhf(x); }
inline float radians(float x) { return x * 0.017453292519943295f; }
inline float degrees(float x) { return x * 57.29577951308232f; }
inline float exp(float x) { return __builtin_expf(x); }
inline float log(float x) { return __builtin_logf(x); }
inline float sqrt(float x) { return __builtin_sqrtf(x); }
inline float inversesqrt(float x) { return 1.0f / sqrt(x); }
inline float mod(float x, float y) { return x - y * floor(x / y); }
inline float min(float x, float y) { return y < x ? y : x; }
inline float max(float x, float y) { return x < y ? y : x; }
inline float pow(float x, float y) { return __builtin_powf(x, y); }
inline float atan(float y, float x) { return __builtin_atan2f(y, x); }
inline float step(float edge, float x) { return x < edge ? 0.0f : 1.0f; }
inline float clamp(float x, float lo, float hi) { return min(max(x, lo), hi); }
inline float mix(float a, float b, float t) { return a + (b - a) * t; }
inline float smoothstep(float lo, float hi, float x) {
  float t = clamp((x - lo) / (hi - lo), 0.0f, 1.0f);
  return t * t * (3.0f - 2.0f * t);
}

#define WLEDTOY_UNARY(V, f) \
  inline V f(V a) { return each(a, [](float x) { return f(x); }); }
#define WLEDTOY_BINARY(V, f)                                                          \
  inline V f(V a, V b) { return each(a, b, [](float x, float y) { return f(x, y); }); } \
  inline V f(V a, float s) { return f(a, V(s)); }
#define WLEDTOY_TERNARY(V, f) \
  inline V f(V a, V b, V t) { return each(a, b, t, [](float x, float y, float z) { return f(x, y, z); }); }

// GLSL's equal() gives a bool vector, which the math helpers only cast back to floats (vec3(equal(x, vec3(0.0)))); with
// no bool vectors here, equal() returns that cast: 1.0 where the components are equal, else 0.0
#define WLEDTOY_BUILTINS(V)                                                                                      \
  WLEDTOY_UNARY(V, abs) WLEDTOY_UNARY(V, sign) WLEDTOY_UNARY(V, floor) WLEDTOY_UNARY(V, ceil)                    \
  WLEDTOY_UNARY(V, trunc) WLEDTOY_UNARY(V, fract) WLEDTOY_UNARY(V, sin) WLEDTOY_UNARY(V, cos)                    \
  WLEDTOY_UNARY(V, tan) WLEDTOY_UNARY(V, asin) WLEDTOY_UNARY(V, acos) WLEDTOY_UNARY(V, atan)                     \
  WLEDTOY_UNARY(V, sinh) WLEDTOY_UNARY(V, cosh) WLEDTOY_UNARY(V, tanh) WLEDTOY_UNARY(V, radians)                 \
  WLEDTOY_UNARY(V, degrees) WLEDTOY_UNARY(V, exp) WLEDTOY_UNARY(V, log) WLEDTOY_UNARY(V, sqrt)                   \
  WLEDTOY_UNARY(V, inversesqrt)                                                                                 \
  WLEDTOY_BINARY(V, mod) WLEDTOY_BINARY(V, min) WLEDTOY_BINARY(V, max) WLEDTOY_BINARY(V, pow)                   \
  inline V atan(V y, V x) { return each(y, x, [](float a, float b) { return atan(a, b); }); }                   \
  inline V step(V edge, V x) { return each(edge, x, [](float e, float v) { return step(e, v); }); }             \
  inline V step(float edge, V x) { return step(V(edge), x); }                                                   \
  WLEDTOY_TERNARY(V, clamp) WLEDTOY_TERNARY(V, mix) WLEDTOY_TERNARY(V, smoothstep)                              \
  inline V clamp(V x, float lo, float hi) { return clamp(x, V(lo), V(hi)); }                                    \
  inline V mix(V a, V b, float t) { return mix(a, b, V(t)); }                                                   \
  inline V smoothstep(float lo, float hi, V x) { return smoothstep(V(lo), V(hi), x); }                          \
  inline float dot(V a, V b) {                                                                                  \
    float sum = 0.0f;                                                                                           \
    for (int i = 0; i < components<V>(); i++) sum += a.c[i] * b.c[i];                                           \
    return sum;                                                                                                 \
  }                                                                                                             \
  inline float length(V a) { return sqrt(dot(a, a)); }                                                          \
  inline float distance(V a, V b) { return length(a - b); }                                                     \
  inline V normalize(V a) { return a * inversesqrt(dot(a, a)); }                                                \
  inline V reflect(V i, V n) { return i - 2.0f * dot(n, i) * n; }                                               \
  inline V equal(V a, V b) { return each(a, b, [](float x, float y) { return x == y ? 1.0f : 0.0f; }); }

WLEDTOY_BUILTINS(vec2)
WLEDTOY_BUILTINS(vec3)
WLEDTOY_BUILTINS(vec4)
#undef WLEDTOY_BUILTINS
#undef WLEDTOY_UNARY
#undef WLEDTOY_BINARY
#undef WLEDTOY_TERNARY

inline float dot(float a, float b) { return a * b; }
inline float length(float a) { return abs(a); }
inline float distance(float a, float b) { return abs(a - b); }
inline float normalize(float a) { return sign(a); }
inline vec3 cross(vec3 a, vec3 b) { return vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x); }

}
