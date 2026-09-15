/* Run before loading NeMo: shared-library constructors may use SIMD already.
 * GCC's x86 CPU detection checks OS support for saving AVX register state too.
 * Compile this standalone program for baseline x86-64, never -march=native.
 */
#include <stdio.h>

int main(void) {
#if defined(__x86_64__) && defined(__GNUC__)
    __builtin_cpu_init();
    if (__builtin_cpu_supports("sse4.2") && __builtin_cpu_supports("avx") &&
        __builtin_cpu_supports("avx2") && __builtin_cpu_supports("fma") &&
        __builtin_cpu_supports("f16c") && __builtin_cpu_supports("bmi2")) {
        return 0;
    }
#endif
    fputs("VOCO requires an x86-64 CPU and OS with AVX2, AVX, FMA, F16C, BMI2 "
          "and SSE4.2 support.\n", stderr);
    return 1;
}
