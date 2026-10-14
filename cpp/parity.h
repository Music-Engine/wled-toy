#pragma once
#include <cstdio>
#include "wledtoy.h"

// One op compiled via the usermod target on stored inputs, beside its op table's `js` result
struct ParityCase {
  const char* inputs;
  // Run before the pixel pass; null w/o one
  void (*frame)();
  void (*pixel)(wledtoy::vec4&, wledtoy::vec2, float);
  int dim;
  double want[3];
};

struct ParityOp {
  const char* name;
  const ParityCase* cases;
  int count;
};

inline bool parityMatches(double got, double want) {
  double diff = got - want;
  return (diff < 0.0 ? -diff : diff) <= 1e-5;
}

inline int countParityFailures(const ParityOp& op) {
  int failed = 0;
  for (int i = 0; i < op.count; i++) {
    const ParityCase& test = op.cases[i];
    wledtoy::vec4 c(0.0f, 0.0f, 0.0f, 1.0f);
    if (test.frame) test.frame();
    test.pixel(c, wledtoy::vec2(0.5f, 0.5f), 0.0f);
    for (int k = 0; k < test.dim; k++) {
      if (parityMatches(c[k], test.want[k])) continue;
      std::printf("  %s (%s) component %d: C++ %.9g, JavaScript %.9g\n", op.name, test.inputs, k, double(c[k]), test.want[k]);
      failed++;
    }
  }
  return failed;
}

// One line per op; exits 1 on any mismatch, so CI judges by the binary alone
inline int runParity(const ParityOp* ops, int count) {
  int failures = 0;
  for (int i = 0; i < count; i++) {
    int failed = countParityFailures(ops[i]);
    std::printf("%s %s %d\n", failed ? "FAIL" : "ok", ops[i].name, ops[i].count);
    failures += failed;
  }
  return failures ? 1 : 0;
}
