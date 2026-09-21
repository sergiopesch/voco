#!/usr/bin/env bash
# Sourced only by disposable desktop harnesses. Never write an owner profile.
voco_stage_test_speech() {
  local test_dir=$1
  local source_root
  source_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
  local speech=${VOCO_TEST_SPEECH_RUNTIME:-$source_root/runtime/speech}
  /usr/bin/python3 - "$speech" "$source_root/runtime/speech" <<'PY'
import hashlib,json,pathlib,sys
speech,expected=map(pathlib.Path,sys.argv[1:])
def digest(p):
    with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
identity=json.loads((expected/'MODEL-IDENTITY.json').read_text())
assert digest(speech/'models/nemotron-speech-streaming-en-0.6b.q8_0.gguf')==identity['model_sha256']
native=json.loads((expected/'NATIVE-BUILD.json').read_text())
for name,sha in native['files'].items():assert digest(speech/name)==sha,name
for name,target in native['symlinks'].items():
    p=speech/name
    assert p.is_symlink() and p.readlink()==pathlib.Path(target) and p.resolve().is_relative_to(speech.resolve()),name
PY
  cp -a --reflink=auto "$speech" "$test_dir/speech"
  export VOCO_STREAM_WORKER="$test_dir/speech/stream_worker.py"
  export VOCO_NEMOTRON_MODEL="$test_dir/speech/models/nemotron-speech-streaming-en-0.6b.q8_0.gguf"
}
