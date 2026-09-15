# glib iterator safety backport

This is crates.io **glib 0.18.5** with the two-line upstream fix for
[RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html).
The original MIT license, copyright notice, complete crate sources, tests and manifests are retained.
[Provenance](VOCO-UPSTREAM.json) pins the original archive and upstream fix;
[upstream-fix.patch](upstream-fix.patch) contains the exact accepted change.

`VariantStrIter::impl_get` passes a mutable pointer slot to the C out argument.
Previously it passed an immutable reference to a slot modified by C, violating
Rust's aliasing rules and crashing optimized iteration. All five retrieving
iterator methods use this boundary. Public APIs, string lifetimes, iterator
bounds/type checks and dependency versions are unchanged.

GTK 0.18 and WebKit2GTK 2.0 require glib 0.18. Adding glib 0.20 directly would
retain an affected transitive copy and introduce incompatible object types.
The application patches crates.io resolution so every glib consumer uses this
copy. `scripts/verify-glib-backport.py` checks the full source against the pinned
archive and exact patch, and verifies there is only one resolved glib package for the supported x86_64
Linux production target.

`scripts/test-glib-variant.py --output <fresh-directory>` runs the regression
with optimization 3, thin LTO and one codegen unit. It covers forward/reverse
iteration, skipping, last, Unicode, empty strings, bounds and type rejection.
The pristine dependency crashed on the same forward test; its control passed.

This is an upstream **source backport**, not a published glib version upgrade.
Version-only scanners may still flag 0.18.5. Do not suppress the advisory without
checking the exact shipped source. Remove this vendor override when the complete
GTK/WebKit dependency graph supports a fixed upstream release and passes tests.
