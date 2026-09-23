# VOCO .55 release qualification — 23 September 2026

This record continues the [whole-codebase assessment](release-readiness-2026-09-22.md).
The user approved integration of the private legacy input helper and a new release
cut on 23 September. Earlier candidate packages and failed trials remain retained.

## Scope

The final change keeps the existing Ubuntu input client and device permissions.
A source-built, narrowly patched daemon is private to VOCO; exact client identity
selects it, and other clients retain the distribution daemon. The installed app's
single-instance guard covers migration before recording can begin. Package hooks
do not control user-session services. Custom units and unrelated daemons are
preserved. Development and extracted candidates cannot migrate the owner's unit.

The runtime, model, privacy model, branded installer, and delivery recovery rules
remain as assessed on 22 September. No automatic retry is added for uncertain
text insertion. No claim of atomic focus ownership is made.

## Evidence in progress

Final source, helper lifecycle/resource checks, isolated VM input, fresh install,
upgrade, removal, renderer/audio delivery, protected CI and exact package identities
are being recorded before signing. Publication requires verified publisher
signatures and downloaded draft/public bytes. This assembly-time document is not
evidence that publication has happened; GitHub Releases and its signed validation
manifest are authoritative.

Physical microphones and owner-perceived experience are distinct from synthetic
audio and virtual desktops. A local container validates package userspace only;
kernel input qualification uses a disposable VM without host input passthrough.
Other distribution channels remain on their separately qualified .43 artifacts.
