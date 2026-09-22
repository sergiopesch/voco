# Installer performance candidate · 22 September 2026

Status: **unreleased source candidate**, separate from public 2026.0.51. This work
changes the standalone installer and its presentation, not the application, model,
package compression, desktop permissions or recognition settings. The owner’s
working installation and recovery archive were not changed.

## Changes and limits

- Run checksum metadata retrieval alongside the package; verification remains
  mandatory before APT. Downloads retain bounded retries and in-run continuation.
- Wait on wget directly. The old 250 ms polling loop could delay completion;
  the renderer now observes independently and stops when the child exits.
- Measure recent byte deltas for Signal bars at 4 Hz, format sizes with shell
  builtins, and suppress wget’s per-chunk dot log. A short phase-entry Silver sweep
  has no minimum display duration. No compiler, UI framework or extra payload is
  installed for presentation.
- Reuse completed Wayland-helper prefetches, but stop a still-running download-only
  process group after the main package is verified. APT handles remaining helpers
  in its ordinary transaction. No parallel privileged installation is introduced.
- Observe APT’s structured progress with an optional Python standard-library
  filter, capped at 10 paints/second and no idle polling after the entry sweep.
  Sudo/password input stays native; package questions and unknown output release
  the view. Plain terminals, missing Python and restricted sudo policies use
  ordinary APT. Logging failure also releases the view rather than breaking APT.
- Honor GNOME’s disabled-animation setting, `VOCO_INSTALL_NO_MOTION=1`, and
  `VOCO_INSTALL_PLAIN=1`. Redirected output, `NO_COLOR` and `TERM=dumb` stay static.

Animations still consume a small amount of CPU and terminal output. They do not
add an intentional wait to installation. This is not a zero-overhead claim, a
whole-install speed benchmark, or proof that all Linux terminals behave alike.

## Download measurements

Baseline source commit: `2882c9365b0cb8ffa6b7bf914cd43a45fcfb1297` (public master
at the start of this work). Exact installer SHA-256 identities:

- Baseline: `9976e1e7ee3fa3b5865ab6bb2765a48e00600c4b40bd60626603527ebcb44158`
- Candidate: `0d9d34b8b2defe6c95fc65c960284310883e4f67c0cb20e051cf621cb94ad097`

These measurements were rerun after the .52 version bump against the exact
release installer. The earlier 56-trial pre-version run remains in a separate
[historical numeric record](installer-performance-pre-version-2026-09-22.json);
it does not supply the release measurements below.

The benchmark ran on the existing Ubuntu host (x86_64, Linux 6.17.0-1032-oem,
glibc 2.39). It exercises each installer’s actual download function through an
80-column pseudoterminal against loopback HTTP. The fast transfer is 64 KiB;
the paced transfer is 8 MiB in 128 KiB chunks, with a 12 ms server pause per chunk.
Seven repetitions per source/mode/transfer alternate baseline/candidate order:
**56/56 trials completed and verified the expected payload SHA-256**.

Wall time includes shell startup, download, presentation and fixture hash checking.
CPU is aggregate child user + system time. The HTTP server is outside that CPU
measurement. No APT transaction, Internet/CDN transfer, full package unpacking,
owner password delay, microphone or desktop launch is timed here.

| Mode | Transfer | Source | Median wall (s) | Wall range (s) | Median CPU (s) |
|---|---|---|---:|---:|---:|
| plain | fast | baseline | 0.2649 | 0.2636–0.2654 | 0.0175 |
| plain | fast | candidate | 0.0151 | 0.0144–0.0155 | 0.0148 |
| plain | paced | baseline | 1.0256 | 1.0251–1.0266 | 0.0484 |
| plain | paced | candidate | 0.7893 | 0.7879–0.7922 | 0.0312 |
| animated | fast | baseline | 0.2674 | 0.2666–0.2694 | 0.0206 |
| animated | fast | candidate | 0.0158 | 0.0152–0.0174 | 0.0190 |
| animated | paced | baseline | 1.0389 | 1.0374–1.0403 | 0.0621 |
| animated | paced | candidate | 0.7908 | 0.7888–0.7924 | 0.0457 |

The animated paced fixture is about **24% shorter** and uses about **26% less
CPU time** than this baseline download path. Its median wall time is comparable
to the candidate’s plain path. These percentages belong only to this small local
fixture; there are no latency percentiles or universal installation-speed claims.
Two additional `strace` runs observed 19 versus 14 `execve` calls for the paced
animated transfer. Traced timings are excluded from the medians because tracing
changes execution cost. All 56 samples and the two trace summaries are in the
[raw numeric record](installer-performance-2026-09-22.json).

Reproduce from a checkout containing the baseline commit (fetch that exact commit
first when using a shallow clone):

```bash
git show 2882c9365b0cb8ffa6b7bf914cd43a45fcfb1297:install > /tmp/voco-installer-baseline
python3 scripts/benchmark-installer.py --baseline /tmp/voco-installer-baseline   --output /tmp/voco-installer-new-measurements --repeats 7
```

The output directory must be new. Bash, wget, Python and strace are needed for this
research runner, not as new product dependencies. Keep every attempted result.

## Functional verification

- `npm run verify:devops`: passed, including exact embedded-source/shared-helper
  checks, shell syntax, existing readiness/configuration regressions, release
  rehearsal, ten terminal presentation cases, five helper-prefetch cases and
  eight concurrency/checksum/prompt/presentation regressions. Valid, missing and
  corrupted checksum cases exercise the actual pre-install verification gate.
- `npm run test:dictation-evaluation`: passed. The application and worker source
  are unchanged; this is not a newly run real-model benchmark.
- `shellcheck -S error install scripts/lib/install-ui.sh scripts/lib/install-common.sh`:
  passed. The broader warning level still reports existing unused shared variables
  and directory-mode warnings; this scoped work does not claim a warning-free tree.
- Real Ubuntu 24.04 APT 2.8.3, in dedicated local-container Crabbox lease
  `cbx_6b961b12b872`: passed a maintainer-script question without a newline, and a
  configuration-file upgrade question that preserves the owner’s chosen contents.
  The synthetic package was purged after testing and the dedicated lease was stopped.
  This is a container package test,
  not a booted desktop or a fresh installation of the complete VOCO package.

The native fixture is deliberately opt-in and must only run in a disposable
container; it installs/removes its synthetic package:

```bash
python3 scripts/test-install-apt.py --allow-container-package-changes
```

The guide’s authored lesson and generated chapter data explain the candidate
without changing its historical .43 source catalog. Guide unit/browser checks
are recorded in [guide verification](../guide/VERIFICATION.md).

## Rejected experiments and cause

An initial APT wrapper put progress on stdout. Mocked prompt tests passed, but a
real Ubuntu package script then reported an output I/O error and waited for input.
Giving the fixture a real controlling terminal did not fix it. Inspection found
that APT marks its status descriptor close-on-exec before invoking dpkg; assigning
stdout to that role closes package-script output. The final wrapper creates a
**dedicated descriptor 3 after sudo**, with raw output on a separate channel and
stdin unchanged. A merged output/protocol variant also leaked status messages
when yielding to a prompt; separate channels fixed that failure. Both real APT
prompt cases passed after the fix. The relevant primary implementation is
[APT PackageManagerProgressFd::StartDpkg](https://github.com/Debian/apt/blob/main/apt-pkg/install-progress.cc);
this archived mirror was checked against the observed Ubuntu 2.8.3 behavior.

Stopping only a prefetch shell could leave APT acquire workers running. The final
prefetch uses its own session/process group and kills only that disposable,
unprivileged download group. It never kills a package installation transaction.
Earlier timing trials and unsuccessful APT attempts remain in local evidence;
the numeric record above identifies the final measured installer source.

## Remaining qualification

No new signed package, release or public site deployment was made. A complete
fresh-user run of this installer against the final release assets, including
native desktop onboarding, remains the next release acceptance check. Actual
network/mirror speed, dependency state and disk performance still determine most
installation time. Keep package verification, input prerequisites and native
prompts even when they cost time; removing them is not a valid optimization.
