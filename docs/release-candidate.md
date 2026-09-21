# Release status

The [latest published GitHub release](https://github.com/sergiopesch/voco/releases/latest)
is authoritative for current downloads. A source version, local test receipt or
private draft does not establish publication or installation.

The current public Ubuntu/Debian release is **2026.0.47**. Source **2026.0.48** is a
local test candidate for fresh-install fixes, not a published download. See the
[candidate changes](releases/2026.0.48.md) and [investigation](testing/fresh-install-2026-09-21.md).

The published .47 release includes the approved onboarding, tray, settings and installer improvements,
plus Wayland desktop readiness checks. The signed release tag and checksum
manifests bind the complete package and source archive to the publisher key.
All protected CI gates passed; the uploaded/downloaded assets were verified.
See [.47 changes](releases/2026.0.47.md) and the attached provenance and validation
records on [GitHub Releases](https://github.com/sergiopesch/voco/releases/tag/voco.2026.0.47).
Installed-VM checks used synthetic audio and do not qualify physical microphones
or every compositor/application.
Fedora, openSUSE and Arch/Omarchy downloads remain at **2026.0.43**.
Confirm publication and exact assets on GitHub before installing.

The preceding **2026.0.43** release contains: Debian, Fedora, openSUSE and Arch
package profiles, native Wayland capture and Omarchy integration. Final package
and desktop evidence is recorded in [Linux support](linux-support.md) and the
[qualification report](testing/linux-release-2026-09-19.md). Publication requires
publisher signatures, all protected CI gates and verified uploaded/downloaded
assets. Use the [native installation guide](install-native.md) only with a
matching published release.

- [.43 changes and measured limits](releases/2026.0.43.md)
- [Earlier .42 release and assets](https://github.com/sergiopesch/voco/releases/tag/voco.2026.0.42)
- [.42 changes and qualification scope](releases/2026.0.42.md)
- [General installation and signature verification](install.md)

The .42 Debian release combined safer capture admission, explicit offline recovery
and the TypeSafe guide. The .43 model and context remain unchanged; CPU thread
selection now reserves desktop headroom, supported by the separate installed
worker and desktop checks. No new semantic score is claimed for these changes.

The signed .44 tag remains immutable and unpublished. The .45 cut corrects
pending-start cancellation and terminal-caret validation found during review.

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

The [20 September polish verification](testing/linux-release-2026-09-20.md) records the refreshed application identity, seven
package checks, four desktop scenarios and preserved setup failures. Earlier long
and recovery measurements remain attributed to their original engine build.
