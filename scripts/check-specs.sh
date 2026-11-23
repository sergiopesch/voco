#!/usr/bin/env bash
# Model-checks the TLA+ specifications in specs/tla with TLC: every .cfg there
# names a model of the module it is called after (Module.cfg, Module.name.cfg).
#
# TLC is not part of this repository. Point VOCO_TLA_TOOLS at a tla2tools.jar
# from https://github.com/tlaplus/tlaplus/releases and run with Java 11 or later:
#
#   VOCO_TLA_TOOLS=~/tla2tools.jar scripts/check-specs.sh [Module ...]
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tools="${VOCO_TLA_TOOLS:-}"
if [[ -z "${tools}" || ! -f "${tools}" ]]; then
  echo "check-specs: set VOCO_TLA_TOOLS to a tla2tools.jar" >&2
  exit 2
fi
if ! command -v java >/dev/null 2>&1; then
  echo "check-specs: java is not installed" >&2
  exit 2
fi
tools="$(realpath -- "${tools}")"

# TLC writes its states and any trace beside the model, so each run gets a
# copy of the specifications in a folder of its own.
work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

failed=0
checked=0
for config in "${root}"/specs/tla/*.cfg; do
  name="$(basename "${config}" .cfg)"
  module="${name%%.*}"
  if (( $# > 0 )) && [[ " $* " != *" ${module} "* ]]; then
    continue
  fi
  run="${work}/${name}"
  mkdir "${run}"
  cp "${root}"/specs/tla/*.tla "${run}/"
  cp "${config}" "${run}/model.cfg"
  checked=$((checked + 1))
  # The models are bounded, so their last states have no successor: -deadlock
  # turns that check off. Properties with fairness are checked as written.
  if (cd "${run}" && java -XX:+UseParallelGC -cp "${tools}" tlc2.TLC \
      -deadlock -workers auto -config model.cfg "${module}.tla") >"${run}/tlc.log" 2>&1 &&
    grep -q "Model checking completed. No error has been found." "${run}/tlc.log"; then
    states="$(grep -Eo '[0-9]+ distinct states found' "${run}/tlc.log" | tail -n 1)"
    echo "ok    ${name}: ${states}"
  else
    failed=$((failed + 1))
    echo "FAIL  ${name}"
    grep -Ev '^(Picked up|Parsing file|Semantic processing|Linting of)' "${run}/tlc.log" | sed 's/^/      /'
  fi
done

if (( checked == 0 )); then
  echo "check-specs: no model matches $*" >&2
  exit 2
fi
if (( failed > 0 )); then
  echo "check-specs: ${failed} of ${checked} models failed" >&2
  exit 1
fi
echo "check-specs: ${checked} models checked"
