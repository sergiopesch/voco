#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${ROOT_DIR}/apps/desktop"
if (( $# > 0 )); then
  echo "Usage: $0" >&2
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
  --features custom-protocol,update-helper --bin voco-browser-host --bin voco-update-helper \
  --message-format=json-render-diagnostics >"${BUILD_STATE}/host-artifacts.jsonl"
python3 - "${BUILD_STATE}" <<'PY'
import json, os, pathlib, sys
state = pathlib.Path(sys.argv[1])
# Each helper goes to /usr/libexec only, from the path Cargo reports.
helpers = {'voco-browser-host': [], 'voco-update-helper': []}
for line in (state / 'host-artifacts.jsonl').read_text().splitlines():
    artifact = json.loads(line)
    name = artifact.get('target', {}).get('name')
    if artifact.get('reason') == 'compiler-artifact' and name in helpers and artifact.get('executable'):
        helpers[name].append(artifact['executable'])
files = {}
for name, executables in helpers.items():
    if len(executables) != 1 or not os.access(executables[0], os.X_OK):
        raise SystemExit(f'Cargo did not produce one executable {name}')
    files[f'/usr/libexec/{name}'] = executables[0]
config = {'bundle': {'linux': {'deb': {'files': files}}}}
(state / 'browser-host-bundle.json').write_text(json.dumps(config))
PY

cd "${APP_DIR}"
cargo tauri build --features custom-protocol --bundles deb \
  --config "${BUILD_STATE}/browser-host-bundle.json" -- --locked
