# Linux release development · 19 September 2026

**Not a release qualification or publication receipt.** Public/installed .42 stays
unchanged. The .43 candidate adds compositor control and packaging foundations;
hidden-window audio and the full desktop matrix remain open.

## Hyprland experiments

Booted KVM guest: Omarchy 4.0.3 ISO-derived userspace, Linux 7.2.6, Hyprland 0.56.2,
minimal Lua configuration, virtual audio and a native GTK recipient. This is not a
clean Omarchy installer/default-desktop acceptance run. No host microphone,
keyboard or clipboard was exposed to the guest.

| Trial | Application / change | Result |
| --- | --- | --- |
| Baseline hidden-window assertion | Frozen .42 | Failed: VOCO still mapped as a tiled window after Hide |
| Hide before recording | .42 with diagnostic GTK native hide | Tile removed; microphone request did not reach capture-active within 25 seconds |
| First delayed-hide setup | .42 diagnostic | Failed before onboarding; timer fired too early. Retained, not counted as dictation evidence |
| Hide after first delivered phrase | .42 with signal-triggered diagnostic hide | 14/14 words, second field empty, unmapped tile, Stop-to-idle 313 ms |
| Compositor `voco --toggle` | .43 development executable; native capture compiled but disabled | 14/14 words, second field empty, two socket triggers, Stop-to-idle 261 ms |

These are five attempts, including two deliberate negative controls and one setup
failure. The two completed dictation trials use one short public fixture; their
Stop times are single observations, not percentiles or a performance ranking.
The diagnostic preload is confined to the guest and is not a shipped fix.
No ten-minute continuity or physical-microphone claim follows from these results.

The observed failure boundary is a new WebKit microphone request while the window
is unmapped. The existing native capture backend remains a gated development
option. Promoting it changes capture architecture and the explicit permission/setup
flow and requires a product decision followed by separate qualification.

## Native RPM profile tests

Native builds wrap the exact signed-public .42 Debian payload, not a .43 package.
Fedora 44 and openSUSE Tumbleweed ran in separate local Crabbox containers. They
share the host kernel and do not establish installed GNOME/KDE desktop readiness.

Both profiles passed native install, upgrade, reinstall and removal; full payload
comparison covered 218 entries and nine ELF objects. User settings survived
removal. RPM integrity checks passed. Under a minimal `nodocs` policy, all 14
explicit license files remained installed. Full-document parity was checked
separately with `--includedocs`.

The initial parity attempts failed because container policies excluded documentation.
The first specs also classified bundled license files as ordinary documentation;
those obligations could be excluded. The corrected generator uses `%license` and
tests the minimal-install case explicitly. Failed attempts remain in local receipts.
Test artifacts were unsigned and installed only in disposable test containers;
this does not establish a production signing or download channel.

openSUSE repository inspection found no provider of `libsentencepiece.so.0`.
A companion RPM builds the existing dependency from upstream commit
`31646a467d2051eb904e0b45de3a73e91fe1c1e3`, with an exact archive hash and source RPM.
The inherited test option `SPM_ENABLE_TEST` was ineffective. Corrected recipes use
`SPM_BUILD_TEST=ON`; CTest ran its upstream suite successfully and now fails if no
tests are discovered. Arch's revised companion recipe still needs a fresh native
build; older source-build evidence does not qualify this revision.

## Source validation

- 331 Rust library tests passed, including 11 trigger-transport tests.
- 15 native staging tests passed.
- Type check, Clippy, frontend build, version consistency and DevOps checks passed.
- ESLint: zero errors, four existing `no-explicit-any` warnings in recording orchestration.
- Full release CI, exact .43 artifacts and the complete compositor/application matrix
  remain separate gates. No TypeSafe live scores were generated for package checks.

## Outstanding release gates

Resolve hidden microphone startup, shortcut readiness presentation and output-service
setup; qualify the chosen capture path, actual Omarchy configuration and GNOME/KDE/X11
application matrix; exercise long sessions, failures and device lifecycle; build and
sign exact per-distribution artifacts; verify public downloads and only then upgrade
the reference installation. Physical microphone acceptance is recorded independently.

The public guide explains these boundaries. See [Linux support](../linux-support.md)
and [TypeSafe evaluation](typesafe-evaluation.md) for the distinct metric contracts.
