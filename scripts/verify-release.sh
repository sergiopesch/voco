#!/usr/bin/env bash
# Verify a VOCO release directory: checksum integrity, then optional publisher
# signature against KEYS from this repository. No network. Exit codes:
#   0 signed and verified
#   1 integrity failure or unsafe checksum path
#   2 checksums match but no usable publisher signature (unsigned cut)
set -euo pipefail

usage() {
  echo "Usage: $0 [--keys KEYS] CHECKSUMS_FILE" >&2
  exit 1
}

KEYS=""
CHECKSUMS=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --keys)
      [[ $# -ge 2 ]] || usage
      KEYS="$2"
      shift 2
      ;;
    -h|--help)
      usage
      ;;
    *)
      [[ -z "$CHECKSUMS" ]] || usage
      CHECKSUMS="$1"
      shift
      ;;
  esac
done
[[ -n "$CHECKSUMS" ]] || usage
[[ -f "$CHECKSUMS" ]] || { echo "Missing checksums file: $CHECKSUMS" >&2; exit 1; }

if [[ -z "$KEYS" ]]; then
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  if [[ -f "$ROOT/KEYS" ]]; then
    KEYS="$ROOT/KEYS"
  fi
fi

dir="$(cd "$(dirname -- "$CHECKSUMS")" && pwd)"
file="$(basename -- "$CHECKSUMS")"

while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" || "$line" =~ ^# ]] && continue
  # GNU coreutils: "HASH  NAME" or "HASH *NAME"
  name="${line#* }"
  name="${name# }"
  name="${name#\*}"
  case "$name" in
    ""|*/*|..|.)
      echo "Refusing checksum entry that is not a single basename: $name" >&2
      exit 1
      ;;
  esac
done < "$CHECKSUMS"

echo "Checking file integrity with $file"
(cd "$dir" && sha256sum -c --strict "$file")

sig=""
if [[ -f "$dir/$file.asc" ]]; then
  sig="$dir/$file.asc"
elif [[ -f "$dir/$file.sig" ]]; then
  sig="$dir/$file.sig"
fi

if [[ -z "$sig" ]]; then
  echo "Checksums matched. No $file.asc signature; this cut is unsigned." >&2
  echo "Integrity is not publisher identity." >&2
  exit 2
fi

if [[ -z "$KEYS" || ! -f "$KEYS" ]]; then
  echo "Signature file present but KEYS is missing. Cannot prove publisher identity." >&2
  exit 2
fi

if grep -q "BEGIN PGP PRIVATE KEY" "$KEYS"; then
  echo "KEYS contains a private key block; refusing to import it." >&2
  exit 1
fi

if ! command -v gpg >/dev/null 2>&1; then
  echo "gpg is required to verify $sig" >&2
  exit 1
fi

homedir="$(mktemp -d "${TMPDIR:-/tmp}/voco-verify-gnupg.XXXXXX")"
cleanup() {
  rm -rf -- "$homedir"
}
trap cleanup EXIT
chmod 700 "$homedir"

gpg --batch --homedir "$homedir" --import "$KEYS" >/dev/null 2>&1
# Ephemeral keyring: the only imported key is KEYS from this invocation.
gpg --batch --homedir "$homedir" --trust-model always \
  --verify "$sig" "$dir/$file"
echo "Checksums and publisher signature verified."
