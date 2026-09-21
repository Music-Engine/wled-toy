import type { GlslChunk } from './chunk'
import { hsvToRgbChunk, rgbToHsvChunk } from './color'

/* SPDX-FileCopyrightText: 2011-2022 Blender Foundation
 *
 * SPDX-License-Identifier: Apache-2.0 */

const hsv = [rgbToHsvChunk, hsvToRgbChunk]

/**
 * One GLSL chunk per Blender node_mix_* blend function (node_color_blend.h), keyed by the Color Mix / Layer Mix
 * `mode` value. `mode` is `connectable: false`, so a node's shape knows its mode at compile time and can include
 * only the one function it calls, instead of a switch over all of them.
 */
export const BLEND_FUNCTIONS: Record<string, { fn: string; chunk: GlslChunk }> = {
  mix: { fn: 'node_mix_blend', chunk: { id: 'blend-mix', requires: [], source: /* glsl */ `
vec3 node_mix_blend(float t, vec3 col1, vec3 col2)
{
  return mix(col1, col2, t);
}
` } },
  add: { fn: 'node_mix_add', chunk: { id: 'blend-add', requires: [], source: /* glsl */ `
vec3 node_mix_add(float t, vec3 col1, vec3 col2)
{
  return mix(col1, col1 + col2, t);
}
` } },
  multiply: { fn: 'node_mix_mul', chunk: { id: 'blend-multiply', requires: [], source: /* glsl */ `
vec3 node_mix_mul(float t, vec3 col1, vec3 col2)
{
  return mix(col1, col1 * col2, t);
}
` } },
  screen: { fn: 'node_mix_screen', chunk: { id: 'blend-screen', requires: [], source: /* glsl */ `
vec3 node_mix_screen(float t, vec3 col1, vec3 col2)
{
  float tm = 1.0 - t;

  return vec3(1.0) - (vec3(tm) + t * (vec3(1.0) - col2)) * (vec3(1.0) - col1);
}
` } },
  overlay: { fn: 'node_mix_overlay', chunk: { id: 'blend-overlay', requires: [], source: /* glsl */ `
vec3 node_mix_overlay(float t, vec3 col1, vec3 col2)
{
  float tm = 1.0 - t;

  vec3 outcol = col1;

  if (outcol[0] < 0.5) {
    outcol[0] *= tm + 2.0 * t * col2[0];
  }
  else {
    outcol[0] = 1.0 - (tm + 2.0 * t * (1.0 - col2[0])) * (1.0 - outcol[0]);
  }

  if (outcol[1] < 0.5) {
    outcol[1] *= tm + 2.0 * t * col2[1];
  }
  else {
    outcol[1] = 1.0 - (tm + 2.0 * t * (1.0 - col2[1])) * (1.0 - outcol[1]);
  }

  if (outcol[2] < 0.5) {
    outcol[2] *= tm + 2.0 * t * col2[2];
  }
  else {
    outcol[2] = 1.0 - (tm + 2.0 * t * (1.0 - col2[2])) * (1.0 - outcol[2]);
  }

  return outcol;
}
` } },
  subtract: { fn: 'node_mix_sub', chunk: { id: 'blend-subtract', requires: [], source: /* glsl */ `
vec3 node_mix_sub(float t, vec3 col1, vec3 col2)
{
  return mix(col1, col1 - col2, t);
}
` } },
  divide: { fn: 'node_mix_div', chunk: { id: 'blend-divide', requires: [], source: /* glsl */ `
vec3 node_mix_div(float t, vec3 col1, vec3 col2)
{
  float tm = 1.0 - t;

  vec3 outcol = col1;

  if (col2[0] != 0.0) {
    outcol[0] = tm * outcol[0] + t * outcol[0] / col2[0];
  }
  if (col2[1] != 0.0) {
    outcol[1] = tm * outcol[1] + t * outcol[1] / col2[1];
  }
  if (col2[2] != 0.0) {
    outcol[2] = tm * outcol[2] + t * outcol[2] / col2[2];
  }

  return outcol;
}
` } },
  difference: { fn: 'node_mix_diff', chunk: { id: 'blend-difference', requires: [], source: /* glsl */ `
vec3 node_mix_diff(float t, vec3 col1, vec3 col2)
{
  return mix(col1, abs(col1 - col2), t);
}
` } },
  exclusion: { fn: 'node_mix_exclusion', chunk: { id: 'blend-exclusion', requires: [], source: /* glsl */ `
vec3 node_mix_exclusion(float t, vec3 col1, vec3 col2)
{
  return max(mix(col1, col1 + col2 - 2.0 * col1 * col2, t), 0.0);
}
` } },
  darken: { fn: 'node_mix_dark', chunk: { id: 'blend-darken', requires: [], source: /* glsl */ `
vec3 node_mix_dark(float t, vec3 col1, vec3 col2)
{
  return mix(col1, min(col1, col2), t);
}
` } },
  lighten: { fn: 'node_mix_light', chunk: { id: 'blend-lighten', requires: [], source: /* glsl */ `
vec3 node_mix_light(float t, vec3 col1, vec3 col2)
{
  return mix(col1, max(col1, col2), t);
}
` } },
  dodge: { fn: 'node_mix_dodge', chunk: { id: 'blend-dodge', requires: [], source: /* glsl */ `
vec3 node_mix_dodge(float t, vec3 col1, vec3 col2)
{
  vec3 outcol = col1;

  if (outcol[0] != 0.0) {
    float tmp = 1.0 - t * col2[0];
    if (tmp <= 0.0) {
      outcol[0] = 1.0;
    }
    else if ((tmp = outcol[0] / tmp) > 1.0) {
      outcol[0] = 1.0;
    }
    else {
      outcol[0] = tmp;
    }
  }
  if (outcol[1] != 0.0) {
    float tmp = 1.0 - t * col2[1];
    if (tmp <= 0.0) {
      outcol[1] = 1.0;
    }
    else if ((tmp = outcol[1] / tmp) > 1.0) {
      outcol[1] = 1.0;
    }
    else {
      outcol[1] = tmp;
    }
  }
  if (outcol[2] != 0.0) {
    float tmp = 1.0 - t * col2[2];
    if (tmp <= 0.0) {
      outcol[2] = 1.0;
    }
    else if ((tmp = outcol[2] / tmp) > 1.0) {
      outcol[2] = 1.0;
    }
    else {
      outcol[2] = tmp;
    }
  }

  return outcol;
}
` } },
  burn: { fn: 'node_mix_burn', chunk: { id: 'blend-burn', requires: [], source: /* glsl */ `
vec3 node_mix_burn(float t, vec3 col1, vec3 col2)
{
  float tmp, tm = 1.0 - t;

  vec3 outcol = col1;

  tmp = tm + t * col2[0];
  if (tmp <= 0.0) {
    outcol[0] = 0.0;
  }
  else if ((tmp = (1.0 - (1.0 - outcol[0]) / tmp)) < 0.0) {
    outcol[0] = 0.0;
  }
  else if (tmp > 1.0) {
    outcol[0] = 1.0;
  }
  else {
    outcol[0] = tmp;
  }

  tmp = tm + t * col2[1];
  if (tmp <= 0.0) {
    outcol[1] = 0.0;
  }
  else if ((tmp = (1.0 - (1.0 - outcol[1]) / tmp)) < 0.0) {
    outcol[1] = 0.0;
  }
  else if (tmp > 1.0) {
    outcol[1] = 1.0;
  }
  else {
    outcol[1] = tmp;
  }

  tmp = tm + t * col2[2];
  if (tmp <= 0.0) {
    outcol[2] = 0.0;
  }
  else if ((tmp = (1.0 - (1.0 - outcol[2]) / tmp)) < 0.0) {
    outcol[2] = 0.0;
  }
  else if (tmp > 1.0) {
    outcol[2] = 1.0;
  }
  else {
    outcol[2] = tmp;
  }

  return outcol;
}
` } },
  hue: { fn: 'node_mix_hue', chunk: { id: 'blend-hue', requires: hsv, source: /* glsl */ `
vec3 node_mix_hue(float t, vec3 col1, vec3 col2)
{
  vec3 outcol = col1;
  vec3 hsv2 = rgb_to_hsv(col2);

  if (hsv2[1] != 0.0) {
    vec3 hsv = rgb_to_hsv(outcol);
    hsv[0] = hsv2[0];
    vec3 tmp = hsv_to_rgb(hsv);

    outcol = mix(outcol, tmp, t);
  }

  return outcol;
}
` } },
  saturation: { fn: 'node_mix_sat', chunk: { id: 'blend-saturation', requires: hsv, source: /* glsl */ `
vec3 node_mix_sat(float t, vec3 col1, vec3 col2)
{
  float tm = 1.0 - t;

  vec3 outcol = col1;

  vec3 hsv = rgb_to_hsv(outcol);

  if (hsv[1] != 0.0) {
    vec3 hsv2 = rgb_to_hsv(col2);

    hsv[1] = tm * hsv[1] + t * hsv2[1];
    outcol = hsv_to_rgb(hsv);
  }

  return outcol;
}
` } },
  value: { fn: 'node_mix_val', chunk: { id: 'blend-value', requires: hsv, source: /* glsl */ `
vec3 node_mix_val(float t, vec3 col1, vec3 col2)
{
  float tm = 1.0 - t;

  vec3 hsv = rgb_to_hsv(col1);
  vec3 hsv2 = rgb_to_hsv(col2);

  hsv[2] = tm * hsv[2] + t * hsv2[2];

  return hsv_to_rgb(hsv);
}
` } },
  color: { fn: 'node_mix_color', chunk: { id: 'blend-color', requires: hsv, source: /* glsl */ `
vec3 node_mix_color(float t, vec3 col1, vec3 col2)
{
  vec3 outcol = col1;
  vec3 hsv2 = rgb_to_hsv(col2);

  if (hsv2[1] != 0.0) {
    vec3 hsv = rgb_to_hsv(outcol);
    hsv[0] = hsv2[0];
    hsv[1] = hsv2[1];
    vec3 tmp = hsv_to_rgb(hsv);

    outcol = mix(outcol, tmp, t);
  }

  return outcol;
}
` } },
  softLight: { fn: 'node_mix_soft', chunk: { id: 'blend-soft-light', requires: [], source: /* glsl */ `
vec3 node_mix_soft(float t, vec3 col1, vec3 col2)
{
  float tm = 1.0 - t;

  vec3 one = vec3(1.0);
  vec3 scr = one - (one - col2) * (one - col1);

  return tm * col1 + t * ((one - col1) * col2 * col1 + col1 * scr);
}
` } },
  linearLight: { fn: 'node_mix_linear', chunk: { id: 'blend-linear-light', requires: [], source: /* glsl */ `
vec3 node_mix_linear(float t, vec3 col1, vec3 col2)
{
  vec3 outcol = col1;

  if (col2[0] > 0.5) {
    outcol[0] = col1[0] + t * (2.0 * (col2[0] - 0.5));
  }
  else {
    outcol[0] = col1[0] + t * (2.0 * (col2[0]) - 1.0);
  }

  if (col2[1] > 0.5) {
    outcol[1] = col1[1] + t * (2.0 * (col2[1] - 0.5));
  }
  else {
    outcol[1] = col1[1] + t * (2.0 * (col2[1]) - 1.0);
  }

  if (col2[2] > 0.5) {
    outcol[2] = col1[2] + t * (2.0 * (col2[2] - 0.5));
  }
  else {
    outcol[2] = col1[2] + t * (2.0 * (col2[2]) - 1.0);
  }

  return outcol;
}
` } },
}
