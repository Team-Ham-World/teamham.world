# Member Page Personalization V2 — Local Implementation Record

**Date:** 2026-08-26

**Scope:** Local source, migration, editor, renderer, asset lifecycle, bridge, moderation, tests, and build only. No production or external infrastructure changes were performed.

## Runtime baseline and Next.js guidance

- Node engine: `>=24 <25`
- Next.js: `16.3.1`
- React / React DOM: `19.2.8`
- TypeScript: `5`
- Database runtime: existing `@neondatabase/serverless` tagged HTTP queries; no ORM or interactive runtime transactions added.

The implementation reviewed the installed Next.js guides required by the delivery plan for Server/Client Components, mutations, caching, revalidation, metadata, Route Handlers, forms, Server Actions, authentication, data security, CDN behavior, package bundling, and lazy loading.

Material Next.js 16 decisions:

- Request APIs and route parameters are handled asynchronously.
- Every Server Action and Route Handler re-authenticates and re-authorizes on the server.
- Editor, TipTap, dnd-kit, upload, and draft state modules are isolated behind the owner-only editor branch.
- Public asset responses remain `no-store` until deployed revocation behavior is proven.
- `/m/[member]` remains dynamically rendered for owner-aware behavior; public-page cacheability is therefore not yet established.

## Local implementation status

Implemented locally:

- closed V2 document, rich-text AST, limits, strict validation, asset references, conversion, themes, and rollout controls;
- additive migration `0007`, deterministic backfill, malformed-row preconditions, least-privilege grants, durable mutation limits, asset metadata, ETag binding, and page-first race-safe counters;
- V2 public renderer with Paper parity, Newsprint, Blueprint, and Riso themes;
- temporary V1 fallback and mandatory non-cohort dual-write with V2 cohort rejection;
- owner autosave, conflict handling, publish, unpublish, reset, block editing, responsive inspector, TipTap, uploads, galleries, external artwork, and dnd-kit reordering;
- private R2 configuration, SigV4 adapter, strict bounded JPEG/PNG/WebP/AVIF verification, animation rejection, allocation/finalize/delete/serve routes, and replay-safe claims;
- administrator takedown-and-hold / clear-hold controls without draft or private-asset access;
- conservative cache headers and server-side rollout / kill-switch enforcement.

`image-size` was removed after npm disclosed unfixed high-severity synchronous DoS advisories in its HEIF/JXL/ICNS parsing paths and review found a reachable AVIF exploit plus a quadratic JPEG path. The replacement parsers are bounded and covered by adversarial fixtures. This is a deliberate security deviation from the original dependency plan.

## Verification completed

- `npm run typecheck` — passed.
- `npm run lint` — passed with zero errors/warnings.
- `npm run test:unit` — 629 tests passed.
- `npm run test:integration` — 266 tests passed against disposable PostgreSQL 16; no database cases skipped.
- `npm test` — 895 tests passed against the same disposable PostgreSQL 16 database; no tests skipped.
- `AUTH_MODE=disabled npm run preflight` — passed.
- `AUTH_MODE=disabled npm run build` — passed; all member asset routes compiled as dynamic Route Handlers.
- `npm audit --audit-level=high` — not rerun during the 2026-08-26 review because the registry advisory request was unavailable in the sandbox and external manifest disclosure was not authorized; the prior implementation run recorded zero vulnerabilities.
- `npm ls image-size --all` — empty.
- `git diff --check` and `git diff --cached --check` — passed.
- Theme contrast automation covers every enabled theme/accent pair; see `MEMBER_PAGE_V2_THEME_CONTRAST.md`.

A disposable PostgreSQL 16 container executed migrations `0001` through `0007`, exact canonical backfill checks, runtime-role grants, durable rate limits, asset constraints, and all concurrency cases after the final migration and bridge hardening edits. The complete 266-case integration suite passed twice against fresh/reinitialized state, and the disposable database container was removed afterward. This local result does not replace the required fresh Neon rehearsal branch.

The Vitest native-config advisory about ESM syntax in `vitest.config.ts` remains informational and predates this work.

## Intentionally unexecuted release evidence

The following remain required and were not authorized or possible as local implementation work:

- read-only production audit of migrations `0005` / `0006`, existing rows, malformed content, and remote artwork count;
- conditional remote-artwork importer decision and execution;
- private production/non-production R2 bucket, credential, CORS, and no-public-domain verification;
- fresh Neon rehearsal branch, migration application, runtime-role verification, production authorization, and production migration execution;
- final all-page Paper parity capture against production content;
- deployed public asset cache/revocation proof after publish, unpublish, and moderation takedown;
- deployed signed-out/non-owner bundle inspection;
- manual keyboard, screen-reader, touch, 375 px, 200% zoom, and reduced-motion audit;
- two-week 5–10 page pilot, kill-switch exercise, general cutover, observation period, cleanup release, and later migration `0008`.

Until those gates pass, this implementation must not be represented as deployed, pilot-approved, cache-revocation-proven, or generally cut over.
