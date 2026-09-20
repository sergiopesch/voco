# Linux release polish verification — 20 September 2026

The refreshed 2026.0.43 application passed native package lifecycle checks in seven
environments and four installed desktop scenarios. Publication, publisher signing
and public-download verification remain separate gates; GitHub Releases determines
availability.

## What changed after the engine qualification

Release review found a Debian-only sentence in Updates settings and an unusable
placeholder in the release-page verification command. Updates now names Debian,
Fedora, openSUSE and Arch, including Omarchy. Release notes supply exact manifest
names and GPG/checksum commands that do not require a source checkout.

The refreshed application SHA-256 is
`c04a65c215387aa021cdb8a174a1e5c18834cf62cc3b47ce68f424dca8840301`.
Its application change is one help sentence, from source `f05c264`; package assembly
used source snapshot `503a4b7`, including the latest bundled documentation.
Comparison with the [19 September qualification](linux-release-2026-09-19.md)
confirmed identical recognition/runtime, model, browser-host and other integration
payloads. Sixteen payload entries changed or were added: the application and fifteen
documentation entries. The new inventory contains 227 entries and nine ELF objects.

The earlier long-recording, recovery and focus-departure trials belong to application
`f634e62146a44ffe213636fa8456ff59337c68249e443fccc4578385f8a5499b`.
They retain that identity and their original timings. They were not rerun or relabeled
as measurements of the refreshed binary. The bounded source change justified
repeating packaging and fresh-user dictation checks below.

## Refreshed package checks

Ubuntu 24.04's booted guest upgraded from the verified public .42 Debian package.
Ubuntu 26.04, Debian 13 and Mint 22.3 containers used the preserved .37 baseline.
Fedora 44, openSUSE Tumbleweed 20260917 and Omarchy 4.0.4 used their native managers.
All seven passed install, reinstall, removal, exact payload verification and
preservation of a package-independent user-state marker. RPM license files remained
present under the guests' documentation policies.

These lifecycle tests preceded publisher signing. Omarchy used a clearly identified
disposable VM signing key. Publisher signatures and unchanged signed payloads must
be verified separately before publication; a test key is not publisher trust.

## Installed desktop observations

| Desktop / recipient | Scenario | Normalized words | Stop to idle | Synthetic Start to first field observation |
| --- | --- | --- | --- | --- |
| Fedora GNOME Wayland / GTK | Two sessions at the same caret | 28/28 | 452, 446 ms | 1,936 ms |
| openSUSE KDE Wayland / Firefox | One session | 14/14 | 498 ms | 2,544 ms |
| Omarchy Hyprland / GTK | Two sessions at the same caret | 28/28 | 220, 262 ms | 1,840 ms |
| Ubuntu GNOME X11 / GTK | Two sessions at the same caret | 28/28 | 490, 466 ms | 1,913 ms |

All four completed with the secondary field empty. These are individual virtual
machine observations using public fixture audio, not percentiles, physical input,
pixel-paint latency or a broad accuracy corpus. Firefox was settled before recording
and observed without diagnostic DOM transcript logging. No new TypeSafe API scores
or punctuation-accuracy measurements were produced.

Six desktop attempts were retained: four passed, while two Fedora attempts failed
before recording because the post-login GNOME overview prevented recipient focus.
Dismissing the overview resolved the setup issue. The first Omarchy package attempt
stopped because its temporary test keyring was empty after reboot; restoring that
keyring and repeating the full lifecycle passed. Failures remain in private evidence.

The Omarchy guest uses packaged Hyprland/Quickshell with a supplied kernel. It does
not qualify the ISO installer or bootloader. Containers do not qualify default
desktops. Physical microphones, suspend/resume, arbitrary applications and other CPU
architectures retain the limitations in the [support matrix](../linux-support.md).
