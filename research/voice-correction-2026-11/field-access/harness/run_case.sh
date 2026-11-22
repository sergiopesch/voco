#!/bin/bash
# All scenarios of one case:  ./run_case.sh <case> [config] [scenario ...]
HERE="$(cd "$(dirname "$0")" && pwd)"
CASE="$1"; CONFIG="${2:-plain}"; shift; shift 2>/dev/null
SCENARIOS=("$@")
[ ${#SCENARIOS[@]} -eq 0 ] && SCENARIOS=(probe atspi atspi_settext atspi_selpaste blind hazard_atspi hazard_blind)
for s in "${SCENARIOS[@]}"; do
  "$HERE/run.sh" "$CASE" "$s" --config "$CONFIG" >"$HERE/work/last.$CASE.$s.log" 2>&1
  echo "$CASE $s $CONFIG -> exit $?"
done
