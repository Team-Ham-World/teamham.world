# Bun 1.4 Migration Plan & Technical Specification

**Document Status**: `PROPOSED MIGRATION PLAN (NOT APPLIED)`
**Target Project**: `teamham.world` (Next.js App Router repository)
**Target Bun Version**: `1.4.x` (CI pinned to `1.4.0`; Vercel serverless functions on `1.4.x`)
**Date**: 2026-08-20

---

## Executive Summary & Decision Context

This document outlines the technical strategy and phased migration plan to evaluate and adopt **Bun 1.4** for developer tooling, CI pipelines, and Vercel Functions / Routing Middleware runtime execution for the `teamham.world` hub.

Vercel provides official production support for Bun 1.4 in Vercel Functions via the `bunVersion: "1.4.x"` configuration in `vercel.json`. This plan establishes a controlled, fully reversible migration sequence that decouples local tooling adoption from runtime deployment, preserves all existing security boundaries and Discord OAuth flows, retains PostgreSQL integration testing, and provides a clear operational runbook with an instant rollback mechanism to Node.js.

---

## 1. Purpose, Scope, Goals & Non-Goals

### 1.1 Purpose
To provide an actionable, implementation-ready specification for migrating `teamham.world` from Node.js 24 + npm to Bun 1.4 across local development, GitHub Actions CI, and Vercel serverless execution.

### 1.2 Scope
- **In Scope**:
  - `teamham.world` Next.js 16.3.1 application and serverless infrastructure.
  - Package manager migration (`npm` with `package-lock.json` -> `bun` with `bun.lock`).
  - GitHub Actions CI workflow pipeline updates using `oven-sh/setup-bun@v2`.
  - TypeScript script execution (`scripts/*.ts` direct invocation via Bun runtime).
  - Vercel Serverless Function & Routing Middleware runtime configuration (`bunVersion: "1.4.x"` in `vercel.json` and `runtime: 'nodejs'` in `src/proxy.ts`).
  - System validation across authentication cookies, cryptographic routines, Neon PostgreSQL queries, and static prerendering.
- **Out of Scope**:
  - Rewriting application code to native `bun:sqlite` or proprietary Bun-only APIs.
  - Modifying the private `organization-docs` repository structure or branding specifications.
  - Migrating unit and integration tests from Vitest to `bun:test` during this initial phase.
  - Altering database schemas, Discord OAuth application configurations, or DNS records.

### 1.3 Goals
- **Tooling & CI Optimization**: Streamline clean dependency installation and test/build pipeline steps in GitHub Actions CI and local development.
- **Runtime Footprint & Cold Starts**: Transition non-Edge serverless endpoints and routing middleware to Bun 1.4 execution on Vercel Fluid Compute.
- **Unified Tooling**: Execute TypeScript utility scripts (`scripts/preflight.ts`, `scripts/assert-static-root.ts`, `scripts/ci-smoke-disabled.ts`) directly via Bun, removing `tsx` as an intermediate development dependency.
- **Zero Functional Regressions**: Maintain comprehensive test pass rates, static prerendering of `/`, cryptographic state verification, and safe `AUTH_MODE=disabled` fallbacks.
- **Rapid, Clean Rollback**: Retain the ability to revert back to Node.js on Vercel by removing the `bunVersion` property from `vercel.json`.

### 1.4 Non-Goals
- **Immediate `bun:test` Migration**: Vitest 4 is deeply integrated with existing mocked environments and live PostgreSQL container integration suites; replacing Vitest test runners is explicitly deferred.
- **Edge Runtime Alterations**: Any routes explicitly configured with `runtime = 'edge'` remain on Vercel's Edge Runtime; Bun 1.4 replaces standard Node.js serverless functions and Routing Middleware configured for `nodejs`.
- **Eliminating Node Compatibility**: Application code remains standard Web-standard and Node.js-compatible rather than coupling to Bun-exclusive runtime globals.

---

## 2. Current State & Migration Readiness Assessment

### 2.1 Stack Inventory (`teamham.world`)

| Component | Current Setting in Repository | Migration Assessment |
| :--- | :--- | :--- |
| **Framework** | Next.js `16.3.1` (App Router, Turbopack) | Supported on Bun; official docs require `bun run --bun next dev/build` when using ISR. |
| **UI Library** | React `19.2.8` / React DOM `19.2.8` | Expected compatible under standard JSX/RSC rendering. |
| **Styling** | Tailwind CSS `4.3.3` + `@tailwindcss/postcss` | Expected compatible via PostCSS build pipeline. |
| **Language** | TypeScript `5.9.3` (`tsconfig.json`, strict) | Native TypeScript parsing in Bun runtime. |
| **Linter** | ESLint `9.39.5` (Flat config `eslint.config.mjs`) | Invoked via `bun run lint` (or `bun x eslint .`). |
| **Test Runner** | Vitest `4.1.11` | Executed under Bun runtime via `bun run vitest run` / `bun run test`. |
| **Script Runner** | `tsx` `4.23.12` | Scripts run directly via `bun <file>.ts`, allowing optional `tsx` removal. |
| **Database Client** | `@neondatabase/serverless` `^1.1.0` & `pg` `^8.23.0` | Uses HTTP tagged queries and Node socket APIs; compatibility to be confirmed via CI integration suite. |
| **Crypto Modules** | `node:crypto` (`randomBytes`, `createHash`, `createHmac`, `timingSafeEqual`) | Evaluated against `tests/unit/crypto.test.ts` for signature and timing equivalence. |
| **Routing / Auth** | `src/proxy.ts` (Next.js Middleware + Route Handlers) | Requires `runtime: 'nodejs'` in config to select Bun runtime tier under `bunVersion: "1.4.x"`. |
| **Node Engine / Version**| `package.json` engines `>=24 <25`, `.nvmrc` `24` | `.nvmrc` retained during transition for Node fallback/rollback workflows. |
| **Package Manager** | `npm` with committed `package-lock.json` | Replaced by `bun.lock` after CI and preview verification. |

### 2.2 Native Binary & SWC Tooling Assessment
- The application codebase contains no custom native C++ addons (`node-gyp`, `.node` binary bindings).
- Next.js itself relies on platform-specific native binary packages (e.g. `@next/swc-*` in `package-lock.json`). Vercel officially supports Next.js on Bun, and the build step must validate that SWC and Turbopack compiler artifacts resolve and execute properly under Bun's package installer and build runner.

### 2.3 Package Manager / Tooling vs. Production Runtime Separation
A key architectural principle of this plan is separating tooling changes from production runtime changes:
1. **Developer Tooling & Package Manager**: Adopting `bun install`, `bun.lock`, and `bun run` locally and in GitHub Actions CI. This modernization can be evaluated independently before runtime activation.
2. **Vercel Production Runtime**: Explicitly activating Bun 1.4 for serverless execution by adding `bunVersion: "1.4.x"` to `vercel.json` and `runtime: 'nodejs'` to `src/proxy.ts`.

```
+-----------------------------------------------------------------------------+
|                          DEVELOPMENT & CI LIFECYCLE                         |
|  Local Workspace (macOS)                    GitHub Actions CI (Ubuntu)      |
|  - packageManager: "bun@1.4.0"              - Setup Bun 1.4.0 (setup-bun)   |
|  - bun install -> bun.lock                  - bun install --frozen-lockfile |
|  - bun run lint / typecheck                 - Local Postgres Service        |
|  - bun scripts/preflight.ts                 - bun run vitest run (all)      |
|  - bun run test (Vitest 4)                  - bun scripts/assert-static-root|
+-----------------------------------------------------------------------------+
                                       |
                              Git Push / PR Deploy
                                       v
+-----------------------------------------------------------------------------+
|                            VERCEL HOSTING RUNTIME                           |
|  Build Phase (Vercel Build Container)                                       |
|  - Detects bun.lock -> runs bun install                                     |
|  - bun run --bun next build (generates static / & serverless functions)     |
|                                                                             |
|  Execution Phase (Vercel Fluid Compute)                                     |
|  - vercel.json -> bunVersion: "1.4.x"                                       |
|  - Non-Edge Vercel Functions -> Bun 1.4 Runtime                             |
|  - Routing Middleware (src/proxy.ts with runtime: 'nodejs') -> Bun 1.4     |
|  - Static Prerendered Assets (/) -> Vercel Edge Cache CDN (Global)          |
+-----------------------------------------------------------------------------+
```

---

## 3. Authoritative Vercel & Bun 1.4 Technical Facts

The following specifications are derived from official Vercel documentation and Bun 1.4 documentation:

### 3.1 Bun 1.4 Production Support & `vercel.json` Configuration
- **Production Availability**: Bun 1.4 is available in Vercel Functions.
- **Opt-In Property**: To run serverless functions on Bun 1.4, `vercel.json` must specify:
  ```json
  {
    "bunVersion": "1.4.x"
  }
  ```
- **Valid `bunVersion` Values**:
  - `"1.4.x"`: Pins execution to the Bun 1.4 channel with automatic Vercel-managed patch updates.
  - `"1.x"`: Currently maps to Bun **1.3.14** on Vercel.
  - *Explicit Opt-In*: Specifying `"1.4.x"` is required to enable the Bun 1.4 runtime.

### 3.2 Rollback Mechanics
- To roll back a Vercel deployment from Bun to standard Node.js, **completely remove the `bunVersion` property** from `vercel.json`.
- *Caution*: Changing `bunVersion` to `"1.x"` does **not** roll back to Node.js; it targets Bun 1.3.14. Node.js execution is restored only by omitting `bunVersion`.

### 3.3 Scope of Runtime Execution
- **Non-Edge Vercel Functions & Routing Middleware**: `bunVersion` applies to all non-Edge Vercel Functions. Routing Middleware with `runtime: 'nodejs'` executes on the Bun runtime when `bunVersion` is set.
- **Edge Runtime**: Routes or middleware explicitly declaring `runtime = 'edge'` remain on Vercel's Edge Runtime (independent of `bunVersion`).
- **Static Assets**: Prerendered static pages (e.g. root `/`, fonts, metadata images) continue to be served directly from Vercel's Edge CDN without triggering function invocations.

### 3.4 Fluid Compute & Patch Updates
- Functions configured with Bun run on Vercel's Fluid Compute architecture.
- Patch releases within the `1.4.x` channel are managed and updated by Vercel automatically.

### 3.5 Permissions & Project Scope Verification
- Vercel Function runtime settings may depend on workspace feature availability and account permissions.
- Account and project runtime enablement must be verified in a Vercel Preview deployment prior to production merge.

### 3.6 Next.js CLI Execution & Incremental Static Regeneration (ISR)
- **Official Vercel ISR Requirement**: Vercel documentation specifies that when using Next.js **and Incremental Static Regeneration (ISR)**, build and development commands must use:
  ```bash
  bun run --bun next dev
  bun run --bun next build
  ```
- Using `--bun` ensures Next.js invokes its internal server workers through Bun.
- For local production smoke testing, `bun run --bun next start` or forwarding arguments with `bun run start -- --port 3000` may be utilized.

---

## 4. Testing & Test Runner Strategy

### 4.1 Recommendation: Retain Vitest 4 under Bun Runtime
We recommend **retaining Vitest 4** as the test runner during this migration rather than attempting an immediate rewrite to `bun:test`.

**Rationale**:
1. **Preserve Test Suites & Mock Setup**: The current test suites (`tests/unit/config.test.ts`, `tests/unit/crypto.test.ts`, `tests/integration/cache-headers.test.ts`, `tests/integration/oauth-flow.test.ts`, `tests/integration/db-queries.test.ts`) use Vitest assertion APIs, module mocks (`vi.fn()`), and environment resets.
2. **PostgreSQL Integration Isolation**: `db-queries.test.ts` runs integration tests against a live PostgreSQL 16 container. Vitest's setup, teardown, and lifecycle hooks are verified and stable.
3. **Isolate Migration Variables**: Running Vitest directly under the Bun runtime (`bun run vitest run`) separates runtime/bundling verification from test framework rewriting.

### 4.2 Test Execution Command Matrix

| Test Scope | Node / npm Invocations | Proposed Bun Invocations |
| :--- | :--- | :--- |
| **All Tests** | `npm test` (`vitest run`) | `bun run test` (invoking `vitest run`) |
| **Unit Tests** | `npm run test:unit` | `bun run test:unit` (`vitest run tests/unit`) |
| **Mocked Integration** | `npx vitest run tests/unit ...` | `bun run vitest run tests/unit tests/integration/oauth-flow.test.ts tests/integration/cache-headers.test.ts` |
| **PostgreSQL Integration**| `npx vitest run tests/integration/db-queries.test.ts` | `bun run vitest run tests/integration/db-queries.test.ts` |

---

## 5. Proposed File-by-File Changes (Illustrative)

*Note: The snippets below represent the target state for implementation. These edits have not been applied to application code.*

### 5.1 `package.json`
- Declare package manager toolchain (`packageManager: "bun@1.4.0"`).
- Update engine bounds if enforcing Bun locally (`bun: ">=1.4.0 <1.5.0"`), while retaining Node engine bounds for fallback.
- Update Next.js scripts to use `bun run --bun next`.
- Update script runners to execute TypeScript files directly with `bun`.
- Optionally remove `tsx` from `devDependencies`.

```json
{
  "name": "teamham.world",
  "version": "0.1.0",
  "private": true,
  "packageManager": "bun@1.4.0",
  "engines": {
    "node": ">=24 <25",
    "bun": ">=1.4.0 <1.5.0"
  },
  "scripts": {
    "dev": "bun run --bun next dev",
    "build": "bun run --bun next build",
    "start": "bun run --bun next start",
    "lint": "eslint",
    "typecheck": "tsc --noEmit",
    "preflight": "bun scripts/preflight.ts",
    "test": "vitest run",
    "test:unit": "vitest run tests/unit",
    "test:integration": "vitest run tests/integration"
  },
  "dependencies": {
    "@neondatabase/serverless": "^1.1.0",
    "next": "16.3.1",
    "react": "19.2.8",
    "react-dom": "19.2.8"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@types/node": "^20",
    "@types/pg": "^8.23.1",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "eslint": "^9",
    "eslint-config-next": "16.3.1",
    "pg": "^8.23.0",
    "tailwindcss": "^4",
    "typescript": "^5",
    "vitest": "^4.1.11"
  }
}
```

### 5.2 Lockfiles (`bun.lock` vs. `package-lock.json`)
- Run `bun install` to generate the text-based `bun.lock`.
- **Sequencing & Recovery**: Git history retains `package-lock.json` for rollback. During branch development, if both lockfiles exist temporarily, verify Vercel build logs to confirm the intended installer is selected. Remove `package-lock.json` immediately before merging to `main` once CI and Preview verification pass.

### 5.3 `vercel.json`
Add `vercel.json` at the root of `teamham.world` to declare Bun 1.4 runtime support:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "bunVersion": "1.4.x"
}
```

### 5.4 Routing Middleware (`src/proxy.ts`)
Vercel documentation requires Routing Middleware to declare `runtime: 'nodejs'` to route through the Bun serverless runtime tier under `bunVersion: "1.4.x"`.

```typescript
// Proposed illustrative edit to src/proxy.ts config object:
export const config = {
  matcher: ['/account', '/account/:path*'],
  runtime: 'nodejs',
};
```

### 5.5 GitHub Actions CI Workflow (`.github/workflows/ci.yml`)
Use `oven-sh/setup-bun@v2` with an exact pinned version (`1.4.0`) for CI reproducibility, while preserving PostgreSQL container services, gitleaks, build verification, and HTTP smoke tests:

```yaml
name: CI

on:
  push:
    branches:
      - main
  pull_request:
    branches:
      - main

permissions:
  contents: read

env:
  AUTH_MODE: disabled

jobs:
  validate:
    name: validate
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: neondb
          POSTGRES_USER: neondb_owner
          POSTGRES_PASSWORD: synthetic_ci_password_12345
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.4.0

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Preflight check (disabled mode)
        run: bun scripts/preflight.ts

      - name: Lint
        run: bun run lint

      - name: Typecheck
        run: bun run typecheck

      - name: Run unit and mocked integration tests
        run: bun run vitest run tests/unit tests/integration/oauth-flow.test.ts tests/integration/cache-headers.test.ts

      - name: Run PostgreSQL integration tests
        env:
          TEST_DATABASE_URL: postgres://neondb_owner:synthetic_ci_password_12345@127.0.0.1:5432/neondb
          ALLOW_LOCAL_DB_TESTS: "1"
        run: bun run vitest run tests/integration/db-queries.test.ts

      - name: Run secret scanner
        uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Build Next.js application
        run: bun run build

      - name: Assert static root
        run: bun scripts/assert-static-root.ts

      - name: Run disabled-mode HTTP smoke tests
        run: |
          LOG_FILE=$(mktemp)
          bun run start -- --port 3000 > "$LOG_FILE" 2>&1 &
          SERVER_PID=$!
          trap 'kill -TERM $SERVER_PID 2>/dev/null || true; wait $SERVER_PID 2>/dev/null || true; rm -f "$LOG_FILE"' EXIT

          if ! CI_BASE_URL="http://127.0.0.1:3000" bun scripts/ci-smoke-disabled.ts; then
            echo "Smoke test failed. Server output:"
            cat "$LOG_FILE"
            exit 1
          fi
```

### 5.6 `.nvmrc` and Node Fallback
- `.nvmrc` (`24`) does not configure Bun; it is retained in the repository during the observation window to support the Node.js fallback/rollback path and local Node workflows.

### 5.7 Direct TypeScript Script Invocation
- TypeScript utility scripts in `scripts/` are executed directly using `bun scripts/<script>.ts`.
- `tsx` can be removed from `devDependencies` once verified in CI.

---

## 6. Phased Migration Execution Plan & Actionable Checklists

### Phase 1: Baseline & Branch Preparation
- [ ] Create dedicated branch: `feature/bun-1-4-migration`.
- [ ] Record current Node 24 baseline metrics (clean install duration, build duration, Vitest duration, bundle sizes).
- [ ] Verify local installation of Bun 1.4 (`bun --version` >= 1.4.0).

### Phase 2: Local Tooling & Lockfile Generation
- [ ] Run `bun install` locally to generate `bun.lock`.
- [ ] Update `package.json` scripts (`bun run --bun next dev/build/start`, direct `bun scripts/*.ts` invocations).
- [ ] Verify `bun run lint` passes without errors.
- [ ] Verify `bun run typecheck` passes without errors.
- [ ] Verify `bun scripts/preflight.ts` passes under `AUTH_MODE=disabled` and `AUTH_MODE=development`.
- [ ] Execute `bun run vitest run` locally; confirm all 5 test suites pass against local synthetic PostgreSQL.
- [ ] Remove `tsx` dependency from `package.json`.

### Phase 3: CI Pipeline Adaptation & Integration Verification
- [ ] Update `.github/workflows/ci.yml` with `oven-sh/setup-bun@v2` pinned to `1.4.0`.
- [ ] Validate complete CI execution: lint, typecheck, unit tests, PostgreSQL integration tests, gitleaks, build, static root assertion, and background HTTP smoke tests.
- [ ] Verify that CI passes cleanly on pull request push.

### Phase 4: Vercel Preview Deployment & Function Verification
- [ ] Add `vercel.json` with `bunVersion: "1.4.x"`.
- [ ] Update `src/proxy.ts` configuration to include `runtime: 'nodejs'`.
- [ ] Open Pull Request to trigger Vercel Preview deployment.
- [ ] Confirm in Vercel build logs that Bun package resolution and build steps are active.
- [ ] Validate Preview deployment in `AUTH_MODE=disabled`:
  - [ ] `GET /` -> HTTP 200 with static HTML and verified brand assets.
  - [ ] `GET /account` -> generic HTTP 404 (disabled mode gate).
  - [ ] `GET /api/auth/discord/login` -> generic HTTP 404.
  - [ ] Verify security response headers (`x-content-type-options: nosniff`, `x-frame-options: DENY`).
- [ ] Remove `package-lock.json` from the branch prior to merge (retained safely in git history).

### Phase 5: Production Rollout & Live Smoke Testing
- [ ] Merge Pull Request to `main`.
- [ ] Monitor Vercel production deployment logs until `Ready`.
- [ ] Execute production smoke test checklist in `AUTH_MODE=production`:
  - [ ] Verify canonical apex `https://teamham.world` returns HTTP 200.
  - [ ] Verify `https://www.teamham.world` returns HTTP 308 redirect to apex.
  - [ ] Complete Discord OAuth login with an eligible test account.
  - [ ] Confirm session cookie (`__Host-session`) issuance and `/account` rendering.
  - [ ] Execute logout flow; confirm session record deletion in Neon and cookie clearance.

### Phase 6: Post-Rollout Observation & Tooling Pin Maintenance
- [ ] Monitor Vercel function error logs and execution durations over an observation window.
- [ ] Update developer setup instructions in `teamham.world/README.md`.
- [ ] Establish routine maintenance procedure: when Vercel rolls out patch updates within the `1.4.x` channel, periodically update the CI pin in `ci.yml` (`bun-version: 1.4.x` or latest patch) to maintain local/CI parity.

---

## 7. Critical Subsystem Validation Matrix

| Subsystem | Underlying API / Mechanism | Validation Expectation | Verification Method |
| :--- | :--- | :--- | :--- |
| **Auth & Session Cookies** | `__Host-session`, `__Host-oauth_state`, `SameSite=Lax`, `Secure`, `HttpOnly` | Cookie header formatting, appending, and clearance headers operate correctly under Bun runtime. | `tests/integration/oauth-flow.test.ts` & live OAuth smoke test. |
| **Routing Middleware** | `src/proxy.ts` (`NextRequest`, `NextResponse`, `runtime: 'nodejs'`) | Header mutation (`x-teamham-authenticated`) and conditional 404/503 responses route properly. | `tests/integration/cache-headers.test.ts` & `scripts/ci-smoke-disabled.ts`. |
| **Database Connectivity** | `@neondatabase/serverless` (HTTP tagged queries) & `pg` (driver) | Query parameterization, SSL handshakes, and result shapes match expected schemas. | `tests/integration/db-queries.test.ts` against PostgreSQL 16 container. |
| **Cryptographic Integrity** | `node:crypto` (`createHmac`, `createHash`, `timingSafeEqual`, `randomBytes`) | PKCE challenges, state HMAC signatures, and constant-time equality checks execute identically. | `tests/unit/crypto.test.ts` (all test vectors passing). |
| **Static Prerendering** | Next.js App Router SSG | Root `/` prerendered into static build output without runtime dependencies. | `scripts/assert-static-root.ts` validating `.next/prerender-manifest.json`. |
| **ISR Compatibility** | Next.js cache revalidation | Build invoked with `bun run --bun next build` to satisfy Vercel ISR requirements. | Build verification in CI and Vercel build log inspection. |
| **Auth Modes** | `AUTH_MODE` (`disabled`, `development`, `production`) | Environment parsing and fail-closed behaviors remain enforced. | `tests/unit/config.test.ts` & `scripts/preflight.ts`. |

---

## 8. Benchmark Plan & Performance Expectations

### 8.1 Benchmark Measurement Plan

Measurements will be collected before and after the migration using identical benchmark environments:

| Metric Dimension | Measurement Context | Node 24 Baseline | Bun 1.4 Target |
| :--- | :--- | :--- | :--- |
| **Clean Dependency Install** | GitHub Actions clean cache (`bun install` vs `npm ci`) | *TBD / measure* | *TBD / measure* |
| **Next.js Build Duration** | `next build` execution time in CI | *TBD / measure* | *TBD / measure* |
| **Vitest Full Suite Execution** | All 5 unit & integration suites in CI | *TBD / measure* | *TBD / measure* |
| **Vercel Function Cold Start** | Vercel Function p95 invocation latency | *TBD / measure* | *TBD / measure* |
| **Routing Middleware Latency** | `src/proxy.ts` execution overhead | *TBD / measure* | *TBD / measure* |
| **Function Memory Usage** | Average / peak function memory consumption | *TBD / measure* | *TBD / measure* |

### 8.2 Database and Network Workload Considerations
While Bun runtime provides faster startup and lightweight execution, maintainers should note that:
- **Neon PostgreSQL Queries**: Queries executed over HTTP/TLS to Neon are bound primarily by network transit time and database query execution.
- **Discord API Interactions**: OAuth token exchange and guild membership checks are bound by Discord API response times.
- Overall user-perceived OAuth callback latency improvements will come primarily from function initialization and local compute rather than remote I/O.

---

## 9. Risk Register & Mitigations

| Risk ID | Risk Description | Severity | Likelihood | Mitigation Strategy |
| :--- | :--- | :--- | :--- | :--- |
| **R-01** | Vercel workspace feature or plan permissions prevent enabling `bunVersion: "1.4.x"`. | Medium | Low | Confirm `bunVersion` deployment behavior on a Vercel Preview branch prior to production merge. |
| **R-02** | Behavioral discrepancies in `node:crypto` `timingSafeEqual` or `Buffer` handling. | High | Very Low | Validate with `tests/unit/crypto.test.ts`, which tests invalid signatures, mismatched lengths, and malformed inputs. |
| **R-03** | Next.js prerender manifest format or static artifact mismatch during build. | High | Low | Enforce `scripts/assert-static-root.ts` in CI pipeline to fail the build if static `/` is missing. |
| **R-04** | Dual lockfile ambiguity during branch development. | Low | Low | Inspect Vercel build logs to verify Bun installer detection; remove `package-lock.json` before merge. |
| **R-05** | Routing Middleware is not configured with Vercel's required non-Edge runtime selector for Bun. | Medium | Low | Explicitly set `runtime: 'nodejs'` in `src/proxy.ts` `config` per Vercel Bun documentation. |

---

## 10. Operational Runbook: Rollout & Rollback Procedures

### 10.1 Production Rollout
1. Verify all CI steps pass on the migration branch.
2. Verify Preview deployment in `AUTH_MODE=disabled`.
3. Merge pull request to `main`.
4. Monitor Vercel deployment logs to ensure build completes and reaches `Ready`.
5. Execute live smoke tests on `https://teamham.world` (static home, redirect from `www`, and Discord OAuth login/logout).

### 10.2 Immediate Rollback Runbook
If an unexpected runtime regression occurs in production:

1. **Option A: Instant Vercel Rollback (Recommended)**:
   - Navigate to Vercel Dashboard -> `teamham-world` -> Deployments.
   - Select the previous successful Node.js deployment.
   - Click **Instant Rollback / Promote to Production**.
2. **Option B: Code-Level Reversion**:
   - In `vercel.json`, remove `"bunVersion": "1.4.x"` (do **not** change it to `"1.x"`).
   - In `src/proxy.ts`, revert `runtime: 'nodejs'`.
   - Restore `package-lock.json` from git history and revert `package.json` scripts.
   - Commit and push to `main`.

---

## 11. Effort Estimate & Acceptance Criteria

### 11.1 Effort Estimate
- **Implementation & Local Verification**: ~0.5 working day (lockfile generation, script updates, test verification, proxy config).
- **CI & Preview Deployment Validation**: ~0.5 working day (CI pipeline updates, preview verification, permissions check).
- **Post-Rollout Observation & Benchmarking**: 1–2 weeks passive monitoring.

### 11.2 Acceptance Criteria & Definition of Done
- [ ] `bun.lock` generated and committed to `teamham.world`.
- [ ] `packageManager: "bun@1.4.0"` and `bun` engine declared in `package.json`.
- [ ] `vercel.json` contains `"bunVersion": "1.4.x"`.
- [ ] `src/proxy.ts` declares `runtime: 'nodejs'` in `config`.
- [ ] GitHub Actions CI runs with `oven-sh/setup-bun@v2` (`1.4.0`) and passes lint, typecheck, unit tests, DB integration tests, gitleaks, build, static assertion, and HTTP smoke tests.
- [ ] Vercel Preview and Production deployments verified live.
- [ ] `package-lock.json` removed from `main` branch (available in git history).

---

## 12. Authoritative References & Official Sources

1. **Vercel Functions Bun 1.4 Support**: [https://vercel.com/changelog/bun-1-4-is-now-available-in-vercel-functions](https://vercel.com/changelog/bun-1-4-is-now-available-in-vercel-functions)
2. **Vercel Functions Bun Runtime Documentation**: [https://vercel.com/docs/functions/runtimes/bun](https://vercel.com/docs/functions/runtimes/bun)
3. **Vercel Configuration Reference (`bunVersion`)**: [https://vercel.com/docs/project-configuration/vercel-json#bunversion](https://vercel.com/docs/project-configuration/vercel-json#bunversion)
4. **Bun 1.4 Release Blog**: [https://bun.com/blog/bun-v1.4](https://bun.com/blog/bun-v1.4)
5. **Bun Official Documentation**: [https://bun.sh/docs](https://bun.sh/docs)
