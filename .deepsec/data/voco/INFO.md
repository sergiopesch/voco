# voco

## What this codebase does

VOCO is a local Linux dictation app: press a shortcut, speak, and the words are
pasted into whichever app has keyboard focus. It is a Tauri desktop app (Rust in
`apps/desktop/src-tauri/src`, React/TypeScript in `apps/desktop/src`) with a
Python speech worker (`runtime/speech`), a GNOME Shell companion extension
(`integrations/gnome`), a Chromium extension with a native-messaging host
(`integrations/chromium`, `src/bin/voco-browser-host.rs`), an IBus engine in
Python (`apps/desktop/src-tauri/resources/voco_ibus_*.py`), and `.deb`, RPM and
snap packaging with a guided installer (`install`). There is no server, account,
telemetry or cloud transcription. The only network use is a read of GitHub's
public releases API and, when the user chooses Install update, a download of
that release's package and signed checksums.

## Auth shape

There are no user accounts. Trust is decided per local channel:

- Unix sockets (`trigger_socket.rs`, `single_instance.rs`, `browser_socket.rs`,
  the IBus engine's socket): 0700 directory, 0600 socket, `SO_PEERCRED` uid check.
- D-Bus (`panel.rs`): `Attach` only from the current owner of `org.gnome.Shell`;
  every other method is gated on that sender, except `CompanionAsking` and, in
  the snap only, `Toggle`.
- Browser field delivery (`browser_broker.rs`, `browser_protocol.rs`): 48-hex
  tokens, document IDs, sequence numbers and exact committed-character receipts;
  the native host checks the extension origin.
- Updates (`update_verify.rs`, `update_download.rs`, `bin/voco-update-helper.rs`):
  `gpgv` against the embedded release key's fingerprint, then SHA-256, then the
  package's identity; the root helper, run only through `pkexec`, re-verifies a
  root-owned copy.
- The webview reaches Rust only through registered Tauri commands
  (`capabilities/default.json`); `is_allowed_external_url` gates `xdg-open`.

## Threat model

Ranked by impact: (1) root code execution through the update helper, the
installer, package hooks or the polkit action; (2) another local user, or a
sandboxed program of the same user that shares the session bus, `/tmp` or
`XDG_RUNTIME_DIR`, making VOCO type or paste into the focused app, start the
microphone, or read dictated text; (3) a web page in an armed browser tab, or a
hostile GitHub API answer or release asset, steering VOCO; (4) dictated text,
My words, clipboard contents or audio reaching logs, metrics, the crash journal
or any network destination; (5) the speech worker escaping its sandbox.

## Project-specific patterns to flag

- Files under `/tmp`, `XDG_RUNTIME_DIR` or the config and state folders created
  or opened without `O_NOFOLLOW`/`O_EXCL`, an owner and mode check, or a
  descriptor-anchored `openat`; verify-then-use of a path another process of
  the same user can replace before a privileged step.
- A spawned helper (`xclip`, `xdotool`, `notify-send`, `gpgv`, `pkexec`,
  `apt-get`, `dnf`, `dbus-send`, `gsettings`) given a value that could begin
  with `-`, or an environment not cleared before a privileged process.
- A D-Bus method, socket message or Tauri command that pastes, types, toggles
  dictation or returns text without the sender, peer-uid or token check its
  neighbours make.
- Dictated text, My words, taught versions, the account's name, clipboard
  values, URLs or window titles in a `log::`, trace, metrics or notification
  call; any new outbound request or host.
- A paste path that sends keys without the origin-session and lock checks
  (`desktop_session.rs`), or that sends Enter or any key other than Shift+Insert.
- The worker started without `worker_sandbox.rs`'s seccomp filter, with a
  socket, or with more than its allowlisted environment.

## Known false-positives

- `scripts/`, `tests/`, `research/` and `docs/guide/` are test harnesses,
  fixtures, dated studies and a documentation site: they never ship.
- `vendor/` holds upstream crates (glib, global-hotkey, tray-icon) with narrow,
  documented patches; review only the patches named in `vendor/README.md`.
- 64-hex strings in `runtime/speech/*.json`, `adapters.py` and the packaging
  scripts are pinned SHA-256 digests, not secrets. `KEYS` and
  `packaging/release-key.gpg` are the public release key.
- `postMessage` in `apps/desktop/public/audio-processor.js` and `useDictation.ts`
  is an AudioWorklet port, not a window message.
- The paste deliberately replaces the clipboard and never restores it, and
  logind being unreachable deliberately permits a paste; both are documented in
  `AGENTS.md` and `docs/security/README.md`.
