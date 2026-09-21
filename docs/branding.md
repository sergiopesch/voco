# VOCO branding

VOCO is a local English dictation app for Linux. The lead message is **Your voice,
typed. Built for Linux.** Speech becomes text at the cursor, without an account,
subscription or cloud transcription.

Use calm, precise, brief copy and sentence case. Name the action: Start test,
Finish test, Done, Change shortcut. Keep everyday controls visible and technical
explanations in Help. Show recording, recovery and permission information when
it matters; never trade truthful state or safe recovery for shorter copy.

## Identity

Keep the uppercase VOCO name and upright silver microphone. The visual character
is quiet, precise desktop equipment: graphite surfaces, satin silver, clear
shapes, and minimal decorative effects. Do not stretch the microphone, recolor
its entire body for status, or add tiny inscriptions that disappear at icon sizes.

- `assets/voco-logo.png`: square 1024px primary master, a broad simplified grille.
  Use for large launcher icons and promotional material.
- `assets/voco-symbol.png`: square 1024px optical master, three broad channels and
  a simpler support. Use for icons through 64px, app headers and status visuals.
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

Use semantic buttons, inputs and disclosures inside the material treatment.
Microphone selectors use the controlled listbox described below; other selects stay native.
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

## Shared interaction motion

Onboarding, the React tray popover and settings share the Silver Lens motion
vocabulary in `apps/desktop/src/motion.css`: 150 ms feedback and 220 ms settling,
with silver state marks, a recording capsule, and a sliding device-menu highlight.
The silver microphone, existing Adwaita/Lucide icons, graphite materials and Geist
fonts remain the source of identity. No additional icon or animation package is
required. These are original VOCO presentation components inspired by the React
Bits micro-interaction patterns; no React Bits source is vendored.

`VoiceSignal` consumes the owner's audio level; it never opens a microphone or
simulates speech. The labelled onboarding Start/Stop button remains separate from
the accessible meter. The popover keeps its microphone artwork and adds the same
level display while listening. Active dictation prioritises the finish instruction;
getting-started guidance remains in More and in the idle view. Recovery stays
persistent. The [GNOME panel extension](../integrations/gnome/README.md) supersedes
the floating recording presentation when attached: the unchanged microphone
expands horizontally into a silver capsule inside the panel. Native tray menus
remain the fallback when it is absent.

`StatusMark` is decorative beside readable status text. Pending, working,
listening, success and attention are supplied by the owning operation. A passed
voice test never implies desktop-input readiness. Settings save/copy results use
the actual promise outcome. Only working indicators loop, and reduced motion
removes that animation as well as the level interpolation and expanding surfaces.
Contrast and transparency fallbacks remain authoritative.

`DeviceSelect` uses a labelled combobox and listbox with arrow keys, Home/End,
typeahead, Enter/Space, Escape and Tab. Disabled devices cannot be selected, long
names wrap in a bounded scrolling menu, and Escape dismisses without applying a
choice. Native microphone access still requires acknowledgement and the explicit
Use this microphone action; changing the draft resets acknowledgement. Tooltips
support focus and Escape, keep essential instructions in the page, and warm up
between adjacent controls without an idle loop.

### Review and verification

Run `npm run test:brand-motion` with an exclusive `VOCO_RENDERER_EVIDENCE_DIR` to
exercise the production presentation components using synthetic fixture state.
The suite defaults to Chromium; set `VOCO_MOTION_BROWSERS=chromium,webkit` when
both browser runtimes and their host libraries are installed. Use
`VOCO_RENDERER_PORT` to isolate the test server from other work. The native capture
renderer suite also accepts that port override. On hosts with exhausted file
watchers, `CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=1500` applies to that process only.

The dev-only `/tests/brand-motion.html` fixture supports `surface=onboarding`,
`surface=popover` or `surface=settings`, and `state=starting`, `recording`,
`processing`, `success` or `error`. Its Start/Stop actions change synthetic state;
this is not a microphone or native desktop trial and is not a production entry.
Use the full native-capture renderer suite for the mocked App/recording integration,
and separately qualify installed WebKitGTK and physical audio before release.

### First-run continuity

Setup keeps microphone selection inline and uses real capture levels. Working
labels distinguish Preparing, Listening, Finishing and Checking setup. A passed
voice test is retained while desktop prerequisites are repaired. Only verified
readiness reveals “Your voice, ready.”, the configured shortcut and the tray
handoff. Phase changes move keyboard focus to the next primary action.

The opening renderer uses the original microphone asset and a working indicator
while configuration loads. Native window presentation still controls whether
that state is visible during cold launch; a browser fixture is not proof of native
startup timing. The panel capsule remains horizontal and labels processing
“Finishing” to match setup.

The guided terminal installer retains the existing VOCO wordmark in wide colour
terminals and uses a compact VOCO heading in narrow or static output. Only an
active operation animates. Redirected output, TERM=dumb and NO_COLOR use static
text without ANSI escapes. No logo reveal, artificial percentage, simulated
typing or hidden package-manager prompts. New installs use Alt+D; upgrades keep
the existing shortcut. Terminal completion hands off to the actual Start test,
Finish test and Done controls; installation alone does not claim voice setup is
complete.
