# Focused-field delivery observation (.37)

The .36 installed fixture reproduced clipboard corruption when a recipient waits
1.8 seconds before reading the clipboard, plus missing sentence separators.
This candidate adds a bounded observation path for eligible AT-SPI text controls.
It does not change the selected NVIDIA model or add a final-message rewriter.

Before each streaming paste, a persistent native helper verifies the focused
editable non-password, non-terminal control. It retains only the current caret,
selection endpoints, character count, up to 64 preceding / 32 following Unicode
characters and the expected insertion. These values stay transient in the helper;
responses and normal logs contain identities, categories, lengths and timings.
The helper does not read window titles, unrelated controls, or clipboard content.

After the normal paste gesture, the helper samples the expected local region,
caret and count twice with fresh focus checks. The next chunk cannot replace the
clipboard until that observation succeeds. A standalone leading Space is a
pending intermediate state, not a successful paste. The observation polling/request budget is three seconds; cleanup uses a 100 ms
request budget and performs no accessibility query. Process cleanup and mutex
scheduling can add wall-clock time. Unavailable or changed
state after dispatch stops streaming with an uncertain outcome and retained
recovery; no automatic retry occurs. Blocking waits run off the UI/capture event
loop. Overlapping VOCO insertion transactions are rejected before input.

This is sampled local-region evidence, not atomic ownership or whole-field
identity. Unrelated edits outside the bounded region may be invisible, and user
input can race the OS paste gesture. Unsupported accessibility controls keep the
existing best-effort route: the delayed-reader protection is not established for
those controls. Terminals remain on their existing sanitized paste route.

## Sentence joining

Only the first delivery in a session can receive an inferred ASCII space. The
caret must be collapsed at the end of the same bound control, the incoming text
must begin alphanumerically, and existing text must resemble a complete sentence
ending in `.`, `!` or `?`. Multiple alphabetic words or a single capitalized
alphabetic sentence such as `Hello.` qualify. Existing whitespace, selection,
mid-field insertion, lowercase code-like `object.`, URL/path/email patterns and
machine-oriented input purposes are excluded. This is a conservative heuristic;
unfinished prose is unchanged and a generic input cannot prove prose semantics.

The queue continues to track model text. Native `context_separator` records the
intentional extra character separately from the existing leading-Space/payload
split. Metadata reconciliation accounts for it explicitly. Only native dispatch
can report `destination_content_observation: observed`; frontend and terminal
summaries cannot invent recipient observation. Missing evidence remains missing.

## Validation

Run `npm run test:delivery-observation`, the existing focus tests, quality-metadata
report tests, Rust observation/protocol tests, and the paired installed matrix.
Retain original baseline results. Include delayed clipboard reads, repeated and
prefilled sessions, selection, existing whitespace, URL-like input, moved caret,
focus changes and worker failure. A passing GTK case does not qualify physical
Wayland, Codex, Brave, Ghostty or arbitrary applications.

### Legacy Wayland separator regression

The owner's Codex test of .37+local2 exposed a separate helper syntax defect:
ydotool 0.1.x interprets `space` as the S key. This is not xdotool's keysym syntax.
The corrected legacy command passes a literal space argument; modern ydotool keeps
its explicit `57:1`, `57:0` events. Normal and terminal paste retain their existing
chords. No helper upgrade or user keyboard configuration change is required.

Run `/usr/bin/python3 scripts/test-legacy-ydotool.py` on a host with legacy ydotool
and Bubblewrap. It invokes the installed helper against a private socket with no
physical input device, asserts the old failure as a negative control, and checks
four corrected chord/separator combinations. Rust tests additionally cover all
eight combinations across the two CLI generations. This is helper event evidence,
not Codex field readback or full physical Wayland qualification.

The owner session's successful dispatch records did not attest correct recipient
text: content observation was unavailable. Do not use byte-count agreement to
claim spaces, punctuation or words were correct. Final punctuation quality and
safe whole-message refinement remain separate acceptance work.


### Firefox content/caret propagation

An isolated KDE/Firefox trial on the .43 candidate exposed a transient valid
count with an old caret: content length changed from 463 to 465 while the caret
remained at 463. The previous observer rejected that sample although the intended
text arrived. The bounded observer now treats exact expected local content with
an earlier known collapsed caret as pending. This also covers the standalone
leading-space transition. It never acknowledges that intermediate state: two
aligned expected text/position samples are still required. Wrong text, unrelated
caret offsets, focus changes and backwards confirmed progress still fail closed.
The three-second deadline and prohibition on replay are unchanged.
