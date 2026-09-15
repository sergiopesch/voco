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
for a signed release or an independent security audit.
