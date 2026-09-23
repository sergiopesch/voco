# Installer brand presence — 23 September 2026

Status: **unreleased source change**, on `fix/installer-brand-presence`, based on
`ec67c7a9f99e72501262ee32462362e7261ff80c`. The installed application, profile,
published installer and immutable release assets were not changed.

## Presentation

- A five-row, 35-column VOCO wordmark makes the brand prominent in an ordinary
  colour terminal. It appears immediately, in satin silver; the existing brief
  four-step silver highlight now spans the full-height letters.
- Soft green checks identify completed stages; an amber chevron identifies the
  active stage; pending stages use a muted open circle. Errors retain their red
  error presentation. Meaning is carried by shape and text as well as colour.
- Download and APT share the same glyphs and palette from
  `scripts/lib/install-brand.json`. The sync generator updates marked constant
  sections in both renderers, then embeds them in the standalone `install` file.
  No new runtime dependency, logo download or UI framework is introduced.
- The large canvas uses 14 lines at 64+ columns and 16+ rows. Short colour terminals
  retain the ten-line compact canvas. Narrow, redirected, plain, `NO_COLOR` and
  `TERM=dumb` output retain the static text fallback.
- Reduced motion removes the highlight and moving transfer-history bars. Measured
  progress still updates. Rendering keeps its existing bounded cadence, with no
  minimum animation time and no cosmetic completion delay.
- Both renderers clear their full canvas before password/package questions or
  unexpected APT output. Package exit status, verification, retries and launch
  behavior remain authoritative and unchanged.

## Verification

- `npm run verify:devops`: passed, including version consistency, embedded source
  identity, shell/Python syntax, installer regressions and release rehearsal.
- Presentation: ten terminal/download cases passed, including resume, cancel,
  failure, redirected output and colour-disabled modes.
- Performance/prompt suite: eleven tests passed. New coverage checks the large
  wordmark at 80×24 and the 64×16 boundary, the 80×12 compact fallback, canvas release,
  reduced-motion letter colours and the APT-to-prompt handoff.
- Journey suite: five test methods passed across their subcases. Final output has
  exactly one five-row logo without stale animation frames; plain/narrow/short
  output retains one text heading. Password prompts, package questions, rejected
  signatures, desktop readiness failures and launch fallbacks remain covered.
- The first new APT-renderer test omitted its required private pre-created log and
  therefore exercised the logging-failure fallback instead of painting. That failed
  attempt is retained. The corrected fixture creates a mode-0600 log and passes.
- The preview uses real shell-renderer ANSI output with fixture verification text,
  presented in a monospace browser view. It is not a screenshot of an owner terminal
  or a new complete package installation. Terminal font/theme differences and live
  terminal resizing are not qualified by these checks.
- ShellCheck is unavailable on this host; its separate check was not run. Shell
  syntax, real Bash execution and the broader DevOps gate passed.

## Download rendering cost

The existing benchmark alternated baseline/candidate order over seven repetitions
for each mode/transfer combination: **56/56 trials succeeded and verified payload
hashes**. Fast transfers use 64 KiB; paced transfers use 8 MiB from local HTTP, with
128 KiB chunks separated by 12 ms. CPU is aggregate child user+system time.
These are local download/presentation fixtures, not Internet, full APT, desktop
startup or user-perceived installation measurements.

| Transfer | Mode | Source | Median wall (s) | Median CPU (s) | Median output bytes |
|---|---|---|---:|---:|---:|
| fast | plain | baseline | 0.0159 | 0.0157 | 162 |
| fast | plain | candidate | 0.0160 | 0.0159 | 162 |
| fast | animated | baseline | 0.0167 | 0.0202 | 958 |
| fast | animated | candidate | 0.0174 | 0.0210 | 2700 |
| paced | plain | baseline | 0.7894 | 0.0309 | 161 |
| paced | plain | candidate | 0.7890 | 0.0311 | 161 |
| paced | animated | baseline | 0.7885 | 0.0460 | 4132 |
| paced | animated | candidate | 0.7891 | 0.0479 | 11843 |

The larger animated paced canvas adds approximately 1.9 ms median CPU time and
0.6 ms median wall time in this fixture. Output rises from 4,132 to 11,843 bytes;
this is the expected cost of painting the larger mark, not zero overhead. Both
separate traced trials verified their payload and recorded 14 `execve` calls.
The source hashes, all samples, traces, intermediate attempts and preview remain in
the private `installer-brand-review-2026-09-23` evidence directory.

This change does not publish a new release. The .56 installer referenced by the
public installation instructions continues to show the previous smaller wordmark.
