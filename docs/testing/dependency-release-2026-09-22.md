# VOCO 2026.0.53 dependency qualification · 22 September 2026

The .53 release integrates dependency PRs #46–#57 and updates the maintenance
policy. The [signed release](https://github.com/sergiopesch/voco/releases/tag/voco.2026.0.53)
is published and its anonymous downloads are verified. The prior [.52 release](../releases/2026.0.52.md)
remains immutable and available for rollback.

## Identity and scope

- Application build/package assembly commit: `12de071c546fbcf70ed9557f13b5881fb8d42bd5`.
- Complete Debian package SHA-256: `fde427a8aa0152f2b89835fcdaedca11668645b4344d0f4635434d8e9b6ca2be`.
- Packaged application SHA-256: `3b59806e345c187c9be043878a5029dfa2986040cac73422d496c7426cce813b`.
- Installer SHA-256: `9a43199cb904ab9fc407d308fa7c6bf1220d7bcdbbd215a9ab9b3ba2a634a184`.
- NVIDIA runtime/model and recognition source are unchanged from .52.

The Tauri bundler patches the executable's bundle metadata; provenance records
the pre-bundle target and the executable extracted from the complete package
separately. Only the latter is the desktop-test identity. Bundled documentation
retains its assembly snapshot; final qualification documentation is included in
the source archive and GitHub repository.

## Dependency regressions

The original sha2, evdev, ESLint-recommended and TypeScript PRs failed CI.
The integrated changes preserve checksum formatting, migrate typed input events,
remove two unused assignments, retain the cause of update timeouts and use
Microsoft's TypeScript 6 API compatibility package beside the TypeScript 7 compiler.

The shortcut-plugin update passed CI but introduced a second `global-hotkey`
instance, bypassing VOCO's X11 focus-lease actor. The patch was rebased onto 0.8.0;
a new provenance/lockfile gate requires both consumers to share that patched copy.
The gate rejects the original PR #54 graph. No delivery permission was relaxed.

## Checks

The [integration build](https://github.com/sergiopesch/voco/actions/runs/35719658426)
passed all four protected checks. Local checks passed type/lint/DevOps gates,
449 frontend tests, 16 dictation, 31 microphone and 42 native-capture renderer
cases, 258 application Rust tests, 19 browser-host tests, seven glib regressions
and Clippy. One existing Rust fixture-export test remains explicitly ignored;
it requires a dedicated state directory and is not counted as a passed test.

The pinned speech corpus passed at aggregate WER 0.025, including continuity,
silence and partial-Stop checks. Source and packaged workers passed 13 protocol
checks each. These limited fixtures are not a general accuracy claim.

The exact packaged binary passed 12 private GNOME 46 X11 checks: fresh onboarding,
Done/launcher handoff, Alt+D, measured tray levels and silence, repeated Stop,
companion reconnection, repeated Chromium rich-editor dictation and focus-departure
recovery. The fallback meter produced 18 distinct frames. Public virtual audio
ran only inside the isolated session; no owner microphone or input device was used.

Ubuntu 24.04 local-container lease `cbx_05062c499d99` passed real APT prompt tests,
installation with the exact script/package, complete payload integrity and removal.
The transport fixture redirected only versioned release URLs to local exact assets.
Onboarding defaulted false, selected microphone was null and the shortcut was Alt+D.
Exit 2 correctly reported unavailable container uinput, distinct from package success.
The lease was stopped after collecting evidence.

All 56 local download trials verified their payloads against .52 and .53 scripts.
Installer behavior is unchanged apart from the version/asset URLs. These trials
measure local download handling, not Internet or whole-installation performance.

Npm audit reported zero vulnerabilities. Cargo audit reported zero vulnerability-
class findings, seven existing unmaintained warnings and one unsound warning.
The existing low rand advisory remains open with its documented build-only,
log-feature-disabled assessment; no advisory was dismissed or ignored.

## Preserved attempts and limits

Initial native compilation exposed changed evdev test constructors; the corrected
rerun passed. An initial release-mode test omitted the mandatory custom-protocol
feature and was rejected by the existing compile guard. Neither is counted as a
passing attempt.

The first desktop fixture expected a host-installed `/usr/bin/voco`; the clean
owner machine correctly lacked it. The corrected private package mount passed
without installing VOCO on the host. The minimal container emitted an Ubuntu
pager warning; the installer correctly exposed it and switched to ordinary APT
output. Prompt and warning visibility are intentional fallbacks.

Physical microphones, owner-perceived animation, native Wayland cursor delivery,
and other desktop/application combinations are not requalified by this X11 test.
The final protected merge, signed tag, five signed checksum manifests and all
18 draft/public assets passed verification. Latest aliases and the tagged installer
match the signed bytes. The hosted release assembler stays disabled.

## Repository hygiene

Four remote feature branches had exact tips already merged into master and were
removed with compare-and-delete leases:

| Branch | Recorded tip |
| --- | --- |
| codex/publish-2026-0-51-docs | `4f56dda4bd9c4dc683940b4c637ee7c64d224628` |
| codex/rich-editor-delivery | `f5449fa0e1ea571f7685dcd16ea6ff100a2cd3b2` |
| codex/tray-meter-setup | `5c2ea1e376ecbf87c263eec35b2b63868d0995cc` |
| codex/wayland-install-readiness | `13074f3cf4a9a9be7bfe2221d52bec525618a4c2` |

The merged local installer branch was removed at `203e4e0`. All 12 original
dependency PRs closed as merged, with their exact tips retained in master.
Their branches were deleted automatically. Weekly compatible groups, two version
PRs per ecosystem and separate
major/input reviews replace the former ungrouped queue of up to 15 version PRs.
Branch protection and the independent security-update queue are retained.

Published release commit: `75cfd671fdc2b90707b504856c81c288c4755286`.
Final protected PR head: `154cd99ce3f17f2e2bba96ff8a7f9864aff73d98`.
All four checks passed on the [final PR](https://github.com/sergiopesch/voco/actions/runs/35720398379)
and [merged release source](https://github.com/sergiopesch/voco/actions/runs/35720893445).

Dependabot then opened a new, smaller grouped review batch; it is separate from
the frozen .53 cut.
