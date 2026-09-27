// The environment a WLEDtoy pixel body runs in, as C++: GLSL's vector types, the built-in functions the bodies and
// chunks call, and the prelude's uniforms and helpers that a WLED usermod on ESP32 can supply. Anything that samples a
// texture or takes a derivative is left out on purpose, so a body using one without ctx.require('glsl') fails to compile.
// No exceptions, RTTI, allocation or iostream.
#pragma once

#include "vecmath.h"
#include "runtime.h"
#include "prelude.h"
