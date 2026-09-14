# Pinned local speech decoder sources

VOCO uses the existing whisper-rs 0.14.4 and whisper-rs-sys 0.13.1, including
whisper.cpp 1.7.4, with the same base.en model. The application Cargo manifest pins
these two local crates. This is a small owned native patch, not a model upgrade.

## Local changes

- Read-only state diagnostics additionally expose entropy/repetition-loop rejection
  history independently of the final selected confidence. The safe history getter
  rejects stale data after wrapper-level input rejection. This does not itself
  change native decoding or establish transcript quality.
- Read-only state diagnostics expose low-confidence decoder rejection, terminal
  selected-decoder failure and the earliest selected near-end completion offset.
  Each resets at the start of every native full call. These signals do not prove
  transcript correctness or lexical coverage; application Rust owns recovery policy.
- The existing final no-speech rejection remains active. An additive guard also
  suppresses high-no-speech output whose accepted lexical-token mean confidence is
  below the same existing log-probability threshold. It is not a general VAD.
- A bounded per-state selected-window observer records numeric completion and rejection
  evidence for alternative admission, with checked copied getters and full-call reset.
  It retains no transcript, token sequence or audio. Overflow makes evidence unavailable.
- Safe Rust accessors and static fallback bindings cover the new native getters. The
  selected-window accessor rejects stale results after a Rust-side full-call error.
- The build script tracks native sources and refreshes its generated OUT_DIR copy
  on a rerun, preventing changed or removed source files from leaving stale code.

- Linux non-OpenMP CPU barriers use bounded spinning followed by a generation-checked
  condition wait. CPU graph cancellation records a node boundary and all workers
  meet a final graph-completion barrier before graph resources can be reused.
  The public native ABI and speech policy are unchanged. See
  `docs/architecture/native-cpu-synchronization.md` for scope and validation limits.

Separate patches and the aggregate pristine diff are retained in `provenance/`.
The exact pristine crate archives and their canonical URLs/hashes are retained too.
Reconstruct the two crates by extracting those archives and applying
`provenance/synchronization-pristine.patch` with `patch --fuzz=0 -p1` from the vendor root.
Historical terminal and selected-window patches remain intact;
`synchronization.patch` is the incremental change on the prior repetition-history baseline.
Earlier speech patches remain retained. No teacher scoring or research probe is included.
Cargo cache markers and an experiment's patch backup are excluded; upstream
`Cargo.toml.orig`, licenses and source metadata remain.

## Verification and updates

Run from the repository root:

```sh
python3 vendor/verify.py
python3 vendor/verify.test.py
```

`OWNED-FILES.json` lists all 485 regular files under the two crate roots, their
SHA-256 hashes, sizes and executable permissions. Verification rejects missing,
changed, unexpected, symlink and nonregular files, including a nonregular inventory.
Checks remain active with optimized Python; the CLI tests exercise that environment.
The verifier never regenerates its inventory. An intentional native change requires
reviewing the patch, rebuilding the pristine diff and inventory, and repeating
recognition and packaged-application validation. An inventory pass proves source
identity, not recognition quality.

The manifest at `apps/desktop/src-tauri/Cargo.toml` is the Cargo root. Its
`[patch.crates-io]` paths select these crates; subsequent builds use `--locked`.
Vendoring these crates does not vendor every transitive dependency or guarantee an
offline clean build. Avoid editing the Cargo registry or formatting all upstream
files. Scope application formatting to package `voco`; verify the inventory after
any dependency-related work. Validate both generated bindings and the
`WHISPER_DONT_GENERATE_BINDINGS=1` build path when native interfaces change.

Native CPU features and optimization settings retain their existing defaults.
Source reproducibility does not promise byte-identical binaries across toolchains
or machines, nor qualify all Linux hardware. Preserve build settings and exact
executable/model hashes with qualification results.

## Licenses and acceptance

`THIRD-PARTY-NOTICES.txt` contains the wrapper's Unlicense and the native MIT license.
The Debian bundle installs these bytes at
`/usr/share/doc/voco/THIRD-PARTY-NOTICES.txt`; the package verifier checks their exact
contents and permissions. This is a decoder notice, not a complete dependency
license audit.

See `docs/testing/speech-adversarial-evaluation.md` for independent recognition
checks and fixed failure gates. Diagnostics, source inventory and helper tests do
not establish recognition acceptance. Remaining word errors stay visible and fail
the strict speech gate; they must not be described as passing qualification.
