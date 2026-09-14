# Microphone refresh and Retry qualification

Device discovery, access, live preview and transcription are separate checks. A populated device selector does not establish permission or prove that a live capture stream exists. A successful access probe must release its stream and restart only the preview that still owns the request.

The frontend now orders overlapping refreshes and access attempts, ignores stale results after device/activity/lifecycle changes, and preserves acquired-stream cleanup. Optional browser permission queries do not block enumeration or opening Settings. Missing permission-query support does not erase a proven grant. Device, constraint and busy errors are distinguished from permission denial, and their details survive status changes. A current successful Retry restarts the visible preview; a failed or stale Retry does not.

Capture constraints, existing device fallback, models and native permission policy are unchanged.

Preview startup must resume a suspended AudioContext and verify that it is running before reading the analyser. Closing the panel during a pending resume releases its owned stream and context once; late success or failure cannot restart the graph or update the closed panel.

## Reproducible frontend checks

Run the focused unit tests with `npm --workspace @voco/desktop test -- src/lib/microphoneRefresh.test.ts src/__tests__/audioInput.test.ts src/components/ControlPanel.test.tsx`.

Run `VOCO_RENDERER_EVIDENCE_DIR=/absolute/path/to/a/new/directory npm run test:microphone-renderer`. The parent directory must exist and the output directory must be new. This uses the actual App, store, hooks and ControlPanel in headless Chromium, with microphone, native and network boundaries mocked. It records source hashes and failures. It never uses a physical microphone. `npm run test:dictation-renderer` checks the surrounding recording and delivery flows.

These checks cannot establish installed WebKit device recovery, Linux hardware compatibility or waveform continuity.

## Installed baseline, 6 September 2026

The [prospective guest plan](../../../foundations-evidence/iteration-13/application-integration/local-vm/HOTPLUG-03-PLAN.json) starts the retained raw diagnostic package before adding exactly one owned virtual microphone. It keeps the same GUI and WebKit processes, settles for five seconds after addition, invokes Retry once, then settles for five seconds again. No fixture playback, transcription or physical capture occurs.

The same GUI process discovered the new remapped source after Retry, confirmed by the [opened selector](../../../foundations-evidence/iteration-13/application-integration/local-vm/run-03/selector-after-retry-01.png). The [live preview](../../../foundations-evidence/iteration-13/application-integration/local-vm/run-03/access-after-retry-02.png) still displayed `Invalid constraint`, and the provider snapshot retained no application capture stream. This supports the stale-preview defect; it does not support a general requirement to restart VOCO. Native zero-device messages, visible labels and the independent GStreamer provider view remain distinct observations. Direct JavaScript exception/enumeration telemetry was unavailable.

The initial action preflight expected `click`, but the observed accessibility action was `press`; it stopped before any UI action. That failure is retained separately. The subsequent identity-checked Retry was the only Retry action. The [cleanup receipt](../../../foundations-evidence/iteration-13/application-integration/local-vm/run-03/BASELINE-CLEANUP.json) verifies app exit, owned source removal, original virtual default restoration and the prior idle timeout.

Every candidate requires its own installed acceptance result: start without a source, add one, invoke Retry once, verify the preview owns a capture stream, and verify cleanup. Preserve the original failure separately. This baseline does not qualify a later build or resolve the separately observed WebKit capture waveform failure.

## First fixed candidate: retained meter failure

The [first candidate's meter audit](../../../foundations-evidence/iteration-13/application-integration/local-vm/hotplug-candidate-01/DECODER-METER-FAILURE-REVIEW.json) confirms that Retry cleared the preview error and opened one owned WebKit capture stream. However, all three planned screenshots showed an empty level meter during the single virtual fixture trial, so the candidate failed acceptance. Hiding Settings closed that stream in the same app process. The fixture and playback passed their checks; the actual AudioContext state was not observed.

A separate browser reproduction starts the mocked context suspended and returns silence until resume. It exposes the missing preview resume call without changing the real capture constraints or permissions. This supports the contained graph-startup correction; only a fresh installed test can establish its effect in WebKit. A preceding qualification-helper launch failure on protected process inspection is also retained and is not an application test pass.

## Second candidate: installed recovery and meter response

The [second package](../../../foundations-evidence/iteration-13/application-integration/package-frontend-microphone-02/PACKAGE-MANIFEST.json), SHA256 `e299f193b324d9a576d547efc8fba17ee07d2d990ed44542f1e1c0af652b7246`, contains GUI `e4cf972ec6c4f2741756b0b931fb8be63fb3d8cf0cd9fc9f802a382d73a27af3`. Its independently checked 835-file source differs from the first candidate in preview startup/cleanup, the renderer regression harness and this document. Recognition, capture constraints and the browser host are unchanged.

The [prospective trial](../../../foundations-evidence/iteration-13/application-integration/local-vm/HOTPLUG-CANDIDATE-02-PLAN.json) retained the original acceptance gates: launch without a microphone, add one owned virtual source, settle five seconds, invoke Retry once and settle five seconds. GUI PID 10929 and its WebKit processes retained their original start identities. The preview error cleared, the selector listed the added source, and exactly one uncorked WebKit input stream targeted that owned source.

During the single 2.09-second fixture playback, the [middle planned screenshot](../../../foundations-evidence/iteration-13/application-integration/local-vm/hotplug-candidate-02/meter-2.png) visibly shows a positive level. The other two planned screenshots show an empty meter; all three are retained. This establishes visible response, not continuous frame-by-frame metering or audio fidelity. The actual installed AudioContext state was not directly instrumented, so the before/after result does not uniquely prove the first candidate's runtime cause.

The [hide check](../../../foundations-evidence/iteration-13/application-integration/local-vm/hotplug-candidate-02/HIDE-CLEANUP.json) verifies that hiding Settings closed the application capture stream without replacing GUI or WebKit processes. [Cleanup](../../../foundations-evidence/iteration-13/application-integration/local-vm/hotplug-candidate-02/CLEANUP.json) verifies app exit, owned source removal, the original virtual default source and the 300-second idle timeout. The [VM supervisor](../../../foundations-evidence/iteration-13/application-integration/local-vm/run-03/SUPERVISOR-RESULT.json) records normal exit zero without signals. Its `qualificationPassed: false` is a default field the VM lifecycle supervisor never promotes; application acceptance is evaluated separately. The first evidence archive attempt failed on unreadable Python bytecode; that partial archive is retained, and a separate successful collection excludes only `__pycache__`.

The final preview code also passed 26 permanent App renderer cases, including suspended startup, failed resume, selection changes and closing the panel during a pending resume. Full frontend tests passed with 253 tests and two existing skips, and the surrounding dictation renderer passed. These checks use mocked media/native boundaries; the installed trial uses an owned virtual source. No physical microphone, transcription or stronger model was used in this recovery trial. The packaged source snapshot predates this result section; this later documentation update does not change its executable bytes.

The separate WebKit/app waveform-continuity failure and unavailable guest hotkey remain open. A long device label also stretches the Audio form toward the panel edge in the baseline and both candidates; that layout defect is not fixed by this patch. Broader Linux, physical-device and comparative product qualification remain required.
