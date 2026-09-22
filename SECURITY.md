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
for a signed release or an independent security audit. The current Ubuntu/Debian
release, `voco.2026.0.51`, has a signed tag and detached checksum signatures.
The historical `voco.2026.0.39` tag is unsigned and must not be moved to add a
signature. New publishers use `scripts/setup-release-signing.sh` once, then sign
each new tag and its checksum manifests. Verify a signed cut with
`scripts/verify-release.sh` against the `KEYS` file from this repository; check
the fingerprint out of band before trusting a fresh clone.

## Release 2026.0.42

The glib iterator defect [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429)
is fixed with the pinned upstream backport. Tauri 2.11.1 and serde_with 3.23.0
include the updates previously deferred from .39. The GTK stack still resolves to
one patched glib 0.18.5 copy.

The remaining low-severity rand custom-logger reentry advisory is tracked rather
than dismissed. Its affected `log` feature is disabled in this dependency graph.
RustSec also reports maintenance warnings for parts of the GTK stack; a passing
audit is not a claim that all dependencies are actively maintained or defect-free.
Reassess applicability when features, platforms or dependencies change.

TypeSafe evaluation is an optional contributor tool. It requires explicit sending
and a separate API credential; the installed app never calls TypeSafe. Send only
public or synthetic evaluation text. See [the protocol](docs/testing/typesafe-evaluation.md).
