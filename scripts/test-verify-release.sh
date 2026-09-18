#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERIFY="$ROOT/scripts/verify-release.sh"
SIGN="$ROOT/scripts/sign-release-checksums.sh"
SETUP="$ROOT/scripts/setup-release-signing.sh"
workdir="$(mktemp -d "${TMPDIR:-/tmp}/voco-verify-test.XXXXXX")"
trap 'rm -rf -- "$workdir"' EXIT

echo payload > "$workdir/voco_latest_amd64.deb"
(cd "$workdir" && sha256sum voco_latest_amd64.deb > voco_latest_checksums.txt)

set +e
"$VERIFY" "$workdir/voco_latest_checksums.txt" >/dev/null 2>&1
status=$?
set -e
if [[ "$status" -ne 2 ]]; then
  echo "unsigned checksums should exit 2, got $status" >&2
  exit 1
fi

printf '%s\n' "0000000000000000000000000000000000000000000000000000000000000000  ../../etc/passwd" \
  > "$workdir/bad.txt"
set +e
"$VERIFY" "$workdir/bad.txt" >/dev/null 2>&1
status=$?
set -e
if [[ "$status" -ne 1 ]]; then
  echo "path traversal checksums should exit 1, got $status" >&2
  exit 1
fi

bash -n "$VERIFY" "$SIGN" "$SETUP"
echo "verify-release tests passed"
