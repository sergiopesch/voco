#!/usr/bin/env bash
# Runs deepsec's AI review of VOCO from this workspace, with the model key the
# maintainer names and inside a spending limit.
#
#   DEEPSEC_ANTHROPIC_API_KEY=... .deepsec/review.sh
#       The pattern scan, then the AI review of the files in first-pass.txt,
#       five at a time, until DEEPSEC_BUDGET_USD (default 50) is spent.
#       Run it again to continue where it stopped.
#   .deepsec/review.sh deepsec <arguments>
#       Any deepsec command, in the same clean environment.
#
# deepsec's one-shot `init` needs a Vercel login even with a key of your own,
# and its `process` has no cost limit, so this script uses `process` on a list
# of files and adds the limit from the cost deepsec records for each file.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${here}"
key_name=DEEPSEC_ANTHROPIC_API_KEY
budget="${DEEPSEC_BUDGET_USD:-50}"
chunk=5

if [[ ! "${budget}" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
  echo "review: DEEPSEC_BUDGET_USD must be a number of US dollars" >&2
  exit 2
fi
if [[ ! -d node_modules/deepsec ]]; then
  npm ci --no-audit --no-fund
fi

# deepsec's agent is a Claude Code process of its own. Started from inside
# another Claude Code session it would inherit that session's model route and
# identity (ANTHROPIC_BASE_URL, CLAUDE_CODE_*) and use them in place of the key
# named here, so it gets only what it needs, and a home of its own in place of
# the machine's Claude login and settings.
mkdir -p .home
clean=(env -i "PATH=${PATH}" "HOME=${here}/.home" "TERM=${TERM:-dumb}"
  VERCEL_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1)
for name in HTTPS_PROXY HTTP_PROXY NO_PROXY https_proxy http_proxy no_proxy \
  SSL_CERT_FILE NODE_EXTRA_CA_CERTS "${key_name}"; do
  if [[ -n "${!name:-}" ]]; then
    clean+=("${name}=${!name}")
  fi
done
deepsec=("${clean[@]}" "${here}/node_modules/.bin/deepsec")

if [[ "${1:-}" == "deepsec" ]]; then
  shift
  exec "${deepsec[@]}" "$@"
fi
if (( $# > 0 )); then
  echo "review: run it with no arguments, or as: review.sh deepsec <arguments>" >&2
  exit 2
fi
if [[ -z "${!key_name:-}" ]]; then
  echo "review: set ${key_name} to an Anthropic API key" >&2
  exit 2
fi

# What deepsec has recorded as spent on this project, in US dollars.
spent() {
  python3 -I - "${here}/data/voco/files" <<'EOF'
import json
import pathlib
import sys

total = 0.0
for record in pathlib.Path(sys.argv[1]).rglob("*.json"):
    try:
        history = json.loads(record.read_text()).get("analysisHistory") or []
    except (OSError, ValueError):
        continue
    total += sum(float(entry.get("costUsd") or 0) for entry in history)
print(f"{total:.2f}")
EOF
}
within_budget() {
  python3 -I -c 'import sys; sys.exit(0 if float(sys.argv[1]) < float(sys.argv[2]) else 1)' "$1" "${budget}"
}

"${deepsec[@]}" scan --project-id voco

# Files of the first pass already reviewed are listed here, under the ignored
# run data, so a later run continues after them.
done_list="data/voco/runs/first-pass.done"
mkdir -p "$(dirname "${done_list}")"
touch "${done_list}"
mapfile -t pending < <(grep -vxFf "${done_list}" first-pass.txt | grep -v '^[[:space:]]*$' || true)

log="$(mktemp)"
trap 'rm -f "${log}"' EXIT
while (( ${#pending[@]} > 0 )); do
  now="$(spent)"
  if ! within_budget "${now}"; then
    echo "review: stopped at the limit: ${now} of ${budget} US dollars spent, ${#pending[@]} files left"
    exit 3
  fi
  batch=("${pending[@]:0:chunk}")
  pending=("${pending[@]:chunk}")
  echo "review: ${now} of ${budget} US dollars spent; reviewing ${batch[*]}"
  status=0
  printf '%s\n' "${batch[@]}" |
    "${deepsec[@]}" process --project-id voco --agent claude --no-ignore \
      --files-from - --batch-size "${chunk}" --concurrency 1 2>&1 | tee "${log}" || status=$?
  # In this mode deepsec also exits 1 when it has findings, so its own words
  # tell an agent that failed, as with a refused key, from a review that ran.
  if grep -q "batch(es) errored" "${log}"; then
    echo "review: deepsec's agent failed, so nothing more is sent; the files above stay to review" >&2
    exit 1
  fi
  if (( status > 1 )); then
    echo "review: deepsec exited ${status}" >&2
    exit "${status}"
  fi
  printf '%s\n' "${batch[@]}" >> "${done_list}"
done

echo "review: first pass complete, $(spent) US dollars spent"
echo "review: read the findings with: .deepsec/review.sh deepsec export --project-id voco --format md-dir --out ./findings"
