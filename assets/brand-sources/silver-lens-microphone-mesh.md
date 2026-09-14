# Silver Lens microphone mesh

Generated with the built-in ImageGen tool on 2026-09-05 as a material asset for
the user-selected Silver Lens direction. One generation, no synthetic hand-drawn
texture, no component or stylesheet changes.

- Reference: `glass-concepts/silver-lens-refined.png` in the surrounding VOCO
  workspace; used only to guide the graphite mesh material.
- Unmodified generation: `silver-lens-microphone-mesh.png` beside this file.
- Web asset: `apps/desktop/public/textures/microphone-mesh.webp`, 1024 × 1024.
- Export: ffmpeg Lanczos resize to 1024 × 1024, WebP quality 88, compression level 6.
  No recoloring, texture synthesis, compositing or retouching was applied.
- The texture is a flat, opaque, static graphite material. Tiling continuity has
  not been verified; prefer a single covered background and control visibility
  in the consuming UI so the small perforations do not compete with text.

## Prompt

Use case: precise-object-edit. Asset type: production desktop UI background
texture. Edit the reference into a standalone 1024 x 1024 square material texture:
retain only the fine graphite microphone-grille mesh material, remove the entire
interface, microphone, letters, controls, borders and enclosing panel, and extend
the underlying material uniformly across every edge of the square. The result
must be only a flat, front-facing, finely perforated dark graphite metal mesh
sheet. Much quieter and lower contrast than the reference: tiny consistent
rounded perforations, dark neutral graphite around #1b1d20, subtly lighter satin
mesh ridges, gentle broad studio illumination with no hotspot or vignette. Fine
real material detail, low-relief surface, soft neutral lighting; no perspective,
folds, objects, recognizable shapes, microphone, logo, text, watermark, button,
glass effect, frame or bezel. Not a mockup: fill the whole canvas edge to edge
with only the material texture. This will be placed below real UI and must never
compete with white text. Make exactly one texture image.

## Checksums

Source SHA-256: `5961b9a87a11a50bdc120ca0104eda1ba9df4817e71a59fe8698c4906d423eef`

Web asset SHA-256: `e4c4da8eb60ce68f4f7deb6af0d5f6d4e4dc7b29a644724c89155f039357fc7d`
