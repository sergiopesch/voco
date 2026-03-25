# Dependency Audit

Audit project dependencies for security, licensing, and bloat.

## Steps
1. Run `npm audit` and report findings by severity
2. Run `npm ls --depth=0` to list direct JS dependencies
3. Run `cargo tree` to list Rust dependencies
4. For each direct dependency, check:
   - Is it still used? (grep for imports)
   - Last publish date and maintenance status
   - License compatibility (prefer MIT/Apache-2.0)
   - Known vulnerabilities
5. Check for unused dependencies (installed but not imported)
6. Check for duplicate functionality
7. Verify all significant dependencies are justified in `.claude/rules/dependency-policy.md`
8. Report: safe / needs attention / action required, with specific recommendations
