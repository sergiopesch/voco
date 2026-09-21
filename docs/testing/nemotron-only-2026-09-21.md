# Whisper retirement: 21 September 2026

Source **2026.0.51** removes the second speech engine. This work is isolated on
`codex/drop-whisper`, based on `f5449fa0e1ea571f7685dcd16ea6ff100a2cd3b2`.
It does not replace the frozen .50 candidate, install an application, or publish a release.

## Change

The production desktop stream already used Nemotron. Whisper remained compiled
into the application for the alternate browser/final transcription paths, with
a separate model downloader, preview/chunk machinery, vendored native code and
mandatory CI model tests.

Whisper's Rust dependencies, source, vendor trees, downloader, IPC commands,
replay executables and build configuration are removed. Desktop, explicit
Chromium exact-field delivery, onboarding, manual-copy mode and local recovery
now use the same pinned Nemotron 0.6B Q8 runtime. Startup readiness follows its
successful warmup. No new dependency or model was added; existing dependency
versions were preserved while 35 obsolete package versions left the Cargo lock.

Browser recognition streams through an independent exact-field lease. Every
append verifies session identity, field ownership and committed Unicode character
count. Stop drains the existing stream and requests an empty final receipt.
Focus loss or an uncertain receipt retains recovery without replaying text.
Unverified capture remains eligible only for explicit local recovery.

CI now provisions the checksum-pinned native/model payload from the immutable .47
package and keeps the worker from the current checkout. It runs Nemotron accuracy,
repetition, silence and protocol checks. Historical reports and model-free scoring
helpers remain historical; they are not an alternate selectable recognizer.

## Size

| Artifact | Bytes | MiB |
| --- | ---: | ---: |
| Frozen .50 application executable | 14,395,616 | 13.73 |
| Optimized .51 application executable | 10,844,208 | 10.34 |
| Unchanged bundled Nemotron model | 699,872,960 | 667.45 |

The executable is approximately 25% smaller, saving 3.39 MiB. These are executable
and model measurements, not a newly assembled package comparison or a runtime RAM
benchmark. The .50 package did not bundle Whisper weights. Nemotron's model remains
the dominant payload; retiring Whisper alone cannot make the installer small.

## Verification

- Production frontend and optimized native application/browser-host builds passed.
- Type checks, lint, Rust formatting, clippy, version consistency and DevOps checks passed.
- Full `npm test` passed, including 449 frontend tests. Rust all-target tests passed
  300 executions, with one explicitly ignored offline audit-export fixture.
- Sixteen dictation-renderer scenarios passed, covering browser receipt failure,
  Stop-tail draining, cancellation, retained samples, local recovery, long streaming
  and the capture fallback boundary. The microphone renderer passed 31 cases;
  the native-capture renderer passed 42, including original-sample retention,
  late capture callbacks, explicit recovery and onboarding.
- The real production worker passed its 13 protocol cases and the eight-fixture
  speech corpus at **2.5% aggregate WER**, plus repeated speech, silence and capture
  variants. This small public corpus does not establish general accuracy.
- The optimized application passed private X11/PulseAudio/Chromium delivery,
  focus-loss preservation, visible recovery clearing and fresh recording afterward.
  A separate 39.755-second full-reference stream passed at **3.41% WER** (3/88 words).
  It exercised real WebKit capture, native IPC, Nemotron and the browser extension.
- Pinned CI payload download, checksum, model/native identity and manifest checks passed.
  The nine pinned-guide tests passed.

Private logs, reports, synthetic-fixture captures and failed attempts are retained
outside Git in the sibling `drop-whisper-evidence-2026-09-21` directory. The first
browser run delivered text but timed out against the old recovery-to-idle
expectation; the migrated test checks visible recovery and preserves the committed
prefix. Earlier renderer setup failures and obsolete Whisper-mock failures remain
in the record rather than being counted as passes.

These are source and isolated-fixture checks. No complete .51 installer, installed
VM, physical microphone or broad compositor/application qualification is claimed.
Existing installed profiles and legacy cached model files were not modified.
