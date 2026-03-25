# Review Current Branch

Review all changes on the current branch compared to master.

## Steps
1. Run `git diff master...HEAD` to see all changes
2. Run `git log master..HEAD --oneline` to see commit history
3. For each changed file, check:
   - Code correctness and edge cases
   - TypeScript type safety (no `any` without justification)
   - Rust idioms (error propagation, no panics)
   - Security: no leaked secrets, safe shell command usage, input validation
   - Performance: no unnecessary re-renders or blocking calls
   - Linux behaviour: insertion strategy, session detection, XDG paths
   - Style: consistent with project conventions
4. Report findings as a structured list with file:line references
