#!/usr/bin/env bash
set -euo pipefail

# Reuse the exact released native payload; keep worker Python from this checkout.
# The checksum is fixed here, never obtained from a mutable latest-release URL.
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
state="$(mktemp -d)"
trap 'rm -rf "$state"' EXIT
curl --fail --location --retry 3 --max-time 600 \
  https://github.com/sergiopesch/voco/releases/download/voco.2026.0.47/voco_2026.0.47_amd64.deb \
  --output "$state/runtime.deb"
echo "7164521ff55c59fc00310db5bea051cdfad020371e52abcbf202c15eb8d34743  $state/runtime.deb" | sha256sum --check --strict
dpkg-deb --extract "$state/runtime.deb" "$state/package"
python3 "$root/scripts/verify-speech-payload.py" "$state/package" 2026.0.47
payload="$state/package/usr/lib/voco/speech"
cmp "$root/runtime/speech/MODEL-IDENTITY.json" "$payload/MODEL-IDENTITY.json"
cmp "$root/runtime/speech/NATIVE-BUILD.json" "$payload/NATIVE-BUILD.json"
cp -a "$payload/models" "$payload/lib" "$payload/libbench_nemo_pool.so" "$root/runtime/speech/"
