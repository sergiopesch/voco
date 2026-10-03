# Proposed upgrade approach and agent handoff

Status: **proposal only**. Start with the [findings](README.md). The user requested
assessment without implementation. This branch must remain documentation-only;
implementation starts only under a subsequent instruction, ideally on a child
branch so this assessment stays reviewable.

## Recommended scope

Deliver a small Ubuntu 24.04/GNOME 46 and Ubuntu 26.04/GNOME 50 compatibility
release. Support precisely those tested combinations; do not imply 47–49 or
future GNOME majors are covered just because 46 and 50 pass. Preserve the current
recognizer, delivery contract, app framework and visual direction.

The release is justified: the host changes break installation and startup before
recognition quality becomes relevant. Fixing those boundaries improves reliability
and removes measurable work from a service retry loop. A broader rewrite has no
demonstrated benefit for this task.

## Alternatives

| Approach | Pros | Cons | Decision |
| --- | --- | --- | --- |
| Explicit 46/50 companion support plus package/service fixes | Preserves existing UX, authenticated modifier checks and shortcut consumption; bounded code changes | Shell internals still require maintenance and visual testing | Recommended first release |
| Tray with a user-created compositor binding | Smaller dependency on Shell APIs; useful fallback and diagnostic control | Setup friction; displayed app shortcut may differ; held modifiers and duplicate triggers need care; no live panel | Keep available and qualify; not an equivalent replacement for the requested seamless upgrade |
| GlobalShortcuts portal | Standard permission/session model; GNOME implementation exists | New UX, persistence and arbitration state; shortcut deactivation is not all-modifier clearance; no panel or paste replacement | Separate experiment after the narrow port |
| RemoteDesktop/Clipboard portal input replacement | Potentially less direct uinput integration | Major permission and delivery redesign; recipient/clipboard semantics and latency unproven here | Defer; requires an explicit product/security decision |
| Metadata-only support or disable Shell validation | Small apparent edit | Known removed API; no reliable shortcut/panel and false compatibility claim | Reject |
| Increase speech threads, change model or rewrite capture | Could be investigated for an independently measured bottleneck | No identified need; risks responsiveness, accuracy and sample accounting; obscures OS compatibility | Out of scope |
| Recommend GNOME Xorg or downgrade the desktop | Avoids investigating some Wayland paths in principle | GNOME 50 no longer provides the old X11 session; distro downgrade is outside app support | Reject as the upgrade approach |

## Work packages, in order

### W0 — Freeze identities and establish independent test environments

Re-read the actual candidate AGENTS, README, architecture and current release
status. Pin the implementation base and model/native payload hashes. Check whether
master moved after `2045dd7`; review the intervening diff before reusing findings.
Record the exact OS, Shell, Mutter, Python, WebKit, PipeWire, kernel and ydotool
versions for each environment. Keep a clean Ubuntu 24.04 reference and a clean
Ubuntu 26.04 reference separate from a 24.04→26.04 migration fixture.

Use a disposable VM for genuine compositor/uinput/service qualification. Crabbox
doctor currently reports a working **local-container** provider only; do not
describe that as a VM or remote-desktop proof. Check available repo jobs before
using it. If a provider cannot isolate clipboard, input and audio, mark the gate
unavailable instead of exercising the user's desktop.

Package builds should retain the oldest supported ABI floor. Building on this
newer glibc 2.43 host does not itself prove a binary runs on Ubuntu 24.04/glibc
2.39. Build in a reproducible supported-floor environment and test forward on
26.04, or produce explicitly separate artifacts with honest requirements. Inspect
ELF symbol versions, not just a hand-written dependency floor. Do not weaken the
private legacy helper's ABI/provenance checks to make a local build pass.

### W1 — Correct dependency resolution without losing older Ubuntu support

Affected surfaces:

- `scripts/lib/install-common.sh::voco_install_deb_package`
- root `install` helper prefetch and generated common-helper copy
- `scripts/setup.sh` and the shared installer tests
- `apps/desktop/src-tauri/tauri.conf.json` package recommendations
- `scripts/verify-deb-package.sh` and package/installer fixtures
- install/platform documentation and installer synchronization check

Resolve required capabilities to tested package mappings: Ubuntu 24.04 needs the
split client/daemon packages; this Ubuntu 26.04 needs the merged `ydotool` package.
Keep package names distinct from executable names and daemon readiness. Prefer a
small explicit mapping with package-manager confirmation over a general new
dependency framework. Consider a version-constrained Debian recommendation
alternative for the daemon capability, but prove APT resolution on both releases
before choosing its exact expression; do not assume `ydotool` declares a virtual
`Provides: ydotoold` (the inspected package does not).

Apply the same selection to prefetch and final APT transaction. After installation,
check `/usr/bin/ydotool` and its matching daemon/provider using trusted system
paths; a binary earlier on PATH is not authoritative. Cover disabled APT
recommendations, package upgrades, missing repository candidates and custom
packages. Regenerate the installer via the repository's synchronization workflow;
do not maintain a divergent hand-patched embedded copy.

Acceptance: clean install and in-place upgrade resolve on both releases, including
`--no-install-recommends`; no package hook enables or restarts desktop services.

### W2 — Make input-provider ownership explicit and resolve duplicate VOCO service state

Affected surfaces: `packaging/ydotool/voco-ydotool-launcher`,
`packaging/systemd/voco-ydotoold.service`, `desktop_input_setup.rs`,
`insertion.rs`, startup in `lib.rs`, and `voco_start_wayland_service`.

Prefer reusing a verified, reachable distro/user-managed modern provider. Retain
VOCO's daemon path for its qualified legacy client and for an explicitly selected
VOCO-owned setup. Do not always enable a second service. The provider check should
describe executable generation, actual socket selection, owner/permissions,
connectivity, and relevant unit state without sending keys or replacing clipboard
contents. Preserve genuine custom socket/administrator setups; do not infer
permission to replace them from their process name.

Handle these states deliberately:

| Observed state | Proposed result |
| --- | --- |
| One verified distro provider, VOCO unit inactive | Reuse it; do not start VOCO's unit |
| One healthy qualified VOCO provider | Keep it; retain bounded safe-boundary migration |
| Healthy distro provider plus stock VOCO unit in socket-collision restart loop | Report exact conflict; offer an explicit, recoverable repair that stops/disables only VOCO's duplicate after identity checks |
| Customized VOCO unit/drop-ins or unrelated daemon | Preserve them; provide actionable diagnostics and require owner choice |
| Real migration job pending or ownership changed mid-operation | Keep startup/capture blocked until settled; never globally ignore exit 70 |
| No reachable provider / stale or wrong-owner socket | No input-ready claim; no key dispatch; explicit setup guidance |

Stopping/disabling even VOCO's stock duplicate changes persistent service state.
The implementation must make this an explicit setup repair, preserve previous
enabled state and check the chosen provider remains reachable. Do not kill the
distro daemon, unlink an unowned socket, broaden permissions or migrate while a
dictation could be active. A stopped VOCO duplicate must not reappear on login.
If a service file changes, update the launcher's pinned unit hash and fixtures.

Make input diagnostics and launch preflight share enough facts to explain why
the app cannot launch despite a functioning paste provider. A cached executable
syntax classification may be investigated, but socket reachability is live state;
do not cache it across owner changes just to improve latency. Distinguish permanent
conflict from a real transient migration without adding uncontrolled retries.

Acceptance: no competing daemon, no restart loop, no input mutation during setup,
working reboot/login persistence, and no regression in legacy or admin-owned setups.

### W3 — Port the companion, preserving its small contract

Affected surfaces: `integrations/gnome/voco-panel@voco.local/{extension.js,metadata.json}`,
`voco_gnome_panel.py`, `panel_setup.rs`, panel tests and GNOME integration docs.

Use explicit tested-major handling or narrowly checked capabilities to replace
the removed compositor query. GNOME 50 is Wayland-only, while GNOME 46 still has
a real X11 branch. Do not treat every future missing API as proof of Wayland.
Update metadata and Python support classification together and bump companion
version plus `COMPANION_VERSION` together. Keep older loaded companion detection.

Retain authenticated unique-owner D-Bus calls, one in-flight poll, generation
checks, 2.5-second shortcut leases, bounded heartbeat/retry behavior and full
disable/disconnect cleanup. Preserve action modes NORMAL/OVERVIEW and test modal
and locked surfaces; do not widen them to ALL. Check compatibility before claiming
an active panel so a deterministic API error cannot silently loop indefinitely.

Verify current layout on actual Ubuntu Shell before modifying styles. Keep the
microphone position stable within VOCO's own allocation, the meter to its left,
explicit Stop, accessible names, reduced motion and GNOME's real microphone
privacy indicator. Do not keep a capture stream open to prevent top-bar movement.
Do not add polling to the renderer or raise existing meter refresh rates.

Acceptance: complete lifecycle and shortcut evidence on 46 and 50, with exactly
one presentation surface, no stale shortcut authority and correct loaded-version
feedback after install/re-login. Merely enabling the extension is not acceptance.

### W4 — Port qualification before claiming support

Update GNOME 50 harness invocation and probe support metadata under private test
namespaces. Keep a separate GNOME 46 path. The devkit's integration features make
isolation an explicit design check: no host clipboard, audio, input, D-Bus or
configuration writes. Prefer full VM tests when those boundaries are uncertain.

Keep fast mocks and nested adapters, but add actual modern `ydotool` and distro
service tests in the VM. Exercise native GTK/WebKit, Chromium/Electron, terminals,
PRIMARY and CLIPBOARD, held keys, duplicate trigger paths, focus changes, errors,
onboarding, crash Review and physical capture. Use the [validation matrix](validation-plan.md).

### W5 — Package, review and hand off a reversible laptop trial

Only after implementation and qualification, select a fresh source/package
version (check current publication first), assemble the complete pinned speech
payload and retain source/package hashes, licenses and test receipts. No public
release or upload is authorized by this assessment. Run final code review against
the implementation diff; docs should describe its actual resulting behavior.

Before a later authorized laptop installation, preserve the old package, settings,
WebKit data, text recovery and relevant unit/extension state privately with a
manifest. A fresh onboarding trial can use an explicitly approved recoverable
profile reset. Package removal alone does not clear user settings or enabled user
units. An old binary rollback does not undo the OS upgrade or restore GNOME 46.

Install through APT, validate package contents and helper/companion states, then
request one desktop-user launch. Never start the GUI from root or package hooks.
Let the user handle sign-out/sign-in when needed. Keep physical microphone and
focused-app acceptance as explicit final gates, and retain unsuccessful attempts.

## Decisions to keep explicit

No new dependency, major framework upgrade, model change, permission expansion,
shortcut reassignment or clipboard policy change is justified automatically by
this review. In particular, changing unknown-modifier behavior, PRIMARY failure
policy, lock-screen recording policy, automatic duplicate-service repair, or
switching to a portal backend has product/security implications. Bring a concrete
proposal and evidence before choosing a materially different behavior.

## Next agent's starting sequence

1. Fetch `codex/gnome50-ubuntu2604-assessment`, read this directory and confirm
   whether a later user instruction authorizes implementation.
2. Recheck source head, OS/session, package version and service/extension state;
   the snapshot is not a durable fact about the next run.
3. Under implementation authorization, branch from the assessment, reproduce F1
   and F2 with the read-only recipe and establish the two OS test environments.
4. Implement W1/W2 with focused fixtures; implement W3 alongside W4; retain
   separate commits so packaging, service policy and Shell changes can be reviewed.
5. Complete all applicable gates, report gaps honestly, perform final review,
   and only then prepare W5 under the user's installation/publication scope.

Avoid unrelated cleanup. A small explicit port with complete evidence is preferable
to coupling the OS upgrade to a new dictation engine or desktop architecture.
