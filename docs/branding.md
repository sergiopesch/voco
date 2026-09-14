# VOCO branding

VOCO is a local-first Linux dictation app. The lead message is **Your voice,
typed. Built for Linux.** Describe the core workflow before optional assistant
integrations. Claims about local transcription apply to normal dictation;
OpenClaw and Realtime have separate data flows, documented in the store listing.

## Identity

Keep the uppercase VOCO name and upright silver microphone. The visual character
is quiet, precise desktop equipment: graphite surfaces, satin silver, clear
shapes, and minimal decorative effects. Do not stretch the microphone, recolor
its entire body for status, or add tiny inscriptions that disappear at icon sizes.

- `assets/voco-logo.png`: square 1024px primary master, a broad simplified grille.
  Use for large launcher icons and promotional material.
- `assets/voco-symbol.png`: square 1024px optical master, three broad channels and
  a simpler support. Use for icons through 64px, app headers and realtime visuals.
- `assets/voco-symbol-ui.png`: generated 128px derivative of the optical master.
  Frontend components import this lightweight file, not the 1024px source.
- `assets/voco-readme-banner.svg`: self-contained graphite banner with the primary
  master and an uppercase wordmark. Geist is preferred; the SVG retains a system
  sans-serif fallback when the font is unavailable.
- Primary canvas: `#111318`; silver text: `#f1f3f6`; supporting text: `#c7ccd4`.
  Keep the existing app palette in `apps/desktop/src/styles.css` authoritative.
- UI uses Geist and Geist Mono from existing bundled font packages. Wordmark
  letter spacing is restrained; supporting copy stays plainly readable.

Both masters have genuine alpha transparency. Preserve their square canvas and
aspect ratio. Do not add transparent padding when exporting them. Check native
16, 24, 32, 48 and 128px sizes against both light and dark backgrounds.

## Status identity

The microphone remains silver and fixed in place. A contrasting badge combines
shape and color; color alone is not the status channel:

| State | Indicator |
| --- | --- |
| Not ready / attention | Amber exclamation in a triangle |
| Ready | Green check in a shield |
| Recording | Red dot in a circle |
| Processing | Amber hourglass in a diamond |
| Realtime muted | Silver pause bars in a square |

The native tray and frontend status legend consume the same generated PNGs in
`apps/desktop/public/tray/`. Existing runtime tooltips and visible labels provide
textual status. The badges do not change recording or error handling behavior.
Small desktop trays remain constrained; inspect the target shell rather than
assuming a large preview proves small-size readability.

## Regeneration

From the repository root, with Python 3.10+ and ffmpeg available:

```bash
python3 scripts/prepare-brand-masters.py
python3 scripts/generate-icons.py
python3 scripts/generate-brand-banner.py
```

The first step removes the explicit green key from retained generated exports
and suppresses edge spill; the second creates Linux launcher, favicon and status
PNGs; the third embeds the generated 256px primary icon into the banner. The
pipeline uses no additional project dependency. Inspect transparency after
regeneration. Linux packaging uses PNG assets; historical `.ico` and `.icns`
files are unused and are not regenerated as falsely named PNG containers.

## Source provenance

This refinement was produced on the `codex/branding-refinement` branch from
`6ab2b2c`, retaining the existing microphone identity. Built-in ImageGen produced
the revised sources in `assets/brand-sources/`; GPT-6 Astra agents handled
implementation and review. The unmodified original brand remains recoverable in
Git at the baseline commit.

The generated source brief was: preserve an upright, front-facing satin-silver
and graphite vintage microphone, simplify the grille to five channels for the
primary and three for the optical master, strengthen the U support and foot,
remove tiny emblems and photographic noise, fill approximately 86% of a square
canvas, and avoid text, glow and decorative scenery. Final source exports used
an explicit green key for deterministic transparent packaging. Two earlier
transparency attempts were rejected because the checkerboard was painted into
RGB data; they are not referenced by the app. Their retained local provenance,
along with full prompts and review evidence, is in the adjacent branding-evidence
folder for this work session, not a shipping asset dependency.

## Silver Lens interface material

The command panel uses a 420 × 380 logical-pixel Silver Lens layout: one silver
microphone, state and configured shortcut, one cue, a Hide to dictate action,
and microphone/More controls. Recovery expands the native window to 420 × 660
and retains its scrollable transcript list. Microphone opens Microphone settings.
More opens a glass disclosure above its trigger; Escape closes it and returns
focus before the panel's normal Escape-to-hide behavior applies.

The static generated microphone mesh lives at
`apps/desktop/public/textures/microphone-mesh.webp`. It is a single covered image,
not a seamless tile; a graphite wash and mask keep reading areas quiet. Original
source, prompt, and export provenance are in
`assets/brand-sources/silver-lens-microphone-mesh.md`.
Controls combine smoked tint, backdrop blur where supported, thin silver edges,
and restrained highlights. The primary command button tracks a fine mouse
pointer only during interaction, with no idle animation loop. This is a CSS
interpretation of glass, not Apple's native refraction renderer. On Linux,
backdrop filtering samples the app's own content; desktop wallpaper blur is not
part of this implementation.

Glass is the default appearance; there is no app-level effects toggle. Increased
contrast/reduced-transparency preferences use solid materials; reduced motion
disables pointer glints and motion. Unsupported backdrop filtering also receives
a solid control surface. The separate configuration-recovery screen remains
outside this material treatment. Native WebKitGTK/compositor appearance still
requires an on-device check; browser previews are not proof of native dictation.

## Crystal Sidebar settings

Settings carries the silver and graphite identity through one navigation surface
and grouped, readable controls. Overview brings together microphone, shortcut,
output and appearance choices; retained transcripts appear before these groups
and take priority over previous delivery-success copy. Updates and Troubleshooting
remain in a separate app-settings navigation group.

Use native buttons, selects, inputs and disclosures inside the material treatment.
Reduce motion reports the system preference as On, Off or Unavailable rather than
offering a misleading second switch. Output descriptions are associated with
their controls, and the microphone check has qualitative status text alongside
the visual meter. Keep functional signal feedback independent of decorative motion.

Text drafts and their save/discard protection remain in the control-panel state
across settings navigation. Save feedback is shown when there is an edit, an
operation or a result; idle settings do not need a permanent save-status footer.

The command panel's settings and chevron icons are unmodified GNOME Adwaita assets, vendored from the
host's icon theme without adding a runtime dependency. Attribution and license
are retained in `apps/desktop/public/icons/ADWAITA-LICENSE.txt` (GNOME Project,
https://www.gnome.org).

Crystal Sidebar uses unmodified Lucide SVG files in
`apps/desktop/public/icons/settings/`, with source provenance and license retained
alongside them. These are static assets and add no runtime package dependency.

The settings canvas uses `apps/desktop/public/textures/settings-studio.webp`, a
1040 × 760 graphite microphone-grille backdrop. Its generated source and prompt
are retained under `assets/brand-sources/crystal-sidebar-settings-studio.*`.
The texture stays behind the reading surface and is removed when effects,
transparency, or contrast preferences call for an opaque interface.


### Rounded surface contract

All VOCO-owned window surfaces and visible interactive controls use rounded
corners. `--voco-radius-window` (28 px) and `--voco-radius-control` (12 px) provide
shared defaults; smaller controls keep appropriate nonzero radii. Settings texture
is clipped to the window radius, and grouped row hover/focus states stay inside
their rounded boundaries. Checkbox controls keep native keyboard/checked semantics.
OS reduced motion, contrast and transparency fallbacks remain authoritative.
