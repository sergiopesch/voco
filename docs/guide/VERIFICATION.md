# Verification

Run these checks before a guide change lands. They check the guide, not VOCO's
recognition, delivery or desktop support.

## Automated checks

From the repository root:

```sh
export PYTHONDONTWRITEBYTECODE=1
python3 docs/guide/tools/write_lessons.py --check
VOCO_SOURCE=. PYTHONPATH=docs/guide python3 -m unittest discover -s docs/guide/tests -v
node --check docs/guide/site/app.js
node --check docs/guide/site/diagrams.js
node --check docs/guide/site/glossary.js
```

`PYTHONDONTWRITEBYTECODE=1` keeps `__pycache__` out of the guide. The nine tests
start the real server on a free loopback port and check that:

- it listens on 127.0.0.1 and sends its security headers: a content security
  policy with `frame-ancestors 'none'`, `Cache-Control: no-store` and no
  cross-origin permission;
- a foreign Host, a foreign Origin and a cross-site fetch get 403;
- source text equals the Git blob at the recorded commit, and unknown, private
  and untracked paths get 404;
- path traversal and unknown endpoints get 404, a repeated query parameter gets
  400, and POST gets 405;
- a binary file is metadata only and gets 415;
- the catalog lists every tracked path and blob at the recorded commit, and its
  version matches that commit's `package.json`;
- `site/chapters.json` is exactly what `tools/write_lessons.py` writes;
- there are 20 chapters with unique ids, five steps each, a valid quiz answer and
  only cited files that are in the catalog;
- only the desktops chapter has a comparison table, and the table names wl-copy,
  xclip, xdotool and VOCO virtual keyboard. At the recorded commit,
  `insertion.rs` uses the three helpers and sends Wayland keys through
  `virtual_keyboard.rs`, which names its device VOCO virtual keyboard. No
  chapter uses the release-history words the test lists.

## Content review

Review every chapter you changed against the recorded commit:

- Each number and each quoted message appears in the code at that commit. Check
  with `git grep -F` on the commit, excluding `docs/`.
- Each cited file is source, a script or packaging, not VOCO's other
  documentation. Vendor READMEs and `VOCO-PATCH.md` notes are fine.
- The prose describes current behaviour only, with no dates, run IDs or release
  history, and no claim of fastest, most accurate, universal compatibility or
  stability.
- Simulations say they are simulations, and each quiz explanation says why the
  right answer is right.
- The glossary defines every new term and has no entry for removed behaviour.

## Browser checks

Start the server with `python3 docs/guide/serve.py --repo .`, open
http://127.0.0.1:8785 and check:

- Every chapter opens from the rail, and Play, Pause and Next step work in its
  journey.
- Each simulation responds to its controls and shows its simulation label.
- A quiz answer shows feedback with its explanation.
- A cited file opens in the source viewer with line numbers, the commit and the
  function and type list, and Close returns to the chapter.
- File search finds a path and a function name, and the group filter narrows the
  list.
- Glossary search filters terms.
- In the desktops chapter, Tab reaches the table's scroll region, and at a narrow
  width the table scrolls inside its frame.
- At 390 × 844 the page doesn't scroll sideways, the Chapters drawer opens and
  closes, and a closed drawer can't be reached with the keyboard.
- With reduced motion requested, nothing animates.
- The console shows no warnings or errors, and every request goes to
  127.0.0.1.

Stop the server when you finish. If you regenerate the catalog, restart the
server before checking again, because it loads the catalog when it starts.

## Limits

These checks cover the guide only. They don't measure recognition accuracy or
speed, and they don't test any Linux desktop. Every tracked file is indexed, but
the catalog's group descriptions aren't reviews of each file. A check that
couldn't run counts as not run, never as passed.
