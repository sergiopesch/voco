# Terminal presentation and visual comparison pass

The design branch replaces opaque download spinners with measured file bytes
and average transfer speed. It keeps the existing VOCO wordmark, groups routine
checks, distinguishes missing release files from connection failures, retains
private download diagnostics on failure and preserves visible APT prompts.
Downloads make at most three attempts and can continue partial files within one
run. New runs start fresh; checksum validation still precedes installation.

## Validation

- `python3 scripts/test-install-presentation.py`: nine cases passed. A localhost
  HTTP server supplies real bytes to GNU wget. Covers wide/narrow TTY, redirection,
  NO_COLOR, TERM=dumb, HTTP error, connection failure, Range continuation and
  cancellation. Verifies exact payload hash, private log mode, cleanup and exit
  codes. Added to the DevOps preflight.
- `bash scripts/check-devops.sh`: passed. Shared installer helpers, default and
  preserved shortcuts, packaging boundaries and release checks remain intact.
- Branded renderer checks passed, with added Preparing, Finishing and inline
  microphone screenshots. Browser plugin is not available; repository Playwright
  fixtures were used. No production GUI code changed in this terminal pass.
- The actual nested GNOME Shell panel test passed with synthetic status. Fresh
  screenshots include idle, preparation, recording, finishing, recovery, expansion,
  limited panel space, reduced motion and high contrast. Horizontal containment
  and the icon are preserved.

## Terminal screenshots

Crabbox local-container lease `cbx_0e922de2bd13` ran Ubuntu 26.04 with Xvfb and
xterm. Captures compare installer `f4f5ad5` to the new presentation. Wget transferred
real fixture bytes over localhost; APT, package records and desktop readiness
were simulated. Ten full-script runs passed: success, narrow, NO_COLOR, HTTP
failure and desktop readiness failure, before and after. Actual scripts supplied
the display output; no screenshot was drawn or retouched. The lease was stopped.

This does not qualify a real release download, hardware microphone, production
installation or broad Linux support. No installed application or user profile
was changed.

The external comparison bundle contains 32 pairs / 64 source screenshots and
a manifest with original paths and SHA-256 hashes. GUI baselines come from the
earlier UX and journey audits, with each pair labelled; they are cumulative
comparisons rather than claims that this pass changed every screen. The standalone
gallery validates image loading, category filters and a narrow viewport.
