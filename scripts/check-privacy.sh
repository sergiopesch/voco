#!/usr/bin/env bash
# Measure VOCO's network and microphone claims end to end. The release build runs
# twice in a throwaway container, with every network call traced and every packet
# captured, and dictates one public clip each time:
#   offline  no network, update checks off: no process may reach the internet or DNS
#   online   a network, update checks on: only api.github.com may be resolved and
#            reached, and the speech worker reaches nothing
# In both, a microphone stream exists only while dictation runs.
#
# Usage: scripts/check-privacy.sh [--binary FILE] [--speech DIR] [--output DIR]
# Needs Linux with podman or docker, a release build (npm run build) and the
# pinned speech runtime (scripts/provision-ci-speech.sh). Exit 0 when both cases
# pass, 1 when a rule fails, 2 when the check can't run.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
BINARY=$ROOT/apps/desktop/src-tauri/target/release/voco
SPEECH=$ROOT/runtime/speech
OUTPUT=${TMPDIR:-/tmp}/voco-privacy-$(date -u +%Y%m%dT%H%M%SZ)
while [[ $# -gt 0 ]]; do
  case $1 in
    --binary) BINARY=$(realpath "$2"); shift 2 ;;
    --speech) SPEECH=$(realpath "$2"); shift 2 ;;
    --output) OUTPUT=$(realpath -m "$2"); shift 2 ;;
    *) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
  esac
done
# Ubuntu 26.04 from Docker's official images on ECR Public, pinned by digest.
BASE=public.ecr.aws/docker/library/ubuntu:26.04@sha256:f144425ff09be612d6d9ad965196e9cdc23dae1f42110a8a11a3e9a8198759f7
ENGINE=$(command -v podman || command -v docker || true)
fail() { echo "check-privacy: $*" >&2; exit 2; }
[[ -n $ENGINE ]] || fail "needs podman or docker"
[[ -x $BINARY ]] || fail "no VOCO build at $BINARY; run npm run build, or pass --binary"
[[ -f $SPEECH/models/nemotron-speech-streaming-en-0.6b.q8_0.gguf ]] \
  || fail "no speech runtime in $SPEECH; run scripts/provision-ci-speech.sh, or pass --speech"
HERE=$ROOT/scripts/privacy
IMAGE=localhost/voco-privacy:$( { cat "$HERE/Containerfile"; python3 "$ROOT/scripts/distro-dependencies.py" debian; } | sha256sum | cut -c1-12)
if ! "$ENGINE" image inspect "$IMAGE" > /dev/null 2>&1; then
  echo "Building $IMAGE"
  sed "s|^FROM UBUNTU_2604$|FROM $BASE|" "$HERE/Containerfile" \
    | "$ENGINE" build --build-arg PACKAGES="$(python3 "$ROOT/scripts/distro-dependencies.py" debian)" \
        -t "$IMAGE" -f - "$HERE" > /dev/null
fi
mkdir -p "$OUTPUT"
status=0
for case in offline online; do
  folder=$OUTPUT/$case
  # Never judge files an earlier run left.
  rm -rf "$folder"; mkdir -p "$folder"
  network=(--network none)
  if [[ $case == online ]]; then network=(); [[ $ENGINE == *podman ]] && network=(--network pasta); fi
  echo "Running the $case case (about three minutes)"
  # NET_RAW lets tcpdump capture inside the container; rootless, it stays in the
  # container's own user namespace.
  "$ENGINE" run --rm "${network[@]}" --cap-add NET_RAW --memory 6g --tmpfs /tmp --tmpfs /home/test:mode=700 \
    --tmpfs /run/xdg:mode=700 -v "$BINARY:/opt/voco:ro" -v "$SPEECH:/opt/speech:ro" \
    -v "$ROOT/tests/fixtures/speech:/fixtures:ro" -v "$HERE:/privacy:ro" -v "$folder:/ev" \
    "$IMAGE" bash /privacy/inner.sh "$case" > "$folder/run.log" 2>&1 || true
  if python3 "$HERE/analyze.py" "$case" "$folder" > "$folder/verdict.json"; then
    echo "  $case: PASS"
  else
    status=1
    echo "  $case: FAIL"
    python3 -c 'import json,sys; [print("   -", f) for f in json.load(open(sys.argv[1]))["failures"]]' "$folder/verdict.json"
  fi
done
echo "Evidence: $OUTPUT"
exit "$status"
