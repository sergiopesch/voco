# Inside VOCO

A visual field guide to VOCO. Follow a spoken word through the app, then open the code that does the work.

## Start locally

Python 3.10+ and Git are the only requirements. From the VOCO repository root:

```sh
python3 docs/guide/serve.py --repo .
```

Open **http://127.0.0.1:8785**. Stop with Ctrl+C. No build, npm install, account, API key or internet connection is needed to study. The code tour follows a pinned 2026.0.43 development source snapshot recorded in
`site/catalog.json`. Clone the repository with its history (or fetch that recorded
commit) so the read-only viewer can resolve the exact blobs. The TypeSafe tables
retain the separate .41 research identity; they are not .42 latency benchmarks.

## What is inside

- 20 chapters: the application tour, TypeSafe evaluation with measured before/after experiments, and Linux package/desktop qualification.
- Clickable journeys, five kinds of small teaching simulations, quizzes and a glossary.
- A complete index of the tracked files at the pinned source snapshot. Search paths, groups and detected function/type names.
- A read-only viewer of the exact pinned Git blobs, with line numbers and symbol jumps.

Start with **The big picture**, work through the chapters, then follow the source links. Progress stays in this browser’s local storage.

The Linux chapter explains why package installation and desktop dictation need
separate checks, including the Hyprland hidden-start failure and the native-capture candidate that
addresses it. Before/after results retain their specific test conditions.
It also records the .45 fresh-install dependency gap and the .46 candidate’s
separate desktop readiness check. The delivery chapter records the later .48
rich-editor confirmation failure and the .49 candidate correction. Those later findings do not change the pinned
source viewer or announce a new release. The interface chapter also records the
.50 candidate's packaged GNOME panel, explicit activation and visible setup handoff.
The .51 release cut combines these changes with measured tray bars, microphone
selection inside the test canvas and one bundled Nemotron recognizer. These
current-behavior notes preserve the historical source snapshot and its attribution.

The Linux chapter also records the published .52 installer:
measured signal bars, bounded silver sweeps and progress that never holds up the
work. Its local download measurements and APT prompt tests are separate from
whole-install or dictation performance. The pinned code viewer is unchanged.

## Scope and privacy

The lessons explain the important layers and their contracts. The file catalog covers every tracked entry; its generic group descriptions are navigation aids, **not a hand-written, line-by-line explanation of every upstream library**. Binary files and text over 2 MB have metadata only. Model weights and installed runtime binaries live outside the Git source snapshot.

The server binds only to `127.0.0.1`. It rejects foreign Host/Origin requests, exposes no write API and serves source only from catalogued Git blobs. It never serves the checkout directory, uncommitted files, personal recordings or credentials. There is no analytics, remote font, CDN or public deployment configuration. Do not add a tunnel, bind to all interfaces or enable GitHub Pages.

The interactive exercises are teaching simulations, not microphone capture or performance measurements. Private benchmarks and launch-media exports are not part of this guide.

The TypeSafe chapter includes a curated, dated aggregate comparison; raw benchmark
logs, transcripts and API credentials remain outside the guide. It makes no API
calls. The separate opt-in research runner and rubric are documented in
[the evaluation protocol](../testing/typesafe-evaluation.md) and
[the results](../testing/typesafe-results-2026-09-19.md).

## Maintain it

Read [AGENTS.md](AGENTS.md) and [DESIGN.md](DESIGN.md). When deliberately updating the source snapshot, review the lessons against that exact commit, then regenerate and test:

```sh
cd docs/guide
python3 tools/catalog.py --repo ../..
python3 tools/write_lessons.py
VOCO_SOURCE=../.. python3 -m unittest discover -s tests -v
```

Restart any running guide server after regenerating the catalog. It loads its
pinned source identity at startup.

`tools/catalog.py` is the pinned inventory builder. `tools/write_lessons.py` is the authored chapter source. `site/app.js` handles navigation and source reading; `site/diagrams.js` contains the small simulations. `serve.py` is the loopback-only read boundary.

See [VERIFICATION.md](VERIFICATION.md) for checks and limitations. VOCO source and identity retain their upstream notices; bundled Geist fonts use the SIL Open Font License.

For the release-polish refresh, see [the dated verification record](../testing/linux-release-2026-09-20.md).
It separates the earlier long/recovery evidence from fresh checks after an Updates
help-text change; the code tour remains pinned to the reviewed product source.

The Linux qualification chapter also records the [.53 dependency refresh](../testing/dependency-release-2026-09-22.md):
shared shortcut protection, grouped maintenance updates and exact-package checks.
The learning site remains local and its source viewer remains pinned to .43.
