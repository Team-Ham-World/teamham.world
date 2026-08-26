<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Neon migrations

For Neon/Postgres schema changes or migration execution, use the global `neon` and `neon-postgres` skills and follow `docs/NEON_MIGRATIONS.md`.

# Orchestration Guidance
- When delegating implementation tasks, do so by providing a comprehensive prompt. Ensure that granular context is provided for better implementation.
- Assume that subagents are junior developers and they need all information they can get.
