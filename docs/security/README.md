# Security

## Design Principle: Local-First, No VOCO Account

This guide describes the current source contracts, reviewed on 22 September 2026.
See [release status](../release-candidate.md) for the distinction between source,
qualified packages, the installed application and public releases.

Dictation runs locally and requires no VOCO account, sign-in, subscription or
third-party credential. The package bundles the NVIDIA Nemotron model and CPU
runtime, which are warmed at startup. Explicit recovery uses the same model in a
separate bounded worker, retains audio on failure, and never automatically delivers
the recovered transcript. The compiled application has no Whisper model downloader
or alternate transcription service.

Automatic and manual GitHub Releases metadata checks are the application's network
requests; successful results are reusable for up to six hours. They do not send
audio or transcripts. Installing/downloading release assets and explicitly opening
a help or release page are separate network actions. VOCO has no telemetry, analytics
or crash-reporting service.

## Threat Model

### Assets

- User audio and recovery data (normally held in memory; explicit diagnostics can persist audio)
- User configuration (stored locally)
- ASR model files (stored locally)
- Dictated text retained in VOCO, delivered through default desktop paste, or sent to an explicitly authorized browser element
- Captured browser element value and selection checked transiently inside the extension
- Bounded accessible-field context held transiently by the native observation helper
- Clipboard contents (replaced by native desktop delivery or explicit Copy; clipboard managers may retain dictated text)

### Attack Surface

- Tauri IPC commands (frontend -> Rust)
- Private VOCO app -> persistent shortcut-only IBus engine socket
- Chromium extension, native-messaging host and exact-field broker socket
- Native Wayland audio capture through the existing per-user PulseAudio-compatible socket,
  or WebView `getUserMedia` on X11
- Native desktop paste and compatibility insertion via external helpers (ydotool, xdotool, xclip, wl-copy)
- Local Python speech worker, bounded IPC, native CPU libraries and packaged model
- ASR model loading (local files)
- Automatic and manual GitHub Release checks (HTTPS to api.github.com)
- Explicit debug audio, native source metadata and retained diagnostic WAV/timeline persistence

## Current Protections

- **Local model integrity**: Package assembly records model/native provenance; the speech
  adapter verifies the pinned model SHA-256 before loading it. Digests establish artifact
  identity, not safety of arbitrary same-user runtime replacements.
- **Single-instance ownership**: A private per-user runtime lock is acquired before sockets,
  shortcuts, tray state, or model work, preventing two VOCO processes from stealing shared runtime
  resources or overwriting configuration concurrently
- **Tauri CSP**: Restrictive content security policy, no remote scripts
- **Scoped permissions**: WebView permission grants restricted to UserMedia (microphone) only
- **Scoped input limits**: Desktop delivery rejects empty text and payloads above 100,000
  UTF-8 bytes. Browser frames are capped at 1 MiB with a separate 100,000-byte text limit.
  Native capture has a ten-minute frame ceiling; explicit recovery accepts at most
  ten minutes or 32 Mi samples, whichever is smaller. These are route-specific limits,
  not one universal IPC size bound.
- **External link allowlist**: WebView-triggered external opens allow VOCO GitHub release
  URLs and the fixed ydotoold troubleshooting link
- **Local core storage**: Config, models, state, and debug captures use local paths; VOCO does not
  provide cloud sync
- **Helper execution**: Dictated text is passed through process arguments or stdin,
  without shell interpolation. Helper waits/output are bounded; timed-out child process
  groups are terminated and reaped. The desktop focus helper uses Python isolated mode.
- **Clipboard boundaries**: The current desktop route deliberately uses clipboard paste for
  progressive/final delivery. Text replaces the clipboard and stays there; leading join spaces
  can be typed separately. Helpers cannot atomically prove recipient consumption or preserve all
  MIME formats. No delayed clipboard restore or automatic uncertain replay is performed
- **Sampled desktop observation**: Eligible accessible controls permit bounded local-region
  readback after paste before the next clipboard replacement. Context is transient,
  excluded from metrics/frontend responses, and discarded after the transaction.
  Sampling does not provide atomic field ownership; unsupported controls remain
  unobserved. Timeout or inconsistent identity cannot authorize automatic replay.
- **Trigger socket safety**: Runtime directories must be absolute, real, private and
  current-user-owned. With no `XDG_RUNTIME_DIR`, the existing temporary-directory layout
  is retained only under a verified private root or a root-owned sticky temporary root.
  Unsafe existing paths are rejected without changing their permissions. Trigger sockets
  are `0600`, accepted peers require Linux `SO_PEERCRED` for the current user, and cleanup
  removes only the registered socket inode while its parent remains safe.
- **IBus socket security**: The separate IBus control socket requires a private `XDG_RUNTIME_DIR`, a 0700 VOCO directory, a 0600 socket, Linux `SO_PEERCRED` same-user verification on both ends, one app connection, bounded protocol-v6 JSON messages, ordered request IDs, and no `/tmp` fallback
- **Input-source safety**: VOCO never selects, switches, restores, registers, or restarts a desktop input source. Its package only advertises a rank-zero persistent component that the user explicitly enables
- **Safe default**: Generic IBus mutation is disabled at the native client and protocol-v6 engine
  dispatch boundaries. This does not disable the separately enabled desktop-paste route. Actual
  WebKit tests showed that focus can move between fields without changing IBus identity, metadata
  or cursor geometry; the old context-token mechanism is not sufficient authorization.
- **Exact-element browser authorization**: An explicit tab action enables the adapter. A trusted
  browser chord captures a concrete eligible DOM element and document lifetime. Existing value,
  selection, connectedness, focus and eligibility are checked locally before a synchronous
  `setRangeText`, including after cancelable page hooks. Leaving and returning to the same field
  does not revive ownership. Password controls and recognized sensitive metadata, rich editors and selected ranges are
  rejected. A plain text field can still contain sensitive information without declaring it;
  eligibility is not a universal sensitivity detector. A direct-element write has a native
  undo-history limitation.
- **Browser transport**: The host validates a fixed extension origin; both Unix endpoints check
  same-user kernel credentials and private runtime/socket modes. Frames are bounded to 1 MiB.
  Request IDs, document nonces, connection generations, one-use tokens, native-allocated session
  IDs, sequences and exact committed counts prevent stale requests from being rebound to a new
  authorized session. This does not isolate already-compromised same-user processes.
- **Bounded browser authorization**: Triggers expire after two seconds; sessions last at most ten
  minutes. Each claim/append expires after 1,500 milliseconds and is checked immediately before
  mutation, including after page hooks, while the broker waits two seconds. This assumes a shared
  trustworthy host clock and does not cover arbitrary clock rollback.
- **No uncertain mutation retry**: Matching recipient receipts prove individual browser appends.
  Timeout, disconnection, malformed/mismatched receipts or uncertain mutation outcomes cannot
  authorize replay or fallback insertion. An already acknowledged final receipt remains recorded
  even after a later disconnect. Recovery must not imply that an uncertain write definitely failed.

## Capture and speech worker boundaries

When compiled with native capture, Wayland uses the native backend; X11 retains
WebKit unless the development override is set. Native capture commands accept only
VOCO's main application origin and require explicit source selection/acknowledgment.
The native bridge uses the existing local PulseAudio-compatible server without
autospawn or a remote `PULSE_SERVER`. It does not silently switch to another source.
Session identity, generation, sequence and retained-block acknowledgments prevent
stale renderer requests from controlling a replacement capture. Stop uses native
cork/barrier acknowledgment and drains retained blocks; a five-second renderer drain
lease bounds abandoned sessions. Audio callbacks use bounded native storage. See
[native capture contracts and qualification limits](../testing/native-capture-development.md).

The app starts the speech worker from an absolute local file path (default
`/usr/lib/voco/speech/stream_worker.py`). Requests serialize through one worker;
startup and responses have bounded waits, with a 4 MiB worker request-line ceiling
and 1 MiB app response-line ceiling. Session/sequence checks reject stale messages,
and audio pushes require finite samples, a consistent sample rate and at most one
second per push. Failed workers are terminated and reaped; an active recording is
not silently restarted or replayed. Developer executable/model overrides remain
inside the same-user trust boundary; this process separation is not a sandbox for
untrusted Python or native libraries.

## Diagnostics and audio persistence

Normal dictation does not write audio or transcripts to diagnostic files. Recovery
retains audio/text in memory; copying or delivering text also exposes it to the
clipboard and recipient application. Clipboard managers and recipients have their
own retention rules.

- `VOCO_PERFORMANCE_LOG=1` enables bounded asynchronous metadata logs in the app and
  worker. Allowlisted stages, counts, timing and resource metrics omit audio, text,
  clipboard values, URLs and window titles. Each writer has a 256-event queue. App
  logs rotate at 8 MiB with one previous file; worker logs rotate at 8 MiB with three
  backups. Disk failure drops diagnostic coverage without rejecting recognition.
- `VOCO_HOTKEY_TRACE=1` separately enables the local timing/lifecycle trace. Current
  and previous files are capped at 8 MiB for new writes. Unsafe links are rejected;
  an oversized legacy trace is preserved and tracing fails closed until it is
  archived or removed and VOCO restarted. These lifecycle events are not physical
  capture or recipient-consumption evidence.
- Native raw-capture evidence requires all three exact flags:
  `VOCO_DEV_NATIVE_CAPTURE=1`, `VOCO_DEBUG_CAPTURE_AUDIO=1` and
  `VOCO_DEBUG_NATIVE_CAPTURE=1`. The one-shot native and renderer-retention bundles
  contain audio and source metadata. Their directories are `0700`, payloads are
  exclusive `0600` single-link files, and descriptor-relative traversal refuses
  symlinks. `COMMIT.json` is published last with payload lengths/hashes; incomplete
  private payloads can remain after a failure.
- Retained diagnostic IPC commands can save a 16 kHz WAV and caller-supplied JSON
  timeline under `debug-captures` only when `VOCO_DEBUG_CAPTURE_AUDIO=1`. The normal
  dictation path does not call these commands. They allow at most one successful
  pair per app process, reject empty/over-ten-minute audio and timelines above
  16 MiB, use an owned `0700` directory and exclusive `0600` files, and attempt to
  remove partial pairs after failure. Any supplied timeline may contain transcripts.

Metadata writers check private owner-controlled paths and regular, single-link
files with no-follow/nonblocking opens. These checks do not isolate an already
compromised same-user process. General application/native-library stderr is a
separate surface and is not covered by the structured-metadata allowlist; inspect
it before sharing. Enabling a logger does not grant permission to record a
microphone or publish personal transcripts. See [diagnostic retention](../testing/laptop-performance.md).

## Data Storage Locations

| Data | Location |
|------|----------|
| Config | `${XDG_CONFIG_HOME:-$HOME/.config}/voco/config.json` |
| Packaged NVIDIA model/runtime | `/usr/lib/voco/speech/` |
| Opt-in application metrics | `${XDG_STATE_HOME:-$HOME/.local/state}/voco/performance/` |
| Opt-in worker metrics | `${XDG_STATE_HOME:-$HOME/.local/state}/voco/stream-performance/` |
| Update result cache | `${XDG_CONFIG_HOME:-$HOME/.config}/voco/update-cache.json` |
| Opt-in timing trace (`VOCO_HOTKEY_TRACE=1`) | `${XDG_STATE_HOME:-$HOME/.local/state}/voco/hotkey-trace.jsonl` |
| Retained diagnostic WAV/timeline IPC | `${XDG_STATE_HOME:-$HOME/.local/state}/voco/debug-captures/` |
| Opt-in native/renderer audio evidence | `${XDG_STATE_HOME:-$HOME/.local/state}/voco/debug-native-captures/` |
| IBus app control | `$XDG_RUNTIME_DIR/voco/ibus-engine.sock` (transient socket only) |
| Browser broker | `$XDG_RUNTIME_DIR/voco-browser/exact-field.sock` (transient socket only) |

The old per-user `voco/models` cache is not used by the current speech engine;
upgrades may leave historical files until the owner removes them.

The IBus engine rejects transcript mutation requests. The browser extension keeps
captured-field checks and receipt journals in memory; existing page content, field
names and URLs are not exported to the broker. Dictated append text necessarily
passes to the explicitly authorized extension. A malicious process already running
as the desktop user remains inside the local-user trust boundary.

## 2026.0.55 source hardening

The 2026.0.55 release adds the following hardening over 2026.0.54:

- The guided installer verifies the publisher's detached checksum signature with
  its pinned release key before accepting a package for privileged APT installation.
- The desktop focus helper runs Python in isolated mode, so launch-directory files
  and `PYTHONPATH` cannot replace its imports.
- Browser tab close, navigation, or native connection loss requests Stop for the
  originating recording. The exact Stop is retained until the frontend confirms
  receipt. Ordinary field focus loss still revokes text delivery while retaining
  the original session's explicit Stop control.
- The unused unguarded `insert_text` renderer command is removed; automatic desktop
  delivery continues through its bound destination token.
- The timing trace is now explicitly opt-in, bounded and hardened as described
  above; performance recording remains a separate opt-in.

## Retention and Deletion

VOCO does not automatically delete completed debug captures or incomplete native
audit bundles. Treat both debug directories as sensitive voice/diagnostic data;
retain only evidence you need and remove it deliberately. Removing the package
does not remove per-user XDG data. See [Install](../install.md) for uninstall and
per-user cleanup commands.

## Permissions Required

| Permission | Purpose |
|-----------|---------|
| Microphone | Audio capture for dictation |
| File system | Per-user configuration/state and read access to the packaged speech runtime |
| Input group (Wayland, optional) | evdev hotkey fallback and legacy ydotool API, not required for manual copying |
| Browser activeTab/scripting/nativeMessaging | Explicit-tab adapter injection and local native host communication |

## Review scope

The [15 September Stop-delivery review](../testing/stop-delivery-review-2026-09-15.md)
and [cross-Linux review](../testing/cross-linux-review-2026-09-15.md) are dated
evidence for their recorded revisions, fixtures and exclusions. Their test counts
and package receipts are not qualification of every later source change.

Desktop delivery still uses the original destination token, focus-generation and
bounded recipient-context checks. The patched X11 shortcut actor binds scope to
manager, registration generation, nonce and renderer epoch, with bounded waits and
a 650-second expiry. Failed/uncertain ownership restoration blocks readiness.
Cleanup does not confer continued delivery authority; generic paste IPC has no
universal renderer-epoch cancellation guarantee. A responsive actor/X server is
required for watchdog cleanup. Wayland/no-op and competing-client behavior must
not be inferred from isolated X11 tests. See [vendored shortcut provenance](../../vendor/global-hotkey/VOCO-UPSTREAM.json)
and [patch contract](../../vendor/global-hotkey/VOCO-PATCH.md).

The 22 September assessment combines bounded source review, focused regressions
and integration fixtures. It is not a complete security certification, a
penetration test of all dependencies, or universal desktop/microphone acceptance.
Current package qualification and remaining release gates belong in
[release status](../release-candidate.md).

## Current dependency audit

The 22 September 2026 npm and Cargo audit receipts report zero vulnerability-class
findings. RustSec database commit: `f7dc4b2860b29978f400fda0aab31cc4dbd21134`.
Seven unmaintained-package notices and one rand unsoundness notice remain visible;
zero vulnerability-class results do not mean zero advisories. Raw review receipts
are `audit-2026-09-22/npm-audit.json` and `audit-2026-09-22/cargo-audit.json` in the
maintainer's external evidence directory. Native shared libraries, models, Python
system packages and distro helpers are outside these npm/Cargo audit scopes.

RUSTSEC-2026-0097 affects rand 0.7.3 under conditions including its `log` feature and
a logger re-entering thread RNG. The resolved feature tree does not enable that
feature; the dependency enters through phf generation/selector build dependencies.
This assessment must be revisited if the graph or logging changes. The seven
maintenance notices cover fxhash, proc-macro-error and five unic crates.

For RUSTSEC-2024-0429, all GTK/WebKit/Tauri consumers resolve vendored glib 0.18.5
with the upstream mutable out-pointer fix. Source/archive verification and the
optimized iterator regression are mandatory CI gates and passed again in the
22 September review. This is a source backport: version-based scanners may retain
an alert, while Cargo audit does not report the vendored path copy. Source
reconstruction and regression evidence establish the fix, not the audit's zero
count. Application-level exploit reachability was not established. See
[patch provenance and maintenance](../../vendor/glib/VOCO-PATCH.md).

### Private legacy input daemon

Ubuntu's `ydotoold` 0.1.8-3build1 leaks accepted client descriptors, including
compatibility probes and ordinary paste clients. At exhaustion, its accept loop
spins and input readiness fails. This availability defect is outside npm/Cargo
audit coverage; periodically restarting it does not prevent recurrence.

The .55 package includes a minimal source-built daemon under
`/usr/libexec/voco/ydotool-legacy/`, with authenticated upstream provenance,
reviewed lifecycle patches, license notices and a checked build manifest.
The launcher selects it only for the exact qualified Ubuntu system client;
`/usr/bin/ydotool` is also used for application probing and dispatch. Other client
generations use the distribution daemon. No distro executable, device permission
or group membership is replaced. See [source and maintenance](../../vendor/ydotool-legacy/README.md).

The installed Wayland app holds its exclusive instance guard before migration.
Only its root-owned, unmodified vendor user unit is eligible. Overrides, custom
arguments, other logins and competing daemons prevent automatic replacement.
Pending or unconfirmed service transitions prevent app startup until resolved;
ordinary safe refusals preserve existing routes. No package hook starts or stops
a session service. The explicit setup CLI requires the app to be closed.

The original daemon fails the retained connection regression; the production ELF
passes lifecycle and forced-failure checks in a namespace with input syscalls
intercepted. This is separate from [isolated VM input qualification](../testing/release-qualification-2026-09-23.md).
The legacy owner-only fixed socket and uinput privilege boundary are unchanged.
Input writes still do not acknowledge recipient consumption; bounded destination
readback and no automatic replay remain necessary.

## Known Limits and Verification

- Generic IBus input contexts do not establish per-widget identity; IBus mutation remains
  disabled. The separate desktop paste path uses best-effort focus metadata, not exact-widget
  ownership. It cannot universally detect protected/sensitive fields, user caret movement within
  the same field, or whether paste was consumed. Availability is not universal app support.
- Exact-field browser support is constrained to eligible plain-text controls. Direct mutation may
  bypass native browser undo history; framework-controlled and rich editors need separate evidence.
- The recipient expiry assumes the shared host clock; arbitrary clock changes are not covered.
- Desktop ydotool delivery uses broad input privileges and does not prove target consumption.
  Keep the target focused; never treat key-dispatch completion as a recipient receipt.
- Development package creation and isolated synthetic tests do not mean the candidate has been
  installed, published, or validated across all Linux desktops and physical microphones.

See [browser broker acceptance](../testing/browser-broker.md) and the native capture
evidence for measured guarantees and remaining coverage.
