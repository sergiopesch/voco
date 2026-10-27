"""Authored lessons with pinned implementation references; no generated speech data."""

from pathlib import Path
import json, sys

F = "apps/desktop/src/"
B = "apps/desktop/src-tauri/src/"
P = "apps/desktop/src-tauri/resources/"
R = "runtime/speech/"
chapters = []


def lesson(
    id,
    title,
    intro,
    story,
    steps,
    facts,
    files,
    caution,
    question,
    answers,
    correct,
    why,
    lab="journey",
):
    chapters.append(
        dict(
            id=id,
            title=title,
            intro=intro,
            story=story,
            steps=[dict(label=a, detail=b) for a, b in steps],
            facts=[dict(title=a, text=b) for a, b in facts],
            files=[dict(path=a, why=b) for a, b in files],
            caution=caution,
            quiz=dict(question=question, answers=answers, correct=correct, why=why),
            lab=lab,
        )
    )


lesson(
    "big-picture",
    "A voice becomes words.",
    "Imagine a small team inside your computer. One member listens, one understands, and one puts the words where you are typing.",
    [
        "Press the shortcut and VOCO starts listening. It turns your speech into words on your own computer and pastes them at your cursor while you are still talking. Press the shortcut again and VOCO finishes the last words.",
        "Each part of VOCO does one job and passes small messages to the next. Sound travels in packets of one tenth of a second, so words can appear before you finish a sentence.",
        "Nothing you say leaves the computer. The speech model runs on the processor, and the only network request asks GitHub whether a new release exists. Later chapters open each box and show the real code inside.",
    ],
    [
        (
            "Shortcut",
            "You press Alt+D, or the shortcut you chose. The same shortcut, or Stop dictation in VOCO's menu, ends the recording.",
        ),
        (
            "Microphone",
            "VOCO records the microphone. On Wayland, Rust records through libpulse. On X11, the window records through a WebKit AudioWorklet.",
        ),
        (
            "Speech model",
            "A Python worker runs NVIDIA Nemotron Speech Streaming on the processor and answers with the transcript so far.",
        ),
        (
            "Delivery",
            "Only the new words move on. VOCO puts them on the clipboard, then presses Shift+Insert.",
        ),
        (
            "Your cursor",
            "The words land in whichever app has keyboard focus. VOCO never presses Enter for you.",
        ),
    ],
    [
        (
            "One warm worker",
            "The speech worker starts and loads its model when VOCO launches, then stays running between recordings. If it has exited, the next recording starts a fresh one.",
        ),
        (
            "Words follow the focus",
            "VOCO doesn't remember where a recording started. Each group of words goes to whatever has keyboard focus when that group is ready.",
        ),
        (
            "Local by design",
            "The window's content security policy allows connections only to VOCO itself, Tauri's message channel and api.github.com. Speech never needs the network.",
        ),
        (
            "Stop finishes the job",
            "Stop sends the last audio, waits for the final transcript and pastes it. After a finished sentence it adds one space, so the next dictation starts apart. Words that couldn't be pasted are copied to the clipboard, and VOCO tells you.",
        ),
    ],
    [
        (F + "lib/dictationRecording.ts", "Runs one recording from Start through Stop."),
        (F + "lib/dictationStream.ts", "Sends audio packets and passes on only the new words."),
        (B + "speech_stream.rs", "Starts the speech worker and exchanges one message at a time with it."),
        (R + "worker_main.py", "The worker's main loop: one request in, one answer out."),
        (B + "insertion.rs", "Copies words to the clipboard and presses the paste key."),
        (
            "apps/desktop/src-tauri/tauri.conf.json",
            "The app's identity, its content security policy and the Debian package contents.",
        ),
    ],
    "VOCO pastes into whatever has keyboard focus. Sending the paste keys doesn't prove that the app accepted the words.",
    "You start dictating in an editor, then click into a chat window while you keep talking. Where do the next words go?",
    [
        "Back to the editor, where the recording started",
        "To the chat window, because it now has keyboard focus",
        "Nowhere, because VOCO pauses when focus changes",
    ],
    1,
    "VOCO pastes each group of words into whatever has keyboard focus when the group is ready. It doesn't remember where the recording started.",
)

lesson(
    "languages",
    "Meet the languages.",
    "VOCO is one app written in several languages. Each language sits where it fits best.",
    [
        "Rust is the part the operating system sees. It starts processes, owns files and sockets, talks to the desktop and presses the paste keys.",
        "The window is a small React app written in TypeScript. It runs inside WebKitGTK and can reach the system only through commands that Rust registers.",
        "Speech recognition runs in a Python worker. A small C++ bridge connects it to NeMo-Speech.cpp, the native recognizer. Two optional extensions, one for GNOME Shell and one for Chromium, are written in JavaScript.",
    ],
    [
        (
            "Rust",
            "The Tauri 2 shell: processes, sockets, files, D-Bus, the tray, Wayland capture and paste.",
        ),
        (
            "TypeScript",
            "The React 19 window: onboarding, settings, each recording and X11 capture.",
        ),
        (
            "Python",
            "The speech worker reads one JSON line and writes one JSON line for each request.",
        ),
        (
            "C and C++",
            "native_capture_pulse.c talks to libpulse. nemo_bridge.cpp calls the recognizer.",
        ),
        ("JavaScript", "The GNOME companion in the top bar and the Chromium extension."),
    ],
    [
        (
            "Pinned toolchains",
            "CI builds with Rust 1.99.0 and the Node version in .nvmrc, which is 24. Cargo.toml pins Tauri to exactly 2.12.2.",
        ),
        (
            "Messages, not shared memory",
            "The parts talk through Tauri commands and events, a pipe to the worker, local sockets and D-Bus. No part reaches into another's memory.",
        ),
        (
            "A clean Python process",
            "Rust starts the worker as python3 -E -s -B, so Python ignores PYTHON variables and your own site-packages, and writes no cache files next to the installed code.",
        ),
        (
            "Where each part lives",
            "apps/desktop/src holds the window, apps/desktop/src-tauri the Rust shell, runtime/speech the worker, runtime/native the recognizer build and integrations the two extensions.",
        ),
    ],
    [
        (B + "lib.rs", "The Rust shell: startup, shortcuts and every registered command."),
        (F + "App.tsx", "The root of the React window."),
        (R + "worker_main.py", "The Python worker's request loop."),
        (R + "nemo_bridge.cpp", "The C++ bridge from Python to the native recognizer."),
        (
            "apps/desktop/src-tauri/native/native_capture_pulse.c",
            "The C layer that records through libpulse.",
        ),
        (
            "integrations/gnome/voco-panel@sergiopesch.com/extension.js",
            "The GNOME Shell companion, in JavaScript.",
        ),
        ("integrations/chromium/content.js", "The Chromium extension's script inside web pages."),
        ("apps/desktop/src-tauri/Cargo.toml", "Rust dependencies, the exact Tauri version and the minimum Rust version."),
        ("apps/desktop/package.json", "The window's dependencies: React, TypeScript and Vite."),
        ("package.json", "Repository scripts and the required Node version."),
    ],
    "The window has no shell plugin and can't start programs. It can ask only for the commands that lib.rs registers.",
    "Which part starts the speech worker and the paste helpers?",
    ["The React window", "The GNOME companion", "The Rust shell"],
    2,
    "Only Rust starts processes. The window asks Rust through registered commands, and the companion talks to VOCO over D-Bus.",
)

lesson(
    "shortcut",
    "One press, one recording.",
    "A shortcut makes a small promise: one press starts a recording, and the next press finishes it.",
    [
        "The shortcut is Alt+D unless you change it. Change shortcut in VOCO's menu offers Alt+D, Alt+Shift+D and Custom shortcut…, which opens the shortcut settings. A custom shortcut needs Alt, Control or Super plus one main key.",
        "How the key press reaches VOCO depends on the desktop. On X11, VOCO grabs the shortcut. On Wayland, VOCO reads the keyboards for the two preset shortcuts, or the GNOME companion grabs them inside the Shell.",
        "Every route ends at the same gate. It ignores a second toggle that arrives within 120 ms of the first, so one press never counts twice.",
    ],
    [
        (
            "Choose",
            "VOCO checks the saved shortcut at startup. An invalid one is reset to Alt+D, and VOCO tells you why.",
        ),
        (
            "Route",
            "The press arrives through the X11 grab, the companion's grab, keyboard reading, the VOCO Dictation IBus input source or voco --toggle.",
        ),
        (
            "Consume",
            "A grab keeps the keys away from other apps. Reading the keyboards only observes, so the focused app sees the keys too.",
        ),
        ("Debounce", "A toggle within 120 ms of the previous one is ignored."),
        (
            "Toggle",
            "The window starts or stops the recording. A toggle that arrives before the window is ready is kept and applied once it is.",
        ),
    ],
    [
        (
            "X11 toggles on release",
            "While the chord is held, VOCO's grab receives every key. VOCO waits for the release before it toggles, so the paste keys reach the app.",
        ),
        (
            "Passive keys also reach the app",
            "When VOCO reads the keyboards, the focused app gets the shortcut as well. Browsers move the cursor to the address bar, so your words land there, and terminals delete a word. Once per launch VOCO shows \"Your shortcut also reached the app\" with a way to avoid it.",
        ),
        (
            "One toggle, however it arrives",
            "The GNOME companion holds a 2.5-second lease on the shortcut, and while it is fresh VOCO ignores the same keys from the keyboards. The IBus source holds a 1-second lease, and VOCO also releases its X11 grab so the source receives the keys.",
        ),
        (
            "voco --toggle",
            "A desktop binding can run voco --toggle. It connects once to VOCO's owner-only socket, and the connection itself is the request. It never launches VOCO, changes focus or confirms whether recording started.",
        ),
        (
            "Other shortcuts on Wayland",
            "Keyboard reading covers only Alt+D and Alt+Shift+D, so any other shortcut on Wayland needs a desktop binding that runs voco --toggle. VOCO registers a shortcut through Tauri's global-shortcut plugin only outside Wayland, and only while no IBus source takes the chord. Whenever settings can't confirm that the shortcut works, they advise: \"To dictate into other apps, start dictation from the tray or assign voco --toggle to a shortcut in your desktop settings.\"",
        ),
        (
            "Reading keyboards",
            "VOCO reads the keyboards in /dev/input that have an Alt key and a D key, and watches for keyboards you plug in later. It needs read access to those devices. It skips two synthetic keyboards by name, VOCO's own virtual keyboard and the device another tool's ydotoold creates, so their keys never count as the shortcut or a held modifier.",
        ),
        (
            "When nothing hears the shortcut",
            "If no keyboard is readable and neither the GNOME companion nor the IBus source takes Alt+D or Alt+Shift+D, the shortcut does nothing at all. 20 seconds after the keyboard reader starts, VOCO says \"Your shortcut can't reach VOCO yet\" once and names the fix, such as enabling the VOCO panel or assigning voco --toggle to a shortcut.",
        ),
        (
            "Plain status",
            "Shortcut help in Settings explains the current route in plain words, for example \"VOCO's GNOME panel handles this shortcut.\" or \"A live synchronized keyboard supports the configured shortcut.\"",
        ),
    ],
    [
        (B + "lib.rs", "Registers the shortcut, reads keyboards on Wayland and emits the toggle."),
        (B + "shortcut_arbitration.rs", "The 120 ms gate every toggle passes, and the IBus lease."),
        (
            B + "hotkey_state.rs",
            "Tracks which keys each keyboard holds and counts the keyboards that can send each preset, so unplugging one can't leave a modifier stuck.",
        ),
        (B + "shortcut_readiness.rs", "Explains in plain words whether the shortcut can work right now."),
        (B + "panel_setup.rs", "Names the fix in the shortcut notices."),
        (B + "panel.rs", "The GNOME companion's D-Bus service and its shortcut lease."),
        (B + "ibus_shortcut.rs", "Receives the shortcut from the VOCO Dictation input source."),
        (P + "voco_ibus_engine.py", "The IBus input source that consumes the chord and changes no text."),
        (B + "trigger_socket.rs", "The owner-only socket behind voco --toggle."),
        (B + "main.rs", "Command-line options, including --toggle."),
        (B + "tray.rs", "The tray menu, including Change shortcut."),
        (F + "hooks/useGlobalShortcut.ts", "Listens for the toggle event in the window."),
        (F + "lib/dictationTrigger.ts", "Tells desktop and browser triggers apart."),
        (F + "lib/shortcutPresentation.ts", "Turns the shortcut's status into the words settings show."),
    ],
    "Reading the keyboards only observes. The companion's grab keeps the keys out of every app, and the IBus source keeps them out of IBus-aware fields.",
    "On Wayland without the GNOME companion, you press Alt+D in a browser. What happens?",
    [
        "Only VOCO sees the key press",
        "The browser may also act on Alt+D, for example by focusing its address bar",
        "Nothing, because VOCO blocks Alt+D on Wayland",
    ],
    1,
    "Without the companion, VOCO reads the keyboards and only observes. The browser receives Alt+D too, which is why VOCO warns you once per launch.",
)

lesson(
    "microphone",
    "Sound becomes numbers.",
    "A microphone measures tiny changes in air pressure. VOCO reads those measurements as a long list of numbers called samples.",
    [
        "On Wayland, Rust records through libpulse from PipeWire's Pulse service, which gives each source the identity VOCO needs to select it. It takes 44,100 samples per second on two channels and averages them into one.",
        "On X11, the window records through WebKit with an AudioWorklet. If WebKit offers only the older ScriptProcessor fallback, VOCO can't confirm that it receives every sample. It shows \"Dictation won't be typed\" and never pastes that recording.",
        "Silence is valid audio, so a long pause never ends a recording. VOCO stops on its own only when capture fails or after ten minutes.",
    ],
    [
        (
            "Choose a source",
            "Microphone settings list every source and mark monitors of your speakers as (output monitor). VOCO uses the system default only when it is a microphone with a PipeWire identity.",
        ),
        ("Capture", "The C layer records 16-bit stereo at 44,100 Hz in 10 ms fragments."),
        (
            "Mix to mono",
            "On Wayland, VOCO averages the two channels into one, because the speech model needs one channel.",
        ),
        (
            "Drain",
            "Rust pumps the stream every 5 ms while recording, and the window collects the samples. If the window stops collecting for 5 seconds, capture ends with \"Renderer drain lease expired\".",
        ),
        (
            "Watch health",
            "If capture reports a problem, VOCO ends the recording with an error. At 600 seconds it stops normally, like pressing Stop.",
        ),
    ],
    [
        (
            "No microphone chosen yet",
            "VOCO still counts as ready when the system default is a microphone it can record from: the tray reads \"VOCO — Ready · microphone checks on first use\", and Start dictation chooses that default. Without such a default it reads \"VOCO — Microphone setup required\". VOCO opens no microphone until a recording, a voice test or a Say it check starts.",
        ),
        (
            "No default microphone",
            "When there is no default, or the default is a monitor or has no PipeWire identity, VOCO says \"No default microphone is available. Connect a microphone or choose one in Microphone settings.\"",
        ),
        (
            "Health checks in WebKit",
            "Every 250 ms VOCO checks the WebKit track. It cancels the recording if the track ends, stays muted by the system for 3 seconds or delivers no samples for 5 seconds.",
        ),
        (
            "The drain lease",
            "Only VOCO's main page may drain native capture. If the window stops draining, capture ends after 5 seconds, so a stuck window can't keep the microphone open.",
        ),
        (
            "A ten-minute limit",
            "Both capture paths stop after 600 seconds, and the recording finishes like a normal Stop.",
        ),
        (
            "The level meter",
            "The window computes each level from a batch of samples, the same way on every capture path. The level spans -44 to -12 dB, VOCO sends a new one at most every 40 ms, and a level older than 250 ms reads as silence.",
        ),
    ],
    [
        (F + "lib/nativeCapture.ts", "The window's side of native capture: start, drain and stop."),
        (B + "native_capture/mod.rs", "Native capture's lease, pump and call timeouts."),
        (B + "native_capture/pulse.rs", "Rust's side of the C capture layer."),
        (
            "apps/desktop/src-tauri/native/native_capture_pulse.c",
            "Records from libpulse: 16-bit stereo at 44,100 Hz.",
        ),
        (B + "native_capture_commands.rs", "The commands the window uses for native capture."),
        ("apps/desktop/public/audio-processor.js", "The X11 AudioWorklet that forwards samples."),
        (F + "hooks/useDictation.ts", "Opens the microphone and wires capture into a recording."),
        (F + "hooks/useNativeCaptureSettings.ts", "Loads the list of native sources for settings."),
        (F + "lib/captureHealth.ts", "The WebKit health checks."),
        (F + "lib/audioLevel.ts", "Turns samples into a meter level."),
        (F + "lib/desktopCaptureTail.ts", "Keeps samples in memory for the Stop tail, up to the limit."),
        (F + "lib/dictationRecovery.ts", "The 600-second limit both capture paths share."),
        (F + "components/NativeMicrophoneSettings.tsx", "Microphone settings, including monitor labels."),
        (F + "lib/nativeCaptureSettings.ts", "Finds the system default microphone VOCO can record from."),
        (F + "lib/dictationPresentation.ts", "Keeps VOCO ready when no microphone is chosen yet."),
    ],
    "A long pause keeps the recording open. Press the shortcut again when you finish, or VOCO keeps listening until the ten-minute limit.",
    "You pause for ten seconds in the middle of a sentence. What does VOCO do?",
    [
        "Keeps recording, because silence is valid audio",
        "Stops after five seconds of silence",
        "Deletes the words so far",
    ],
    0,
    "The health checks look for capture that stopped delivering samples, not for quiet. Only a capture failure or the ten-minute limit ends a recording on its own.",
    "wave",
)

lesson(
    "queue",
    "Audio on a conveyor belt.",
    "Audio doesn't wait for the end of a sentence. It moves to the speech worker in small packets, like boxes on a conveyor belt.",
    [
        "VOCO cuts the audio into packets of one tenth of a second and sends one request to the worker at a time. Each request carries the recording's session name and a number that grows by one.",
        "Each answer holds the whole transcript so far. VOCO compares it with the previous one and passes on only the new ending. Words never change once they move on.",
        "If recognition falls more than three seconds behind, or rewrites words it already gave, VOCO stops transcribing this recording. Words already pasted stay where they are.",
    ],
    [
        (
            "Collect",
            "The stream gathers round(rate × 0.1) samples, which is 100 ms of audio at any sample rate.",
        ),
        ("Send", "Only one request is in flight. Newer packets wait in line."),
        (
            "Check",
            "Each answer must carry the same session and number as its request, and the append-only mode.",
        ),
        ("Compare", "VOCO keeps only text that extends the previous transcript."),
        (
            "Paste",
            "The new words go to delivery, each desktop paste ending between two characters that aren't spaces. If a paste is still running, newer words wait and go together.",
        ),
    ],
    [
        (
            "A three-second limit",
            "When more than three seconds of audio wait in line, VOCO stops with \"Recognition fell more than three seconds behind, so VOCO stopped transcribing.\"",
        ),
        (
            "No rewrites",
            "If an answer changes earlier words, VOCO stops with \"Recognition revised earlier words, so VOCO stopped transcribing.\" Either way you see \"Dictation interrupted\", and the words already pasted stay.",
        ),
        (
            "Three paste outcomes",
            "A paste that changes nothing leaves the words pending for the next words, a quiet release or Stop, which retries them 3 times, 250 ms apart. A rejected paste, refused before the clipboard changed, stops typing. An uncertain paste also stops typing, and VOCO never sends those words again.",
        ),
        (
            "Metadata, not words",
            "The queue reports lengths, counts and timings, never the words, and only when VOCO_PERFORMANCE_LOG=1: once Rust answers that logging is off, the window sends no reports. At most 32 reports are in flight; extra ones are dropped and counted, and Rust keeps only the fields it knows.",
        ),
    ],
    [
        (
            F + "lib/dictationStream.ts",
            "Packets, the one-request rule, append-only checks and the three-second limit.",
        ),
        (F + "lib/dictationStream.test.ts", "Tests for revisions, backlogs and paste outcomes."),
        (F + "lib/dictationStream.startup.test.ts", "Tests for the start of a stream."),
        (F + "lib/desktopCaptureTail.ts", "Forwards retained audio to the stream at Stop."),
        (B + "performance.rs", "Keeps only known metadata fields from queue reports."),
    ],
    "Append-only is a promise about delivery, not about the model. The model may change its mind, and VOCO stops rather than edit text that is already in an app.",
    "The worker's new answer changes a word VOCO already pasted. What happens?",
    [
        "VOCO deletes the old word and pastes the new one",
        "VOCO ignores the change and keeps pasting",
        "VOCO stops transcribing this recording, and the pasted words stay",
    ],
    2,
    "VOCO never edits text it already delivered. A revision breaks the append-only rule, so transcription stops and the pasted words stay as they are.",
    "queue",
)

lesson(
    "worker",
    "The speech worker has a rulebook.",
    "The speech worker is a separate program. VOCO and the worker follow a short rulebook, one message at a time.",
    [
        "VOCO starts one worker when it launches and keeps it warm. The two talk through a pipe: VOCO writes one line of JSON, and the worker answers with one line. The requests are start, push, finish and cancel, and a push carries at most one second of audio.",
        "Every message is checked on both sides. If anything goes wrong, such as a timeout, a mismatched answer or a rejected request, Rust drops the worker.",
        "A new worker starts only at the next warmup or the next recording. VOCO never sends the same request twice, so no audio is processed twice.",
    ],
    [
        (
            "Launch",
            "Rust runs /usr/bin/python3 -E -s -B with stream_worker.py. VOCO_STREAM_PYTHON and VOCO_STREAM_WORKER may name other absolute local files. The worker has 30 seconds to load the model and report ready.",
        ),
        ("Start", "A start names the session, 1 to 80 characters long, and a number that is 0 or more."),
        (
            "Push",
            "Each push carries at most one second of mono audio at 8,000 to 96,000 Hz. The rate stays the same for the whole session, and every value must be a finite number.",
        ),
        (
            "Answer",
            "The worker answers within 10 seconds. A push returns text only when the transcript changed; a finish always returns the final text.",
        ),
        ("Close", "A finish or cancel ends the session. Each request's number must be larger than the last."),
    ],
    [
        (
            "Bounded messages",
            "A request may be at most 4 MiB and an answer at most 1 MiB. Anything larger is refused.",
        ),
        (
            "Clean output",
            "stream_worker.py keeps library messages off the protocol, so only answers travel on the worker's output.",
        ),
        (
            "Your spelling",
            "Each session start carries the saved spelling. spelling.py converts the whole hypothesis with a table of unambiguous VarCon forms and emits only text that can no longer change, so pasting stays append-only. Only lowercase words change, so names stay, and so do words whose spelling depends on meaning.",
        ),
        (
            "Your words",
            "Each start also carries the My words list. mywords.py skips any entry that breaks the list rules: at most 100, each at most four words and 40 characters, and at most three combining marks on a letter or digit. adapters.py hands the rest to NeMo-Speech.cpp as one speech context at a boost of 0.5, and the worker writes each listed occurrence as listed, ignoring case, accents and the spaces inside it. The start carries the taught versions too, what the recognizer wrote when you said a word, up to five for each: the worker writes the word wherever it hears one, and never boosts them. A push holds back any tail that later text could still turn into a listed term or a taught version, and spelling never converts a listed word.",
        ),
        (
            "No network for the worker",
            "Just before Python starts, worker_sandbox.rs marks every descriptor beyond the worker's standard streams close-on-exec, so it inherits no socket of VOCO's, and installs a seccomp filter. Every socket and socket pair, Unix ones included, and io_uring fail with permission denied. If the filter can't be installed, the worker doesn't start. The worker also gets only the environment variables it reads, so nothing tells it where the session bus, the display or an agent socket is.",
        ),
        (
            "The thread rule",
            "The worker uses one less than the processors it may run on, between 1 and 4, to leave room for capture, the compositor and the app you are typing into. NEMO_SPEECH_CPU_THREADS overrides it.",
        ),
        (
            "No replay",
            "If the worker dies during a recording, the next push or finish gets \"worker lost\". Transcription ends for that recording, and the next recording starts a new worker.",
        ),
        (
            "Private diagnostics",
            "When the worker rejects a request, its answer names only the error type after \"stream request rejected: \". It never contains audio or text.",
        ),
    ],
    [
        (B + "speech_stream.rs", "Starts the worker, enforces time limits and never replays a request."),
        (B + "worker_sandbox.rs", "Confines the worker: close-on-exec descriptors and the seccomp filter."),
        (R + "stream_worker.py", "The worker's entry point; keeps library output off the protocol."),
        (R + "worker_main.py", "Checks every request and answers one line at a time."),
        (R + "streaming.py", "Checks audio packets and runs the silence gate."),
        (R + "spelling.py", "British or American spelling, emitted only once it can't change."),
        (R + "mywords.py", "My words: the list rules, the boosted phrases, the taught versions and each listed occurrence written as listed."),
        (R + "test_worker_protocol.py", "Tests for the rulebook."),
        (R + "test_cpu_threads.py", "Tests for the thread rule."),
    ],
    "The worker's answer says what the model heard, not what reached an app. Delivery is a separate step with its own outcomes.",
    "The worker crashes in the middle of a recording. What happens?",
    [
        "VOCO restarts it and replays the audio",
        "Transcription stops for this recording, and the next recording starts a new worker",
        "VOCO keeps pasting from its own copy of the model",
    ],
    1,
    "Rust never replays a request. A push or finish without a worker gets \"worker lost\", and a new worker starts only at the next warmup or recording.",
    "protocol",
)

lesson(
    "model",
    "How the model guesses words.",
    "A speech model doesn't look words up. It makes a careful guess from patterns it learned, and the guess grows as you speak.",
    [
        "VOCO uses NVIDIA Nemotron Speech Streaming, an English model with 0.6 billion parameters, stored at 8-bit precision in a GGUF file. It runs on the processor through NeMo-Speech.cpp and needs no graphics card.",
        "The model is built for streaming. It listens in short chunks and keeps a growing guess of the transcript, with punctuation.",
        "Before loading, the worker checks the file's SHA-256 fingerprint. If it doesn't match the pinned value, the worker refuses to start.",
    ],
    [
        (
            "Verify",
            "The worker computes the model file's SHA-256 and compares it with the pinned value. A mismatch stops the worker before the model loads.",
        ),
        (
            "Load",
            "The recognizer loads with its right-context setting at 1. VOCO_NEMOTRON_CONTEXT accepts 0 or 1.",
        ),
        (
            "Warm up",
            "Before the first recording, the worker runs one second of zeros at 16,000 Hz through the recognizer.",
        ),
        (
            "Gate",
            "Long runs of exact digital zeros are skipped. The gate keeps 640 ms before sound and 1.5 seconds after it.",
        ),
        (
            "Transcribe",
            "The recognizer returns its finished text joined with its latest partial guess.",
        ),
    ],
    [
        (
            "A pinned build",
            "NATIVE-BUILD.json records the NeMo-Speech.cpp and ggml revisions and the patch digests. The build targets generic x86-64 with AVX, AVX2, FMA and F16C, and leaves AVX-512, AMX and OpenMP off. That sets the processor VOCO needs.",
        ),
        (
            "Two small patches",
            "One patch lets the first chunk start without waiting for another 90 ms of audio. The other runs 1 to 16 threads in a pool that sleeps between steps instead of spinning.",
        ),
        (
            "Fewer, larger frames",
            "When the gate releases audio it held back, the worker joins those packets into frames of at most one second, without changing any samples.",
        ),
        (
            "Original samples",
            "The recognizer always receives the original samples at the capture rate, and each push names that rate.",
        ),
        (
            "The tokenizer inside",
            "NVIDIA's GGUF holds the decoder's vocabulary but not the SentencePiece tokenizer the recognizer needs to turn phrases into the model's pieces. VOCO's copy adds that tokenizer from NVIDIA's checkpoint as one metadata entry. Every weight and every other entry stays as NVIDIA published it, and the pinned fingerprint is that of the result.",
        ),
        (
            "Punctuation comes with the next word",
            "Measured on public speech, the recognizer usually writes a comma or full stop only once it hears the next word, so at a pause its text rarely ends in one. In the study's development set, today's recognizer gave 62.7% of pauses between sentences a sentence end, so where you pause the full stop can come a word late or not at all. The worker changes recognized text only for spelling and My words, so VOCO adds no full stop of its own where you pause.",
        ),
        (
            "Turning the gate off",
            "VOCO_SILENCE_GATE=off disables the gate. The default mode, zero, treats a packet as quiet only when every sample is exactly zero. Any other value stops the worker before the model loads.",
        ),
    ],
    [
        (R + "adapters.py", "Checks the model fingerprint and loads the native library."),
        (R + "nemo_bridge.cpp", "The bridge into NeMo-Speech.cpp."),
        (R + "streaming.py", "The warmup, the silence gate and frame joining."),
        (R + "worker_main.py", "The request loop and the thread rule; it changes recognized text only for spelling and My words."),
        ("research/pause-sentence-ends-2026-10/harness/run_policies.py", "The pause study's runs on public speech, which record the recognizer's text at every pause."),
        ("research/pause-sentence-ends-2026-10/results/dev-table.txt", "The pause study's development results; P0 is today's recognizer."),
        (R + "MODEL-IDENTITY.json", "The model's source, revision and fingerprint, and those of the NVIDIA file and tokenizer it is built from."),
        ("scripts/graft-model-tokenizer.py", "Adds the tokenizer to NVIDIA's GGUF and checks every pin."),
        (R + "NATIVE-BUILD.json", "Pinned revisions, patch digests and processor flags."),
        ("runtime/native/build.py", "Builds the native recognizer from pinned source."),
        ("runtime/native/thread-pool.patch", "Bounded threads that sleep between steps."),
        ("runtime/native/first-chunk.patch", "Lets the first chunk start without extra audio."),
    ],
    "The transcript is the model's best guess. VOCO checks that the model file is the right one, not that each word is right.",
    "Someone replaces the model file with a different one. What happens?",
    [
        "The worker refuses it because the fingerprint doesn't match",
        "VOCO downloads a fresh copy",
        "The worker loads it and transcribes as usual",
    ],
    0,
    "The worker compares the file's SHA-256 with the pinned value before loading. VOCO never downloads models, so a mismatch stops the worker.",
)

lesson(
    "delivery",
    "Words meet the cursor.",
    "The last step puts words into another app. VOCO does it the way you would: copy, then paste.",
    [
        "insertion.rs pastes one group of words at a time. It puts the words on the clipboard, then presses Shift+Insert. In the code's words, \"Shift+Insert is the paste key shared by GTK, Qt, Chromium, Firefox, Electron and terminal emulators.\"",
        "Terminals paste the PRIMARY selection instead of the clipboard, so VOCO fills both. Each live paste ends between two characters that aren't spaces, so its spaces travel inside it. Two spaces go alone: the one before the next words after a quiet release, and the one Stop adds after a finished sentence. Before each paste VOCO checks the helper programs and, on Wayland, access to its own virtual keyboard, and it waits for you to release the shortcut's keys.",
        "An optional Chromium extension offers a second route. In a tab where you enable it, VOCO inserts words at the caret of one plain text field, and the extension confirms each insert with a receipt.",
    ],
    [
        (
            "Check",
            "The text must be 1 to 100,000 bytes and the helpers ready. On Wayland this session must be the active one, and VOCO's own virtual keyboard must exist unless the GNOME companion will press the keys.",
        ),
        (
            "Clean",
            "Control characters, including newlines and tabs, become spaces, so a terminal never receives Enter.",
        ),
        (
            "Settle",
            "VOCO lets the app read the previous paste first. Where xclip copies on GNOME Wayland, it watches for that read, for up to 300 ms after the Insert press; elsewhere, and whenever it can't tell, it waits until 150 ms after the previous paste's keys.",
        ),
        (
            "Copy",
            "The words go to CLIPBOARD and PRIMARY, and a PRIMARY failure only logs a warning. Where xclip copies on GNOME Wayland, PRIMARY goes first, and VOCO waits up to 100 ms for Mutter's read of the new CLIPBOARD, which shows the copy is current.",
        ),
        (
            "Press",
            "VOCO waits up to 1.5 seconds for the shortcut's modifier keys to be released, and on X11 also while the X server reports Shift, Control, Alt, Super or AltGr held. Then it sends Shift+Insert.",
        ),
    ],
    [
        (
            "Every space inside a paste",
            "Chromium's address bar strips the spaces at the edges of pasted text, and its rich-text fields turn a space pasted alone into a no-break space. So each live paste ends between two characters that aren't spaces, never inside a letter and its accents, and the last letter waits for the next words. After 0.75 seconds of audio with no new words, the held text goes out on its own. The next words' space is then pasted alone, which the address bar keeps, so a rich-text field gets at most one no-break space for each pause. The final text goes out whole. In the Chromium extension's field each space stays with its words, and a trailing space waits for them.",
        ),
        (
            "Seeing the app read",
            "On GNOME Wayland with DISPLAY set, where xclip copies, each copy runs it in the foreground with -verbose, which reports every request it answers except TARGETS, and keeps the selection until the next copy. Mutter's clipboard manager reads each new CLIPBOARD once. When that read is in by the Insert press, the first answer after the press is the app's read, and the next copy follows at once. A read before the press, during the wait for a young keyboard or the gap after Shift, never counts. A read shows that the app asked for the text, not that the words arrived.",
        ),
        (
            "Waiting for GNOME's switch",
            "A helper reports owning its selection just before its request leaves for the X server, and until the server has it, an app pastes the previous copy. So where xclip copies on GNOME Wayland, VOCO copies PRIMARY first, then CLIPBOARD, and before the keys waits up to 100 ms for Mutter's read of the new CLIPBOARD. Nothing reads PRIMARY that way, so its early copy is a head start, not proof. Without the read in time, the keys go anyway.",
        ),
        (
            "Keys from inside GNOME Shell",
            "On GNOME Wayland, while the companion is attached and the copy GNOME has loaded asks VOCO for work, the companion presses Shift and Insert from inside the Shell with a keyboard of its own, 12 ms apart. It keeps one NextRequest call waiting on VOCO; VOCO answers it with the paste and waits up to 1 second for PasteDone, which carries the moment the Insert press went out. A refusal, because a modifier is held or another paste is in flight, sends no keys, so the words wait, and so does a paste no call took in that second, which VOCO then withdraws. A paste taken but not reported in time is uncertain. Everywhere else, VOCO's own virtual keyboard presses the keys, except in the snap, which has none.",
        ),
        (
            "Three failure outcomes",
            "No change: no keys were sent, so the words wait for the next try. Rejected: VOCO refused before touching the clipboard, and typing stops. Uncertain: a helper failed after it started, or the paste keys failed after the copy, so typing stops and VOCO never sends those words again.",
        ),
        (
            "Checked before recording",
            "If a helper is missing, or on Wayland the virtual keyboard can't be used, the recording doesn't start. VOCO shows \"Dictation setup incomplete\" with the reason.",
        ),
        (
            "Checking the originating session",
            "A virtual keyboard types into whichever login owns the screen. On Wayland VOCO checks the desktop session it started in before the copy and again just before the keys. That is a graphical login, or the text console a compositor such as Sway was started from, which logind calls tty. When logind reports that session as not active, as after switching to another user, VOCO reports \"This desktop session isn't the active local session for VOCO's keyboard, so VOCO sent no paste keys.\" If logind can't answer, VOCO doesn't block. These checks don't lock the session: switching after the last check can still redirect keys.",
        ),
        (
            "Nothing while the screen is locked",
            "VOCO follows logind's LockedHint for the session it started in. While the screen is locked, a paste fails with \"The screen is locked, so VOCO sent no paste keys.\" and no shortcut starts dictation. Locking the screen during a dictation stops it, and VOCO shows \"Dictation stopped\" with \"VOCO stopped listening when the screen locked.\"",
        ),
        (
            "VOCO steps aside",
            "If VOCO's own window is showing when you start, VOCO hides it instead of recording and shows \"VOCO hidden\" with \"Click where you want the text, then start dictation again.\"",
        ),
        (
            "The browser route",
            "The Chromium extension works through its toolbar button and Alt+Shift+V. It inserts only into a text area or a text, search, URL or telephone input with a collapsed caret. It skips disabled and read-only fields, fields inside a private or inert area, and fields whose autocomplete asks for a password, a one-time code or payment details. Incognito tabs are refused, and an insert counts only when a matching receipt comes back.",
        ),
        (
            "The clipboard keeps the words",
            "VOCO doesn't restore what the clipboard held before. After dictation, the clipboard holds VOCO's last paste, such as the end of your last word or the space Stop adds after a finished sentence. The helper holding it keeps running, even after VOCO quits, until something else is copied.",
        ),
    ],
    [
        (B + "insertion.rs", "Checks helpers, copies both selections and presses Shift+Insert."),
        (B + "virtual_keyboard.rs", "VOCO's own keyboard for the Wayland paste keys, which reports when Insert went out."),
        (B + "panel.rs", "Hands the GNOME companion each paste through its waiting NextRequest call, once the Shell's loaded copy asks for work."),
        (B + "selection_owner.rs", "The GNOME copies: xclip helpers that keep both selections and report each read."),
        (B + "desktop_session.rs", "Tracks the originating desktop session and asks logind whether it is active and locked."),
        (F + "lib/dictationRecording.ts", "Checks paste readiness before a recording starts."),
        (F + "App.tsx", "Hides VOCO's window before dictation into another app."),
        (F + "lib/dictationStream.ts", "Ends each live paste inside the words and lets held text go after a pause."),
        (
            B + "process_runner.rs",
            "Runs helper programs within bounds and tells a failed start apart from a failure after the helper may have acted.",
        ),
        (F + "lib/tauri.ts", "Typed wrappers for the paste and copy commands."),
        (B + "browser_broker.rs", "Hands words to the Chromium extension and matches receipts."),
        (B + "bin/voco-browser-host.rs", "The native messaging host the extension talks to."),
        (B + "browser_protocol.rs", "The messages between VOCO and the extension."),
        ("integrations/chromium/content.js", "Finds the eligible field and inserts at the caret."),
        (F + "lib/browserStreamDelivery.ts", "Never retries an insert whose receipt is missing."),
    ],
    "Dispatched means the paste keys went out. On GNOME VOCO also sees the app read the clipboard, but only the browser route gets a receipt from the page; for other apps VOCO can't see whether the words arrived.",
    "A paste helper fails after it started. Why doesn't VOCO simply try again?",
    [
        "The keys may already have reached the app, so a retry could type the words twice",
        "Helpers can run only once per recording",
        "VOCO retries silently in the background",
    ],
    0,
    "After a helper starts, the clipboard or the app may already hold the words. VOCO marks the paste uncertain and never replays it.",
    "focus",
)

lesson(
    "stop",
    "Stop means finish the work.",
    "Pressing Stop doesn't throw away the end of your sentence. VOCO finishes the work before it goes quiet.",
    [
        "When you stop, VOCO flushes the microphone and sends the audio the worker hasn't heard yet, including the last partial packet. Then it asks for the final transcript and pastes the last words, and after a finished sentence, one space.",
        "If some words couldn't be pasted, VOCO copies them to the clipboard and tells you. If even the copy fails, the words wait in Review.",
        "A recognition failure is different. VOCO copies nothing, because the transcript may be missing words, and asks you to check your text field.",
    ],
    [
        (
            "Flush",
            "On X11 the AudioWorklet must confirm its flush within 80 ms. Otherwise VOCO says \"The end of this recording could not be confirmed, so VOCO did not finish it. Try again.\"",
        ),
        (
            "Forward the tail",
            "VOCO sends the retained samples the stream hasn't received, then the partial packet.",
        ),
        (
            "Finish",
            "The worker returns the final transcript. Words still pending get up to 3 more paste attempts, 250 ms apart.",
        ),
        (
            "Deliver or copy",
            "Words left over go to CLIPBOARD and PRIMARY, with any space before them, and VOCO shows \"Dictation copied to clipboard\".",
        ),
        ("Clean up", "VOCO clears the audio from memory and deletes the recording's journal entry."),
    ],
    [
        (
            "A space after a finished sentence",
            "When the whole final text went out, with no cancel and no failed or uncertain paste, and it ends with . ? ! or …, perhaps before closing quotes or brackets, Stop pastes one space on its own after it, so your next dictation or typing starts apart. It never does in the Chromium extension's field, the voice test or Say it. If that paste fails, VOCO says nothing and copies nothing, because no words are missing.",
        ),
        (
            "Typing stopped, listening continues",
            "When a paste is rejected or uncertain, VOCO shows \"VOCO stopped typing\" with \"It's still listening. When you stop, VOCO copies the rest of your words to the clipboard.\"",
        ),
        (
            "After an uncertain paste",
            "The clipboard notice warns: \"Some words may already be in the app, so check it first. Then press Shift+Insert or Ctrl+V to paste the rest.\"",
        ),
        (
            "When the copy fails",
            "VOCO keeps the words in Review and shows \"Dictation saved in Review\" with \"VOCO couldn't paste or copy it. Choose Review in VOCO's menu to copy it.\" If even that fails, the window shows \"VOCO couldn't paste, copy or save this dictation.\"",
        ),
        (
            "When recognition fails",
            "VOCO shows \"Dictation interrupted\" with \"Some words may be missing. Check your text field before starting again.\" If no words were recognized yet, the message starts \"Nothing was typed.\" and gives the reason instead. Nothing is copied.",
        ),
        (
            "Unconfirmed audio is never typed",
            "When WebKit offered only the ScriptProcessor fallback, VOCO already showed \"Dictation won't be typed\". At Stop it clears the audio, and the window shows \"VOCO couldn't confirm it received all of your audio, so it didn't type this recording. Try again.\"",
        ),
    ],
    [
        (F + "lib/dictationRecording.ts", "The Stop sequence, the clipboard copy and every notice."),
        (F + "lib/desktopCaptureTail.ts", "Forwards the audio the stream hasn't received."),
        (F + "lib/audioCaptureFlush.ts", "The 80 ms flush confirmation."),
        (F + "lib/dictationStream.ts", "Finishes the stream, reports undelivered words and whether all of the final text went out."),
        (B + "insertion.rs", "Copies leftover words to both selections without sending keys."),
        (F + "lib/crashRecovery.ts", "Saves words in Review when copying fails."),
    ],
    "Stop never replays words as key presses after typing stopped. Words that weren't typed go to the clipboard, or to Review if copying fails.",
    "A paste failed during the recording, but recognition kept going. What does Stop do with the words that weren't typed?",
    [
        "Types them with simulated key presses",
        "Copies them to the clipboard and tells you to paste them",
        "Discards them",
    ],
    1,
    "Stop never replays words as key presses. It copies the rest to CLIPBOARD and PRIMARY and shows \"Dictation copied to clipboard\", so you choose where to paste.",
    "queue",
)

lesson(
    "recovery",
    "When something goes wrong.",
    "Computers crash sometimes. VOCO keeps a small private note of what you said, so a crash doesn't lose your words.",
    [
        "While you dictate, VOCO writes the transcript, and only the transcript, to a journal on disk. A normal finish deletes the entry, and so do Quit and a clean shutdown signal.",
        "If VOCO exits unexpectedly, the entry stays. At the next start VOCO moves it to Review, where it waits for you.",
        "Review opens only when you choose it from VOCO's menu. You can copy each transcript or discard it, and Review never pastes anything by itself.",
    ],
    [
        ("Record", "Each new result updates the recording's entry. An entry larger than 256 KiB is refused."),
        ("Finish", "A normal finish deletes the entry."),
        (
            "Recover",
            "At the next start, an unfinished entry moves to Review. If only the window reloads, it moves at once.",
        ),
        ("Keep five", "Review keeps up to five entries and removes the oldest."),
        (
            "Choose",
            "Copy transcript puts the text on the clipboard. Discard first asks \"Discard this transcript?\" and offers Keep or Discard transcript.",
        ),
    ],
    [
        (
            "Owner-only files",
            "The journal lives in $XDG_STATE_HOME/voco/crash-recovery, or ~/.local/state/voco/crash-recovery when that variable is unset, empty or relative. Only your user can read it.",
        ),
        (
            "When the journal is unavailable",
            "Dictation still works. VOCO shows \"Crash recovery unavailable\" with \"Dictation continues, but VOCO can't recover it if VOCO exits unexpectedly.\"",
        ),
        (
            "Clean exits clean up",
            "Quit VOCO, SIGINT and SIGTERM delete the active entry, because those exits are chosen, not crashes.",
        ),
        (
            "When the window crashes",
            "WebKit runs VOCO's window in a process of its own. If that process crashes, VOCO loads the window again, its unfinished entry moves to Review, and VOCO shows \"Dictation interrupted\" if you were dictating. If it crashes again after three reloads in five minutes, VOCO leaves it closed and shows \"VOCO stopped working\".",
        ),
        (
            "Review is explicit",
            "Each entry is \"Kept until you discard it.\" VOCO never opens, pastes or retries recovered text for you.",
        ),
        (
            "Cleanup failures",
            "If temporary text can't be deleted, VOCO says \"Temporary dictation text could not be deleted. VOCO will retry cleanup before the next recording.\"",
        ),
    ],
    [
        (B + "crash_recovery.rs", "The owner-only journal, its size bound and Review's five entries."),
        (B + "lib.rs", "Loads the window again when its web process crashes, at most three times in five minutes."),
        (F + "lib/crashRecovery.ts", "The window's side of the journal."),
        (F + "components/CrashReview.tsx", "The Review screen: copy or discard."),
        (F + "lib/dictationRecording.ts", "Writes and finishes the journal during a recording."),
        (F + "lib/crashRecovery.test.ts", "Tests for journal updates and cleanup."),
        (B + "tray.rs", "The menu item that opens Review."),
    ],
    "Quitting VOCO while you dictate deletes the unfinished entry. Review protects against crashes, not against choosing Quit.",
    "VOCO crashes in the middle of a recording. What happens to the words you said?",
    [
        "They are pasted automatically at the next start",
        "They are lost, because the journal is deleted",
        "They wait in Review until you open it from VOCO's menu",
    ],
    2,
    "An unexpected exit leaves the journal entry in place. At the next start VOCO moves it to Review, which opens only when you choose it and never pastes by itself.",
)

lesson(
    "settings",
    "A small interface, clear ownership.",
    "VOCO has few settings, and one part owns them. That keeps the file simple and safe.",
    [
        "VOCO keeps its settings in one file, and Rust owns it. The window sends small changes, called patches, and Rust refuses fields it doesn't know and null values.",
        "Fields from older versions are ignored and dropped at the next save. If VOCO can't read the file, it never overwrites it. Dictation pauses, and a recovery panel offers three ways out.",
        "Each save leaves a copy beside the file, so settings an earlier VOCO drops come back at the next start, unless a reset happened in between. Only Reset keeps a backup of the old file.",
    ],
    [
        (
            "Load",
            "Rust reads $XDG_CONFIG_HOME/voco/config.json and takes any setting it lacks from config.json.last, unless a reset renamed the file since that copy was saved.",
        ),
        (
            "Migrate",
            "If that file doesn't exist, VOCO copies $XDG_CONFIG_HOME/voice/config.json when present.",
        ),
        ("Patch", "The window sends only the fields that changed. Unknown fields and null values are refused."),
        (
            "Save",
            "Rust writes the file atomically, then the same settings to config.json.last, keeping any that a later VOCO left there. The folder is 0700 and the files 0600, so only you can read them.",
        ),
        (
            "Recover",
            "When the file can't be read, the recovery panel offers Retry loading settings, Open config directory and Reset to defaults.",
        ),
    ],
    [
        (
            "Nine fields",
            "hotkey, which defaults to Alt+D; selectedMic; onboardingCompleted; updateChannel; automaticUpdateChecks, which defaults to true; englishSpelling, unset until chosen, which means British; myWords, empty until you add a word; myWordsHeard, the versions VOCO learned when you said a word; and installChannel.",
        ),
        (
            "Update checks",
            "VOCO checks after startup and when you change the update channel, unless Update checks is set to Only when I choose. It reuses an answer younger than 6 hours, and otherwise asks GitHub for the 12 newest releases, with a 15-second timeout. Check for updates in Settings always asks. The snap never checks: Settings shows its version and \"The Snap Store keeps VOCO up to date.\"",
        ),
        (
            "Only a notice",
            "When a newer release exists, VOCO shows an \"Update available\" notification once for that release, and Settings offers Open latest release. VOCO never downloads or installs anything.",
        ),
        (
            "Two channels",
            "The default channel ignores pre-releases, and its helper text reads \"Recommended for everyday use.\" Beta includes them: \"Beta releases change more often.\" Drafts are always ignored.",
        ),
        ("Installation method", "installChannel only chooses which update instructions VOCO shows."),
        (
            "Reset is confirmed",
            "Reset to defaults asks \"Reset local settings?\" and needs Confirm reset before it replaces the file. It keeps the old file as a recovery backup and deletes config.json.last and the backups of earlier resets.",
        ),
        (
            "Back from an earlier version",
            "An earlier VOCO rewrites the file without the settings it doesn't know. The next start takes them back from config.json.last, keeping what you changed in the earlier version. A reset in between wins: every VOCO names its backup with the time of the reset, and a backup newer than the copy means nothing comes back. A restored taught version that clashes with the list is dropped, and the log gives only how many.",
        ),
    ],
    [
        (B + "config.rs", "Loads, patches and saves the settings and their copy, and restores what an earlier VOCO dropped."),
        (F + "components/ControlPanel.tsx", "The settings window, including the update channel."),
        (B + "confinement.rs", "Tells the window when the Snap Store updates VOCO, so it never checks."),
        (F + "components/ConfigRecoveryPanel.tsx", "The three ways out when settings can't load."),
        (F + "lib/updates.ts", "Asks GitHub for releases and filters them by channel."),
        (F + "lib/updateCheckCoordinator.ts", "Decides when to check and when to reuse the cached answer."),
        (F + "store/useStore.ts", "The window's in-memory state."),
        (F + "lib/configSnapshot.ts", "Ignores a settings snapshot older than the one in use."),
        (F + "App.tsx", "Pauses dictation only while the settings can't load at startup."),
    ],
    "Settings stay on this computer. VOCO has no account and syncs nothing.",
    "The window sends a patch with a field Rust doesn't know. What happens?",
    [
        "Rust refuses the change",
        "Rust saves it for later versions",
        "Rust drops that field and saves the rest",
    ],
    0,
    "Rust owns the file and accepts only the five fields it knows. A patch with an unknown field is refused, so nothing unexpected reaches the file.",
)

lesson(
    "linux",
    "One app, several Linux paths.",
    "A Linux desktop is made of many parts. VOCO fits into them with a few small, private pieces.",
    [
        "Only one copy of VOCO runs per login. Launching it again brings the running copy forward and never starts a recording.",
        "Other programs reach VOCO through private sockets that check the caller's user ID. Notifications go through D-Bus, the desktop's message bus.",
        "On Wayland, VOCO presses the paste keys through its own virtual keyboard, or on GNOME through the companion once it asks VOCO for work. A udev rule in the package lets the person at the computer use /dev/uinput, so there is no service, daemon or group to set up. The snap can't open /dev/uinput, so on Wayland only the companion types for it.",
    ],
    [
        ("Lock", "instance.lock in $XDG_RUNTIME_DIR/voco makes sure only one copy runs."),
        (
            "Activate",
            "A second launch connects to voco-activate.sock and asks the running copy to show itself, waiting at most 2 seconds.",
        ),
        (
            "Trigger",
            "voco.sock and voice.sock sit in $XDG_RUNTIME_DIR, or in a private voco-<uid> folder in the temporary directory when that variable is unset. The sockets are 0600, and a connection is the request.",
        ),
        ("Notify", "Notifications go through D-Bus with a 3-second timeout."),
        (
            "Keyboard",
            "On Wayland, VOCO creates its virtual keyboard at startup and keeps it until it quits.",
        ),
    ],
    [
        (
            "Command-line options",
            "voco accepts --toggle, --check-desktop-input, --check-panel, --setup-panel, --version and --help. Unknown arguments exit with code 2.",
        ),
        (
            "A launcher click opens VOCO",
            "When VOCO's own launcher starts it, GIO names VOCO.desktop and this process, so VOCO shows its popover as it would for a second launch. A start from a terminal or a login autostart stays in the tray.",
        ),
        (
            "A hidden window",
            "With native capture VOCO really hides its window. On X11, where WebKit records, VOCO instead shrinks the window to 1 by 1 pixel and moves it off-screen.",
        ),
        (
            "Checking input",
            "voco --check-desktop-input checks the paste prerequisites without launching VOCO or sending keys: the clipboard helper, xdotool on X11, and on Wayland that /dev/uinput opens for reading and writing. In the snap on Wayland it instead asks the running VOCO, through CompanionAsking, whether the companion asks it for work, since only that VOCO knows. It exits with code 1 when something is missing.",
        ),
        (
            "Access from a udev rule",
            "70-voco-uinput.rules tags /dev/uinput with uaccess, so logind gives the user of the active local session access through an ACL that follows seat changes. voco-uinput.conf loads the uinput module at boot.",
        ),
        (
            "A leftover service",
            "At a Wayland start, VOCO removes a leftover link to voco-ydotoold.service from this login's systemd folder, but only if the link points at /usr/lib/systemd/user/voco-ydotoold.service and that file no longer exists. Then it stops the unit and reloads the user manager, off the startup path.",
        ),
        (
            "Two packages and a snap, one tree",
            "The Debian package depends on xclip, xdotool and wl-clipboard, among others, and recommends nothing. The Fedora RPM is built from the same staged files and requires the same packages under their Fedora names. The snap carries those files too, except what strict confinement can't use.",
        ),
        (
            "The snap",
            "When snapd names it voco, VOCO knows it runs as its snap and leaves out the virtual keyboard, the keyboard reader, the IBus listener and the update check. On Wayland only the GNOME companion types for it: \"On Wayland, the VOCO snap types through the VOCO panel. Install it from extensions.gnome.org, then sign out and back in.\" On other Wayland desktops Start is refused, and X11 keeps xdotool.",
        ),
        (
            "Connections the snap needs",
            "Until the store connects them itself, the snap names the commands. Before each recording it asks snapctl whether audio-record is connected, and logind refuses it until login-session-observe is: \"The VOCO snap can't use the microphone yet. Run snap connect voco:audio-record, then try again.\"",
        ),
    ],
    [
        (B + "main.rs", "Command-line options and their exit codes."),
        (B + "lib.rs", "Startup, the window and the keyboard reader."),
        (B + "single_instance.rs", "The lock that keeps one copy per login."),
        (B + "activation.rs", "Brings the running copy forward, or the copy its launcher started."),
        (B + "desktop_notifications.rs", "Notifications over D-Bus."),
        (B + "trigger_socket.rs", "The owner-only sockets behind voco --toggle."),
        (B + "virtual_keyboard.rs", "Creates the virtual keyboard and sends its keys."),
        (B + "desktop_session.rs", "The originating desktop session and its active-state check."),
        (B + "confinement.rs", "Knows when VOCO runs as its snap, and asks snapctl about its microphone connection."),
        ("apps/desktop/src-tauri/tauri.conf.json", "The Debian package's dependencies and files."),
        ("packaging/rpm/voco.spec.in", "The Fedora package: the same files, with Fedora's names for the dependencies."),
        ("packaging/snap/snapcraft.yaml.in", "The snap's recipe: core24, the GNOME extension, three plugs and the panel slot."),
        ("packaging/udev/70-voco-uinput.rules", "Gives the active session's user access to /dev/uinput."),
        ("packaging/udev/voco-uinput.conf", "Loads the uinput module at boot."),
        ("packaging/tauri/VOCO.desktop", "The desktop entry."),
    ],
    "A second launch never starts a recording. To toggle from a desktop shortcut, bind voco --toggle.",
    "VOCO is already running and you launch it again from the app menu. What happens?",
    [
        "The running copy shows itself, and no recording starts",
        "A second copy starts",
        "The running copy starts recording",
    ],
    0,
    "The instance lock keeps one copy per login. A second launch asks the running copy to show itself through voco-activate.sock and never toggles dictation.",
)

lesson(
    "privacy",
    "Draw the trust boundaries.",
    "Privacy is easier to check when you can see where each piece of data goes. VOCO keeps the map short.",
    [
        "Audio stays in memory while you record and is cleared when the recording ends. It travels to the worker over a private pipe, never over the network.",
        "Text lives briefly in the crash journal and on the clipboard. The window may connect only to VOCO itself and GitHub's release API.",
        "Logs are off by default. When you turn them on, they hold metadata such as lengths and timings, never your words or audio.",
    ],
    [
        ("Microphone", "VOCO opens the microphone only for a recording, a voice test or a Say it check."),
        ("Worker", "Audio and text travel to the worker through its standard input and output."),
        (
            "Sockets",
            "VOCO's sockets are owner-only, and the trigger, activation, IBus and browser sockets check the caller's user ID through one shared helper.",
        ),
        ("Files", "Settings, the journal and logs are private to your user."),
        ("Network", "The only request asks GitHub's API about new releases, and the snap makes none."),
    ],
    [
        (
            "Opt-in logs",
            "VOCO_PERFORMANCE_LOG=1 and VOCO_HOTKEY_TRACE=1 turn on metadata logs. They never record dictated text, audio or window titles.",
        ),
        (
            "Debug audio",
            "Saving audio needs three variables, VOCO_DEV_NATIVE_CAPTURE, VOCO_DEBUG_CAPTURE_AUDIO and VOCO_DEBUG_NATIVE_CAPTURE, all set to exactly 1. Then VOCO writes one owner-only bundle in $XDG_STATE_HOME/voco/debug-native-captures after the recording.",
        ),
        (
            "The clipboard is shared",
            "Other apps can read the clipboard. VOCO pastes through it and doesn't restore what it held before.",
        ),
        (
            "No shell access",
            "The window has no shell plugin. Its permissions are Tauri's core defaults and a list of window controls, so it can't register global shortcuts either.",
        ),
        (
            "Browser limits",
            "The Chromium extension refuses incognito tabs, skips password, one-time-code and payment fields, and works only in tabs where you enable it.",
        ),
        (
            "Paste keys for one person",
            "The package's uaccess rule gives /dev/uinput to the user of the active local session alone, with no group, daemon or socket. VOCO's keyboard can press only Shift and Insert, and so can the GNOME companion's, which answers only the attached VOCO. Before copying and before sending keys, VOCO checks its originating session. An inactive or locked result stops the paste; an unavailable result permits it. A switch after the check can still redirect keys.",
        ),
        (
            "The snap's sandbox",
            "The snap plugs no network, home folder or input device, so it can't reach the internet, read your home folder outside its own folders or open /dev/uinput. The Snap Store updates it. On the session bus it owns org.voco.Panel through a dbus slot, which lets it answer GNOME Shell but never call it.",
        ),
        (
            "Same user, not same program",
            "The sockets keep out other users. They are not a boundary against a compromised program that runs as you.",
        ),
        (
            "Measured, not only promised",
            "check-privacy.sh runs a release build twice in a container and dictates a public clip each time. With update checks off and no network, no process may connect, send or bind to an internet address, or ask DNS anything. With them on, only api.github.com may be resolved and reached, and the speech worker reaches nothing. In both, a microphone stream exists only while dictation runs.",
        ),
    ],
    [
        (B + "performance.rs", "The opt-in metadata log and its fixed fields."),
        (B + "hotkey_trace.rs", "The opt-in shortcut trace."),
        (B + "crash_recovery.rs", "The owner-only journal."),
        (F + "lib/updates.ts", "The single network request."),
        ("apps/desktop/src-tauri/tauri.conf.json", "The content security policy."),
        ("apps/desktop/src-tauri/capabilities/default.json", "The window's permissions."),
        (B + "trigger_socket.rs", "Checks the caller's user ID."),
        (B + "browser_socket.rs", "The browser host's owner-only socket, and the one helper that reads a caller's user ID."),
        (B + "native_capture/audit.rs", "Debug audio, off unless three variables are set."),
        (B + "native_capture/private_bundle.rs", "Writes the owner-only debug bundle."),
        (B + "virtual_keyboard.rs", "Creates a keyboard with only Shift and Insert."),
        (B + "worker_sandbox.rs", "Keeps the speech worker off the network."),
        ("scripts/check-privacy.sh", "Runs a release build offline and online and records every network call and DNS query."),
        ("scripts/privacy/analyze.py", "Judges a run: no internet offline, only api.github.com online, the microphone only while dictating."),
        (B + "desktop_session.rs", "Checks the originating session and its screen lock, allowing pastes when logind cannot answer."),
        ("packaging/udev/70-voco-uinput.rules", "Who may create input devices."),
        ("integrations/chromium/content.js", "The field rules inside web pages."),
    ],
    "Local processing protects your audio. It doesn't protect the clipboard, which other apps can read.",
    "What is VOCO's only network request?",
    [
        "It uploads audio for better recognition",
        "It sends usage statistics",
        "It asks GitHub's API about new releases",
    ],
    2,
    "Speech runs on the computer, and the content security policy allows only VOCO itself, Tauri's message channel and api.github.com. The update check is the only request.",
)

lesson(
    "performance",
    "Measure the right stopwatch.",
    "A time is only useful when you know where the stopwatch starts and stops. VOCO's measurements always say which clock they use.",
    [
        "Performance logging is off until you turn it on. Then VOCO and the worker record timings and resource use, never words or audio.",
        "report-performance.py summarizes the log with counts, medians, 95th percentiles and maximums, and never scores what it didn't measure.",
        "A replay script feeds pinned public speech to the real worker, so one machine can be measured again under the same conditions.",
    ],
    [
        ("Opt in", "Set VOCO_PERFORMANCE_LOG=1 before starting VOCO."),
        (
            "Record",
            "VOCO writes performance.jsonl up to 8 MiB, then keeps one previous file. It samples resource use every 2 seconds.",
        ),
        ("Worker timings", "The worker writes worker.jsonl up to 8 MiB and keeps 3 older files."),
        (
            "Summarize",
            "report-performance.py and report-speech-performance.py turn the logs into counts and percentiles.",
        ),
        (
            "Replay",
            "evaluate-dictation-worker.py replays public speech into the worker without opening any audio or input device.",
        ),
    ],
    [
        (
            "Logging never blocks speech",
            "Log records wait in a queue of 256. When it is full, VOCO drops the record and counts it rather than slow dictation.",
        ),
        (
            "Named failures",
            "Queue failures are logged by name, such as backlog_limit and prefix_revision, with a hashed session instead of the session itself.",
        ),
        ("Threads", "By default the worker uses at most 4 threads, one less than the processors it may use."),
        (
            "Know what is measured",
            "Each quality record names its clock_domain and counts samples at queue_ingress, where audio enters the queue. The replay measures the worker's process boundary, not capture, the receiving app or the screen.",
        ),
        (
            "Reads, not proof",
            "Each paste's record says which selection the app read and how many milliseconds after the Insert press, that nothing read it within 300 ms, or that the helpers couldn't tell, as they can only where xclip copies on GNOME Wayland. A read shows that the app asked for the text, not that the words arrived.",
        ),
        (
            "Which keyboard typed",
            "Each paste's record also names the keyboard that sent its keys: companion, uinput or xdotool. report-dictation-quality-events.py counts them for each session, so timings can be compared by keyboard.",
        ),
        (
            "Descriptive statistics",
            "Percentiles use the nearest-rank method and keep their sample counts. A few runs describe those runs, nothing more.",
        ),
    ],
    [
        (B + "performance.rs", "The opt-in log, its bounded queue and fixed fields."),
        (R + "streaming.py", "The worker's timing log."),
        (F + "lib/dictationStream.ts", "Sends queue metadata when logging is on."),
        ("scripts/report-performance.py", "Summarizes VOCO's performance log."),
        (
            "scripts/report-speech-performance.py",
            "Summarizes the worker's log; missing measurements stay unavailable.",
        ),
        (
            "scripts/report-dictation-quality-events.py",
            "Matches queue and dispatch records without guessing what an app received.",
        ),
        ("scripts/evaluate-dictation-worker.py", "Replays pinned public speech into the real worker."),
        ("scripts/score-dictation-worker.mjs", "Scores replay results with descriptive statistics."),
        ("runtime/native/thread-pool.patch", "The bounded thread pool that sleeps between steps."),
    ],
    "Compare timings only when they use the same clock, the same audio and the same machine.",
    "You add two seconds of silence before the first word. Which delay grows?",
    [
        "Time from the start of playback to the words in the field",
        "Time from the start of speech to the words in the field",
        "Neither, because VOCO skips silence",
    ],
    0,
    "A stopwatch that starts at playback includes the silence, and one that starts at speech doesn't. That's why every timing must say where its clock starts.",
    "latency",
)

lesson(
    "tests",
    "Tests are little promises.",
    "A test is a promise written as code: when this happens, VOCO does that. Running the tests checks that the promises still hold.",
    [
        "npm test runs scripts/test-unit.sh, the fast checks that need no microphone, speech model or desktop session.",
        "CI runs on every push and pull request to master, in nine jobs. Some start the real app in private desktop sessions and paste into real applications, one runs the speech runtime in Debian 13 and Fedora 44 containers, and one checks what strict confinement lets a snap do on the session bus.",
        "Tests use only public or synthetic audio. No personal recording is part of any test.",
    ],
    [
        (
            "Unit checks",
            "scripts/test-unit.sh checks the patched libraries, the speech reports and runtime, capture helpers, the IBus engine and the window's Vitest suite.",
        ),
        ("Rust checks", "cargo fmt, clippy with warnings treated as errors, and cargo test."),
        (
            "Speech checks",
            "CI reuses the native speech runtime from a released package, checked against a fixed checksum, then runs the speech baseline and the worker protocol tests, on Ubuntu 24.04 and in the Debian 13 and Fedora 44 containers. Rust Check & Test runs the protocol tests once more from only the worker files a package ships, staged by stage-speech-worker.py.",
        ),
        (
            "Application checks",
            "A release build runs end to end in private sessions: the GNOME panel, capture and paste into a focused field, the Wayland lifecycle and Chromium. On GNOME Wayland its paste keys go through VOCO's real virtual keyboard, and the applications suite runs once more through the GNOME companion.",
        ),
        (
            "Audit",
            "RustSec checks the Rust dependencies, and npm run verify:security checks the JavaScript ones.",
        ),
    ],
    [
        (
            "Nine CI jobs",
            "Code Guide, RustSec Audit, Frontend Checks, Rust Check & Test, Application, GNOME 50 Companion, GNOME 51 Companion, a runtime job that runs once for Debian 13 and once for Fedora 44, and Snap Confinement Probe. The probe builds a small strict snap that owns org.voco.Panel and proves it answers an unconfined caller's waiting call but can't call it, which is why the companion asks VOCO for work.",
        ),
        (
            "Private sessions",
            "The hosted desktop tests refuse to run outside GitHub Actions, so they never touch a developer's own session.",
        ),
        (
            "Many apps, one paste",
            "test-application-delivery.py pastes with the one production chord and reads the result back from each application itself.",
        ),
        (
            "A bridge for the paste keys",
            "The Wayland delivery suites give their private session /dev/uinput but no /dev/input. A test-only bridge outside the session grabs each device named VOCO virtual keyboard, so its keys reach no real desktop, and replays them in order into the session's display. It accepts only the paste gesture and refuses to run beside a graphical login.",
        ),
        (
            "Typing through the companion",
            "The companion run loads the repository's GNOME companion into the private session. Each production paste waits for it to attach and checks that it pressed the keys. /dev/null, which discards everything, stands in for /dev/uinput, so a paste that reached for VOCO's own keyboard couldn't type anywhere.",
        ),
        (
            "Paste against Mutter",
            "On each Shell it runs, the companion suite pastes into a GTK field 200 times through the companion and 200 times through Mutter's RemoteDesktop API, taking turns. Every paste must arrive exactly, and from the request to the Insert press the companion's median may be at most 1 ms above Mutter's, and its 99th percentile at most 2 ms. 20 more pastes go to a field under XWayland. Pastes asked for by another connection, with a modifier held, while one is in flight, at the lock screen or after disabling must send no key.",
        ),
        (
            "GNOME 50 and 51, headless",
            "GNOME 50 and 51 have no nested mode, so the companion regression runs Shell headless and sends keys and clicks through a private RemoteDesktop session: GNOME 50 on Ubuntu 26.04, and GNOME 51 in rootless Podman, from a digest-pinned Fedora 45 image.",
        ),
        (
            "Each distribution's names",
            "The Debian 13 and Fedora 44 jobs install VOCO's package dependencies by that distribution's names, as distro-dependencies.py prints them, so a renamed package fails in CI before a release.",
        ),
        (
            "What CI never does",
            "Hosted CI never assembles or signs the NVIDIA package. The maintainer does that locally with assemble-release.sh.",
        ),
        (
            "The guide checks itself",
            "The Code Guide job runs this guide's own tests: chapters, catalog and server safety.",
        ),
        (
            "Measured on demand",
            "Two commands measure what CI doesn't. check-privacy.sh runs a release build offline and online and records what it reaches on the network and when the microphone is open. check-speech.sh replays the public clips through the real worker for word error rate, latency and My words, and fails when a My words gate does. With --against voco.2026.0.62 it measures that release beside this checkout.",
        ),
    ],
    [
        ("scripts/test-unit.sh", "The fast checks behind npm test."),
        (".github/workflows/ci.yml", "The nine CI jobs."),
        ("scripts/test-snap-dbus-probe.py", "Drives the probe snap on the session bus, as GNOME Shell would."),
        (
            "scripts/test-private-ibus-engine-hosted.sh",
            "Runs desktop tests in private sessions, and only on GitHub Actions.",
        ),
        ("scripts/test-application-delivery.py", "Pastes into real apps and reads the text back."),
        ("scripts/fixtures/uinput-bridge.py", "Grabs VOCO's virtual keyboard and replays its keys inside a test session."),
        ("scripts/distro-dependencies.py", "Prints the package dependencies by Debian or Fedora names."),
        ("scripts/test-gnome-panel.py", "Runs GNOME Shell nested, or headless from GNOME 50."),
        ("scripts/test-gnome-panel-container.sh", "Runs the companion suite on a Fedora image's GNOME Shell in rootless Podman."),
        ("scripts/fixtures/paste-field.py", "The GTK field the companion suite times each paste in."),
        (R + "test_worker_protocol.py", "The worker rulebook tests."),
        ("scripts/stage-speech-worker.py", "Copies the speech worker as packages ship it, for CI to run."),
        ("scripts/check-privacy.sh", "Runs a release build offline and online and records its network calls, DNS and microphone streams."),
        ("scripts/check-speech.sh", "Measures word error rate, latency and the My words gates through the real worker."),
        (F + "lib/dictationStream.test.ts", "Queue and delivery tests."),
        ("package.json", "npm test and the other test scripts."),
    ],
    "Tests prove promises on the systems they ran on. Another desktop or app needs its own run.",
    "Which command runs the fast checks that need no microphone, model or desktop?",
    [
        "A full release build",
        "Recording a sample with your own microphone",
        "npm test, which runs scripts/test-unit.sh",
    ],
    2,
    "npm test runs scripts/test-unit.sh, which needs no microphone, speech model or desktop session. The heavier checks run in CI.",
)

lesson(
    "shipping",
    "How source becomes an app.",
    "Shipping turns source code into a package someone can trust. Each step leaves proof that the next step can check.",
    [
        "A release starts from a signed tag on a commit that already passed CI on master. The build runs from a clean tree, and its timestamps come from the last commit.",
        "The build adds the speech runtime and model to a Debian package, builds a Fedora RPM from the same staged files, checks both and signs the checksums.",
        "The installer runs the chain backwards. It checks the signature, then the checksum, and only then installs.",
    ],
    [
        (
            "Tag",
            "assemble-release.sh needs a signed voco.<version> tag that git verify-tag accepts, on a commit that passed CI on master.",
        ),
        (
            "Build",
            "The tree must be clean, SOURCE_DATE_EPOCH comes from the last commit, and the build must not change tracked files.",
        ),
        (
            "Package",
            "package-nvidia.py adds the speech runtime and model to the Tauri package and, with --rpm and --snap, builds the RPM and the snap from the same staged tree. verify-deb-package.sh, verify-rpm-package.sh and verify-snap-package.sh check them.",
        ),
        ("Sign", "sign-release-checksums.sh signs the checksum files."),
        (
            "Install",
            "The install script checks the signature with gpgv, then the package checksum, then installs with APT or DNF.",
        ),
    ],
    [
        (
            "Nothing is uploaded",
            "assemble-release.sh ends with the assembled, signed files and prints the gh release create command with --draft and --verify-tag. A person uploads the release.",
        ),
        (
            "Checking a download",
            "verify-release.sh exits 0 when the files are signed and verified, 1 on an integrity failure or unsafe path, and 2 when the checksums match but no usable signature exists.",
        ),
        (
            "The installer",
            "It supports x86-64 only. It uses APT when apt-get and dpkg-query exist, otherwise DNF when dnf and rpm do, and the package manager must then report exactly that release. After installing, it checks desktop input with voco --check-desktop-input; if that fails, it says \"VOCO is installed. Desktop setup needs one more step.\" and exits with code 2.",
        ),
        (
            "Before the download",
            "The installer stops early on a system VOCO can't run on: glibc older than 2.39, or a processor without AVX2, FMA and F16C. It refuses only what it could read and found short, and leaves the rest to the package manager.",
        ),
        (
            "One installer file",
            "install embeds scripts/lib/install-common.sh, the steps setup.sh also sources, byte for byte. sync-installer-ui.py --check fails on any difference.",
        ),
        (
            "Same files in both",
            "Given the Debian package too, verify-rpm-package.sh proves that both carry the same files and that the RPM requires each Debian dependency under its Fedora name.",
        ),
        (
            "The snap",
            "With VOCO_RELEASE_SNAP=1 the assembler also builds the snap, for the Snap Store rather than the GitHub release. snap_package.py leaves out the uinput rule and module file, the IBus engine, the companion and the Chromium host, and verify-snap-package.sh proves the snap holds the Debian package's other files byte for byte.",
        ),
        (
            "Programs in their own folders",
            "The snap takes Python with NumPy and SentencePiece, xclip, xdotool and notify-send from Ubuntu 24.04. Each lives with its libraries in a folder under /usr/lib/voco/snap and runs through a small wrapper, so none of them replaces the GNOME platform's libraries in the app.",
        ),
        (
            "A pinned install line",
            "The README's install line stays pinned to the release named in packaging/published-release.json, and rehearse-release.sh checks that the documented lines match.",
        ),
        (
            "One script per package",
            "The Debian package's only maintainer script repairs directory modes from older installs, without following links or touching user data, then applies the uinput rule: it loads uinput, reloads udev's rules and re-triggers /dev/uinput, each step best effort within 10 seconds. debian_maintainer.py generates and verifies it. The RPM's only scriptlet, post.sh, runs the same three steps.",
        ),
    ],
    [
        ("scripts/assemble-release.sh", "Builds and signs a release from a signed tag, and uploads nothing."),
        ("scripts/build-desktop.sh", "Builds the desktop app."),
        ("scripts/package-nvidia.py", "Adds the speech runtime and model, then builds both packages from one staged tree."),
        ("scripts/verify-deb-package.sh", "Checks the Debian package's contents."),
        ("scripts/rpm_package.py", "Renders the RPM spec, builds the RPM and holds its checks."),
        ("scripts/verify-rpm-package.sh", "Checks the RPM, and that it matches the Debian package."),
        ("scripts/snap_package.py", "Copies the snap's files, renders its recipe and holds its checks."),
        ("scripts/verify-snap-package.sh", "Checks the snap, and that it matches the Debian package."),
        ("packaging/snap/snapcraft.yaml.in", "The snap's recipe."),
        ("packaging/snap/wrappers/python3", "Runs the speech worker's Python from the snap's own folder."),
        ("packaging/rpm/voco.spec.in", "The RPM spec template."),
        ("packaging/rpm/post.sh", "The RPM's only scriptlet."),
        ("scripts/sign-release-checksums.sh", "Signs the checksum files and uploads nothing."),
        ("scripts/verify-release.sh", "Checks downloaded files and their signature."),
        ("scripts/render-release-body.sh", "Prints the GitHub release notes for a release tag."),
        ("scripts/rehearse-release.sh", "Checks versions, the installer and the documented install lines."),
        ("install", "The installer: platform floors, signature, checksum, APT or DNF, then the desktop check."),
        ("scripts/lib/install-common.sh", "The install steps the installer embeds and setup.sh sources."),
        ("scripts/sync-installer-ui.py", "Embeds the shared steps and the interface into install, and checks them."),
        ("KEYS", "The public key that signs releases."),
        ("packaging/published-release.json", "The release the install instructions point to."),
        ("scripts/debian_maintainer.py", "Generates and verifies the one maintainer script."),
        ("packaging/debian/postinst.py.in", "Repairs directory modes and applies the uinput rule."),
    ],
    "A signature proves where the files came from and that they are unchanged. It doesn't prove how VOCO behaves on a given desktop.",
    "The downloaded package doesn't match its checksum. What does the installer do?",
    ["Installs it and warns you", "Stops without installing", "Downloads a different version"],
    1,
    "The installer checks the signature, then the checksum. A mismatch stops it with \"The download could not be verified. Run the installer again; nothing was installed.\"",
)

lesson(
    "dependencies",
    "Borrowed code needs care.",
    "VOCO builds on libraries other people wrote. A few need small fixes, so VOCO keeps patched copies and checks them.",
    [
        "Three Rust libraries are patched in vendor: glib, global-hotkey and tray-icon. Cargo.toml tells every part of VOCO to use those copies.",
        "Each patch is small and has one reason: in glib a security fix, in global-hotkey an X11 shortcut actor that waits for events instead of polling, and in tray-icon icons that stay valid while VOCO runs. The package carries each one's licenses and patch notes.",
        "Scripts check each patched copy against its recorded origin, so a later update can't quietly bring back the unpatched code.",
    ],
    [
        ("glib", "0.18.5 with the two-line upstream fix for RUSTSEC-2024-0429."),
        ("global-hotkey", "0.8.0 with an event-driven X11 actor."),
        ("tray-icon", "0.25.1 with a Linux call that sets icons by file path."),
        (
            "Ship",
            "package-nvidia.py copies each crate's licenses, patch notes and provenance into /usr/share/doc/voco/vendor, and stops if one is missing.",
        ),
        (
            "Verify",
            "Three verify scripts compare each copy with its recorded origin and check how Cargo resolves it.",
        ),
    ],
    [
        (
            "One glib for everyone",
            "GTK 0.18 and WebKit2GTK need glib 0.18, so VOCO patches Cargo's resolution and every glib user gets the fixed copy. verify-glib-backport.py checks the source against the pinned archive and the exact upstream fix, and that only one glib resolves.",
        ),
        (
            "Why the X11 actor waits",
            "The patched global-hotkey waits on the X11 connection and a command signal instead of a timer, so key events never wait for a 50 ms tick and an idle actor never wakes. VOCO and Tauri's shortcut plugin must share this one copy.",
        ),
        (
            "Why icons stay put",
            "The patch adds set_icon_path. VOCO writes 3 state icons and 64 meter frames into a private folder once and keeps them while it runs, so a slow tray reader can still open any icon VOCO announced.",
        ),
        (
            "Licenses travel along",
            "The RPM marks those notices as licenses, so they stay installed even when documentation is skipped.",
        ),
        (
            "Everything else is unpatched",
            "Other crates come from crates.io at the versions Cargo.lock records. The virtual keyboard, for example, uses evdev 0.13.2 as published.",
        ),
    ],
    [
        ("vendor/README.md", "What is vendored and why."),
        ("vendor/glib/VOCO-PATCH.md", "The glib fix and why one copy serves everyone."),
        ("vendor/global-hotkey/VOCO-PATCH.md", "The event-driven X11 actor."),
        ("vendor/tray-icon/VOCO-PATCH.md", "Icons set by path that stay valid."),
        ("scripts/verify-glib-backport.py", "Checks the glib fix and its single resolution."),
        ("scripts/verify-shortcut-backport.py", "Rejects a second, unpatched shortcut actor."),
        ("scripts/verify-tray-backport.py", "Checks the tray source and requires Tauri to use the patched icon call."),
        ("apps/desktop/src-tauri/Cargo.toml", "Rust dependencies and the [patch.crates-io] overrides."),
        ("apps/desktop/src-tauri/Cargo.lock", "The exact version of every Rust crate."),
        ("scripts/package-nvidia.py", "Copies each patched crate's notices into the package."),
        ("scripts/rpm_package.py", "Marks the notices as licenses in the RPM."),
        ("apps/desktop/package.json", "The window's JavaScript dependencies."),
        ("vendor/THIRD-PARTY-NOTICES.txt", "Licenses for the vendored code."),
        ("runtime/notices/THIRD_PARTY_NOTICES.md", "Licenses for the speech runtime."),
    ],
    "Scanners that compare version numbers only may still flag glib 0.18.5. The fix is in the patched source, which verify-glib-backport.py checks.",
    "A dependency update would make Tauri's shortcut plugin use an unpatched global-hotkey. What catches it?",
    [
        "verify-shortcut-backport.py rejects a split dependency graph",
        "Nothing, because Cargo always picks the patched copy",
        "The GNOME companion",
    ],
    0,
    "VOCO and tauri-plugin-global-shortcut must resolve to the one patched copy. verify-shortcut-backport.py fails when a second, unpatched shortcut actor appears.",
)

lesson(
    "code-reading",
    "Open any piece of the code.",
    "Reading a large project is easier with a thread to follow. Pick one event and follow it from file to file.",
    [
        "Follow the toggle. Rust emits voco:toggle-dictation from lib.rs. useGlobalShortcut.ts hears it, useDictation.ts and dictationRecording.ts start the recording, and dictationStream.ts sends audio through the speech_stream command.",
        "From there, speech_stream.rs talks to the worker, and insertion.rs pastes the words. Tests sit next to the code they check, usually in a file with test in its name.",
        "All source files lists every tracked file at the commit this guide records, so the code you read matches the chapters.",
    ],
    [
        ("Event", "lib.rs emits voco:toggle-dictation after the 120 ms gate."),
        (
            "Hook",
            "useGlobalShortcut.ts listens for the event and hands it to App.tsx, which decides whether this press starts or stops a recording.",
        ),
        ("Recording", "dictationRecording.ts checks setup, opens capture and starts the journal."),
        (
            "Stream",
            "dictationStream.ts sends packets through the speech_stream command to speech_stream.rs and the worker.",
        ),
        ("Paste", "New words go through a Tauri command to insertion.rs."),
    ],
    [
        (
            "Find the command",
            "Every command the window can call is registered in lib.rs. Search for the command's name there first.",
        ),
        (
            "Types cross the boundary",
            "lib/tauri.ts gives many commands typed wrappers, so the window calls them like ordinary functions.",
        ),
        (
            "Follow the numbers",
            "Constants have names such as TOGGLE_DEBOUNCE_MS. Search for the name to find every place that uses it.",
        ),
        ("Read the tests", "A test shows in a few lines how the code is expected to behave."),
    ],
    [
        (F + "App.tsx", "Decides what each toggle means."),
        (F + "hooks/useGlobalShortcut.ts", "Hears the toggle event."),
        (F + "hooks/useDictation.ts", "Wires capture into a recording."),
        (F + "lib/dictationRecording.ts", "Runs one recording from Start through Stop."),
        (F + "lib/dictationStream.ts", "Sends packets and passes on new words."),
        (F + "lib/tauri.ts", "Typed wrappers for Tauri commands."),
        (B + "lib.rs", "Emits the toggle and registers every command."),
        (B + "speech_stream.rs", "Talks to the worker."),
        (R + "worker_main.py", "Answers each request."),
        (B + "insertion.rs", "Pastes the words."),
    ],
    "The guide shows one recorded commit. Your working tree may differ, so check the commit before you compare.",
    "You want to find the Rust function behind a command the window calls. Where do you look first?",
    [
        "In the speech worker",
        "In the tray menu",
        "In lib.rs, where commands are registered",
    ],
    2,
    "Every command the window can call is registered in lib.rs, so the command's name leads you to the Rust function.",
)

lesson(
    "top-bar",
    "A microphone in the top bar.",
    "On GNOME, VOCO can live in the top bar near the clock, with bars that move while you speak.",
    [
        "The optional companion for GNOME 46, 48, 50 and 51 shows VOCO's microphone in the top bar. While you dictate, a seven-bar meter opens on its left when there is room beside the clock.",
        "The installer runs voco --setup-panel, and VOCO's setup and Help offer Enable live panel. Enabling adds only this extension, may need you to sign out and back in, and never restarts the Shell. The package alone never enables it, and voco --check-panel changes nothing.",
        "Once the companion attaches, VOCO hides its tray icon. On Wayland the companion grabs Alt+D or Alt+Shift+D inside the Shell, so other apps never see the shortcut, and presses VOCO's paste keys.",
    ],
    [
        ("Enable", "voco --setup-panel or Enable live panel turns on this one extension for your user."),
        (
            "Attach",
            "The companion calls Attach over D-Bus. VOCO accepts it only from the process that owns org.gnome.Shell, then hides the tray icon.",
        ),
        (
            "Poll",
            "The companion asks for VOCO's state every 50 ms while recording and every 1500 ms otherwise.",
        ),
        (
            "Grab",
            "On Wayland it grabs the configured preset and renews a 2.5-second lease about once a second.",
        ),
        (
            "Release",
            "If GetState stops arriving for more than 5 seconds, or the companion calls Detach, VOCO drops the lease and shows the tray icon again.",
        ),
    ],
    [
        (
            "The menu",
            "A primary click stops dictation, or opens VOCO when nothing can be stopped. Other mouse buttons, the Menu key and Shift+F10 open a menu with Settings, Review and Stop dictation.",
        ),
        (
            "Motion",
            "Bars grow in 45 ms and shrink in 100 ms. While VOCO processes, the bars hold at 0.35 and pulse over 700 ms, each bar 40 ms after the last. The meter opens in 220 ms. When GNOME's animations are off, every change happens at once and nothing pulses.",
        ),
        (
            "The bar formula",
            "Each bar's height is 0.15 + 0.85 × level × weight, with weights 0.35, 0.65, 0.9, 1, 0.8, 0.55 and 0.3 from left to right.",
        ),
        (
            "Fresh levels only",
            "A level older than 250 ms reads as silence, so the bars never freeze on an old value.",
        ),
        (
            "Keys released",
            "When VOCO can't read the keyboards, it asks the companion whether the shortcut's keys are up before a Wayland paste, and waits at most 150 ms for its ModifiersState report. A copy from before NextRequest answers ModifiersClear instead.",
        ),
        (
            "VOCO never calls the Shell",
            "A strict snap may answer GNOME Shell but never call it, so from companion version 17 the companion asks VOCO for work. It keeps one NextRequest call waiting, for up to 30 seconds, and calls again as soon as VOCO answers: with a paste, a modifier check, a change of state, or idle after 20 seconds.",
        ),
        (
            "Paste keys from the Shell",
            "For a paste, the companion presses Shift and Insert with one virtual keyboard per enable, 12 ms apart, then reports PasteDone with the time the Insert press went out. VOCO takes a report only from the attached Shell and only for its open request. The companion refuses with ModifiersHeld while a modifier is held and with Busy while another paste is in flight. Disabled during a paste, it releases the keys it holds and reports Disabled, which VOCO treats as uncertain, and GNOME disables it at the lock screen.",
        ),
        (
            "Setup messages",
            "Active: \"Live panel bars and Stop are active.\" Disabled: \"Enable live microphone bars and the VOCO menu in your top panel.\" After enabling: \"Panel enabled. Sign out and back in to load it; saving your work first is recommended.\" After an update, including a copy the Shell marked out of date at login: \"Panel update installed. Save your work, then sign out and back in to load the current panel and shortcut.\"",
        ),
        (
            "Other desktops",
            "On other GNOME versions: \"The VOCO panel supports GNOME 46, 48, 50 and 51. Dictation still works, but without the panel the focused app also receives Alt+D and Alt+Shift+D. To avoid that, choose another shortcut in VOCO and configure it in your desktop to run voco --toggle.\" On other desktops: \"Use the VOCO tray menu for status and Stop. Labels depend on your desktop.\"",
        ),
        (
            "From GNOME 50",
            "GNOME 50 and 51 have no Meta.is_wayland_compositor, so the companion treats a Shell without it as Wayland. Their panel button opens the menu from a click gesture, so the companion leaves primary presses and touches to the pill, and a primary click still stops dictation or opens VOCO.",
        ),
        (
            "No icon at all",
            "The tray icon needs a tray host, on GNOME an AppIndicator extension, which Debian and Fedora don't turn on. If 20 seconds after startup the companion isn't attached and no tray host owns org.kde.StatusNotifierWatcher, VOCO says \"VOCO has no icon in the top bar\" once. On GNOME it adds \"Open VOCO from the app menu, choose Enable live panel in Help, then sign out and back in.\"",
        ),
        (
            "The tray fallback",
            "Without the companion, the tray shows 3 state icons and, while you dictate, animates 64 meter frames every 90 ms.",
        ),
        ("The check cache", "VOCO reuses a panel check for 20 seconds, or for 2 seconds after a failed check."),
        (
            "Until the next login",
            "The Shell loads a newly installed companion at the next login, so until then the focused app also gets Alt+D. Setup's last step then leads with VOCO's note on what the shortcut does there and the fix, and the dictation instruction follows it. The note comes from the once-a-second diagnostics, so it changes when you enable the panel.",
        ),
    ],
    [
        (
            "integrations/gnome/voco-panel@sergiopesch.com/extension.js",
            "The companion: the pill, the bars, the menu, the Wayland grab and the paste keys.",
        ),
        ("integrations/gnome/voco-panel@sergiopesch.com/model.js", "The bar weights and height formula."),
        ("integrations/gnome/voco-panel@sergiopesch.com/metadata.json", "Declares GNOME 46, 48, 50 and 51 and companion version 17 as its version-name, which extensions.gnome.org keeps."),
        (B + "panel.rs", "VOCO's D-Bus service for the companion: Attach, state, the shortcut lease and the work it hands out through NextRequest."),
        (B + "panel_setup.rs", "Checks and enables the companion, and caches the result."),
        (B + "tray.rs", "The tray icon, hidden while the companion is attached."),
        (B + "lib.rs", "Says once when VOCO has no icon in the top bar."),
        (B + "tray_icons.rs", "Writes the state icons and meter frames once."),
        (P + "voco_gnome_panel.py", "The helper behind --check-panel and --setup-panel."),
        (F + "components/PanelSetup.tsx", "The Enable live panel button in setup and Help."),
        (F + "components/Onboarding.tsx", "Setup, whose last step leads with the shortcut note."),
        (
            "scripts/test-gnome-panel.py",
            "Runs real GNOME actors with a synthetic, transcript-free fixture.",
        ),
        ("scripts/test-panel-model.mjs", "Tests the bar formula."),
        (F + "lib/audioLevel.ts", "Turns samples into the level the bars show."),
        ("scripts/package-gnome-panel.py", "Builds a reproducible extension zip without installing it."),
    ],
    "The companion is optional and supports GNOME 46, 48, 50 and 51. Elsewhere, use the tray menu and, for another chord, a desktop binding that runs voco --toggle.",
    "GNOME Shell stops calling GetState. What does VOCO do?",
    [
        "Keeps the tray icon hidden",
        "Releases the companion and shows its tray icon again after 5 seconds",
        "Restarts GNOME Shell",
    ],
    1,
    "VOCO watches for GetState. After more than 5 seconds without it, VOCO drops the companion's lease and brings back the tray icon, so status and Stop stay reachable.",
    "wave",
)

lesson(
    "desktops",
    "Each desktop, its own helpers.",
    "Linux desktops differ in how programs may read keys and send them. VOCO picks a helper for each job from the session it runs in.",
    [
        "VOCO reads XDG_SESSION_TYPE, WAYLAND_DISPLAY and DISPLAY. If XDG_SESSION_TYPE says wayland, VOCO takes the Wayland path. If it says x11, VOCO takes X11 even when WAYLAND_DISPLAY is set. When XDG_SESSION_TYPE is tty, unset or empty, WAYLAND_DISPLAY chooses Wayland and DISPLAY alone chooses X11; neither variable means no desktop session.",
        "On Wayland, keys go through VOCO's own virtual keyboard, a uinput device named VOCO virtual keyboard, or on GNOME through the companion's keyboard inside the Shell once it asks VOCO for work. On GNOME with an X display, xclip sets the clipboard through XWayland: GNOME lacks the wlroots data-control protocol, wl-copy's temporary focus surface can stall, and XWayland bridges the clipboard without taking focus. Other Wayland desktops use wl-copy.",
        "On X11, xdotool sends the keys and xclip sets the clipboard. The table below shows each combination.",
    ],
    [
        ("Detect", "XDG_SESSION_TYPE=wayland selects Wayland. XDG_SESSION_TYPE=x11 selects X11 even when WAYLAND_DISPLAY is set. When XDG_SESSION_TYPE is tty, unset or empty, WAYLAND_DISPLAY chooses Wayland and DISPLAY alone chooses X11."),
        (
            "Shortcut",
            "On X11 VOCO grabs the chord. On Wayland the GNOME companion grabs it, or VOCO reads the keyboards for the two presets.",
        ),
        (
            "Keys",
            "On Wayland the GNOME companion presses Shift+Insert once it asks for work, and VOCO's virtual keyboard otherwise. X11 uses xdotool.",
        ),
        ("Clipboard", "xclip on X11 and on GNOME with DISPLAY set, wl-copy on other Wayland sessions."),
        ("Paste", "Every path ends with Shift+Insert into the focused app."),
    ],
    [
        (
            "One keyboard for the whole run",
            "VOCO creates the keyboard at startup and keeps it until it quits, never one per paste. The compositor adds a new device late and could miss its first keys, so a keyboard younger than 500 ms waits before it types. When VOCO exits, the kernel removes the device and releases any key it held.",
        ),
        (
            "Two keys, one at a time",
            "The keyboard declares only Shift and Insert. Each press and release goes out in its own report, 12 ms apart, so every toolkit sees the chord in order and a paste still takes under 100 ms.",
        ),
        (
            "Access without a helper",
            "The package's udev rule gives the user of the active local session access to /dev/uinput. To check it, voco --check-desktop-input only opens /dev/uinput; it never creates the device or sends keys. Without access it says \"VOCO can't open /dev/uinput, so it can't send the paste keys. Sign out and back in once after installing VOCO; if that doesn't help, see Platform support: Access to /dev/uinput.\"",
        ),
        (
            "Check before the paste",
            "Keys reach whichever login owns the seat, so VOCO asks logind about its originating desktop session before the copy and again just before the keys. An inactive result stops the paste, and so does a locked screen. If logind can't answer, pasting is allowed. The check doesn't lock the session against a later switch.",
        ),
        (
            "After a key error",
            "If the keyboard stops accepting keys, VOCO releases Shift and drops the device, and the next paste creates a fresh one.",
        ),
        (
            "The companion's keyboard",
            "On GNOME Wayland, while the companion is attached and the copy GNOME has loaded asks for work, it presses the keys from inside the Shell, so no new device has to settle first. A Shell still running an older copy keeps VOCO's keyboard until the next login.",
        ),
        (
            "Keys stay on Wayland",
            "Even when xclip sets the clipboard on GNOME, the paste keys still go through the companion or the virtual keyboard.",
        ),
    ],
    [
        (B + "insertion.rs", "Chooses the clipboard helper and the paste keys for each session."),
        (B + "virtual_keyboard.rs", "VOCO's keyboard: two keys, 12 ms apart."),
        (B + "selection_owner.rs", "Runs xclip with -verbose where it copies on GNOME Wayland, and reports each read."),
        (B + "desktop_session.rs", "Binds the originating desktop session and checks whether it is active and locked."),
        (B + "lib.rs", "Shortcut routes for each session, and the keyboard created at startup."),
        (B + "confinement.rs", "Knows when VOCO runs as its snap."),
        ("integrations/gnome/voco-panel@sergiopesch.com/extension.js", "The GNOME grab and paste keys on Wayland."),
        ("packaging/udev/70-voco-uinput.rules", "Gives the active session's user access to /dev/uinput."),
        ("packaging/udev/voco-uinput.conf", "Loads the uinput module at boot."),
        ("packaging/debian/postinst.py.in", "Applies the udev rule after installing."),
        ("install", "Installs the package, then checks the paste prerequisites."),
        ("apps/desktop/src-tauri/tauri.conf.json", "The package's helper dependencies and the udev files."),
    ],
    "The table shows which code path runs on each desktop, not whether every app there accepts the paste.",
    "You use GNOME on Wayland, and DISPLAY is set. Which program sets the clipboard?",
    ["wl-copy", "xclip, through XWayland", "xdotool"],
    1,
    "GNOME lacks the data-control protocol, so with DISPLAY set VOCO uses xclip through XWayland, which needs no window that takes focus. The paste keys still go through the companion or VOCO's virtual keyboard.",
)
chapters[-1]["comparison"] = {
    "title": "Which helper does each job",
    "headers": ["Session", "Shortcut", "Keys", "Clipboard helper"],
    "rows": [
        [
            "GNOME on Wayland",
            "The companion's Shell grab of Alt+D or Alt+Shift+D when attached; otherwise VOCO reads the keyboards for those presets, and the focused app also sees them; for another chord, a desktop binding that runs voco --toggle",
            "The companion's keyboard when its loaded copy asks for work, otherwise VOCO virtual keyboard, after Mutter's read of a new xclip copy (up to 100 ms), the modifier wait and the session check; unavailable session status permits keys",
            "xclip through XWayland when DISPLAY is set, run with -verbose so it reports each read; otherwise wl-copy",
        ],
        [
            "Other Wayland desktops",
            "VOCO reads the keyboards for Alt+D and Alt+Shift+D, and the focused app also sees them; for another chord, a desktop binding that runs voco --toggle",
            "VOCO virtual keyboard, after the modifier wait and session check; unavailable session status permits keys",
            "wl-copy",
        ],
        [
            "X11",
            "VOCO's global key grab, toggling on release",
            "xdotool key --clearmodifiers shift+Insert, once the shortcut is released and the X server reports no Shift, Control, Alt, Super or AltGr held, waiting at most 1.5 seconds",
            "xclip",
        ],
        [
            "The VOCO snap",
            "The companion's Shell grab on GNOME Wayland, VOCO's global key grab on X11, or a desktop binding that runs voco --toggle; it never reads the keyboards or uses IBus",
            "Only the companion's keyboard on GNOME Wayland, and Start is refused on other Wayland desktops; xdotool from the snap's own folder on X11",
            "xclip from the snap's own folder",
        ],
        [
            "IBus input source, any session",
            "The VOCO Dictation input source consumes the chord in IBus-aware fields",
            "Unchanged: the session's helper",
            "Unchanged: the session's helper",
        ],
    ],
    "scope": "Code paths at the commit this guide records. Session detection reads XDG_SESSION_TYPE, WAYLAND_DISPLAY and DISPLAY as the table describes.",
    "limits": "Pasting replaces CLIPBOARD and PRIMARY and leaves the words there. Keys go to whichever app has focus. Each desktop and app still needs its own testing.",
}
chapters[-1]["sourceNote"] = "The table follows insertion.rs (helpers and keys), selection_owner.rs (the GNOME copies), virtual_keyboard.rs (the Wayland keys), desktop_session.rs (the session check), lib.rs (shortcut routes), confinement.rs (the snap) and extension.js (the GNOME grab). It describes code paths, not a compatibility promise."

# Fail closed if a lesson cites a path absent from the pinned source.
root = Path(__file__).resolve().parents[1]
catalog = json.loads((root / "site/catalog.json").read_text())
paths = {x["path"] for x in catalog["files"]}
missing = [f["path"] for ch in chapters for f in ch["files"] if f["path"] not in paths]
assert not missing, missing
for ch in chapters:
    seen = set()
    ch["files"] = [
        f for f in ch["files"] if not (f["path"] in seen or seen.add(f["path"]))
    ]
output = json.dumps(chapters, indent=2) + "\n"
if "--check" in sys.argv:
    assert (
        root / "site/chapters.json"
    ).read_text() == output, "Regenerate chapters.json before shipping"
else:
    (root / "site/chapters.json").write_text(output)
print(f"Authored {len(chapters)} chapters and verified all cited file paths.")
