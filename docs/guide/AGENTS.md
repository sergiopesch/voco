# Working on Inside VOCO

Inside VOCO is the local, visual code guide in VOCO's repository. It runs on the
reader's own computer; it isn't a hosted site.

## Content

- Teach how VOCO works now, at the commit `site/catalog.json` records. Write in
  the present tense, with no release history, dates, run IDs or retired designs.
- Explain one idea at a time: the plain story first, the detail second, the code
  links third. Define each new term in `site/glossary.js`.
- Code is the ground truth. Take every number from the code, such as timeouts,
  bounds, thread counts, sizes and margins, and quote user-visible text exactly.
- Cite tracked source, scripts and packaging files, not VOCO's other
  documentation. Vendor READMEs and `VOCO-PATCH.md` notes are fine.
- Keep claims modest and state limits plainly. Never claim fastest, most
  accurate, universal compatibility or stability. Label simulations as
  simulations.
- Chapter text is plain prose, without markdown or backticks. A quiz explanation
  says why the right answer is right.
- Never add personal recordings, transcripts, benchmark logs, credentials or
  local machine paths.

## Structure

- Chapters live in `tools/write_lessons.py`, and `site/chapters.json` is
  generated from it; never edit the JSON by hand. The generator fails if a
  chapter cites a path that isn't in the catalog.
- There are 20 chapters. Each has five steps, facts, cited files, a caution and a
  quiz. Only the desktops chapter has a comparison table and a source note.
- `tools/catalog.py` indexes every tracked file at one commit. Group descriptions
  are navigation aids; don't present them as reviews of each file.
- When the cited code changes, re-pin with `tools/catalog.py --commit`, review
  every chapter against that commit, regenerate, and restart the server.

## Boundaries

- Keep the guide free of dependencies: standard browser APIs, local assets, the
  Python standard library and Git.
- Serve on loopback only. Never add public hosting, analytics, external
  requests, remote fonts, a CDN or a tunnel.
- Serve source only from the Git blobs in the catalog, never from working files.
  Keep the path allowlist, the 2 MB text bound, the Host and Origin checks and
  the read-only API.
- Keep VOCO's white, graphite and silver palette, Geist typography and the
  silver microphone, along with the responsive layout, keyboard access and
  reduced-motion support.
- Guide maintenance never builds, tags or republishes a VOCO release.

Before a change lands, run the checks in [VERIFICATION.md](VERIFICATION.md).
