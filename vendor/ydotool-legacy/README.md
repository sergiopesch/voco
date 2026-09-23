# Private legacy ydotool daemon

This is the minimal source closure for VOCO's patched legacy **ydotoold 0.1.8**,
with **libuInputPlus 0.1.4**. It is a private daemon; VOCO keeps the authenticated
Ubuntu client and does not replace distribution binaries or grant input privileges.
The socket remains `/tmp/.ydotool_socket`, mode 0600, owned by the launching user.
The eight-byte legacy wire format and upstream uinput setup/emitter are unchanged.

`upstream/` contains original archive bytes, including all source copyright notices.
Only Daemon/Instance and three libuInputPlus translation units are built. The two
patches close accepted sockets on EOF/error, retry interrupted receive/accept,
accept descriptor zero, exit on permanent accept/thread-start failures, and remove
unused client/Boost/evdev header dependencies. They do not change input authority,
packet format, event semantics or recipient verification. Upstream input writes
still have no recipient acknowledgment; existing VOCO no-replay/recovery guards apply.

## Build and verify

From the repository root, on Ubuntu x86_64 with Python 3.11+, G++ 13, patch and
binutils:

```sh
python3 scripts/build-legacy-ydotool.py --verify-only
python3 scripts/build-legacy-ydotool.py --output /absolute/new-build-directory
```

The build verifies every vendored source, patch, license and provenance input,
applies patches without fuzz, enables hardening and checks ELF dependencies and ABI
floors. It never executes the daemon. `ydotoold`, `manifest.json`, `notices/`, compiler
input hashes and command/ELF receipts are retained. Build in two fresh directories
and compare binary hashes; this proves repeatability on that toolchain, not across
arbitrary compiler versions. No compiled artifact belongs in Git.

`manifest.json` includes the binary hash/size, source and patch identities, exact
runtime dependencies, hardening, ABI requirements and hashes for every file under
`notices/`. Package that complete notice/source bundle with the private helper.
Distributed command receipts use stable `/usr/src/` paths; unmodified local
commands and header paths remain in the build directory for investigation.
The helper dynamically requires only system libstdc++, libgcc_s and libc; none is
copied into the private payload. GCC Runtime Library Exception, glibc, Linux UAPI
and upstream MIT notices are retained under `notices/` with the reviewed toolchain's
header notices. Compiler input hashes bind the actual build to those reviewed inputs.

The focused lifecycle gate builds the same production ELF and runs it in a fresh
bubblewrap namespace with no input devices. A separate, test-only syscall sink
records uinput setup/events and injects receive, accept and thread-start failures:

```sh
python3 scripts/test-legacy-ydotool-daemon.py --output /absolute/new-test-directory
```

This requires the qualified legacy `/usr/bin/ydotool` client, a C compiler and
bubblewrap. It checks 4,000 connections, descriptor reclamation, idle CPU, exact
client gestures, fragmented/truncated frames and startup/failure paths. The final
`result.json` must report `passed: true`; individual trial receipts describe their
lifecycle and recorded events. This fixture cannot establish desktop delivery:
separate isolated-VM qualification must use real guest uinput and the exact helper.

## Provenance

`SOURCE.json` binds every selected original archive member and all reviewed local
patches. The source archives were authenticated against Ubuntu noble's signed
universe Sources index on 22 September 2026. The retained `InRelease` is signed by
Ubuntu Archive Automatic Signing Key (2018), fingerprint
`F6ECB3762474EDA9D21B7022871920D1991BC93C`. The individual uploader DSC signature
was not verified; the signed archive index authenticates the original tarball bytes.

Normal builds are offline and verify the pinned vendor inventory. To independently
repeat the complete signature → index → archive → member chain, obtain the exact
`Sources.xz` and original archive URLs/hashes listed in `SOURCE.json`, retain the
archives below one directory, and run:

```sh
python3 scripts/build-legacy-ydotool.py --verify-only \
  --source-index /absolute/Sources.xz --source-archives /absolute/archives \
  --keyring /usr/share/keyrings/ubuntu-archive-keyring.gpg
```

No source download or key trust is implicit. The approximately 20 MB source index
and unrelated archive members are omitted from Git; their hashes and signed index
commitment are retained. Source, patch and license changes require review and a new
manifest, build, lifecycle test and isolated real-uinput qualification.
