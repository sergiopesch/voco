#!/usr/bin/env bash
# Exercise the release signer and verifier with a throwaway key in a private
# keyring: unsigned, unsafe, signed, foreign-key and tampered manifests.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERIFY="$ROOT/scripts/verify-release.sh"
SIGN="$ROOT/scripts/sign-release-checksums.sh"
workdir="$(mktemp -d "${TMPDIR:-/tmp}/voco-verify-test.XXXXXX")"
export GNUPGHOME="$workdir/gnupg"
cleanup() {
  if [[ -d "$GNUPGHOME" ]]; then gpgconf --kill all >/dev/null 2>&1 || true; fi
  rm -rf -- "$workdir"
}
trap cleanup EXIT

expect_status() {
  local expected="$1" description="$2" status=0
  shift 2
  "$@" >/dev/null 2>&1 || status=$?
  if [[ "$status" -ne "$expected" ]]; then
    echo "$description should exit $expected, got $status" >&2
    exit 1
  fi
}

echo payload > "$workdir/voco_latest_amd64.deb"
(cd "$workdir" && sha256sum voco_latest_amd64.deb > voco_latest_checksums.txt)
expect_status 2 "unsigned checksums" "$VERIFY" "$workdir/voco_latest_checksums.txt"

printf '%s\n' "0000000000000000000000000000000000000000000000000000000000000000  ../../etc/passwd" \
  > "$workdir/bad.txt"
expect_status 1 "path traversal checksums" "$VERIFY" "$workdir/bad.txt"

if ! command -v gpg >/dev/null 2>&1; then
  echo "verify-release unsigned and unsafe cases passed; signed cases unavailable without gpg"
  exit 0
fi

mkdir -m 700 "$GNUPGHOME"
new_key() {
  gpg --batch --pinentry-mode loopback --passphrase '' \
    --quick-generate-key "$1 <test@invalid>" ed25519 sign 1d >/dev/null 2>&1
  gpg --batch --with-colons --list-secret-keys "$1" 2>/dev/null | awk -F: '$1 == "fpr" { print $10; exit }'
}
release_key="$(new_key "VOCO test release")"
other_key="$(new_key "VOCO test other")"
gpg --batch --armor --export "$release_key" > "$workdir/KEYS"
gpg --batch --armor --export "$other_key" > "$workdir/OTHER_KEYS"

GPG_KEY_FINGERPRINT="$release_key" "$SIGN" "$workdir/voco_latest_checksums.txt" >/dev/null
expect_status 0 "signed checksums" "$VERIFY" --keys "$workdir/KEYS" "$workdir/voco_latest_checksums.txt"
expect_status 2 "checksums signed by a key outside KEYS" \
  "$VERIFY" --keys "$workdir/OTHER_KEYS" "$workdir/voco_latest_checksums.txt"
expect_status 1 "signing over an existing signature" \
  env GPG_KEY_FINGERPRINT="$release_key" "$SIGN" "$workdir/voco_latest_checksums.txt"
cp "$workdir/voco_latest_checksums.txt" "$workdir/release-notes.md"
expect_status 1 "signing an unexpected filename" \
  env GPG_KEY_FINGERPRINT="$release_key" "$SIGN" "$workdir/release-notes.md"

echo tampered > "$workdir/voco_latest_amd64.deb"
expect_status 1 "a changed package" "$VERIFY" --keys "$workdir/KEYS" "$workdir/voco_latest_checksums.txt"
(cd "$workdir" && sha256sum voco_latest_amd64.deb > voco_latest_checksums.txt)
expect_status 1 "a changed manifest" "$VERIFY" --keys "$workdir/KEYS" "$workdir/voco_latest_checksums.txt"
echo "verify-release tests passed"
