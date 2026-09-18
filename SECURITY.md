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

These GitHub Dependabot alerts remain open on purpose. They are not part of
2026.0.39; merging them would change native application bytes and need a new
version plus a new package:

- **Tauri origin confusion (medium).** The affected origin branch is
  Windows/Android-specific; this Linux artifact does not use it.
- **serde_with KeyValueMap panic (medium).** VOCO uses `skip_serializing_none`,
  not the affected KeyValueMap adapter.
- **rand custom-logger reentry (low).** The affected rand log feature is
  disabled.

These are scoped applicability notes, not a claim that every advisory is
irrelevant forever. Reassess if dependencies, features, consumers or supported
platforms change. Open update PRs stay separate until a qualified follow-up cut.
