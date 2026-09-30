# Security

This page covers what VOCO trusts, what it keeps on disk and what it can reach
on your computer. To report a vulnerability, follow the
[security policy](../../SECURITY.md). [Architecture](../architecture/README.md)
follows one recording from start to finish, and
[Platform support](../platform/README.md) covers the helper programs.

## Trust model

VOCO runs as your login, with your permissions. Its boundary is your user
account: its files and sockets are private to you, and each socket checks that
the process at the other end runs as you. VOCO doesn't defend against a program
that already runs as you. Such a program can read VOCO's files, start and stop
dictation, and send keys through the same helpers VOCO uses.

VOCO has no account, telemetry or cloud service. Recognition runs in a local
worker process, and audio and transcripts stay on the computer. The only network
request is the [release check](#release-check).

## What VOCO keeps

| Data | Location | Kept until |
| --- | --- | --- |
| Settings | `$XDG_CONFIG_HOME/voco/config.json` | You change or reset them |
| Release check | `$XDG_CONFIG_HOME/voco/update-cache.json` | The next check replaces it |
| Crash journal | `$XDG_STATE_HOME/voco/crash-recovery/active.json` | The recording finishes |
| Review | `$XDG_STATE_HOME/voco/crash-recovery/recovered.json` | You discard the entry, or five newer entries push it out |
| [Opt-in logs](../architecture/README.md#logs) | `performance/`, `stream-performance/` and `hotkey-trace.jsonl` in `$XDG_STATE_HOME/voco/` | They rotate at 8 MiB |
| Debug audio | `$XDG_STATE_HOME/voco/debug-native-captures/` | You delete it |

The directories that hold this data are 0700 and the files 0600, owned by you.
VOCO refuses symbolic links and files that another account owns. It writes
settings through a private temporary file and a rename, and opens journal files
without following links and only when they have a single hard link. When a file
can't be opened safely, VOCO reports it rather than using it.

The crash journal and Review hold dictated text, in plain form, up to 256 KiB
per entry. The opt-in logs hold timings and counters, with no dictated text,
audio or window titles. Debug audio exists only when `VOCO_DEV_NATIVE_CAPTURE`,
`VOCO_DEBUG_CAPTURE_AUDIO` and `VOCO_DEBUG_NATIVE_CAPTURE` are all set to `1`;
it then holds the raw audio of one recording per launch. Removing an entry
unlinks its file and doesn't overwrite the disk, so rely on disk encryption for
data at rest.

## Clipboard and paste

VOCO copies each new phrase to the clipboard and the primary selection, then
sends Shift+Insert to whichever app has keyboard focus. It doesn't check which
app that is. Other programs in your session can read both selections, and a
clipboard manager may keep every phrase in its history. VOCO never restores the
earlier clipboard.

Before each paste, VOCO turns ASCII control characters, newlines and tabs
included, into spaces, so pasted text never presses Enter in a terminal or
submits a form. It refuses text outside 1 to 100,000 bytes. At Stop, words that
weren't typed go to the clipboard, or to Review if the copy fails.

## Input devices

On Wayland, paste keys go through `ydotoold`, which holds a virtual keyboard on
`/dev/uinput`. Any process that can write to the daemon's socket, or to
`/dev/uinput`, can type into your session. VOCO's user service runs the daemon
as you, with `UMask=0077`, `NoNewPrivileges=yes` and Unix sockets only. VOCO's
own build of the daemon listens on `/tmp/.ydotool_socket` with mode 0600. VOCO
never changes groups, udev rules or device permissions;
[Access to /dev/uinput](../platform/README.md#access-to-devuinput) lists the
choices.

Passive evdev reads keyboards under `/dev/input`, which usually takes the
`input` group. Membership lets every program you run read every keystroke,
passwords included. VOCO uses those events only to detect its shortcut and to
wait for modifier keys to be released, but the group grants the same access to
everything else you run. The GNOME companion, the IBus input source and a
`voco --toggle` binding need no such access.

## Local interfaces

| Interface | Used by | Checks |
| --- | --- | --- |
| `$XDG_RUNTIME_DIR/voco.sock` and `voice.sock` | `voco --toggle` and desktop bindings | Private directory, socket 0600, peer user ID must match. Each connection is one toggle. |
| `$XDG_RUNTIME_DIR/voco/ibus-engine.sock` | VOCO, talking to its IBus engine | Directory 0700, socket 0600, peer checks on both sides, 1-second timeout, requests up to 4,000,000 bytes and replies up to 64,000. Protocol 6 rejects every text operation. |
| `$XDG_RUNTIME_DIR/voco-browser/exact-field.sock` | `voco-browser-host` | Directory 0700 and a socket owned by you with no group or other access; peer user ID must match. |
| `org.voco.Panel1` on the session bus | The GNOME companion | `Attach` succeeds only for the current owner of `org.gnome.Shell`. Every other method answers only the attached connection. |

Peer checks use `SO_PEERCRED`. Without `XDG_RUNTIME_DIR`, the trigger socket
moves to `voco-<uid>` in the temporary directory, which must be private to you,
or owned by root, sticky and world-writable. The IBus and browser sockets have
no such fallback. When VOCO exits, it removes the trigger socket only if the
file is still the one it created. Any process running as you can use these
interfaces; they keep other accounts out, not your own programs.

## The app window

VOCO's interface is a local web page in WebKitGTK. Its content security policy
loads scripts only from the app, allows network connections only to VOCO's own
IPC and `api.github.com`, and allows media only from the app and microphone
streams. Tauri's capability file gives the page Tauri's core defaults, a short
list of window controls and global-shortcut registration, plus VOCO's own
commands. VOCO grants microphone requests that ask for audio only, and denies
any request that includes a camera.

The window opens two kinds of link through `xdg-open`: release pages under
`https://github.com/sergiopesch/voco/releases/tag/`, and the
[ydotoold section](../platform/README.md#ydotoold-ydotool-daemon) of the
platform guide, on GitHub. It refuses every other address.

## Release check

After startup, and when you change the update channel, VOCO asks the GitHub
releases API for the 12 newest releases, unless its cached answer is younger
than 6 hours. **Check for updates** in Settings always asks. The request
carries no account or device identifier, though GitHub sees your IP address.
VOCO only tells you a release exists; it never downloads or installs anything.
There is no setting that turns the check off.

## Speech worker

VOCO starts `/usr/bin/python3 /usr/lib/voco/speech/stream_worker.py` with pipes
for its input and output. `VOCO_STREAM_PYTHON` and `VOCO_STREAM_WORKER` can
name other absolute files, which then run with your permissions. VOCO reads
response lines of up to 1 MiB, and the worker reads request lines of up to
4 MiB; a longer line ends the exchange. The worker keeps library output off the
protocol, keeps request data and transcripts out of its diagnostics, and refuses
a model whose SHA-256 doesn't match the pinned value, including one named by
`VOCO_NEMOTRON_MODEL`.

## Chromium extension

The extension acts only in a tab where you click its toolbar button, and never
in incognito windows. It asks for `activeTab`, `scripting` and
`nativeMessaging`, with no host permissions, so it can't read other tabs. It
sends VOCO random tokens, document identifiers and counts of inserted
characters, never page addresses or field contents.

It inserts only into the plain text field that had focus when you pressed
Alt+Shift+V. It skips password fields and fields marked for one-time codes or
payment details, and gives up on a field once its focus, selection, content or
page changes. Chromium starts `/usr/libexec/voco-browser-host` only for the
extension's fixed origin, and the host refuses any other. VOCO expires each
request after 1.5 seconds and each field session after 600 seconds, and never
repeats text the field didn't confirm. The
[Chromium guide](../../integrations/chromium/README.md) covers the protocol.

## Dependency policy

`apps/desktop/src-tauri/Cargo.lock` and `package-lock.json` pin every
dependency. VOCO patches three Rust crates and builds one helper from vendored
source, as [vendor/](../../vendor/README.md) records:

| Component | Change | Check |
| --- | --- | --- |
| glib 0.18.5 | [Backport](../../vendor/glib/VOCO-PATCH.md) of the RUSTSEC-2024-0429 fix | `scripts/verify-glib-backport.py`, in CI and packaging |
| global-hotkey 0.8.0 | [Event-driven X11 key grab](../../vendor/global-hotkey/VOCO-PATCH.md) | `scripts/verify-shortcut-backport.py`, in `npm test` |
| tray-icon 0.24.2 | [Fixed, caller-owned icon paths](../../vendor/tray-icon/VOCO-PATCH.md) | `scripts/verify-tray-backport.py`, in `npm test` |
| ydotool 0.1.8, libuInputPlus 0.1.4 | [Private daemon for Ubuntu 24.04's client](../../vendor/ydotool-legacy/README.md) | `scripts/build-legacy-ydotool.py --verify-only`, in `npm run verify:devops` |

CI runs `cargo audit` on the Rust lockfile and `npm run verify:security`, which
is `npm audit` at the moderate level. Scanners that match only version numbers
may still flag glib 0.18.5, because the fix is a backport. A clean audit doesn't
show that every dependency is maintained or free of defects. The package
installs the third-party notices in `/usr/share/doc/voco/`.

## Release signing

One OpenPGP key signs every release. Its public half is in [KEYS](../../KEYS):

```text
B33C7C6AAEC8C20433A7A837540796453D8E3865
```

Confirm this fingerprint through a channel you trust other than the clone
itself. Each release has an annotated, signed `voco.<version>` tag and signed
checksum manifests, each with a detached `.asc` signature. `voco_checksums.txt`
lists the release files, including the package, the installer and KEYS, and
`voco_<version>_debian_checksums.txt` lists only the package.

The guided installer carries its own copy of the key and the fingerprint. It
downloads the package, `voco_checksums.txt` and its signature, and checks the
signature with `gpgv` against that key alone, requiring a valid signature from
that fingerprint. Then it checks the package's SHA-256 before APT sees the
file. If either check fails, it installs nothing.

To check downloaded files by hand, put a manifest, its signature and the files
it lists in one directory. Then, from a clone, run
`scripts/verify-release.sh --keys KEYS` with the manifest's path. The script
imports only KEYS into a temporary keyring and accepts any key in that file, so
check the file's fingerprint first.

| Status | Meaning |
| --- | --- |
| 0 | Every listed file matches, and a key in KEYS signed the manifest. |
| 1 | A file is missing or differs, an entry isn't a plain file name, the signature is bad, or the check can't run safely. |
| 2 | The files match, but the signature is missing or can't be checked against KEYS. |

Hosted CI builds and tests the release application, but it never packages the
speech runtime or holds the signing key. The maintainer assembles, verifies and
signs each release on a Linux computer, from a clean tree at a signed tag whose
commit passed CI, then uploads it as a draft to check before publishing.
[Release process](../release-process.md) covers the steps.

## Known limits

- Programs that run as you share VOCO's access, including its sockets, its
  files and the paste helpers.
- Pasted text goes to whatever has focus when the paste happens, and VOCO
  can't tell whether it landed.
- On X11, every client in the session can read the selections and observe
  keyboard input.
- Dictated text stays in the crash journal until the recording finishes, and
  in Review until you discard it.
- Automated tests check these rules with synthetic audio in private sessions.
  They don't replace an independent review.
