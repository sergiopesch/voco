# Full Validation

Run the complete validation suite for the project.

## Steps
1. Run `npm run check` for TypeScript type checking
2. Run `npm run build` and report success or failure
3. Run `npm test` if tests exist, report results
4. Run `cargo check` and `cargo clippy` for Rust validation
5. Check for any `console.log` statements that should be removed from production code
6. Verify no `.env` or credential files are tracked by git
7. Verify README.md claims match actual behaviour
8. Summarise: PASS or FAIL with details
