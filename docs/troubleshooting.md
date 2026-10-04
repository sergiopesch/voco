# Troubleshooting

Start with the quick checks, then find your symptom below. If nothing here
helps, [report a bug](#report-a-bug).

## Quick checks

Run these in a terminal in your desktop session:

```bash
voco --version
echo "$XDG_SESSION_TYPE"
voco --check-desktop-input
voco --check-panel
```

They show the installed version, whether your session is `x11` or `wayland`,
whether VOCO can paste or what is missing, and what the GNOME panel needs. The
two checks send no keys, leave the clipboard alone and change no settings. On
Wayland, `getfacl /dev/uinput` shows whether your login may use `/dev/uinput`,
which VOCO needs to press the paste keys; see
[Access to /dev/uinput](platform/README.md#access-to-devuinput).

In VOCO, open **Settings** and choose **Help**. The sections
**My microphone is not working**, **My shortcut is not working** and
**My words are not appearing** describe what VOCO sees. **Technical details**
lists runtime checks for your session, the optional IBus shortcut, paste keys
and the clipboard. After you fix something, choose **Refresh runtime checks**.

### Debug log

VOCO writes its log to the terminal it starts from. For more detail, quit VOCO
and start it with debug logging. The log includes file, device and socket paths
from your computer, so read it before you share it.

```bash
RUST_LOG=debug voco
```

## The installer stops

The installer prints the reason. When it keeps a log, it prints the path after
`Details:` or `Installation details:`. The log is in `/tmp`, or in `TMPDIR` if
you set it, and only your account can read it.

| Message | What to do |
| --- | --- |
| `VOCO installs with APT on Ubuntu and Debian, or with DNF on Fedora. Neither was found.` | Run the installer on one of the [supported systems](platform/README.md#supported-systems). |
| `… is required before downloading VOCO.` | Install the named tool with `sudo apt install`, or `sudo dnf install` on Fedora, then run the installer again. |
| `sudo is required before downloading VOCO.`, or `… is not in the sudoers file` | Your account can't use `sudo` yet, as on a Debian system installed with a root password. As root (`su -`), run `apt install sudo` and `adduser <your user name> sudo`, sign out and back in, then run the installer again. |
| `The download stopped.` | Check your connection and run the installer again. If the release file is unavailable, check that the release exists. |
| A key, signature, signer or checksum error | Nothing was installed. Run the installer again. If the check fails again, don't install the file another way, and report it as described in [SECURITY.md](../SECURITY.md). |
| `Installation failed:` | APT or DNF couldn't install the package. Fix the error it shows, then run the installer again. |

Exit status 2 means VOCO is installed but can't paste yet. The installer names
the problem. The most common ones are:

| Message | What to do |
| --- | --- |
| `VOCO can't open /dev/uinput, so it can't send the paste keys. …` | Sign out and back in once, then run `voco --check-desktop-input`. If it still fails, follow [Access to /dev/uinput](platform/README.md#access-to-devuinput). |
| `Pasting on … requires: …` | Install the package that provides the named program, such as `wl-clipboard` for `wl-copy`. |

When `voco --check-desktop-input` passes, run `voco --setup-panel` on GNOME 46,
48 or 50, then open VOCO. See [Wayland paste keys](install.md#wayland-paste-keys).

## DNF says it skipped OpenPGP checks

On Fedora, DNF warns that it skipped OpenPGP checks when it installs VOCO. This
is expected: the RPM carries no OpenPGP signature of its own. The guided
installer checked the release's signed checksum list, and the package against
it, before DNF started. After a manual install, the checks in
[Manual install](install.md#fedora) do the same.

## Dictation won't start

| What you see | What to do |
| --- | --- |
| **Desktop setup needed**, or a **Dictation setup incomplete** notification | VOCO doesn't record when it can't paste. Run `voco --check-desktop-input` and fix what it names. |
| **VOCO hidden** | A VOCO window was open. Click where you want the text, then press the shortcut again. |
| **Dictation could not start** or **Microphone could not start** | Read the reason in the notification. For microphone reasons, see [Microphone problems](#microphone-problems). |
| **Microphone access is blocked** | Allow microphone access in your desktop's privacy settings, then choose **Retry microphone access** on the **Settings** page. |
| **Choose a microphone in Microphone settings.** | Choose a microphone on the **Settings** page. |
| **Streaming dictation is disabled in the desktop environment.** | VOCO started with `VOCO_DESKTOP_STREAM=0`. Quit VOCO and start it without that variable. |

## The shortcut does nothing

1. Check that VOCO is running. Its tray icon or GNOME panel shows when it is.
2. Start dictation from the tray menu, or run `voco --toggle` in a terminal. If
   dictation starts, the problem is the shortcut.
3. Open **Help**, then **My shortcut is not working**. It says how the shortcut
   reaches VOCO and whether that works.
4. On Wayland outside GNOME 46, 48 and 50, bind a key to `voco --toggle`, as
   described in [Wayland compositor shortcuts](install.md#wayland-compositor-shortcuts).

If `voco --toggle` prints `Could not reach VOCO's private control socket`, VOCO
isn't running in this desktop session. Open VOCO, then try again. To record key
events for a bug report, see [Shortcut traces](#shortcut-traces).

## The shortcut also reaches your app, or does nothing

On Wayland without the GNOME panel, VOCO watches for `Alt+D` and `Alt+Shift+D`
but can't stop your app from receiving them. Browsers jump to the address bar,
so your words land there, and terminals delete a word. VOCO warns once per
launch with **Your shortcut also reached the app**. If VOCO can't read any
keyboard either, the shortcut does nothing, and shortly after VOCO starts it
says **Your shortcut can't reach VOCO yet**. Fix either one of these ways:

- On GNOME 46, 48 or 50, choose **Enable live panel** on the **Help** page, or
  run `voco --setup-panel`. Then sign out and back in.
- Elsewhere, choose another shortcut in VOCO and bind it to `voco --toggle` in
  your desktop's keyboard settings.
- Add the [VOCO Dictation input source](install.md#ibus-input-source). It keeps
  the shortcut from supported text fields.

## Words don't appear

- Click in the field before you start. VOCO pastes into the window that has
  keyboard focus.
- Run `voco --check-desktop-input` and fix what it names.
- Let go of the shortcut and other modifier keys, such as Alt, Ctrl and Super,
  while VOCO types. VOCO waits up to 1.5 seconds for them before it pastes,
  then stops typing.
- On Wayland, if VOCO reports that it can't open `/dev/uinput`, sign out and
  back in once, then check again.
- Apps that remap Shift+Insert, remote desktops and virtual machines may ignore
  the paste, and VOCO can't tell when they do.

When a paste fails, VOCO shows **VOCO stopped typing** and keeps listening. At
Stop, it copies the words it didn't type to the clipboard. See
[If a paste fails](everyday-use.md#if-a-paste-fails).

## Dictation interrupted

VOCO stops transcribing and shows **Dictation interrupted** when it can't trust
the rest of the recording:

| Cause | What to do |
| --- | --- |
| The microphone disconnected, stopped sending audio or was muted by the system | Check the connection and your sound settings. |
| Recognition fell more than three seconds behind | Close busy programs. Recognition uses up to four processor threads. |
| Recognition revised words it had already given | Start again. |

The words VOCO already typed stay in your app. Words it hadn't typed yet aren't
kept, so check the end of your text before you continue.

On X11, **Dictation won't be typed** means VOCO can't confirm it receives all of
your audio. Stop and try again. If it happens again, quit and reopen VOCO.

If VOCO closed during a dictation, or couldn't paste or copy the rest, the text
is in [Review](everyday-use.md#review).

## Microphone problems

| What you see | What to do |
| --- | --- |
| **No microphone found.** | Connect a microphone, or choose one on the **Settings** page. |
| **Microphone could not be read; it may be busy.** | Close other programs that use the microphone, or choose another one. |
| **Microphone changed** | Your chosen microphone is missing, so VOCO uses the system default. Choose it again when it's connected. |
| `VOCO requires a microphone sample rate from 8 to 96 kHz.` | Choose a supported format in your sound settings, then restart VOCO. |
| **Microphone setup required**, with **No default microphone is available.** | Connect a microphone, or choose one on the **Settings** page. If your system's default input is a speaker monitor, choose a microphone instead. |
| **Microphone setup required** after a microphone failed or was unplugged | VOCO stopped using the microphone you chose. Choose one again on the **Settings** page. |
| **Source selection is stale** | The microphone list changed since Settings showed it. Choose **Refresh devices**, then pick the microphone again. |
| Every microphone in the list ends with **— identity unavailable** | On Wayland, VOCO needs PipeWire's PulseAudio service. `pactl info` shows `Server Name: PulseAudio (on PipeWire …)` when it runs; if it shows only `pulseaudio`, switch to PipeWire's service, `pipewire-pulse`, then sign out and back in, or use an X11 session. Until then the voice test can't pass. |
| Missing or wrong words | Set the input level in your sound settings so your voice is clear but not distorted, and reduce background noise. |

## The GNOME panel doesn't appear

The panel works on GNOME 46, 48 and 50, and shows only while VOCO is running.
Run `voco --check-panel` and follow the line it prints. It exits with status 2
when the panel needs a step.

- If the panel isn't enabled, choose **Enable live panel** on the **Help** page,
  or run `voco --setup-panel`. Then save your work and sign out and back in.
  GNOME loads the panel, and any update to it, when you sign in.
- If GNOME extensions are turned off, turn them on in the Extensions app. If a
  policy blocks them, ask your administrator.
- If the panel files are missing, reinstall the VOCO package.
- On other GNOME versions, `voco --check-panel` says that the panel supports
  GNOME 46, 48 and 50. There and on other desktops, use the tray menu.

On Debian 13 and Fedora 44, VOCO's tray icon needs an AppIndicator extension,
which they don't turn on, so until the panel loads VOCO has no icon in the top
bar, and shortly after it starts VOCO says **VOCO has no icon in the top bar**.
Open VOCO from your app menu in the meantime, and turn on the panel as above.

While you dictate, GNOME's microphone privacy indicator appears and moves the
VOCO panel to the left. This is expected.

## VOCO settings need attention

VOCO pauses dictation and shows **VOCO settings need attention** when it can't
safely load `~/.config/voco/config.json`. This happens when the file isn't
valid JSON or has a value VOCO doesn't accept, or when the file or its folder
is a symbolic link or belongs to another user. VOCO fixes their permissions
itself. On a first start VOCO copies an older `~/.config/voice/config.json` if
it finds one, and shows the panel when that file is a symbolic link, isn't a
regular file or belongs to another user. A **Dictation paused** notification
may ask you to open VOCO.

- **Retry loading settings** tries again after you correct the file.
- **Open config directory** opens `~/.config/voco/`.
- **Reset to defaults**, then **Confirm reset**, renames the file to
  `config.recovery-backup-<numbers>.json` in the same folder and writes default
  settings. Your shortcut returns to `Alt+D`, and VOCO runs the voice test
  again. VOCO keeps these backups until you delete them.

## Chromium extension problems

| Toolbar button tooltip | What to do |
| --- | --- |
| **Start VOCO, then click again** | VOCO isn't running, or the browser can't reach it. Open VOCO, then click the button again. |
| **VOCO cannot access this page** | Browser pages and some sites block extensions. Use a normal web page. |
| **Enable VOCO in this tab** | The extension is off in this tab. It turns off when the page changes or VOCO quits. Click it to turn it on. |

The package registers VOCO for Google Chrome and Chromium in
`/etc/opt/chrome/native-messaging-hosts` and
`/etc/chromium/native-messaging-hosts`. A browser that doesn't read those
folders can't reach VOCO. If `Alt+Shift+V` does nothing in a field, check that
the field is one VOCO accepts, as described in
[Browser fields](everyday-use.md#browser-fields).

## IBus input source problems

Open **Help**, then **Technical details**, and read **IBus shortcut (optional)**:

- **Input source not enabled:** add and select **VOCO Dictation**, as described
  in [IBus input source](install.md#ibus-input-source).
- **Package refresh required:** the input source and the app are from different
  versions. Quit VOCO, run `ibus restart` or sign out and back in, then open
  VOCO. Switching input sources isn't enough.
- **Desktop session unavailable:** sign out and back in.

## Opening VOCO does nothing

While you dictate, opening VOCO from the app menu doesn't show the popover.
Finish dictating first. Otherwise, a **VOCO could not start** notification
gives the reason:

| Reason | What to do |
| --- | --- |
| `VOCO is running but could not receive the launcher request` | The running VOCO didn't answer. This can happen with a copy started before an upgrade. Use its tray or panel menu, or quit it with `pkill -x voco` and open VOCO again. |
| `could not write the tray icons: …` | VOCO keeps its tray icons in `$XDG_RUNTIME_DIR/voco`, which is usually a small memory-backed folder. Free space there, or sign out and back in, then open VOCO again. |

## Performance logs

Performance logs record how long each step of a dictation takes. They are off
by default. To turn them on, quit VOCO and start it from a terminal. They stay
on until VOCO quits.

```bash
VOCO_PERFORMANCE_LOG=1 voco
```

VOCO writes `performance/performance.jsonl` and
`stream-performance/worker.jsonl` in `~/.local/state/voco`, or in
`$XDG_STATE_HOME/voco` if you set it. Only your account can read them. At
8 MiB, VOCO starts a new file. It keeps one older performance file and up to
three older worker files.

The logs contain timings, counts, sizes, status codes, processor and memory
use, the app and model versions, and hashed session IDs. They never contain
audio, dictated text, clipboard contents, window titles, web addresses or
device names. If the disk can't keep up, VOCO drops log events instead of
slowing dictation.

The package includes two summary scripts. Quit VOCO first so the files are
complete:

```bash
python3 /usr/share/doc/voco/report-performance.py
python3 /usr/share/doc/voco/report-speech-performance.py ~/.local/state/voco
```

`report-performance.py` summarizes the latest run. Add `--run` with a run ID to
pick another, or `--json` for the full report.

### Shortcut traces

To record shortcut events, start VOCO with `VOCO_HOTKEY_TRACE=1 voco`. VOCO
writes event names, timings, the shortcut route and your session type to
`~/.local/state/voco/hotkey-trace.jsonl`. At 8 MiB, it renames the file to
`hotkey-trace.previous.jsonl` and starts a new one.

## Report a bug

Open an issue from the
[issue templates](https://github.com/sergiopesch/voco/issues/new/choose).
Include:

- The output of `voco --version`, your distribution and desktop, X11 or
  Wayland, and the app you dictated into
- The steps to reproduce, what you expected and what happened
- The exact error text, or a summary from the report scripts

Don't post recordings, transcripts, credentials or full logs. Use made-up
sample sentences, and remove personal text and paths from anything you share.
Report security problems privately, as described in [SECURITY.md](../SECURITY.md).
