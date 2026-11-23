# TLA+ models

These are [TLA+](https://lamport.azurewebsites.net/tla/tla.html) specifications
of VOCO's state machines whose cases are easy to miss: two things that happen
at once, a timer that fires late, an answer that arrives after VOCO stopped
waiting for it. Each names the code it models. The model checker, TLC, visits
every state a model can reach and checks the properties below in each.

| Model | Code | Properties |
| --- | --- | --- |
| `DictationSession` | `apps/desktop/src/lib/dictationSession.ts`, driven by `dictationRecording.ts`, `useDictation.ts` and `App.tsx` | A Stop waits only for a start in flight. The store shows the session's phase. A session that was asked to stop, or cancelled, never records, also when asked before "starting" was shown, and it ends |
| `NativeCapture` | `apps/desktop/src/lib/nativeCapture.ts` | Polling starts only at activation. An interruption is reported once, never for a cancelled capture. A stopped capture had its tail confirmed and never failed. Cancel is final |
| `UpdateCheck` | `apps/desktop/src/lib/updateCheckCoordinator.ts` | "Checking" is shown only while a check will replace it, so never once every check has ended. A result comes from the newest check for the selected channel |
| `UpdateInstall` | `Install` and `Gate` in `apps/desktop/src-tauri/src/update_install.rs` | An accepted Cancel stops the install before the password prompt. The prompt opens only when no session may be running, and no recognition starts from then on. Installed is final |
| `CommandCalls` | `CommandTrain` in `apps/desktop/src-tauri/src/shortcut_arbitration.rs` | Each call is taken for a press, a repeat or one still open by the gap before it alone. No call toggles twice. A held key toggles once however late its timer runs, and every tap toggles |
| `ShortcutPresses` | `Presses` in `apps/desktop/src-tauri/src/gnome_shortcut.rs` | A chord held for any time toggles once, whether or not GNOME delivered its press twice, at GNOME's default repeat timing and at a fast keyboard's |

## Checking them

```bash
VOCO_TLA_TOOLS=~/tla2tools.jar scripts/check-specs.sh
```

`VOCO_TLA_TOOLS` is the path of a `tla2tools.jar` from the
[TLA+ releases](https://github.com/tlaplus/tlaplus/releases), which needs Java
11 or later. The script checks every `.cfg` here against the module it is named
after, `Module.cfg` or `Module.name.cfg`, and fails on the first property a
model violates, with TLC's trace of how it got there. Module names as arguments
check only those. CI doesn't run it.

## What a model covers

A model holds the decisions of one state machine: its states, the events it
takes, and what it does with each event in each state. Timers, IPC, the desktop
and the person are its environment, and each model says what it assumes of
them. `ShortcutPresses`, for one, assumes a repeat runs early or late by less
than the margin VOCO allows it, and `UpdateInstall` that the renderer reports a
dictation within five seconds of its session's start or not at all.

The models are bounded, a few sessions, checks or key presses and a short
stretch of time, so TLC proves a property for every behaviour within those
bounds and no further. They don't cover the code around the state machine:
that the code takes the transition the model says is for the unit tests beside
each machine. The two shortcut machines have a test that lists every state
against every kind of call.

Change a state machine, its model and its tests together. A property that
no longer holds is a finding: write the cause down before changing the model
to fit the code.
