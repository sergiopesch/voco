# Linux Wayland Insertion Review

## When to use
Invoke when changes touch text insertion logic, clipboard handling, ydotool/xdotool usage, session type detection, or any code in `insertion.rs`.

## What to review

### Insertion strategy
- Is session type (Wayland vs X11) correctly detected via `XDG_SESSION_TYPE`?
- Does each insertion path (ydotool, xdotool, clipboard fallback) handle its failure modes?
- Are clipboard contents preserved when clipboard fallback is used?
- Is the fallback chain deterministic and clearly documented?

### Wayland-specific concerns
- Does `ydotool` usage account for `ydotoold` not running?
- Does the code handle missing uinput access or input group membership?
- Are compositor differences (GNOME, KDE, Sway) considered where relevant?
- Is wl-clipboard used correctly for clipboard operations?

### X11-specific concerns
- Does `xdotool type` handle special characters and Unicode?
- Is `xclip` used correctly for clipboard operations?
- Are there race conditions between clipboard set and paste simulation?

### Security
- Is user text sanitized before passing to shell commands?
- Are shell commands invoked safely (no interpolation of unsanitized input)?
- Are error messages actionable without exposing sensitive details?

## Output format
| Session | Path | Severity | Issue | File:line | Recommendation |
|---------|------|----------|-------|-----------|----------------|
