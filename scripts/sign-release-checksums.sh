#!/usr/bin/env bash
# Detach-sign checksum files for a VOCO release. Run on the signing laptop only.
# Does not upload, retag, or store the passphrase.
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 CHECKSUMS_FILE [CHECKSUMS_FILE...]" >&2
  exit 1
fi

if ! command -v gpg >/dev/null 2>&1; then
  echo "gpg is required" >&2
  exit 1
fi

key="${GPG_KEY_FINGERPRINT:-$(git config --get user.signingkey || true)}"
if [[ -z "$key" ]]; then
  echo "Set user.signingkey or GPG_KEY_FINGERPRINT. Run scripts/setup-release-signing.sh first." >&2
  exit 1
fi

for checksums in "$@"; do
  [[ -f "$checksums" ]] || { echo "Missing $checksums" >&2; exit 1; }
  base="$(basename -- "$checksums")"
  case "$base" in
    *checksums.txt|SHA256SUMS) ;;
    *)
      echo "Refusing to sign unexpected filename: $base" >&2
      exit 1
      ;;
  esac
  out="$checksums.asc"
  if [[ -e "$out" ]]; then
    echo "Refusing to overwrite $out" >&2
    exit 1
  fi
  gpg --batch --yes --detach-sign --armor --local-user "$key" --output "$out" "$checksums"
  echo "Wrote $out"
done
