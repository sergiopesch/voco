# Privacy and Local-First Review

## When to use
Invoke when changes add dependencies, network access, data storage, logging, or any code that could affect user privacy or the local-first guarantee.

## What to review

### Network access
- Does the change introduce any new network calls?
- If network access is added, is it strictly necessary and clearly documented?
- Is the first-run model download the only network dependency?
- Could a user reasonably expect the app to work offline after first setup?

### Data handling
- Is audio data processed locally and never persisted beyond the current session?
- Is transcribed text only inserted into the target app, not stored or logged?
- Are clipboard contents restored after clipboard-based insertion?
- Is config data stored in XDG-standard locations with documented retention?

### Dependencies
- Does any new dependency phone home, collect telemetry, or require network access?
- Are dependency licenses compatible (MIT/Apache-2.0 preferred)?
- Has the dependency been justified in `dependency-policy.md`?

### Logging and diagnostics
- Does logging avoid capturing audio content, transcribed text, or user file paths?
- Are error messages free of sensitive details?
- Is there any analytics, crash reporting, or telemetry being added?

### Permissions
- Does the app still request only the minimum permissions (mic, file storage, input insertion)?
- Has the Tauri CSP been modified? If so, is the change justified?
- Are any new shell commands or system access patterns introduced?

## Output format
| Area | Severity | Issue | File:line | Privacy impact | Recommendation |
|------|----------|-------|-----------|----------------|----------------|
