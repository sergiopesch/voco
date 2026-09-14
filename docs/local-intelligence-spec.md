# Local Intelligence Specification

This document defines VOCO's local post-transcription intelligence layer: transcript enhancement,
spoken formatting commands, and local model answers.

## Scope

Local intelligence is optional and runs after local ASR.

- Default dictation remains `Audio Capture -> Local ASR -> Text Insertion`.
- Local enhancement may transform a transcript before insertion or before an output target.
- Local assistant mode may send a transcript to a configured localhost model endpoint and insert the
  model response.
- VOCO does not bundle, download, or manage Gemma/llama models for this path.

The product promise is:

> Keep default dictation fast and private, while giving power users a localhost-only way to polish
> transcripts or ask a local model without changing VOCO into a cloud product.

## User-Facing Requirements

### Enhancement Modes

VOCO exposes transcript enhancement modes in Output settings.

Acceptance criteria:

- `Off` is the default for existing and new configs.
- `Voice formatting commands` applies deterministic spoken commands without calling a model.
- `Conservative local polish` calls the configured localhost model endpoint after deterministic
  commands are applied.
- If enhancement fails, VOCO preserves the raw recognition before any command transformations and shows a
  non-blocking warning.
- Enhancement never blocks raw dictation from succeeding when ASR succeeds.

### Spoken Formatting Commands

Formatting commands are deterministic and testable.

Acceptance criteria:

- Supported commands include `new paragraph`, `new line`, `bullet point`, `new bullet`,
  `code block`, `end code block`, and `scratch that`.
- Commands work when enhancement is set to `Voice formatting commands`.
- Commands are applied before conservative local polish.
- Bare commands must occupy a whole sentence, separated by `.`, `?`, `!`, `;`, a newline,
  or the beginning/end of the transcript. For example, `First sentence. New paragraph.
  Second sentence.` produces two paragraphs without a stray command-ending period.
- For inline commands or speech without punctuation, use the explicit prefix `command`:
  `first command new paragraph second` produces two paragraphs. Matching is case-insensitive
  and requires whole words; `new lines` and `code blocker` remain ordinary text.
- Double/single/curly quotes and backticks protect quoted phrases. `literal new paragraph`
  produces the words `new paragraph`; `literal command scratch that` produces the words
  `command scratch that`. The escape is consumed once and its text is never reinterpreted.
- An executed `scratch that` discards earlier text in this dictation's formatted result and
  keeps subsequent text. It never deletes existing text in another application. An ordinary
  mention such as `Please write the phrase scratch that in the title.` is preserved.
- A successful command may intentionally produce empty output. VOCO must not resurrect the
  discarded text as a fallback or call a model to invent replacement text.
- Command processing preserves intentional paragraph, list, and code block structure.

Compatibility note: older releases treated any embedded command substring as executable.
Use standalone sentences or the `command` prefix for existing inline command habits. This
explicit grammar avoids guessing whether ordinary mentions should delete or reformat text.

### Conservative Local Polish

Conservative polish improves readability without changing user intent.

Acceptance criteria:

- VOCO sends only transcript text and a conservative system prompt to the local endpoint.
- The prompt requires the model to preserve words, meaning, order, names, numbers, and technical
  terms.
- The model is instructed not to answer questions, add facts, summarize, or rewrite for style.
- The response must be treated as final text only; markdown or explanations around the answer are
  not accepted as UI metadata.
- Empty, truncated, refused, tool-call, or unconfirmed model responses are rejected and the
  original raw recognition is used instead. Completion requires `choices[0].finish_reason`
  to equal `stop`; missing/null/unknown reasons are not accepted as proof of completeness.
- A completion marker is a protocol check, not a guarantee of semantic fidelity. The prompt's
  promises about names, negation, numbers, and meaning still require independent evaluation.

### Local Assistant Target

The local assistant target answers the dictated request and types the answer.

Acceptance criteria:

- Output settings include `Ask local model and type answer`.
- The target uses the same localhost endpoint and optional model name as transcript enhancement.
- The local assistant call has a separate assistant prompt from transcript polish.
- A failed local assistant request sets dictation to error and does not insert a stale answer.
- OpenClaw targets keep their existing behavior and are not required for local assistant mode.

## Technical Requirements

### Endpoint Policy

Local model calls are loopback-only.

Acceptance criteria:

- Accepted endpoints start with `http://127.0.0.1:`, `http://localhost:`, or `http://[::1]:`.
- Remote hosts, HTTPS remote URLs, credentials in URLs, fragments, whitespace, and control
  characters are rejected.
- VOCO does not attach auth headers to local model requests.
- The dedicated client ignores all proxy settings and never follows redirects. Accepted
  `localhost` connections use pinned IPv4/IPv6 loopback addresses rather than DNS or hosts-file
  resolution. This policy does not change proxy handling for unrelated model downloads.
- Endpoint and model settings are stored in `~/.config/voco/config.json`.

### OpenAI-Compatible Wire Shape

VOCO uses the OpenAI-compatible chat completions shape.

Acceptance criteria:

- Requests are sent to the configured endpoint with JSON `messages`.
- `temperature` is `0`.
- `stream` is `false`.
- `model` is included only when the user configured one.
- Responses are read from `choices[0].message.content`, with `choices[0].text` accepted only as a
  compatibility fallback.

### Performance And Reliability

Local intelligence must not make core dictation fragile.

Acceptance criteria:

- ASR timing, enhancement timing, and local assistant timing are logged without transcript content.
- Privacy-safe timing traces use `dictation_transcription_completed`,
  `dictation_enhancement_completed`, and `dictation_local_assistant_completed` with bounded
  `duration_ms` only.
- Conservative polish uses a short timeout suitable for dictation.
- Local assistant mode may use a longer timeout but remains bounded.
- Transcripts larger than the configured safety limit are rejected before local model calls.
- No audio or transcript content is written to logs.
- Optional OpenClaw and playback helpers drain stdout/stderr while running, with a 2 MiB
  limit per stream and a deadline that also covers inherited open pipes. Output overflow is
  an error, never a truncated successful answer. Failed/timed-out helper process groups are
  terminated and the direct child is reaped. Dictation's recognition model is unchanged.

## Validation

Before marking local intelligence complete:

- Rust tests cover config defaults, endpoint validation, request body construction, response parsing,
  and formatting commands.
- A subprocess test supplies hostile proxy environment settings and verifies direct IPv4 and
  pinned `localhost` delivery while a trap proxy receives no connection. IPv6 loopback is
  exercised when available. Local test servers only receive synthetic text.
- Process tests exercise output larger than pipe buffers, oversized output, blocked stdin,
  child exit with inherited open pipes, and deadlines, without invoking live OpenClaw services.
- Frontend tests cover config state and dictation fallback behavior where practical.
- Manual QA verifies `Off`, `Voice formatting commands`, `Conservative local polish`, and
  `Ask local model and type answer`.
- Manual QA verifies behavior with no local model server running.
- Security docs mention localhost-only local model behavior.
