# Inside VOCO

Inside VOCO is a local, visual guide to how VOCO works. It follows a spoken word
from the shortcut to the cursor, one idea at a time, and then opens the code that
does each job.

## Start it

You need Python 3.9 or later and Git. From the root of the VOCO repository, run:

```sh
python3 docs/guide/serve.py --repo .
```

Then open http://127.0.0.1:8785, and press Ctrl+C to stop the server. `--port`
picks another port. There is nothing to build or install, and studying needs no
account, key or internet connection.

The code tour follows the 2026.0.61 source commit recorded in `site/catalog.json`.
The server reads that commit from your clone, so the clone needs it in its
history. If the commit is missing, the server doesn't start.

## What's inside

- 20 chapters, from the big picture to the helpers each desktop uses. Every
  chapter has a clickable five-step journey, a short story, facts and limits,
  links to the files that do the work, and a quiz.
- Five small teaching simulations: audio samples and the top-bar meter, the
  packet queue, worker messages, a paste decision, and where a stopwatch starts.
- A table of the shortcut, key and clipboard helpers each desktop session uses.
- A glossary of the terms the chapters use.
- An index of every file tracked at the recorded commit, searchable by path,
  group and detected function or type name.
- A read-only source viewer with line numbers and symbol jumps.

Start with The big picture and work through the chapters in order. Read progress
stays in this browser's local storage.

## Scope

The chapters explain VOCO's main layers and the rules between them. The file
index covers every tracked file, but its group descriptions are navigation aids,
not a line-by-line review of each file or borrowed library. Binary files and text
over 2 MB show metadata only. Model weights and the compiled speech runtime aren't
in the repository, so the guide can't show them.

The simulations are teaching models. They use no microphone, model or other app,
and their numbers measure nothing.

## Privacy

The server listens only on 127.0.0.1. It refuses requests whose Host or Origin
isn't the guide, offers no way to write and logs no requests. Apart from the
guide's own pages in `site/`, it serves only the Git blobs listed in the catalog:
never source files from the working tree, uncommitted changes, recordings or
credentials.

The guide makes no external requests and has no analytics, remote fonts or CDN.
Don't bind it to other interfaces, put it behind a tunnel or publish it as a
website.

## Maintain it

Read [AGENTS.md](AGENTS.md) and [DESIGN.md](DESIGN.md) first. When the code the
chapters cite changes, re-pin the guide to the new commit, review the chapters
against that commit, then regenerate and test. Run these from the repository root:

```sh
python3 docs/guide/tools/catalog.py --repo . --commit "$(git rev-parse HEAD)"
python3 docs/guide/tools/write_lessons.py
VOCO_SOURCE=. PYTHONPATH=docs/guide python3 -m unittest discover -s docs/guide/tests -v
```

Always pass `--commit`, so the catalog records the commit you reviewed. The
server loads the catalog when it starts, so restart it after you regenerate the
catalog.

- `tools/catalog.py` builds the file index for one commit.
- `tools/write_lessons.py` holds the chapters and writes `site/chapters.json`. It
  fails if a chapter cites a file that isn't in the catalog.
- `site/app.js` handles navigation, search and the source viewer, and
  `site/diagrams.js` holds the journey and the simulations.
- `serve.py` is the loopback-only server.

[VERIFICATION.md](VERIFICATION.md) lists the checks to run before a change lands.
VOCO's source keeps its own notices, and the bundled Geist fonts use the SIL Open
Font License; see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
