# Release status

**2026.0.42** combines safer capture admission, explicit offline NVIDIA recovery,
maintainability and dependency updates, and the public TypeSafe evaluation guide.

- [Release and assets](https://github.com/sergiopesch/voco/releases/tag/voco.2026.0.42)
- [Changes and qualification scope](releases/2026.0.42.md)
- [Installation and signature verification](install.md)

Only a published GitHub release establishes availability; source version metadata
or a draft does not. The Debian amd64 package is the supported delivery format.
No changes to the speech model, context setting or thread default are promoted
from the small TypeSafe experiments.

## Release boundaries

2026.0.39 remains available for rollback. Its unsigned tag and frozen artifacts
must never be moved or replaced. The .40 and .41 versions were development
milestones; .42 is the combined release.

The hosted GitHub Release workflow stays disabled. Maintainers build and verify
complete local NVIDIA packages, then upload exact artifacts under the
[release process](release-process.md). Checksums establish integrity; signed tags
and checksum files additionally bind them to the stated signing key.

GTK 0.18, WebKit2GTK 2.0 and the single patched glib 0.18.5 copy stay in place.
Userspace fixtures are not certification of every compositor, physical microphone
or application. Known limitations remain explicit in the release notes.
