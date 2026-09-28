#!/usr/bin/env bash
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "Usage: $0 SCRIPT..." >&2
  exit 2
fi

# bash -n accepts one script; further arguments become that script's arguments.
for script in "$@"; do
  bash -n -- "$script"
done
