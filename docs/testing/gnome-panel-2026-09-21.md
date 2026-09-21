# GNOME panel design pass — 21 September 2026

Development scope: GNOME Shell 46, branch `codex/brand-motion`. The panel extension
and native app bridge build locally. No installation, release, inference or physical
microphone qualification is claimed by this record.

## Verified

- Real GNOME Shell/Mutter in an isolated nested Wayland session: idle 66×32 px,
  listening 208×32 px, intermediate expansion observed, and return to the idle
  width. All tested indicator bounds remain inside the 800×32 px panel.
- Synthetic level changes move the seven bars; processing uses a separate pulse.
  States create no application windows. Stop sends the current token and explicit
  `stop` action. Recovery remains visible.
- System reduced motion, a crowded panel, high-contrast screenshot, loss/reappearance
  of the app, transient service failure, and extension disable/re-enable.
- A matching debug/custom-protocol app connects through the actual Rust bridge.
  An unrelated client cannot attach or read state. Its AppIndicator is Passive while
  the extension is attached and returns to Active when the extension is disabled.
  This bridge test observes startup state, not a real audio recording session.
- Original icon bytes match `assets/voco-symbol-ui.png` exactly. Rebuilding the
  extension archive produces the same SHA-256; archive integrity passes.
- 21 native tray unit tests; four panel model tests; 442 frontend unit tests, with
  two existing skips. Type checking, frontend production build, native debug build,
  formatting and Clippy pass. ESLint has zero errors and four pre-existing warnings
  in `dictationRecording.ts`.

The software renderer normally inhibits GNOME animations. The isolated harness uses
`--force-animations` to inspect transitions and then verifies the ordinary system
reduced-motion setting. It does not override motion preferences on the live desktop.
Earlier intermediate-frame checks exposed this harness limitation; the final run
includes an observed intermediate width, not just before/after screenshots.

Local delivery evidence lives beside the checkout in
`../brand-motion-evidence/gnome-panel/`: `results.json`, `build-manifest.json`, native
and frontend build logs, screenshots and the extension archive. `panel-*.png` images
are direct captures of the panel region; full-screen captures are also retained.
Earlier attempt receipts remain under `/tmp/voco-panel-gnome-*` on the development
host, including harness failures while refining animation observation.

## Remaining qualification

Physical audio with the installed, hidden app, long-running dictation and caret
preservation, hardware compositor timing, multiple monitors/scales, other GNOME
versions and distributable app packaging remain separate checks. The extension
archive requires the matching app bridge; it will not activate against older
released VOCO binaries. The existing source release version is unchanged because
this branch has not produced a release installer.
