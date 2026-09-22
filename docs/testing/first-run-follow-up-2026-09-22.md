# First-run follow-up: Brave readback and installer presentation

This records the first investigation against public **2026.0.54**. The owner
subsequently identified **Brave's address/search bar**, not a website editor.
The empty-block issue below was real but was not that reported destination.
The [.55 application investigation](application-delivery-2026-09-22.md) records
the matching reproduction, focus fixes and expanded tests. The installed owner
application and recovery remain intact; source tests do not replace that package.

## Reproduced browser failure

Brave 153.1.95.104 (Chromium 153.0.8010.53) and the repository Chromium fixture
rejected the first character pasted into `<div contenteditable><br></div>`.
The accessibility control and caret route stayed the same. The initial line
break disappeared on input, so the character count stayed one instead of growing
to two. VOCO returned `changed` and stopped delivery despite the expected text.
An empty nested `div` exposed the same issue as a `section` accessibility node.

The correction applies the existing rich-paragraph scaffold handling to editable
HTML `div`/`p` text blocks. Plain/native text controls and HTML textareas retain
literal newlines. Exact local text, caret, field token and nested route checks
remain required. Unexpected text, field departure and backward changes still
stop delivery; no failed paste is replayed.

The regression suite adds bare empty, bare line-break and nested block editors,
including a one-character first chunk and subsequent delivery. Choose another
installed Chromium-family executable without using its existing profile:

```sh
VOCO_RICH_EDITOR_BROWSER=/absolute/path/to/browser \
  npm run test:rich-editor-delivery
```

This harness isolates the display, D-Bus, profile and clipboard in a disposable
namespace. It uses X11 and synthetic public text. It is not a microphone test or
proof of native Wayland input, Snap confinement, or a particular website.

## Installer changes

The previous whole-script flow left multiple wordmarks, separate stage headings,
a completed download frame, partial APT progress and raw service output behind.
The candidate uses one ten-line Signal + Silver canvas for checks, download,
verification and desktop setup. Only measured download activity drives the bars;
phase sweeps remain cancellable and never extend an operation's completion.

Password authentication is requested only when the existing sudo credentials
need it. The view clears its own rows before native authentication, unknown APT
output or package questions. The APT renderer also clears its own intermediate
frame on completion, including when its last reported percentage is below 100.
The final view gives the onboarding sequence, shortcut and any required panel
sign-out. Service-manager diagnostics join the private failure log. Narrow and
plain terminals preserve sequential text; reduced motion removes animation.

## Verification and limits

- Delivery observation: 63 unit cases; focus cache: 36 cases.
- Real browser/AT-SPI/clipboard: 13 cases each in installed Brave and repository
  Chromium on private X11 displays, including wrong-text and focus-departure
  rejection. Before-fix runs failed at the new empty-line-break case.
- Full installer PTY/rendered-scrollback journey: animated, reduced motion,
  password prompt, package prompt, plain output, 40-column and 8-row terminals. Checks
  reject duplicated canvases, stale percentage text and raw service chatter.
- Existing download presentation, failure/resume/cancellation, helper-prefetch,
  authentication and APT protocol checks remain in the DevOps gate.
- Real Ubuntu 24.04 disposable-container APT: package-script prompt and conffile
  prompt passed; the existing configuration was preserved. The fixture uses
  noninteractive debconf, but its package-script and dpkg questions remain live.
- An Ubuntu 26.04 minimal-container attempt without a configured debconf frontend
  timed out before the fixture package was installed; it is not counted as a pass.
- Candidate terminal bytes were replayed through real GNOME Terminal and captured
  without editing the screenshot. Package/desktop operations in that UI fixture
  are synthetic.
- The initial native Wayland fixture was **unqualified**: key events arrived but
  the Xwayland clipboard bridge did not deliver text. A later investigation found
  that the fixture omitted the nested compositor's Xauthority file and mistook
  xclip's authentication error for readiness. The corrected fixture supplies that
  file and requires the clipboard ownership message. It now passes all 17 Brave
  native Wayland cases; the old attempts remain retained and are not passes.

The .54 model, recognition queue and recovery behavior were not changed. A new
qualified package and a matching destination test are required before asking the
owner to repeat the complete installation and dictation journey.
