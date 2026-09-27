import type { GlslChunk } from '@/lib/graph/authoring'

/* SPDX-FileCopyrightText: 2011-2022 Blender Foundation
 *
 * SPDX-License-Identifier: Apache-2.0 */

/** sRGB to scene-linear (Blender node_color.h). */
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
