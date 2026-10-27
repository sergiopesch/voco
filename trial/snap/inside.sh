#!/bin/bash
# Trial only: runs inside VOCO's confinement with `snap run --shell voco` and
# reports what the app, the helpers and the worker's Python find there.
set -u
section() { printf '\n== %s\n' "$*"; }

section "environment"
env | sort | grep -E '^(SNAP_NAME|SNAP_REVISION|SNAP_USER_DATA|SNAP_USER_COMMON|HOME|LD_LIBRARY_PATH|PATH|VOCO_STREAM_[A-Z]+|XDG_[A-Z_]+)=' || true

section "helpers"
for program in xclip xdotool notify-send; do
  printf '%s -> %s\n' "${program}" "$(command -v "${program}")"
done
xclip -version 2>&1 | head -1
xdotool version 2>&1 | head -1
notify-send --version 2>&1 | head -1

section "the app's libraries"
missing="$(ldd "${SNAP}/usr/bin/voco" | grep 'not found' || true)"
printf 'resolved: %s\n' "$(ldd "${SNAP}/usr/bin/voco" | grep -c '=> /')"
printf 'missing: %s\n' "${missing:-none}"
for library in libwebkit2gtk-4.1.so.0 libgtk-3.so.0 libpulse.so.0 libayatana-appindicator3.so.1; do
  printf '%s -> %s\n' "${library}" "$(ldd "${SNAP}/usr/bin/voco" | awk -v name="${library}" '$1 == name { print $3 }')"
done

section "the worker's Python"
"${VOCO_STREAM_PYTHON}" -E -s -B -c '
import ctypes, json, sys
import numpy
ctypes.CDLL(sys.argv[1])
print(json.dumps({"executable": sys.executable, "prefix": sys.prefix, "numpy": numpy.__version__,
                  "path": sys.path}))' "${SNAP}/usr/lib/voco/speech/libbench_nemo_pool.so"

section "check commands"
voco --check-desktop-input; printf 'exit %s\n' "$?"
voco --check-panel; printf 'exit %s\n' "$?"
[[ -z "${missing}" ]]
