# 2026.0.55 source security hardening check

This record covers the uncommitted source changes on `fix/first-run-delivery`
after `1fe252232e38cbb4707a1fe8b8be023154ec7ed9`. It does not qualify the
earlier .55 package, the owner's installed .54 app, or a public release.

## Changes reviewed

- The guided installer requires a valid publisher signature on the release
  checksum manifest before accepting the package hash or invoking APT.
- The focus probe runs system Python with `-I`, excluding the launch directory
  and `PYTHONPATH` from its imports.
- Browser tab departure and native disconnect request Stop for the original
  token. Tab departure revokes insertion before Stop. If the renderer heartbeat
  is stale or the listener is absent, the native Stop is retained and replayed.
  Only an exact frontend receipt retires it; another browser Start is held
  until then. Stale browser tokens cannot stop onboarding or cancel an unrelated
  pending microphone Start.
- The unused, unguarded `insert_text` renderer command and its dead helpers
  are removed. Automatic desktop paste still requires a destination token.
- The local hotkey trace requires `VOCO_HOTKEY_TRACE=1`. New files are private,
  unsafe links are refused, and the current and previous files are each capped
  at 8 MiB. Oversized legacy files are preserved and tracing stops until the
  owner archives or removes them and restarts VOCO. The report reads both
  retained files, and reset archives both.

## Checks completed

| Check | Result |
| --- | --- |
| Signed installer journey, including missing/invalid/swapped signature, wrong fingerprint, checksum mismatch, and seven terminal modes | 3 test cases passed; every negative case stopped before APT |
| Installer prefetch and release rehearsal | 5 tests passed; `npm run rehearse:release` passed |
| Browser background/content lifecycle scripts | Both passed, including no content reply on tab close/navigation |
| Exact-source isolated browser broker, event delivery, protocol, and socket fixture | 29 tests passed |
| Real Tauri focused Rust tests | Focus probe 4, hotkey trace 7 plus opt-in 1, insertion 19, browser event delivery 4 passed |
| Real Tauri compilation and hygiene | `cargo check --locked`, native `cargo build --locked`, Clippy `-D warnings`, `cargo fmt --check`, and `git diff --check` passed; the built binary reported `VOCO 2026.0.55` |
| Frontend | TypeScript check, lint, production frontend build, and all 453 Vitest tests passed |
| Trace report/reset rotation | Direct strict report joined previous and current (PASS); a synthetic failure in previous produced `failures-observed` (FAIL); reset archived both files |

An independent read-only pass after the Stop receipt and trigger isolation
changes found no additional concrete bypass in those paths.

## Qualification limits

The full Tauri library suite compiled and ran, with 237 passing, 37 failing,
and one ignored. Every failure was at this sandbox's Unix socket or private
notification bus setup (`Operation not permitted` or the bus could not start).
The isolated exact-source browser fixture passed its socket tests, but it is not
an installed application test. The full Chromium and renderer harnesses could
not listen on localhost here. `npm run verify:devops` passed version, release
verification, and installer helper checks, then stopped when its presentation
fixture hit the same localhost permission error. The report/reset test scripts
could not spawn child Node processes in this sandbox; direct synthetic runs
covered the new rotation behavior.

The new bytes still need an isolated desktop run with actual microphone capture,
browser navigation/disconnect, recipient recovery, and a package built from this
source. No latency measurement of an opted-in trace or installed desktop flow
was possible here. Default trace mode performs no trace-file I/O; installer
metadata downloads remain concurrent with the package download. No package was
installed, published, or signed during this check.
