#!/usr/bin/env bash
# The same pinned model and prospectively selected audio run through the real Rust worker.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"
if [[ $# != 2 || $1 != --output-dir ]]; then
  echo "Usage: $0 --output-dir /path/to/new/evidence-directory" >&2
  exit 2
fi
: "${VOCO_MODEL_PATH:?Set the existing pinned ggml-base.en.bin path}"
output=$(realpath -m "$2")
if [[ -e $output ]]; then
  echo "Evidence directory exists; choose a new directory to preserve previous results" >&2
  exit 2
fi
mkdir -p "$output"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/apps/desktop/src-tauri/target}"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}"
snapshot_sources() {
  python3 - "$ROOT" <<'PY'
import hashlib
import json
from pathlib import Path
import sys

root = Path(sys.argv[1])
crate = root / 'apps/desktop/src-tauri'
inputs = [crate / name for name in ('Cargo.toml', 'Cargo.lock', 'build.rs', 'tauri.conf.json')]
for directory in (crate / 'src', crate / 'examples', crate / 'vendor', root / 'vendor'):
    if directory.exists():
        inputs.extend(path for path in directory.rglob('*') if path.is_file())
print(json.dumps({str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
                  for path in sorted(set(inputs))}, indent=2, sort_keys=True))
PY
}
snapshot_sources >"$output/source-inputs-before.json"
python3 vendor/verify.py >"$output/vendor-verification.json"
cargo build --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --example preview_replay_worker >"$output/build.log" 2>&1
snapshot_sources >"$output/source-inputs.json"
if ! cmp -s "$output/source-inputs-before.json" "$output/source-inputs.json"; then
  echo "Worker inputs changed during the build; preserve evidence and rerun from stable sources" >&2
  exit 1
fi
cp "$CARGO_TARGET_DIR/debug/examples/preview_replay_worker" "$output/worker"
cp apps/desktop/src-tauri/src/transcribe.rs "$output/transcribe.rs"
python3 scripts/test-speech-adversarial.py prepare --plan-dir "$output/adversarial-plan" >"$output/prepare-adversarial.log" 2>&1
python3 scripts/prepare-speech-boundaries.py --plan-dir "$output/boundary-plan" >"$output/prepare-boundary.log" 2>&1
python3 scripts/prepare-speech-mixed-levels.py --plan-dir "$output/mixed-plan" >"$output/prepare-mixed.log" 2>&1
python3 scripts/prepare-speech-repetition-generalization.py --plan-dir "$output/repetition-plan" >"$output/prepare-repetition.log" 2>&1
failed=0
for suite in adversarial boundary mixed repetition; do
  if python3 scripts/test-speech-adversarial.py evaluate \
      --plan-dir "$output/$suite-plan" --output-dir "$output/$suite" \
      --worker "$output/worker" --worker-source "$output/transcribe.rs" \
      >"$output/$suite.log" 2>&1; then
    printf '%s: PASS\n' "$suite"
  else
    printf '%s: FAIL (see %s)\n' "$suite" "$output/$suite/report.json" >&2
    failed=1
  fi
done
exit "$failed"
