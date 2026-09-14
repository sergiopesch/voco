# Current Rust advisory reachability assessment

4 September 2026. This is an assessment of the locked VOCO development candidate,
not an exemption from future dependency review. The audit still reports 17
unmaintained warnings and two unsoundness warnings; none are suppressed here.

## Rand 0.7.3: RUSTSEC-2026-0097

The [RustSec advisory](https://rustsec.org/advisories/RUSTSEC-2026-0097.html)
requires a reentrant custom logger calling the thread RNG while the RNG reseeds.
The configured graph reaches this version through build-time `phf_generator`
0.8.0 → `phf_codegen` → `selectors`. Its generator calls a deterministically seeded
`SmallRng`, not `thread_rng`. `cargo tree -i rand@0.7.3 -e features` has no enabled
`log` feature. VOCO uses the ordinary `env_logger` builder, with no custom RNG
logger in its source. The reported preconditions are absent in this graph.

This is a bounded source/configuration finding. Keep the advisory visible and
reassess if the dependency graph, enabled features or logger changes. It does not
justify a forced transitive major-version substitution.

## GLib 0.18.5: RUSTSEC-2024-0429

The [RustSec advisory](https://rustsec.org/advisories/RUSTSEC-2024-0429.html)
concerns the string-array iterator's mutable C out-argument. The affected
`VariantStrIter` implementation remains present in the locked library.

A search of VOCO source and the resolved registry package source directories for
`VariantStrIter`, `array_iter_str` and `str_array` found this API's definition,
documentation and GLib's own tests, with no application or other dependency call
site. This reduces evidence of current reachability; a source-name search is not
a formal call-graph proof and cannot certify absence of indirect or generated use.

The current GTK/WebKit stack requires this GLib generation. Upgrading only VOCO's
direct GLib dependency would leave the old transitive version and introduce
incompatible GLib object types. A framework migration or maintained patch must be
evaluated as a deliberate change, with native integration tests. No such migration
or vendored patch was introduced in this pass.

## Reproduction and maintenance

Run these from the repository:

```sh
cargo audit --file apps/desktop/src-tauri/Cargo.lock
cargo tree --locked --manifest-path apps/desktop/src-tauri/Cargo.toml -i rand@0.7.3 -e features
cargo metadata --locked --format-version 1 --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Use each resolved package's `manifest_path` from metadata to scope any follow-up
source scan. Reassess after lockfile changes. A zero vulnerability-entry count
does not mean these unsoundness or maintenance warnings have been repaired.
