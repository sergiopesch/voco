# Documentation Rules

## Living Documentation
- Docs must evolve with implementation; stale docs are worse than no docs
- Update README.md when features are added/removed/changed
- Architecture docs must reflect actual module boundaries

## What Must Be Documented
- Tauri command contracts (argument/return shapes)
- Linux prerequisites and permission requirements
- Wayland/X11 behavioural differences
- Architectural decisions and their rationale (in `docs/decisions/`)
- Security-sensitive design choices (in `docs/security/`)
- Known limitations and distribution compatibility

## Format
- Use Markdown for all docs
- Keep docs concise and scannable
- Use code blocks for examples
- Link to source files where helpful

## No Drift
- If code changes make a doc inaccurate, fix the doc in the same change
- Do not leave aspirational claims in documentation
- If a feature is partial, say so explicitly
