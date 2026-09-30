# Security policy

## Supported versions

Security fixes target the latest release. Older versions may need an upgrade;
there is no separate long-term support branch or guaranteed response time.

## Report a vulnerability

Please [report a vulnerability privately][advisory]. Share the affected version, a
minimal reproduction and the expected impact; use synthetic speech when possible.

[advisory]: https://github.com/sergiopesch/voco/security/advisories/new

Don't put credentials, personal recordings, transcripts or full diagnostic logs
in a public issue, and remove local paths from anything you attach.

## Verify a release

Each release has an annotated, signed `voco.<version>` tag and signed checksum
manifests, each with a detached `.asc` signature. One OpenPGP key signs them. Its
public half is in [KEYS](KEYS), and its fingerprint is:

```text
B33C7C6AAEC8C20433A7A837540796453D8E3865
```

Confirm the fingerprint through a channel you trust other than the clone itself.
Then, from a clone, check a tag:

```bash
gpg --show-keys --fingerprint KEYS
gpg --import KEYS
git verify-tag voco.<version>
```

To check downloaded files, put a manifest such as `voco_checksums.txt`, its `.asc`
signature and the files it lists in one directory, then run:

```bash
bash scripts/verify-release.sh --keys KEYS path/to/voco_checksums.txt
```

The script makes no network requests and imports only the given KEYS file into a
temporary keyring. It exits with 0 when every listed file matches and a key in
KEYS signed the manifest, 1 when a file is missing or differs, an entry is unsafe
or the signature is bad, and 2 when the files match but the signature is missing
or can't be checked. The guided installer carries its own copy of the key and
checks the signature with `gpgv` before APT sees the package.

## Scope

VOCO processes speech locally. Its desktop integration runs with your user
permissions and can paste into the focused application. Optional diagnostics are
off by default and contain bounded metadata. The
[security model](docs/security/README.md) covers the trust boundaries, the data
VOCO keeps, its local interfaces and its known limits.

TypeSafe evaluation is an optional contributor tool. It requires explicit sending
and a separate API credential; the installed app never calls TypeSafe. Send only
public or synthetic evaluation text, as the
[evaluation protocol](docs/testing/typesafe-evaluation.md) describes.
