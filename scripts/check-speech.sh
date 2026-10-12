#!/usr/bin/env bash
# Measure recognition on the public speech fixtures through the real speech
# worker, with no microphone or desktop, and write the evidence to a new folder:
# the accuracy gate, word error rate and latency, unpaced and fed in real time,
# and My words in six conditions from tests/fixtures/mywords/benchmark.json.
#
#   scripts/check-speech.sh [--against REF] [--output DIR]
#
# --against REF also measures the speech worker of another commit or tag, such
# as voco.2026.0.62, with this checkout's harness and speech payload, and the
# summary sets the two side by side. Needs runtime/speech provisioned by
# scripts/provision-ci-speech.sh, Python 3 with psutil, and Node. Exit 0 when
# every run completed and the gate passed, 1 when a check failed, 2 when it
# couldn't run.
set -uo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
AGAINST="" OUT=""
while (($#)); do
  case $1 in
    --against) AGAINST=${2:?}; shift 2 ;;
    --output) OUT=${2:?}; shift 2 ;;
    *) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
  esac
done
fail() { echo "check-speech: $*" >&2; exit 2; }
RUNTIME=$ROOT/runtime/speech
[[ -f $RUNTIME/models/nemotron-speech-streaming-en-0.6b.q8_0.gguf && -d $RUNTIME/lib ]] \
  || fail "no speech payload in $RUNTIME; run scripts/provision-ci-speech.sh"
python3 -c 'import psutil' 2>/dev/null || fail "the evaluator needs Python's psutil"
command -v node >/dev/null || fail "needs Node"
OUT=${OUT:-${TMPDIR:-/tmp}/voco-speech-check-$(date -u +%Y%m%dT%H%M%SZ)}
[[ ! -e $OUT ]] || fail "$OUT exists; choose a new folder"
if ! { mkdir -p "$OUT/words" "$OUT/logs" && chmod 700 "$OUT"; }; then fail "can't create $OUT"; fi
OUT=$(cd "$OUT" && pwd)
cp "$ROOT/tests/fixtures/mywords/benchmark.json" "$OUT/words/benchmark.json"
python3 - "$OUT/words" <<'EOF' || fail "can't write the My words conditions"
import json, sys
from pathlib import Path
folder = Path(sys.argv[1])
fixture = json.loads((folder / "benchmark.json").read_text())
conditions = {
    "empty": {"words": []},
    "listed": {"words": fixture["listed"]},
    "distractors": {"words": fixture["distractors"]},
    "listed-unused-taught": {"words": fixture["listed"], "heard": fixture["unusedTaught"]},
    "listed-used-taught": {"words": fixture["listed"], "heard": fixture["usedTaught"]},
}
for name, start in conditions.items():
    (folder / f"{name}.json").write_text(json.dumps(start, ensure_ascii=False) + "\n")
EOF
export PYTHONDONTWRITEBYTECODE=1
status=0
step() {
  local name=$1; shift
  echo "check-speech: $name"
  "$@" > "$OUT/logs/$name.log" 2>&1 || { echo "check-speech: $name failed; see $OUT/logs/$name.log" >&2; status=1; return 1; }
}
# One worker's runs: unpaced, fed in real time, and each My words condition.
measure() {
  local label=$1 runtime=$2 run words
  for run in unpaced paced words-empty words-listed words-distractors words-listed-unused-taught words-listed-used-taught; do
    local options=(--runtime "$runtime" --split all --threads 4 --output "$OUT/$label/$run")
    [[ $run != paced ]] || options+=(--paced)
    words=${run#words-}
    [[ $run != words-* ]] || options+=(--words "$OUT/words/$words.json")
    step "$label-$run" python3 "$ROOT/scripts/evaluate-dictation-worker.py" "${options[@]}" \
      && step "$label-$run-score" node "$ROOT/scripts/score-dictation-worker.mjs" "$OUT/$label/$run/run.json" "$OUT/$label/$run/score.json"
  done
}
mkdir -p "$OUT/this"
printf '{"label":"this","commit":"%s"}\n' "$(git -C "$ROOT" rev-parse HEAD)" > "$OUT/this/target.json"
step baseline node "$ROOT/scripts/test-speech-baseline.mjs" --report "$OUT/baseline.json"
measure this "$RUNTIME"
if [[ -n $AGAINST ]]; then
  commit=$(git -C "$ROOT" rev-parse --verify --quiet "$AGAINST^{commit}") || fail "unknown commit or tag: $AGAINST"
  worktree=$OUT/.against
  trap 'git -C "$ROOT" worktree remove --force "$worktree" >/dev/null 2>&1; rm -rf "$worktree"' EXIT
  git -C "$ROOT" worktree add --quiet --detach "$worktree" "$commit" || fail "can't check out $AGAINST"
  # The other commit's worker with this checkout's payload, which must be the one it pins.
  for identity in MODEL-IDENTITY.json NATIVE-BUILD.json; do
    cmp -s "$RUNTIME/$identity" "$worktree/runtime/speech/$identity" \
      || fail "$AGAINST pins another speech payload ($identity); measure it from a checkout of $AGAINST"
  done
  for payload in models lib libbench_nemo_pool.so; do
    cp -al "$RUNTIME/$payload" "$worktree/runtime/speech/" 2>/dev/null || cp -a "$RUNTIME/$payload" "$worktree/runtime/speech/" \
      || fail "can't copy the speech payload for $AGAINST"
  done
  mkdir -p "$OUT/against"
  printf '{"label":"against","ref":"%s","commit":"%s"}\n' "$AGAINST" "$commit" > "$OUT/against/target.json"
  measure against "$worktree/runtime/speech"
fi
step summary node "$ROOT/scripts/speech-check-summary.mjs" "$OUT" && cat "$OUT/summary.md"
# The gate's own verdict, which a crashed baseline never writes.
if ! grep -q '"passed": true' "$OUT/baseline.json" 2>/dev/null; then status=1; fi
echo "check-speech: evidence in $OUT"
exit "$status"
