#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${ROOT_DIR}/apps/desktop"
FEATURES="custom-protocol"
case "${1:-}" in
  "") ;;
  --native-capture-dev) FEATURES+=" native-capture-dev" ;;
  *) echo "Usage: $0 [--native-capture-dev]" >&2; exit 2 ;;
esac
if (( $# > 1 )); then
  echo "Usage: $0 [--native-capture-dev]" >&2
  exit 2
fi
# The browser host links the application library, whose Tauri context embeds
# frontend assets even before the later bundle command runs. Support clean trees.
npm --prefix "${APP_DIR}" run build:frontend
BUILD_STATE="$(mktemp -d)"
trap 'rm -rf "${BUILD_STATE}"' EXIT

# Cargo reports the actual executable location, including custom target dirs and
# configured target triples. Never package a guessed or stale host path.
cargo build --manifest-path "${APP_DIR}/src-tauri/Cargo.toml" --locked --release \
  --features "${FEATURES}" --bin voco-browser-host --message-format=json-render-diagnostics \
  >"${BUILD_STATE}/host-artifacts.jsonl"
python3 - "${BUILD_STATE}" "${APP_DIR}/src-tauri/tauri.conf.json" "${FEATURES}" <<'PY'
import json, os, pathlib, sys
state = pathlib.Path(sys.argv[1])
executables = []
for line in (state / 'host-artifacts.jsonl').read_text().splitlines():
    artifact = json.loads(line)
    if artifact.get('reason') == 'compiler-artifact' and artifact.get('target', {}).get('name') == 'voco-browser-host' and artifact.get('executable'):
        executables.append(artifact['executable'])
if len(executables) != 1 or not os.access(executables[0], os.X_OK):
    raise SystemExit('Cargo did not produce one executable native browser host')
config = {'bundle': {'linux': {'deb': {'files': {'/usr/libexec/voco-browser-host': executables[0]}}}}}
if 'native-capture-dev' in sys.argv[3].split():
    declared = json.loads(pathlib.Path(sys.argv[2]).read_text())['bundle']['linux']['deb']['depends']
    config['bundle']['linux']['deb']['depends'] = list(dict.fromkeys([*declared, 'libpulse0']))
(state / 'browser-host-bundle.json').write_text(json.dumps(config))
PY

cd "${APP_DIR}"
cargo tauri build --features "${FEATURES}" --bundles deb \
  --config "${BUILD_STATE}/browser-host-bundle.json" -- --locked
