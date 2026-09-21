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
    "Imagine a tiny team on your laptop. One helper listens, one understands, and one puts the words where you are typing.",
    [
        "When you press a shortcut, VOCO listens to your microphone, turns the sound into words, and puts those words at your cursor.",
        "Each part does one job. They pass small messages to each other instead of waiting for one enormous recording.",
        "In this chapter, follow the whole journey. Later chapters open each box and show the real code inside.",
    ],
    [
        ("Shortcut", "You press Alt+D. VOCO checks that it is safe to start."),
        (
            "Microphone",
            "The microphone turns changing air pressure into a stream of numbers.",
        ),
        ("Speech model", "A local trained model predicts words from those numbers."),
        ("Delivery", "VOCO checks the destination and sends the new text."),
        (
            "Your cursor",
            "The receiving app accepts the paste. VOCO never presses Enter for you.",
        ),
    ],
    [
        (
            "A team, not one magic function",
            "React manages the visible app and recording flow. Rust handles operating-system work. A Python worker calls the native speech library. The receiving app is a separate program.",
        ),
        (
            "The current route",
            "VOCO uses NVIDIA Nemotron English 0.6B Q8 on the CPU. Names containing benchmark in the streaming code are historical; they do real production work.",
        ),
        (
            "Keep the boundary clear",
            "The speech worker can return words even if another application refuses a paste. Recognition success and successful delivery are different things.",
        ),
    ],
    [
        (
            F + "App.tsx",
            "Connects the interface, saved preferences and dictation hook.",
        ),
        (
            F + "hooks/useDictation.ts",
            "Coordinates one recording from Start through Stop.",
        ),
        (R + "stream_worker.py", "Starts the selected local speech worker."),
    ],
    "This guide describes a pinned development source snapshot recorded in its catalog. It does not promise every Linux app or compositor accepts delivery.",
    "Which part owns the text box you are dictating into?",
    ["VOCO always owns it", "The receiving application", "The speech model"],
    1,
    "The receiving application owns its own text field. VOCO must respect that boundary.",
)
lesson(
    "languages",
    "Meet the languages.",
    "Different tools do different jobs, like cooks, waiters and a kitchen manager.",
    [
        "TypeScript helps us describe what kind of information is allowed. React uses it to build the interface.",
        "Rust is the careful manager at the door to Linux. Python connects the speech pieces. A compiled native library does the heavy model work.",
        "A language is not a performance score. Where the time goes matters more than the name of the language.",
    ],
    [
        (
            "TypeScript",
            "Describes data shapes and catches many mistakes before the app runs.",
        ),
        ("React", "Updates controls and status when application state changes."),
        ("Rust", "Owns native commands, processes, files and input checks."),
        ("Python", "Validates streaming messages and calls the speech adapter."),
        ("Native library", "Runs trained model calculations using CPU threads."),
    ],
    [
        (
            "Two kinds of checking",
            "TypeScript types disappear when compiled. Rust and Python must still validate messages received at runtime. A correctly typed sender is not a security guarantee.",
        ),
        (
            "What Tauri provides",
            "Tauri connects a WebKit-rendered interface to native Rust commands. An invoke call crosses that boundary; it is not an ordinary same-language function call.",
        ),
        (
            "How to read unfamiliar syntax",
            "An import brings in another tool. A function names a job. A class or struct groups related information. A test checks what happens in a particular situation.",
        ),
    ],
    [
        (F + "lib/tauri.ts", "Typed frontend wrappers for native commands."),
        (
            B + "lib.rs",
            "Registers native commands and initializes the desktop application.",
        ),
        (R + "adapters.py", "Connects Python to native C-compatible functions."),
        ("apps/desktop/src-tauri/Cargo.toml", "Lists Rust dependencies."),
        ("apps/desktop/package.json", "Lists frontend dependencies and scripts."),
    ],
    "The model weights and compiled speech payload are provisioned separately. They are not all present as readable source in this checkout.",
    "Does a TypeScript type remove the need to validate a native message?",
    ["Yes", "No"],
    1,
    "Runtime messages still need validation at each trust boundary.",
)
lesson(
    "shortcut",
    "One press, one recording.",
    "A shortcut is a doorbell. One ring should produce one response, even when two helpers hear it.",
    [
        "Linux can report a key press through different routes. VOCO must avoid treating one press as two separate instructions.",
        "During a recording, the shortcut belongs to that recording session. An old callback must not stop a newer session.",
        "If a shortcut has already been consumed, ignoring its callback can lose the user’s only signal. That is why the arbitration rules are careful.",
    ],
    [
        ("Key chord", "The configured chord is pressed."),
        ("Arbitration", "VOCO checks which shortcut route currently has authority."),
        (
            "Debounce",
            "A repeated observation of the same press is suppressed when appropriate.",
        ),
        ("Session lease", "One recording gets a specific ownership token."),
        ("Release", "Finish, cancellation or expiry releases that ownership."),
    ],
    [
        (
            "Root and focused-window grabs",
            "On X11, a passive grab can be attached to the root window or the exact input-focus window. The selected recording scope avoids the root-grab focus disturbance found in testing.",
        ),
        (
            "IBus is a shortcut helper",
            "Protocol 6 does not authorize generic text mutation. It helps deliver the recording trigger; it is not the normal text insertion engine.",
        ),
        (
            "A lease has an end",
            "The X11 recording lease has a fixed 650-second expiry. This covers the 600-second capture limit plus finishing allowance; it is not permission to record forever.",
        ),
    ],
    [
        (
            F + "hooks/useGlobalShortcut.ts",
            "Receives shortcut events in the interface.",
        ),
        (
            F + "lib/desktopShortcutSession.ts",
            "Owns the UUID and renderer epoch for one recording.",
        ),
        (
            B + "shortcut_arbitration.rs",
            "Decides which trigger observations may proceed.",
        ),
        (B + "desktop_shortcut.rs", "Acquires and releases native recording scope."),
        (
            "vendor/global-hotkey/src/platform_impl/x11/focus_lease.rs",
            "Implements the patched X11 focus lease.",
        ),
    ],
    "An IBus poll in flight is different from completed IBus ownership. Treating them as identical previously lost valid X11 callbacks.",
    "An old recording finishes after a new one starts. What should its callback do?",
    ["Update the new recording", "Respect its old session identity"],
    1,
    "Session tokens prevent old asynchronous work from changing a replacement recording.",
    "focus",
)
lesson(
    "microphone",
    "Sound becomes numbers.",
    "A microphone makes a very fast flipbook of sound. Each tiny measurement is called a sample.",
    [
        "Imagine writing down the height of a wave many times each second. The list of heights is digital audio.",
        "Sample rate means how many measurements happen in one second. It must travel with the numbers, like units on a ruler.",
        "The .43 candidate uses native audio capture on Wayland so the panel can stay hidden. X11 uses WebKit and an AudioWorklet to collect ordered pieces while the interface does other work.",
    ],
    [
        ("Permission", "On Wayland, explicitly allow the selected source for this app session. On X11, use browser microphone permission."),
        ("Device", "Bind the recording to the selected input. Native system-default selection resolves to a specific source."),
        ("Samples", "Capture ordered blocks and retain their sample rate through conversion."),
        ("Descriptor", "Keep source, rate and sample-count information together."),
        ("Queue", "Offer the blocks to the recording’s speech queue."),
    ],
    [
        (
            "A sample is not a word",
            "One number says something about the waveform at one instant. Recognition needs patterns across many samples to infer speech.",
        ),
        (
            "Never guess the rate",
            "Calling 44,100 samples “one second at 16 kHz” changes the meaning of the audio. Rate validation and resampling must be deliberate.",
        ),
        (
            "Permission is not a recording",
            "Selecting and allowing a native source does not open a recording. Start begins capture; Stop closes it. A removed source cannot silently become a different microphone.",
        ),
    ],
    [
        (F + "lib/audioInput.ts", "Opens and checks browser microphone input."),
        (F + "lib/audioCaptureBuffer.ts", "Retains bounded audio for a recording."),
        (
            F + "lib/captureDescriptor.ts",
            "Keeps audio identity and rate facts together.",
        ),
        (F + "lib/audioResampling.ts", "Handles explicit sample-rate conversion."),
        (
            B + "native_capture_commands.rs",
            "Native source selection, permission and bounded capture commands.",
        ),
    ],
    "The waveform below is a teaching drawing. It never activates your microphone.",
    "What must accompany a list of audio samples?",
    ["The sample rate", "The window wallpaper", "The font size"],
    0,
    "The rate tells the receiver how much time those samples represent.",
    "wave",
)
lesson(
    "queue",
    "Audio on a conveyor belt.",
    "Small boxes arrive in order. The next worker opens them one at a time.",
    [
        "A queue is a waiting line for work. It lets microphone capture continue while an earlier request is being processed.",
        "Each box carries a session and sequence number. Those labels stop a late reply from being mistaken for the next box.",
        "A bounded queue has a maximum size. If the worker falls too far behind, keeping unlimited audio would make memory and delay grow. The candidate groups 100 ms of audio per worker request to reduce IPC overhead; Stop sends any remaining partial packet immediately.",
    ],
    [
        ("Capture", "A new ordered block of audio arrives."),
        ("Label", "Attach session, sequence and sample-range metadata."),
        ("Wait", "The block waits behind earlier work."),
        ("Exchange", "Rust sends it to the worker and checks the reply."),
        ("Account", "Update capture, enqueue and response counters."),
    ],
    [
        (
            "The real bound",
            "The production phrase queue rejects backlog beyond three seconds of queued audio. That is a failure boundary, not a desired steady delay.",
        ),
        (
            "Words have a queue too",
            "A newer append-only hypothesis can replace pending output. Text already sent to an external app cannot be blindly replaced or replayed.",
        ),
        (
            "Counters explain missing work",
            "Captured, enqueued and responded samples should reconcile at the queue boundary. Those counts do not prove that a physical microphone captured every spoken sound.",
        ),
    ],
    [
        (
            F + "lib/benchmarkPhraseQueue.ts",
            "Serializes the production NVIDIA stream and delivery accounting.",
        ),
        (
            F + "lib/desktopPhraseStream.ts",
            "Handles the live phrase-delivery contract.",
        ),
        (B + "benchmark_stream.rs", "Supervises bounded worker requests and replies."),
    ],
    "The boxes in this simulator are illustrative. They are not measured audio or the real app’s queue.",
    "Why is an unlimited queue a bad idea?",
    [
        "It always improves accuracy",
        "Memory and waiting time could grow without a bound",
    ],
    1,
    "Limits turn overload into an explicit recoverable problem instead of silent unlimited growth.",
    "queue",
)
lesson(
    "worker",
    "The speech worker has a rulebook.",
    "Two helpers pass numbered notes through a pipe. Both must agree on what each note means.",
    [
        "The Rust backend runs one local Python worker. It sends a line of JSON for each request.",
        "The worker accepts start, push, finish and cancel. It checks the shape and identity of the message before using it.",
        "Normal protocol output is kept separate from native-library diagnostic output, so a log line cannot masquerade as a reply.",
    ],
    [
        ("Start", "Open a new recognition stream and remember its session."),
        ("Push", "Add a validated audio block in increasing sequence order."),
        ("Reply", "Return matching session/sequence fields and any new text."),
        ("Finish", "Drain the live stream and return the final hypothesis."),
        ("Cancel", "Close the correct stream without replaying old audio."),
    ],
    [
        (
            "Small enough to trust",
            "worker_main.py bounds each input line to 4 MiB and requires a newline. StreamingSession accepts one-dimensional finite audio blocks no longer than one second at the supplied rate.",
        ),
        (
            "Numbers are checked too",
            "The accepted sample-rate range is 8,000–96,000 Hz, with no rate change inside a session. NaN and infinity are rejected.",
        ),
        (
            "A stale cancel is special",
            "A cancel for a different session is acknowledged without cancelling the active recording. Safety sometimes means intentionally doing nothing.",
        ),
    ],
    [
        (
            R + "stream_worker.py",
            "Separates protocol stdout before importing the runtime.",
        ),
        (R + "worker_main.py", "Parses, validates and routes protocol messages."),
        (R + "streaming.py", "Validates audio and owns each streaming session."),
        (
            B + "benchmark_stream.rs",
            "Starts the process, bounds I/O and verifies replies.",
        ),
    ],
    "A worker that dies during push/finish is not silently restarted with replayed text. Recovery needs a safe session boundary.",
    "Why do replies repeat the session and sequence?",
    ["To make logs colorful", "To prove which request they belong to"],
    1,
    "A correct-looking reply for the wrong recording must still be rejected.",
    "protocol",
)
lesson(
    "model",
    "How the model guesses words.",
    "The model is a practiced pattern-finder, not a little person reading your mind.",
    [
        "Training happened before you installed VOCO. It produced many learned numbers called weights.",
        "During dictation, the model uses those weights and recent audio context to predict text. A runtime is the engine that performs the calculations.",
        "VOCO’s selected model is English-focused. It does not promise automatic language switching.",
    ],
    [
        ("Weights", "Load the pinned Q8 model and verify its SHA-256."),
        ("Recognizer", "Create one reusable native recognizer."),
        ("Stream", "Open a stream for this recording."),
        ("Context", "Use incoming audio and recent context to produce hypotheses."),
        ("Result", "Read and free each native result handle."),
    ],
    [
        (
            "Model versus runtime",
            "A model is the learned data; the runtime is the software that executes it. The same model may behave differently with different quantization, threading or streaming settings.",
        ),
        (
            "The selected configuration",
            "The worker defaults to Nemotron English 0.6B Q8, context 1, four CPU threads and the pool backend. Q8 is quantization: a compact representation of model values, not a statement of 98% accuracy.",
        ),
        (
            "Python is the bridge",
            "The Nemotron adapter uses ctypes to call the packaged native library. It defines argument/result types and closes recognizer, stream and result handles to avoid resource leaks.",
        ),
    ],
    [
        (R + "adapters.py", "Nemotron owns native recognizer and result handles."),
        (R + "streaming.py", "Loads and warms the selected configuration."),
        (R + "worker_main.py", "Reports sanitized runtime identity and readiness."),
        (
            "runtime/notices/NOTICE",
            "Records notices for bundled model and library components.",
        ),
    ],
    "The native binary and model weights are separately provisioned artifacts. Research adapters such as Moonshine are not selectable product features.",
    "What is the difference between model and runtime?",
    ["Weights versus the engine that executes them", "They are always the same file"],
    0,
    "The runtime executes calculations using the learned model weights.",
)
lesson(
    "delivery",
    "Words meet the cursor.",
    "Delivering a letter means checking the address, not just finishing the letter.",
    [
        "The recognizer’s words travel back to VOCO. Delivery checks whether the intended destination still looks valid.",
        "The normal desktop route uses clipboard replacement and a paste gesture appropriate to the target category.",
        "A successful key command is not proof that an application displayed the words. Some fields offer readback; some do not.",
    ],
    [
        ("Hypothesis", "Accept a new append-only text suffix."),
        ("Destination", "Check current focus and available target identity."),
        ("Clipboard", "Place the new text on the clipboard."),
        ("Paste", "Dispatch the appropriate key gesture without Enter."),
        ("Observe", "Use bounded field readback when available."),
    ],
    [
        (
            "Why spacing needs care",
            "Address bars and editors may treat leading spaces specially. The implementation has explicit joining rules and a literal-space path for the legacy helper.",
        ),
        (
            "Terminals are different",
            "Known terminal targets use their paste chord. VOCO does not edit the terminal’s shortcut configuration to make that work.",
        ),
        (
            "Why one word could get stuck",
            "A September .48 Codex trial inserted the first word, then stopped. Chromium exposed a fixed outer object placeholder while the actual text lived in a nested paragraph. The .49 candidate follows the caret into that paragraph and confirms its text and position, while retaining the original field identity and the no-replay rule. This newer finding does not change the source viewer pinned to .43.",
        ),
        (
            "Observation has limits",
            "Accessible-field samples are best-effort local observations, not atomic ownership or compositor paint. Firefox can report newly inserted text before its caret catches up. VOCO waits within the existing three-second limit for exact text and position to agree; an intermediate sample cannot confirm delivery, and an uncertain paste is never replayed. A target can still change between checks.",
        ),
    ],
    [
        (
            B + "insertion.rs",
            "Owns destination checks, clipboard writes and key dispatch.",
        ),
        (B + "focus_probe.rs", "Collects bounded focus/target identity."),
        (P + "voco_desktop_target.py", "Provides desktop target observations."),
        (
            F + "lib/dictationDelivery.ts",
            "Coordinates delivery outcomes in the frontend.",
        ),
    ],
    "Clipboard paste replaces the current clipboard text. VOCO never automatically sends the message by pressing Enter.",
    "The model returned words but focus changed. What is safer?",
    ["Paste into whatever is focused now", "Retain recovery instead of guessing"],
    1,
    "Uncertain delivery must not become a blind paste into a different app.",
    "focus",
)
lesson(
    "stop",
    "Stop means finish the work.",
    "Closing a shop means serving the people already in line before locking the door.",
    [
        "Stopping capture and finishing recognition are two different jobs. Some sound can still be waiting in the last capture block.",
        "VOCO drains that tail into the same live stream, asks the model to finish, then waits for remaining delivery.",
        "Only then should the session become idle. Cancellation follows a different path and must not deliver old pending work.",
    ],
    [
        ("Stop capture", "Stop accepting new microphone input."),
        (
            "Drain tail",
            "Take the final captured samples that have not been offered yet.",
        ),
        ("Finish stream", "Finish the existing recognizer stream once."),
        ("Flush text", "Deliver the remaining accepted suffix safely."),
        ("Idle", "Release session ownership and report completion."),
    ],
    [
        (
            "Do not send the whole recording again",
            "The production Stop path forwards retained samples not yet offered. Replaying the whole recording would waste work and could duplicate delivered words.",
        ),
        (
            "One recording owns its tail",
            "Asynchronous guards keep delayed stop/capture callbacks attached to their original recording.",
        ),
        (
            "Why several timings exist",
            "Stop-to-final measures recognition completion. Stop-to-idle includes the rest of shutdown and delivery. Neither is the same as the instant the receiving app paints text.",
        ),
    ],
    [
        (F + "hooks/useDictation.ts", "Orders the complete Stop sequence."),
        (F + "lib/audioCaptureFlush.ts", "Waits for final capture blocks."),
        (F + "lib/dictationFinalizer.ts", "Coordinates finalization outcomes."),
        (F + "lib/dictationAsyncGuards.ts", "Prevents stale asynchronous updates."),
        (R + "streaming.py", "Flushes gated samples and finishes the native stream."),
    ],
    "A fast Stop that silently loses the final syllable is a failure, not an optimization.",
    "What should happen to unoffered tail samples at Stop?",
    [
        "Send them into the existing stream",
        "Throw them away",
        "Replay all earlier audio too",
    ],
    0,
    "Finish the same stream with only the remaining samples.",
    "queue",
)
lesson(
    "recovery",
    "When something goes wrong.",
    "A good helper says “I’m not sure” instead of pretending the job is done.",
    [
        "A microphone can disappear, a worker can stop, a window can change, or a paste can be uncertain.",
        "VOCO keeps recovery explicit. Retry transcribes retained normal-dictation audio with the bundled NVIDIA model, then offers the result for review and Copy. It does not paste it into another application.",
        "Retained audio or text belongs to the recording that produced it. An old error must not overwrite a new session’s state.",
    ],
    [
        ("Notice", "Detect capture, worker or delivery failure."),
        ("Identify", "Keep the failed work attached to its session."),
        ("Retain", "Preserve available recovery material."),
        ("Explain", "Show a useful recovery state instead of false success."),
        ("Retry safely", "Recover locally, review the result and copy deliberately."),
    ],
    [
        (
            "Idle worker repair",
            "A confirmed-dead idle worker may be replaced at a safe boundary. That permission does not extend to automatically replaying an in-flight push or finish.",
        ),
        (
            "State is a map",
            "States such as idle, starting, recording and processing make allowed transitions visible. They are more reliable than several unrelated booleans.",
        ),
        (
            "A separate recovery worker",
            "Recovery preserves the original sample rate and uses a bounded private worker. Cancel retains the audio, suppresses late results and cleans up that session; it cannot cancel a newer recovery or live dictation.",
        ),
    ],
    [
        (F + "lib/dictationRecovery.ts", "Represents retained recovery work."),
        (
            F + "lib/dictationSession.ts",
            "Keeps recording identity and lifecycle facts.",
        ),
        (F + "lib/nvidiaRecovery.ts", "Runs explicit offline recovery without a destination callback."),
        (
            B + "benchmark_stream.rs",
            "Reaps failed workers and controls restart boundaries.",
        ),
    ],
    "This guide’s recovery simulator does not kill or restart the installed app.",
    "Why avoid an automatic paste retry after an uncertain result?",
    ["It may duplicate or misdirect text", "Retries are always slow"],
    0,
    "The first paste may already have succeeded. Uncertainty must be handled explicitly.",
    "focus",
)
lesson(
    "settings",
    "A small interface, clear ownership.",
    "The control panel is the dashboard light, not the engine.",
    [
        "The interface shows microphone, shortcut, readiness and recovery. It does not perform neural-network calculations.",
        "A store keeps visible state and preferences together. Native code still owns operating-system authority.",
        "VOCO keeps the normal output fixed to live cursor delivery. Removed assistant and appearance controls are not hidden extra modes.",
    ],
    [
        ("Load", "Read a validated configuration snapshot."),
        ("Present", "Derive clear state and helpful labels."),
        ("Edit", "Change supported preferences such as microphone or shortcut."),
        ("Validate", "Native code validates and saves a supported patch."),
        ("Refresh", "Update the interface without losing unrelated state."),
    ],
    [
        (
            "A migration is deliberate",
            "The config loader ignores retired fields and fixes cursor output, stable streaming and enhancement off. It preserves microphone, shortcut and onboarding state.",
        ),
        (
            "Accessibility is part of the design",
            "Reduced motion, contrast and transparency follow system preferences. Rounded controls and the silver microphone remain the visual identity.",
        ),
        (
            "Window movement is native work",
            "Dragging/resizing a Tauri window uses native APIs. CSS alone cannot move a Linux desktop window.",
        ),
    ],
    [
        (
            F + "components/ControlPanel.tsx",
            "Builds the actual panel and settings sections.",
        ),
        (F + "store/useStore.ts", "Holds frontend state and preferences."),
        (B + "config.rs", "Validates persisted configuration and supported patches."),
        (F + "lib/configSnapshot.ts", "Guards incoming config snapshots."),
        (F + "preferences.css", "Applies system accessibility preferences."),
    ],
    "Some old branding documents mention removed features. Read the pinned ControlPanel and config implementation for current behavior.",
    "Where should Linux input authority live?",
    ["Only in a React checkbox", "In the native backend and its guarded integrations"],
    1,
    "The UI requests operations; native code enforces their boundaries.",
)
lesson(
    "linux",
    "One app, several Linux paths.",
    "Linux desktops are neighborhoods with different doorbells and mail slots.",
    [
        "X11 and Wayland expose different integration mechanisms. Desktop environments and receiving apps add more variation.",
        "The normal desktop paste route, optional IBus shortcut helper and explicit Chromium field adapter have different contracts.",
        "A test inside one distribution’s container does not test its real default desktop or compositor.",
    ],
    [
        ("Desktop route", "Use current native focus checks and paste helpers."),
        ("X11 scope", "Bind the recording shortcut to the intended focus window."),
        ("IBus", "Optionally receive owned shortcut events; no text mutation."),
        (
            "Chromium",
            "Use explicit element/document authorization in that separate route.",
        ),
        (
            "Qualification",
            "Test the actual desktop, application and microphone together.",
        ),
    ],
    [
        (
            "Stronger browser identity",
            "The explicit browser adapter can check element/document identity, caret and acknowledged prefix. It rejects unsupported fields, including password inputs.",
        ),
        (
            "Native messaging is local transport",
            "The browser host and private socket connect authorized browser work to the desktop. That integration is not a cloud transcription service.",
        ),
        (
            "A support claim needs the right test",
            "Ubuntu userspace, package installation, Hyprland behavior and native microphone operation are separate evidence categories.",
        ),
    ],
    [
        (B + "browser_broker.rs", "Coordinates authorized browser sessions."),
        (B + "browser_protocol.rs", "Defines bounded browser messages."),
        (B + "bin/voco-browser-host.rs", "Runs the native-messaging bridge."),
        (P + "voco_ibus_engine.py", "Implements the shortcut-only IBus engine."),
        ("docs/platform/README.md", "Documents platform qualification boundaries."),
    ],
    "Compatibility is not universal. A successful GTK/X11 fixture cannot prove Codex, Brave, Ghostty or every Wayland compositor works.",
    "Does a successful container test prove the real Hyprland desktop works?",
    ["Yes", "No"],
    1,
    "A container shares the host kernel and may not run the target compositor or physical devices.",
)
lesson(
    "privacy",
    "Draw the trust boundaries.",
    "Keep private letters inside the house. Check visitors before opening the door.",
    [
        "Normal speech recognition runs locally. It does not require a cloud transcription account.",
        "Local still needs security: files, sockets, child processes, browser messages and clipboard delivery all cross boundaries.",
        "Optional timing logs contain counters and identities, not dictated text or recordings. Update checks contact GitHub.",
    ],
    [
        ("Microphone", "Personal audio enters an authorized recording."),
        ("Local worker", "Bounded validated messages stay on the machine."),
        ("Private state", "Configuration, sockets and optional logs need safe paths."),
        ("Other apps", "Clipboard delivery crosses into a separate process."),
        ("Updates", "A separate network operation checks GitHub for releases."),
    ],
    [
        (
            "No arbitrary diagnostic strings",
            "The worker maps failures to safe error codes rather than logging arbitrary exceptions, request data or transcript text.",
        ),
        (
            "Private paths must stay private",
            "Permissions, symlink checks and same-user socket rules help prevent another local user from redirecting sensitive output.",
        ),
        (
            "No silent security shortcuts",
            "A successful helper command is not proof of safe destination ownership. Content-free logging is not proof that every possible data flow is private.",
        ),
    ],
    [
        (R + "worker_main.py", "Sanitizes worker error reporting."),
        (B + "performance.rs", "Writes bounded content-free performance events."),
        (B + "trigger_socket.rs", "Protects private local control sockets."),
        (B + "process_runner.rs", "Runs and reaps bounded helper processes."),
        ("docs/security/README.md", "Explains current security boundaries."),
    ],
    "The study site itself makes no external requests. Its source reader only serves catalogued Git blobs from the pinned commit.",
    "Which statement is accurate?",
    [
        "Local apps never need security checks",
        "Local apps still need file, process and input boundaries",
    ],
    1,
    "Local execution reduces some exposures but does not remove local trust boundaries.",
    "focus",
)
lesson(
    "performance",
    "Measure the right stopwatch.",
    "If two runners start their watches at different times, their numbers cannot be compared fairly.",
    [
        "First sound, first hypothesis, first paste dispatch and first observed field update are different moments.",
        "A queue’s waiting time is different from model compute time. Stop-to-idle is different from Stop-to-final.",
        "A measurement needs its clock origin, units, scope and missing evidence. Good charts keep those labels attached.",
    ],
    [
        ("Playback starts", "Recorded-audio launch can include leading silence."),
        ("Worker text", "The recognizer returns a first nonempty hypothesis."),
        ("Dispatch", "The helper completes its delivery command."),
        ("Field changes", "An independent observer sees the recipient’s text change."),
        ("Paint", "The compositor draws pixels; this needs separate evidence."),
    ],
    [
        (
            "Median and p95",
            "The median is the middle result. The 95th percentile describes the slow tail of a set of observations. Three repeated recordings are not three different speakers.",
        ),
        (
            "CPU and memory have scope",
            "Worker RSS covers one process. Summed app-tree RSS can count shared memory more than once. CPU-seconds are work consumed, not battery energy.",
        ),
        (
            "Logs must not become a bottleneck",
            "Logging is optional and bounded. Dropped events and missing sequences must be reported because incomplete evidence can make a graph misleading.",
        ),
    ],
    [
        (B + "performance.rs", "Records frontend/native performance events."),
        (R + "streaming.py", "Metrics records worker timings and resource counters."),
        ("scripts/report-performance.py", "Summarizes application performance logs."),
        ("scripts/report-speech-performance.py", "Reports speech timing evidence."),
    ],
    "The interactive timeline is an illustration, not benchmark data. Real benchmark assets stay outside this guide repository.",
    "Can helper dispatch time be labeled “pixels appeared”?",
    ["Yes", "No"],
    1,
    "The receiver and compositor do additional work. Dispatch is a different observation.",
    "latency",
)
lesson(
    "tests",
    "Tests are little promises.",
    "A test sets up a situation, performs an action, and checks what should happen.",
    [
        "A useful test catches a consequence: a lost final sample, a stale callback, duplicate text or a malformed message.",
        "Unit tests examine small rules. Integration tests exercise cooperating pieces. Native end-to-end tests use real application boundaries.",
        "Passing tests gives evidence for the situations tested. It does not prove every future input will work.",
    ],
    [
        ("Arrange", "Choose a known starting state and input."),
        ("Act", "Run the operation under test."),
        ("Assert", "Check the expected result and forbidden side effects."),
        ("Record", "Keep exact versions, inputs and attempted-run counts."),
        ("Repeat", "Fix a real failure and rerun the relevant checks."),
    ],
    [
        (
            "Test the failure path",
            "A dead worker, a missing microphone or a changed target may reveal defects that a happy-path demonstration misses.",
        ),
        (
            "Do not erase failed attempts",
            "A fixture failure still belongs in the attempt record. Explain exclusions instead of silently changing the denominator.",
        ),
        (
            "Different proof levels",
            "A browser-rendered UI test can mock all native/media boundaries. It proves interface behavior in that harness, not real microphone or desktop insertion.",
        ),
    ],
    [
        (
            F + "lib/benchmarkPhraseQueue.test.ts",
            "Checks queue behavior and its invariants.",
        ),
        (
            R + "test_worker_protocol.py",
            "Checks validation and state transitions at the worker protocol boundary.",
        ),
        (
            "scripts/test-dictation-renderer.mjs",
            "Exercises the actual frontend with controlled boundaries.",
        ),
        ("scripts/test-native-desktop.sh", "Runs isolated native desktop checks."),
        ("docs/testing/README.md", "Indexes test categories and evidence."),
    ],
    "Test files and benchmark research adapters are engineering tools, not extra user-facing app features.",
    "A mocked browser test passed. What does that establish?",
    [
        "Every physical microphone works",
        "The tested interface behavior passed in that harness",
    ],
    1,
    "The proof must stay within the boundaries actually exercised.",
)
lesson(
    "shipping",
    "How source becomes an app.",
    "A recipe is not a cake. Building, packaging and checking the result are separate steps.",
    [
        "Frontend tools turn TypeScript and CSS into application assets. Rust is compiled into a native executable.",
        "The package must also contain the pinned speech runtime, model artifacts, helper programs and notices.",
        "Checksums and exact identities let us verify which bytes were installed and tested. A matching version label alone is not enough.",
    ],
    [
        ("Source", "Choose a clean commit and locked dependencies."),
        ("Build", "Compile the frontend and native application."),
        ("Assemble", "Add pinned model/runtime payload and Linux integration."),
        ("Verify", "Check package structure, licenses, hashes and execution."),
        ("Release", "Publish only after the required tests and acceptance gates."),
    ],
    [
        (
            "Lock files are part of the recipe",
            "package-lock.json and Cargo.lock pin resolved dependency versions. They are not obsolete copies of the package manifests.",
        ),
        (
            "A base Tauri package can be incomplete",
            "VOCO’s packaging scripts assemble and validate the speech payload. The raw desktop build alone is not the complete distributable.",
        ),
        (
            "Frozen evidence stays frozen",
            "A code change creates new bytes. Tests of an earlier package cannot automatically qualify a newer package, even with the same displayed version.",
        ),
    ],
    [
        ("scripts/build-desktop.sh", "Builds the desktop artifacts."),
        ("scripts/package-nvidia.py", "Assembles the pinned NVIDIA package payload."),
        ("scripts/verify-deb-package.sh", "Checks Debian package contents."),
        ("scripts/verify-speech-payload.py", "Verifies speech runtime/model identity."),
        ("docs/release-process.md", "Documents release and acceptance gates."),
    ],
    "Published releases are available on GitHub with versioned artifacts, checksums and documented test scope. This learning site does not publish or install the app.",
    "Is a version string enough to prove two packages are identical?",
    ["Yes", "No; compare exact artifacts and hashes"],
    1,
    "Different bytes can accidentally share a version label. Artifact identity is stronger.",
)
lesson(
    "dependencies",
    "Borrowed code needs care.",
    "You can build a bicycle with borrowed parts, but you still need to know which parts you fitted.",
    [
        "A dependency is software that VOCO uses rather than rewriting. Vendored code is a copy kept in the repository.",
        "VOCO vendors glib 0.18.5 with a specific upstream iterator-safety fix. Other GTK/WebKit users must resolve to that same patched copy.",
        "A dependency name on a list is not enough. We need the actual resolved version, patch, license and tests.",
    ],
    [
        ("Manifest", "Request a dependency and version range or source."),
        ("Lock", "Record the resolved dependency graph."),
        ("Vendor", "Keep a reviewed patched copy when needed."),
        ("Verify", "Compare provenance and run a targeted regression."),
        ("Notice", "Include required licenses and acknowledgments."),
    ],
    [
        (
            "Why not just add a newer glib?",
            "Adding a second glib version can leave GTK using the old vulnerable copy. The fix must reach the library actually used by the dependency graph.",
        ),
        (
            "Upstream code is a different reading layer",
            "The complete catalog includes vendor files. Their implementations belong to their upstream libraries; start with the local patch notes to see VOCO’s changes.",
        ),
        (
            "No perfect-security badge",
            "A fixed issue does not prove that all dependencies have no other risks. Current security documents keep remaining scope separate.",
        ),
    ],
    [
        (
            "vendor/glib/VOCO-PATCH.md",
            "Explains the exact iterator backport and provenance.",
        ),
        (
            "scripts/verify-glib-backport.py",
            "Checks vendored sources and dependency resolution.",
        ),
        ("scripts/test-glib-variant.py", "Runs the optimized iterator regression."),
        (
            "apps/desktop/src-tauri/Cargo.lock",
            "Records Rust dependency resolution when present.",
        ),
        ("apps/desktop/src-tauri/Cargo.lock", "The desktop Rust lock file."),
    ],
    "Do not edit a vendored library casually. A patch needs a reason, provenance, a focused regression and full dependency validation.",
    "Why can installing a second fixed library version fail to solve an issue?",
    [
        "The application may still use the old copy",
        "Version numbers cannot be compared",
    ],
    0,
    "The resolved consumer dependency must use the patched library.",
)
lesson(
    "code-reading",
    "Open any piece of the code.",
    "Read code like a map: find the entrance, follow the arrows, then inspect one room at a time.",
    [
        "Start with the job of a file, not with its first unfamiliar punctuation mark. Read its imports, named functions and tests.",
        "Use the file catalog to find every tracked entry at the pinned commit. Open a file to inspect its exact source and jump to a named symbol.",
        "The chapters explain the central architecture. The catalog supplies complete file coverage; it is not a claim that every upstream line has a hand-written explanation.",
    ],
    [
        ("Find the owner", "Which module owns the rule you are studying?"),
        ("Read the boundary", "What inputs does it accept, and what does it return?"),
        ("Follow a call", "Jump to the next helper or native command."),
        ("Read a test", "See a concrete input and the expected consequence."),
        ("Ask why", "Look for ordering, identity, limits and failure behavior."),
    ],
    [
        (
            "Production names can mislead",
            "benchmarkPhraseQueue.ts and benchmark_stream.rs are live product modules. A historical name is not a reason to delete code.",
        ),
        (
            "Tests are example stories",
            "Find the matching .test.ts or test_*.py file. A well-chosen test often explains a tricky rule more clearly than a long comment.",
        ),
        (
            "Know what the viewer can show",
            "Text blobs up to 2 MB are readable. Binary assets are indexed with size and Git identity. Native binaries and model weights supplied outside Git are explained as external artifacts.",
        ),
    ],
    [
        ("docs/architecture/code-map.md", "The project’s implementation map."),
        ("AGENTS.md", "Rules for humans and agents working on VOCO."),
        (F + "lib/benchmarkPhraseQueue.ts", "A good first detailed queue reading."),
        (R + "worker_main.py", "A compact protocol-validation reading."),
    ],
    "The source reader is read-only and pinned to a commit. It never serves your uncommitted files, credentials or personal recordings.",
    "What is the best first question when opening a file?",
    ["How many lines can I delete?", "What job and invariant does this file own?"],
    1,
    "Understanding ownership makes later changes safer and more focused.",
)
lesson(
    "typesafe",
    "Measure before we optimize.",
    "A quicker transcript is useful only if it keeps your words, meaning and punctuation intact.",
    [
        "This chapter teaches the evaluation method used by VOCO contributors. The dated measurements were collected on the .41 development snapshot; the .42 release preserves its model and defaults. These experiments are not fresh .42 performance measurements.",
        "A stopwatch and exact text comparison answer different questions from a language model. Code measures timing, word errors and delivery failures. TypeSafe judges whether a transcript preserves meaning.",
        "We give Jev a public reference and a transcript, plus separate questions for meaning and consequential mistakes. Punctuation judgments need an audited reference. Personal dictation never enters this research service; VOCO itself remains local.",
        "We challenge the judge before trusting it, freeze the speech fixtures, then run the same audio through baseline and candidate settings. We keep unsuccessful experiments because they explain why a tempting change was rejected.",
    ],
    [
        ("Define", "Freeze timing boundaries, reference text, rubric and rejection rules before measuring."),
        ("Measure", "Replay the same public audio and record timings, word errors and resources."),
        ("Judge", "Ask TypeSafe narrow questions about meaning; retain probabilities and uncertainty."),
        ("Compare", "Compare repeated trials and separate speakers. Missing evidence stays missing."),
        ("Decide", "Reject regressions. A higher average never excuses a wrong destination or lost meaning."),
    ],
    [
        ("What contributors provide", "Evidence, explicit question criteria, a model version, an API key for live evaluation and independently labeled cases. The skill does not award a built-in app grade."),
        ("What a score means", "Meaning has four concrete levels: contradicted or absent; an important detail wrong; only a minor detail lost; all meaning preserved. A score divided by three and multiplied by 100 is a rubric position, not word accuracy. Confidence is not a truth guarantee."),
        ("Check the judge too", "The 16 authored challenge cases produced 10 true material-error flags and six true negatives at a provisional 0.5 threshold. This small synthetic check is not independent human calibration. An invented action still received 2.10/3 for overall meaning, so the separate consequential-error question matters."),
        ("The measurements still missing", "These public audiobook references have no audited punctuation or word-end times. We cannot honestly score punctuation accuracy, word-end-to-screen latency, physical microphone quality or worldwide rank from them."),
        ("Where to reproduce it", "Follow docs/testing/typesafe-evaluation.md. Provision the pinned runtime, use public fixtures, freeze the rubric and reference text, then run the local measurement and optional TypeSafe tools. Keep API keys and raw receipts out of Git."),
    ],
    [
        ("scripts/evaluate-dictation-worker.py", "Measures the real pinned worker with public audio fixtures."),
        ("scripts/typesafe-evaluate.py", "Asks narrow semantic questions only after explicit opt-in."),
        ("docs/testing/typesafe-evaluation.md", "Defines metric boundaries, targets and reproducible commands."),
    ],
    "The comparison is an experiment, not a world ranking or a release. Worker output, observed recipient text and painted pixels are different boundaries. No production setting changes automatically from a TypeSafe score.",
    "A candidate has a higher meaning score but inserts text into the wrong window. What happens?",
    ["Accept it because its average improved", "Reject it: delivery safety is a separate hard gate", "Ask the model to average the two"],
    1,
    "Safety failures cannot be compensated by better speed or a higher semantic score.",
)
summary_path = Path(__file__).resolve().parents[2] / "testing/typesafe-summary-2026-09-19.json"
chapters[-1]["comparison"] = json.loads(summary_path.read_text())
chapters[-1]["sourceNote"] = "Evaluation tools from the pinned 2026.0.43 development snapshot. Tables retain their original .41 experiment identity."

lesson(
    "linux-support",
    "One VOCO, different Linux desktops.",
    "A download is ready only when installation, microphone, shortcut and text delivery work together.",
    [
        "VOCO keeps a shared recognition model and application source. Native Debian, Fedora, openSUSE and Arch packages translate that application into dependencies each system understands.",
        "The desktop matters too. A package can install correctly while a compositor handles windows, shortcuts or clipboard access differently. Omarchy needs Hyprland testing as well as Arch package testing.",
        "The .43 source snapshot has bounded qualification evidence. The support matrix separates final package and desktop evidence from signing and public availability; only a published GitHub release establishes a download.",
    ],
    [
        ("Package", "Resolve native dependencies and verify every installed payload file."),
        ("Desktop", "Run the intended compositor in a booted guest and finish fresh-user setup."),
        ("Dictation", "Send public fixture audio, observe the receiving field and check Start and Stop."),
        ("Failures", "Switch focus, repeat sessions, interrupt devices and retain recovery safely."),
        ("Release", "Sign exact qualified artifacts and verify the downloaded copies before installation."),
    ],
    [
        ("Before: a transparent tile", "Hyprland kept the off-screen VOCO window tiled. An isolated test reproduced it even though short dictation worked."),
        ("Why hiding alone failed", "A diagnostic native hide removed the tile, but a fresh WebKit microphone request did not become active within 25 seconds. That failed attempt led to native capture qualification."),
        ("After: native capture while hidden", "The final .43 Arch candidate passed repeated dictation under Omarchy’s packaged desktop configuration with a truly hidden panel and an unchanged second field. A 577.68-second repetition delivered all 1,162 normalized words and reached idle 922 ms after Stop. All 25,505,676 retained frames matched native capture, with independent whole-waveform alignment. These individual VM observations do not certify physical microphones or arbitrary apps."),
        ("A measured shortcut improvement", "The candidate's voco --toggle command used a compositor binding without keyboard-device access. One isolated fixture delivered all 14 words and left the second field unchanged. This does not certify every shortcut or application."),
        ("Fit the available CPUs", "A two-core VM took 35.37 seconds to warm a four-thread recognizer, exceeding startup limits. Two threads took 1.53 seconds in a controlled check. The candidate leaves one CPU from process affinity available for desktop work, with at least one recognizer thread and at most four. All 12 public fixtures produced identical transcripts across the final Fedora, openSUSE, Ubuntu and Omarchy workers: six lexical edits in 238 words. This small corpus does not establish worldwide accuracy."),
        ("Reject an unknown destination", "An X11 focus-switch test caught text continuing into a second field. GNOME exposed both the client and its decoration as active, and VOCO incorrectly allowed an unbound paste. The candidate distinguishes the decoration and requires a destination token. The installed regression then left the second field empty and retained recovery. Successful ordinary dictation had not exposed this bug."),
        ("Let desktop focus settle safely", "A fresh Fedora GNOME setup queued about 970 accessibility events after hiding the panel. The old 256-event budget rejected Start. The candidate drains ordinary transition backlogs within a 50 ms time limit, while still refusing an unsettled destination. Installed Fedora GNOME and openSUSE KDE tests then passed repeated dictation, focus departure and explicit recovery after source loss."),
        ("Test the receiving application", "Kate and Konsole accepted the public fixture in a booted KDE guest. Firefox exposed both shortcut-modifier interference and CPU contention that GTK-only tests had missed. The final package delivered all 1,162 words in a 577.68-second Firefox trial and stopped in 376 ms after the browser settled. Its page had no growing DOM diagnostic logger; a preceding logged attempt timed out after 741 words, showing why measurement overhead must remain explicit. Cold-start CPU-pressure failures remain recorded. Separate controls showed that Stop bindings must also accept the Ctrl and Shift modifiers used by clipboard delivery: Omarchy uses ignore_mods; KDE can bind the key and its Ctrl variants. A separate final Fedora GNOME ten-minute run delivered all 1,162 words with full retained-audio parity but took 2,813 ms after Stop. These observations do not establish universal speed or compatibility."),
        ("Test the actual installation command", "A fresh .45 Ubuntu Wayland installation on 20 September passed its local voice test, then rejected all 11 dictation attempts before recording. The short installer used dpkg and dependency repair, which skipped the recommended ydotool client and daemon. Earlier package tests used APT directly on X11, so they did not cover that journey. The .46 source candidate installs Wayland helpers explicitly and checks desktop input before onboarding completes. A voice test, helper readiness and verified cursor delivery are three separate checks. These follow-up findings describe newer work; the code viewer remains pinned to its recorded .43 snapshot."),
        ("Safe upgrades", "Debian preserves existing directory modes during upgrades. A real legacy-install test exposed inherited group-write permissions. A narrowly checked migration repairs only the known package-owned mode, preserving custom permissions and personal settings."),
        ("Keep obligations installed", "RPM can omit ordinary documentation on minimal systems. License files need explicit license metadata so those terms remain installed."),
        ("Keep build identities honest", "The 20 September release polish changed one Updates help sentence and bundled documentation. The refreshed c04a65c application passed all seven package lifecycles and four installed desktop scenarios: repeated sessions on Fedora, Omarchy and Ubuntu, plus Firefox on openSUSE. Their observed Stop times were 220–498 ms. Earlier long and recovery tests above belong to the preceding f634e621 engine build; they were not rerun or relabeled. Two post-login Fedora focus setup failures and one temporary Omarchy test-keyring failure remain recorded. These small samples are not latency percentiles."),
        ("What TypeSafe contributes", "Optional semantic judgments assess a transcript's meaning. Exact code and real desktop tests establish package identity, audio timing, destination safety and compatibility. A language-model score cannot replace those checks."),
    ],
    [
        ("docs/linux-support.md", "The support scope, setup and remaining release gates."),
        ("scripts/stage-native-packages.py", "Explicit native dependency profiles and license metadata."),
        (B + "trigger_socket.rs", "Private, single-attempt compositor control transport."),
        ("docs/testing/linux-release-2026-09-19.md", "Dated outcomes and qualification limits."),
        ("docs/testing/linux-release-2026-09-20.md", "Refreshed package checks and exact-build evidence boundaries."),
    ],
    "These measurements cover the listed guests and scenarios; published availability is a separate check. The Omarchy long-session result uses virtual audio and one GTK recipient. Ubuntu GNOME Wayland/X11, Fedora GNOME Wayland and openSUSE KDE Wayland also have installed virtual-audio trials. Debian and Mint container checks establish package behavior, not their default desktops. Physical microphones and the wider application matrix still need their own evidence.",
    "The RPM installs, but dictation fails under the default compositor. Is that distribution ready?",
    ["Yes: installation is sufficient", "No: package and desktop acceptance are separate gates"],
    1,
    "A native package is only one part of the experience. The microphone, shortcut, window and destination must work together.",
)

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
