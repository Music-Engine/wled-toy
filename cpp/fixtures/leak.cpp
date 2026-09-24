// A pixel body that samples a texture without ctx.require('glsl'), as the GLSL backend would emit it. CI expects this
// unit to fail: wledtoy.h has no texture(), so a body that leaks one cannot reach a C++ build.
#include "../wledtoy.h"

namespace wledtoy {

// declared here so that texture() is the one name the compiler cannot find, whichever compiler reports first
struct sampler2D {};
sampler2D iImage;

void mainImage(vec4& c, vec2 uv, float ledIndex) {
  c = vec4(0.0, 0.0, 0.0, 1.0);
  vec4 n_n = texture(iImage, uv);
  c = vec4(n_n.xyz, 1.0);
}

}  // namespace wledtoy
