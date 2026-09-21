import type { GlslChunk } from './chunk'

/* SPDX-FileCopyrightText: 2011-2022 Blender Foundation
 *
 * SPDX-License-Identifier: Apache-2.0 */

/**
 * sRGB to scene-linear (Blender node_color.h). Consumed directly by nodes/texture/image-texture.ts for a
 * texture whose color space is sRGB, so this binding stays `colorChunk`.
 */
export const colorChunk: GlslChunk = {
  id: 'color-srgb-to-linear',
  requires: [],
  source: /* glsl */ `
float color_srgb_to_scene_linear(float c)
{
  if (c < 0.04045) {
    return (c < 0.0) ? 0.0 : c * (1.0 / 12.92);
  }
  else {
    return pow((c + 0.055) * (1.0 / 1.055), 2.4);
  }
}

vec3 color_srgb_to_scene_linear(vec3 c)
{
  return vec3(color_srgb_to_scene_linear(c[0]),
               color_srgb_to_scene_linear(c[1]),
               color_srgb_to_scene_linear(c[2]));
}
`,
}

/** RGB to HSV (Blender node_color.h). */
export const rgbToHsvChunk: GlslChunk = {
  id: 'color-rgb-to-hsv',
  requires: [],
  source: /* glsl */ `
vec3 rgb_to_hsv(vec3 rgb)
{
  float cmax, cmin, h, s, v, cdelta;
  vec3 c;

  cmax = max(rgb[0], max(rgb[1], rgb[2]));
  cmin = min(rgb[0], min(rgb[1], rgb[2]));
  cdelta = cmax - cmin;

  v = cmax;

  if (cmax != 0.0) {
    s = cdelta / cmax;
  }
  else {
    s = 0.0;
    h = 0.0;
  }

  if (s == 0.0) {
    h = 0.0;
  }
  else {
    c = (vec3(cmax, cmax, cmax) - rgb) / cdelta;

    if (rgb[0] == cmax) {
      h = c[2] - c[1];
    }
    else if (rgb[1] == cmax) {
      h = 2.0 + c[0] - c[2];
    }
    else {
      h = 4.0 + c[1] - c[0];
    }

    h /= 6.0;

    if (h < 0.0) {
      h += 1.0;
    }
  }

  return vec3(h, s, v);
}
`,
}

/** HSV to RGB (Blender node_color.h). */
export const hsvToRgbChunk: GlslChunk = {
  id: 'color-hsv-to-rgb',
  requires: [],
  source: /* glsl */ `
vec3 hsv_to_rgb(vec3 hsv)
{
  float i, f, p, q, t, h, s, v;
  vec3 rgb;

  // Blender only folds h == 1.0 back to 0; hue is a circle, so anything outside 0..1 wraps
  h = fract(hsv[0]);
  s = hsv[1];
  v = hsv[2];

  if (s == 0.0) {
    rgb = vec3(v, v, v);
  }
  else {
    h *= 6.0;
    i = floor(h);
    f = h - i;
    rgb = vec3(f, f, f);
    p = v * (1.0 - s);
    q = v * (1.0 - (s * f));
    t = v * (1.0 - (s * (1.0 - f)));

    if (i == 0.0) {
      rgb = vec3(v, t, p);
    }
    else if (i == 1.0) {
      rgb = vec3(q, v, p);
    }
    else if (i == 2.0) {
      rgb = vec3(p, v, t);
    }
    else if (i == 3.0) {
      rgb = vec3(p, q, v);
    }
    else if (i == 4.0) {
      rgb = vec3(t, p, v);
    }
    else {
      rgb = vec3(v, p, q);
    }
  }

  return rgb;
}
`,
}

/** RGB to HSL (Blender node_color.h). */
export const rgbToHslChunk: GlslChunk = {
  id: 'color-rgb-to-hsl',
  requires: [],
  source: /* glsl */ `
vec3 rgb_to_hsl(vec3 rgb)
{
  float cmax, cmin, h, s, l;

  cmax = max(rgb[0], max(rgb[1], rgb[2]));
  cmin = min(rgb[0], min(rgb[1], rgb[2]));
  l = min(1.0, (cmax + cmin) / 2.0);

  if (cmax == cmin) {
    h = s = 0.0; /* achromatic */
  }
  else {
    float cdelta = cmax - cmin;
    s = l > 0.5 ? cdelta / (2.0 - cmax - cmin) : cdelta / (cmax + cmin);
    if (cmax == rgb[0]) {
      h = (rgb[1] - rgb[2]) / cdelta + (rgb[1] < rgb[2] ? 6.0 : 0.0);
    }
    else if (cmax == rgb[1]) {
      h = (rgb[2] - rgb[0]) / cdelta + 2.0;
    }
    else {
      h = (rgb[0] - rgb[1]) / cdelta + 4.0;
    }
  }
  h /= 6.0;

  return vec3(h, s, l);
}
`,
}

/** HSL to RGB (Blender node_color.h). */
export const hslToRgbChunk: GlslChunk = {
  id: 'color-hsl-to-rgb',
  requires: [],
  source: /* glsl */ `
vec3 hsl_to_rgb(vec3 hsl)
{
  float nr, ng, nb, chroma, h, s, l;

  h = fract(hsl[0]);
  s = hsl[1];
  l = hsl[2];

  nr = abs(h * 6.0 - 3.0) - 1.0;
  ng = 2.0 - abs(h * 6.0 - 2.0);
  nb = 2.0 - abs(h * 6.0 - 4.0);

  nr = clamp(nr, 0.0, 1.0);
  nb = clamp(nb, 0.0, 1.0);
  ng = clamp(ng, 0.0, 1.0);

  chroma = (1.0 - abs(2.0 * l - 1.0)) * s;

  return vec3((nr - 0.5) * chroma + l, (ng - 0.5) * chroma + l, (nb - 0.5) * chroma + l);
}
`,
}
