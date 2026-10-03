# GNOME 50 / Ubuntu 26.04 upstream compatibility research

Assessment date: **2026-10-03**. Candidate inspected: **2045dd7391ece5815d70a5fd42e1cb6fd14ae2a6**. This is a dated assessment and proposed implementation handoff, not a compatibility claim or an implemented port. No package, service, desktop preference, extension, microphone or clipboard was changed by this research.

## Recommendation

Port the existing small companion to explicitly qualified GNOME 46 and 50, correct Ubuntu's changed input-package mapping, and qualify actual Ubuntu 26.04 Wayland delivery before replacing the laptop installation. Keep recognition and its worker/queue limits unchanged during this port. A portal-based shortcut backend is a useful later experiment, but replacing the companion and input stack in the same release would multiply lifecycle and permission risks without an established performance benefit.

The current candidate is **not GNOME 50 ready**. Two source-level companion gates exclude it, and a real removed Mutter API prevents a metadata-only workaround. The existing compositor test harness also targets the old nested backend. These conclusions do not require launching the extension in the user's session.

## Verified facts and consequences

| Finding | Evidence | Consequence / proposed action |
| --- | --- | --- |
| VOCO advertises only GNOME 46. | `integrations/gnome/voco-panel@voco.local/metadata.json:5`; `apps/desktop/src-tauri/resources/voco_gnome_panel.py:18-20`. | Update both supported-version checks only with an actual port and validation; do not disable GNOME's version validation. Keep unsupported versions explicit. |
| `Meta.is_wayland_compositor` is missing from this laptop's installed Meta 18 API. | Read-only GI capability probe below; candidate calls it at `extension.js:257`. | Repair session detection before advertising 50. For explicitly supported GNOME 50, Wayland is the only Shell backend. Preserve the genuine GNOME 46 X11 branch; avoid a blanket fallback that treats every unknown missing API as safe. |
| The keybinding and modifier primitives remain available upstream. | [Mutter 50.1 keybindings](https://raw.githubusercontent.com/GNOME/mutter/50.1/src/core/keybindings.c), `meta_display_grab_accelerator` / `meta_display_ungrab_accelerator`; [Shell 50.1 windowManager](https://raw.githubusercontent.com/GNOME/gnome-shell/50.1/js/ui/windowManager.js), `allowKeybinding`; [Shell 50.1 global](https://raw.githubusercontent.com/GNOME/gnome-shell/50.1/src/shell-global.c), `shell_global_get_pointer`. | Existing design is a plausible narrow port. API presence does not establish correct consumed chords, held-modifier behavior or lock-screen behavior; test them in the compositor. |
| Ubuntu's GNOME session is Wayland-only; XWayland applications remain supported. | [Ubuntu 26.04 LTS summary, Wayland session](https://documentation.ubuntu.com/release-notes/26.04/summary-for-lts-users/#wayland-session); [Mutter 50.1 NEWS](https://raw.githubusercontent.com/GNOME/mutter/50.1/NEWS), 50.alpha. | Do not offer switching to GNOME Xorg as the fix. Do not remove XWayland clipboard bridging merely because the desktop session is Wayland. |
| Resolute packages the client and daemon together in `ydotool` 1.0.4-3. | [Ubuntu package](https://packages.ubuntu.com/resolute/ydotool), [source's binary package list](https://packages.ubuntu.com/source/resolute/ydotool), [daemon manpage](https://manpages.ubuntu.com/manpages/resolute/man8/ydotoold.8.html); local `dpkg -L ydotool` lists both binaries and `ydotool.service`. | A hard requirement to install a separate `ydotoold` package must become distribution-aware. Check executable/service readiness separately from package names. Preserve old Ubuntu mappings for supported older releases. |
| GNOME 49+ uses devkit instead of the old nested invocation. | [GNOME extension development guide](https://gjs.guide/extensions/development/creating.html), [GNOME 49 port guide](https://gjs.guide/extensions/upgrading/gnome-shell-49.html#debugging). | Port isolated GNOME 50 tests; current `scripts/test-gnome-panel.py:83,109,122` uses `--nested`, and the probe metadata permits only 46. Keep GNOME 46 coverage distinct. |

### Reproducible read-only capability evidence

Observed package versions from `dpkg-query` on this laptop:

| Package | Version |
| --- | --- |
| `gnome-shell` | `50.1-0ubuntu1.3` |
| `gir1.2-mutter-18`, `libmutter-18-0` | `50.1-0ubuntu2.4` |
| `xdg-desktop-portal` | `1.21.1+ds-1ubuntu3.1` |
| `xdg-desktop-portal-gnome` | `50.0-0ubuntu1` |
| `ydotool` | `1.0.4-3` |

`apt-cache policy ydotool ydotoold` reports `ydotool` installed/candidate `1.0.4-3`; `ydotoold` has neither an installed nor candidate package. `dpkg -L ydotool` contains `/usr/bin/ydotool`, `/usr/bin/ydotoold`, `/usr/lib/systemd/user/ydotool.service` and `/usr/lib/udev/rules.d/80-uinput.rules`. These are installation facts, not daemon readiness.

The following probe imports introspection metadata only. It does not initialize a compositor, register shortcuts or send input:

```bash
env GI_TYPELIB_PATH=/usr/lib/x86_64-linux-gnu/mutter-18 \
    LD_LIBRARY_PATH=/usr/lib/x86_64-linux-gnu/mutter-18 \
    /usr/bin/python3 - <<'PY'
import gi
for namespace in ('Meta', 'Clutter'):
    gi.require_version(namespace, '18')
from gi.repository import Meta, Clutter
print('Meta.is_wayland_compositor:', hasattr(Meta, 'is_wayland_compositor'))
print('Meta.Display.grab_accelerator:', hasattr(Meta.Display, 'grab_accelerator'))
print('Meta.external_binding_name_for_action:', hasattr(Meta, 'external_binding_name_for_action'))
print('Clutter.ActorBox.new:', hasattr(Clutter.ActorBox, 'new'))
print('Meta.KeyBindingFlags.IGNORE_AUTOREPEAT:', hasattr(Meta.KeyBindingFlags, 'IGNORE_AUTOREPEAT'))
PY
```

Observed output, in that order: `False`, `True`, `True`, `True`, `True`. The hard-coded directory is this laptop's installed ABI, not a proposed portable application path.

### Why a metadata-only change would fail

This is a **source-derived execution path**, not an owner-session reproduction. On a successful `Attach`, `_beginPolling()` calls `GetState`. Its completion handler reaches `_syncShortcut()` before showing/rendering the indicator (`extension.js:160-187`). With `_attached === true`, the missing `Meta.is_wayland_compositor()` at line 257 throws.

`_call()` catches errors raised by the completion handler as well as D-Bus errors (`148-157`) and invokes `_retry()`. That sends `Detach`, then `_disconnect()` releases any shortcut heartbeat/grab, advances generations, removes the state subscription and timer, clears animation/state and hides the indicator (`291-302`, `311-349`). It schedules a single retry after 2 seconds while the app owner remains present. The missing-API failure occurs before the new grab or heartbeat is created. Thus this particular path does **not show a timer leak or tight busy loop** in source; it predicts a repeated attach/detach cycle with no working panel/consumed shortcut. Disable cancels the pending timer via `_disconnect()` and cancels outstanding D-Bus work.

The next agent should add isolated coverage for this deterministic compatibility failure and for later failures after a grab has been established. Verify that a known incompatible API state yields an actionable unsupported/error result without indefinite silent retries or a lost tray. Do not infer that the current D-Bus authentication, stale-reply protection or cleanup must be redesigned wholesale.

## Scope of the Shell port

The official guides describe incremental API changes, not a promise that untested extensions work. [GNOME's version-check explanation](https://gjs.guide/extensions/overview/updates-and-breakage.html) makes the support list a tested compatibility declaration.

- [GNOME 47](https://gjs.guide/extensions/upgrading/gnome-shell-47.html), [48](https://gjs.guide/extensions/upgrading/gnome-shell-48.html), [49](https://gjs.guide/extensions/upgrading/gnome-shell-49.html) and [50](https://gjs.guide/extensions/upgrading/gnome-shell-50.html) should be the bounded port checklist. VOCO already uses ES module imports and the modern `Extension` base; no module-system rewrite is indicated.
- GNOME 48 deprecates `St`'s `vertical` property and removes `Clutter.Image`; 49 removes `Meta.Rectangle`, `Clutter.ClickAction` and `Clutter.TapAction`. This extension does not use these APIs. Do not make speculative substitutions for them.
- GNOME 50 adds `easeAsync`; the existing `ease` animation path is not identified as removed. Retain it unless actual testing shows a problem. Preserve reduced-motion behavior through `org.gnome.desktop.interface::enable-animations`.
- `_render()` accesses `Main.panel._rightBox` and `_centerBox` (`extension.js:235-239`). These are internal Shell layout details, so capability imports alone cannot qualify the visual meter. Test Ubuntu panel extensions, crowded panels, fractional scaling, large text, RTL and reduced motion. This is a validation risk, not a verified layout defect.
- Maintain `NORMAL | OVERVIEW` shortcut action modes initially. Do not use `ALL` to make shortcuts work in lock, modal or authentication surfaces. Test fullscreen, overview, open Shell menus, screen lock/unlock, keyboard layout changes, held shortcuts, repeat suppression, failed/conflicting grabs and extension disable/re-enable.
- Keep companion `metadata.json` version and `COMPANION_VERSION` together; verify loaded metadata separately from installed files. GNOME 50 does not have the old in-place X11 Shell restart path. Request a user-managed session restart only when needed; do not log the user out automatically. [GNOME 50 restart changes](https://gjs.guide/extensions/upgrading/gnome-shell-50.html#restart).

## Clipboard and input: preserve evidence boundaries

The candidate deliberately selects `xclip` for GNOME Wayland when `DISPLAY` is present (`insertion.rs:561-580`) while retaining Wayland keyboard dispatch. Ubuntu explicitly preserves XWayland clients. Therefore a Wayland-only GNOME session does not itself invalidate this route. It does require actual native-Wayland recipient and XWayland recipient tests, including clipboard-owner lifetime, Unicode/newlines, long streaming sessions and modifier release.

No Wayland protocol capability probe was performed here. This note makes **no claim** that Mutter 50 implements or does not implement newer `ext-data-control` protocols. The candidate's comment concerns the wlroots protocol; do not turn that historical implementation explanation into a timeless statement about every clipboard protocol. A future native route should first enumerate exact compositor globals and pinned helper support in an isolated session.

The [Clipboard portal contract](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Clipboard.html) extends Remote Desktop or Input Capture sessions; it is not an independent global clipboard-write service. Using it would introduce permission/session lifecycle requirements. Do not propose it as a drop-in `xclip` replacement without a separate design and UX/security review.

Resolute's [ydotool client contract](https://manpages.ubuntu.com/manpages/resolute/man1/ydotool.1.html) uses numeric `KEYCODE:PRESSED` events and requires a running daemon. Preserve VOCO's separately detected legacy/modern argument paths and qualified legacy binary identity. Do not downgrade the OS input package to recover the old separate-package layout. The installed distro service and VOCO's service both need ownership analysis before either is enabled or restarted; an executable existing is insufficient proof of a reachable, uniquely owned socket.

## Alternatives and tradeoffs

| Approach | Pros | Cons / gate | Recommendation |
| --- | --- | --- | --- |
| Narrow companion port + distro packaging fixes | Preserves panel, consumed shortcut and authenticated modifier query; keeps recognition unchanged; small review surface. | Continued Shell-version maintenance and internal layout dependence; real compositor evidence required. | First implementation candidate. Support only explicitly tested 46/50. |
| Tray + manually configured `voco --toggle` shortcut | Useful fallback with little Shell code; desktop consumes configured chord. | Requires deliberate user configuration and duplicate-path suppression; no companion modifier-query equivalent; tray availability differs. Does not repair service or installer defects. | Documented fallback only after its precise input behavior is qualified. |
| GlobalShortcuts portal for Start/Stop | Standard session-bound activation/deactivation; GNOME implementation exists; can reduce direct keybinding dependency. | New permission/configuration/session behavior; coexisting portal, companion and passive paths can double-toggle; does not provide the panel, destination authority, clipboard delivery or all-modifier clearance. | Separate prototype after stable GNOME 50 support, not a prerequisite rewrite. |
| Replace input with RemoteDesktop/Clipboard portals | Could reduce raw `/dev/uinput` integration and expose structured ownership/events. | Broader permission and lifecycle contract; substantial UX/security change; no measured latency or delivery advantage here. | Defer pending explicit design approval and focused proof. |
| Metadata-only enablement / disable version validation | Minimal edit. | Known missing API; falsely asserts support and bypasses the compatibility guard. | Reject. |

The [GlobalShortcuts specification](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.GlobalShortcuts.html) binds actions to an application session, has `Activated`, `Deactivated` and `ShortcutsChanged` signals, and normally shows a binding/configuration dialog. Its current documentation is interface version 2; implementations must discover the actual exposed version. GNOME's [50.0 implementation](https://raw.githubusercontent.com/GNOME/xdg-desktop-portal-gnome/50.0/src/globalshortcuts.c) connects Shell accelerator activation/deactivation signals. This laptop's installed `gnome.portal` advertises `org.freedesktop.impl.portal.GlobalShortcuts`. These facts establish feasibility, **not** successful binding, permission persistence, latency or full modifier-release semantics on this laptop. Shortcut deactivation alone must not be interpreted as proof that all physical modifiers are clear.

## Performance and qualification handoff

1. Keep the port isolated from recognizer/model, CPU worker count, IPC batching and queue limits. Compare unchanged recognizer identity and results to distinguish OS transport changes from recognition changes.
2. Preserve the extension's bounded asynchronous calls, one in-flight poll, generation checks and resource teardown. Current source uses 50 ms state polling while recording, 1.5 s otherwise, plus a 1 s reservation heartbeat (`extension.js:148-187,269-302`). These are nominal schedules, not measured CPU use or guaranteed poll frequencies; queued changes may request a 1 ms follow-up.
3. Measure Shell and VOCO CPU, resident memory, wakeups, animation frame behavior, input-to-visible-text latency and capture continuity together. Include idle, recording, processing, repeated reconnects, app crash and extension disable; preserve failures and total attempts. Do not improve synthetic latency by deleting ownership or modifier checks.
4. Port the harness to isolated GNOME 50 devkit and update the test probe support metadata. The upstream development command is `dbus-run-session gnome-shell --devkit --wayland`; Ubuntu's devkit package is `mutter-dev-bin`. It is a starting point, not a ready replacement for this repository's isolation wrapper. [Development guide](https://gjs.guide/extensions/development/creating.html). Mutter's [50.rc NEWS](https://raw.githubusercontent.com/GNOME/mutter/50.1/NEWS) records devkit clipboard integration, so explicitly prevent the new harness from sharing the host clipboard/input/audio. Prefer a disposable VM when isolation cannot be demonstrated.
5. Run the same narrow GNOME 46 regression suite and a new GNOME 50 suite, then package/install/remove and user-driven laptop acceptance. Separate nested compositor, installed VM and physical laptop receipts. Qualify actual packaged WebKit and actual system input services; successful imports and package installation do not prove end-to-end dictation.

All proposed changes remain unimplemented. Outstanding empirical questions include actual GNOME 50 extension rendering, held-key and modal behavior, portal permission UX, native/XWayland clipboard latency and the laptop's physical microphone continuity.
