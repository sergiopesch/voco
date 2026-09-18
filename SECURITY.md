# Security

Please [report a vulnerability privately](https://github.com/sergiopesch/voco/security/advisories/new).
Do not put credentials, personal recordings, transcripts or full diagnostic logs
in a public issue. Share the affected version, a minimal reproduction and the
expected impact; use synthetic speech when possible.

Security fixes target the latest release. Older versions may need an upgrade;
there is no separate long-term support branch or guaranteed response time.

VOCO processes speech locally. Its desktop integration runs with your user
permissions and can paste into the focused application. Optional diagnostics are
off by default and contain bounded metadata. See the
[security model and known limitations](docs/security/README.md).

Checksums help detect damaged or mismatched downloads. They are not a substitute
for a signed release or an independent security audit. The current public tag
`voco.2026.0.39` is unsigned and must not be moved to add a signature. Later
cuts should use `scripts/setup-release-signing.sh` once, then signed tags and
detached checksum signatures. Verify a signed cut with
`scripts/verify-release.sh` against the `KEYS` file from this repository; check
the fingerprint out of band before trusting a fresh clone.

## Current public release (2026.0.39)

The glib iterator defect [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429)
is fixed in this cut with a pinned upstream patch.

These GitHub Dependabot alerts remain open on purpose for the public 2026.0.39
cut. They are not part of that package; merging them would change native bytes:

- **Tauri origin confusion (medium).** The affected origin branch is
  Windows/Android-specific; the 2026.0.39 Linux artifact does not use it.
- **serde_with KeyValueMap panic (medium).** 2026.0.39 uses `skip_serializing_none`,
  not the affected KeyValueMap adapter.
- **rand custom-logger reentry (low).** The affected rand log feature is
  disabled.

The 2026.0.40 candidate updates Tauri to 2.11.1 and serde_with to 3.23.0 while
keeping the vendored glib 0.18.5 patch as the only resolved copy. The rand note
still applies. These are scoped applicability notes, not a claim that every
advisory is irrelevant forever. Reassess if dependencies, features, consumers or
supported platforms change.
