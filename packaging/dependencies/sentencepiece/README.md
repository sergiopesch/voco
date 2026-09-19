# SentencePiece companion recipes

VOCO's pinned recognizer already depends on SentencePiece. Fedora and Debian
provide a native shared-library package. The reviewed Arch and openSUSE recipes
here build the existing dependency where the target repositories lack it.

Upstream commit: `31646a467d2051eb904e0b45de3a73e91fe1c1e3` (0.2.1).
Source archive SHA-256:
`b4eb17e6bea5c9380ddd79d04d01d6aa5e280be8f3e3cef1f745a80e6d9451ce`.

Build with the distribution's native tooling in a disposable environment. Preserve
source packages, the Apache-2.0 license, compiler identity, full test output and
artifact hashes. Never execute arbitrary AUR recipes. Before publication, check
upstream security changes and qualify the exact dependency with VOCO's pinned
runtime. These recipes are development candidates, not a published repository.

The CMake test option is **SPM_BUILD_TEST**. `SPM_ENABLE_TEST` does not enable
upstream tests. Both recipes use `ctest --no-tests=error` so an empty suite cannot
silently pass. The openSUSE RPM contains only the processor shared library and its
license; the Arch recipe retains the upstream installation layout.
