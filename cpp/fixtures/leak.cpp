#include "../wledtoy.h"

namespace wledtoy {

// Declared so texture() is the one name any compiler misses
struct sampler2D {};
sampler2D iImage;

// Texture-sampling body; CI expects the build to fail, so a body cppParity missed never builds
void mainImage(vec4& c, vec2 uv, float ledIndex) {
  c = vec4(0.0, 0.0, 0.0, 1.0);
  vec4 n_n = texture(iImage, uv);
  c = vec4(n_n.xyz, 1.0);
}

}  // namespace wledtoy
