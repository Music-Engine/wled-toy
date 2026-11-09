#pragma once

#include "vecmath.h"
#include "runtime.h"
#include "prelude.h"

// No texture sampling or derivatives on purpose: a body cppParity missed fails to build. No exceptions, RTTI,
// allocation or iostream
