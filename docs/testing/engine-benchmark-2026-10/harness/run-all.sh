#!/usr/bin/env bash
# TEST ONLY: run the benchmark configurations one at a time (clean timing), then score.
#
#   run-all.sh [CONFIG...]   default: the full plan below
#
# Results: /opt/bench/results/<config>.jsonl, <config>.log, summary.json, summary.txt.
set -uo pipefail
B=/opt/bench
PY=$B/venv/bin/python
R=$B/results
PLAN=(parakeet-offline nemo-en-r1 nemo-en-r0 nemo-en-r6 nemo-en-r13 nemo35-r1 nemo35-r3 nemo35-r6
      parakeet-win-10-2-2 whisper-la2 whisper-offline nemo-en-r1-paced)
configs=("${@:-${PLAN[@]}}")
for config in "${configs[@]}"; do
  engine=$config extra=()
  case $config in
    whisper-la2) extra=(--every "${WHISPER_EVERY:-50}") ;;  # ~11 s per decode on 4 threads: a sample shows it
    *-paced) engine=${config%-paced} extra=(--paced --every 5) ;;  # checks score.py's replay
  esac
  echo "$(date -u +%FT%TZ) start $config" | tee -a "$R/run-all.log"
  NEMO_SPEECH_CPU_THREADS=4 "$PY" "$B/tools/run.py" "$engine" --corpus "$B/corpus" --out "$R/$config.jsonl" \
    --threads 4 "${extra[@]}" > "$R/$config.log" 2>&1
  echo "$(date -u +%FT%TZ) done $config exit=$?" | tee -a "$R/run-all.log"
done
runs=()
for file in "$R"/*.jsonl; do
  [[ $file == *paced* ]] && continue
  grep -q '"footer"' "$file" && runs+=("$file")
done
"$PY" "$B/tools/score.py" --corpus "$B/corpus" --align "$R/parakeet-offline.jsonl" --out "$R/summary.json" \
  "${runs[@]}" | tee "$R/summary.txt"
