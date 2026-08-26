# Member Page Personalization V2 Implementation Plan

**Document Status**: PLANNED / NOT IMPLEMENTED
**Target Stack**: Next.js 16.3.1, React 19.2.8, Node.js 24, TypeScript 5, Lakebase Postgres through the existing Neon HTTP driver, Cloudflare R2
**Authoritative Product Specification**: [Member Page Personalization V2 Specification](MEMBER_PAGE_PERSONALIZATION_V2_SPEC.md)

## 1. Status, scope, and reference to the specification

This document is the delivery plan for the V2 member-page system defined in `MEMBER_PAGE_PERSONALIZATION_V2_SPEC.md`. It sequences implementation, migration, infrastructure, verification, pilot, cutover, rollback, and later cleanup. It does not replace or reinterpret the product specification.

The current V1 member-page documents are marked **implemented in code / not yet deployed**. Therefore, implementation cannot assume that migrations `0005_member_pages.sql` and `0006_member_social_links.sql` or any V1 member-page rows exist in production. Phase 0 begins with a read-only production audit and records the actual starting state before code or schema decisions are finalized.

This plan does not authorize or execute a database migration, create Cloudflare resources, install dependencies, or deploy an application. Those actions require their normal reviewed implementation and operator approvals.

### 1.1 Existing boundaries retained

- Keep the existing Next.js application and `src/lib/members/` data-access boundary.
- Keep `/m/<slug>`, `/members`, `/admin/members`, the one-owner constraint, immutable slugs, and existing authentication/session model.
- Keep the runtime Postgres access path through `@neondatabase/serverless` tagged HTTP calls. Do not introduce an ORM or interactive-transaction abstraction.
- Keep V1 code available only as a temporary bridge where this plan explicitly requires fallback or dual-write.
- Keep the public homepage and directory contracts minimal; V2 does not add draft or personalization fields to their DTOs.

### 1.2 Mandatory Next.js implementation prerequisite

Before writing later application code, each implementer must read `AGENTS.md` and the relevant installed Next.js 16.3.1 guides under `node_modules/next/dist/docs/`. At minimum, the work owner must inspect the current local guidance for:

- Server and Client Components: `01-app/01-getting-started/05-server-and-client-components.md`;
- mutations, caching, and revalidation: `01-app/01-getting-started/07-mutating-data.md`, `08-caching.md`, and `09-revalidating.md`;
- Route Handlers and metadata: `01-app/01-getting-started/15-route-handlers.md` and `14-metadata-and-og-images.md`;
- forms and Server Actions: `01-app/02-guides/forms.md` and `server-actions.md`;
- authentication and data security: `01-app/02-guides/authentication.md` and `data-security.md`;
- CDN/cache behavior: `01-app/02-guides/cdn-caching.md` and `how-revalidation-works.md`; and
- package/client-boundary behavior: `01-app/02-guides/package-bundling.md` and `lazy-loading.md`.

Record any Next.js 16.3.1 constraints or deprecations that change the planned action, Route Handler, caching, or bundle boundaries before implementation proceeds.

## 2. Delivery principles and non-negotiable invariants

### 2.1 Delivery principles

1. **Audit before assumption** — Production schema and content determine whether V1 deployment or remote-artwork import work is required.
2. **Database before dependent application** — Migration `0007` is applied and verified before any bridge binary that requires its columns is deployed.
3. **Bridge before editor** — Deploy V2 read support, fallback, dual-write, moderation, and feature-flag enforcement with an empty allowlist before exposing the V2 editor.
4. **Tracer bullets before breadth** — Prove draft revision safety and publication state with a summary-only vertical slice before adding blocks, uploads, rich text, drag, or themes.
5. **One guarded statement per database transition** — Autosave, publish, reset, unpublish, takedown-and-hold, clear-hold, ready-asset finalization, and asset metadata deletion each use one SQL statement with all guards in `WHERE` and exact results in `RETURNING`.
6. **Fail closed** — Unknown documents, feature-flag mismatches, ownership mismatches, invalid assets, uncertain animation classification, and inconclusive cache revocation block the affected operation.
7. **Narrow dependencies** — Add only the specified focused packages after compatibility verification. Avoid an ORM, global state library, AWS SDK, native image stack, test service emulator, or background-job platform.
8. **Evidence-gated rollout** — No phase advances on informal confidence. Each checkpoint requires recorded automated and manual evidence.
9. **Temporary architecture is named and deletable** — Every bridge component has a deletion condition and later removal owner.

### 2.2 Non-negotiable invariants

- The R2 bucket remains private; there is no public R2 domain or object URL in a document.
- Production and non-production use separate private R2 buckets and separately scoped credentials. A Neon rehearsal branch, local instance, preview deployment, CI job, or VPS test must never use the production R2 bucket.
- Only the eligible assigned owner may read or mutate a draft or private asset.
- Administrators who are not the owner cannot select, receive, preview, or serve draft documents or non-public assets.
- A moderation hold blocks publication but permits owner editing, upload, autosave, preview, reset, and an already-idempotent unpublish action.
- Publish copies the complete frame and body to one published snapshot and updates `display_name`/`blurb` projection in the same guarded SQL statement.
- Website and supported social links remain fixed frame fields; they are not migrated into or replaced by an Additional links block.
- The page limit is 12 flat blocks. The asset limit is 20 **stored ready assets** per page, including the portrait; pending uploads do not count as ready.
- The public renderer reads only valid published V2 data or the temporary published legacy fallback. It never combines draft frame values with a published body.
- Public visitors and signed-in non-owners receive no TipTap, dnd-kit, inspector, upload, autosave, or other editor dependency in their client bundle.
- The server-side V2 rollout configuration separates **cohort authority** from **editor availability**. Cohort membership gates legacy rejection and remains sticky for pilot pages; a separate global kill switch may disable editor rendering and every owner/content V2 mutation without making those pages eligible for legacy editing. Administrator takedown/hold is a global safety control and remains available when the cohort is empty or the editor is disabled. Non-cohort pages remain on mandatory legacy dual-write until cutover.
- Autosave and reset do not invalidate public caches. Publish, unpublish, and takedown invoke the chosen public invalidation path only after the guarded database transition succeeds.
- Do not claim immediate shared-cache asset revocation until the selected application/CDN behavior is demonstrated. Use conservative response headers until that gate passes.

## 3. Work graph and parallel lanes

### 3.1 High-level dependency graph

```text
Phase 0: local-guide review + production audit + dependency/config decisions
                                  |
                                  v
Phase 1: V2 document core + legacyToDoc + Paper registry + feature flag
                                  |
             +--------------------+--------------------+
             |                    |                    |
             v                    v                    v
Phase 2A: migration 0007   Phase 2B: bridge code   Phase 2C: moderation
             |             renderer + dual-write    admin-only lane
             |                    |                    |
             +--------------------+--------------------+
                                  |
             +--------------------+--------------------+
             |                                         |
             v                                         v
Phase 2D: private R2 provisioning/config        Phase 2E: theme token lane
             |                                  Paper first; others parallel
             +--------------------+--------------------+
                                  |
                                  v
Checkpoint C1: production DB -> empty-allowlist bridge -> all-page parity
                                  |
                                  v
Phase 3: owner editor tracer slices 1-7 (serial)
                                  |
                 +----------------+----------------+
                 |                                 |
                 v                                 v
Checkpoint C2: Paper pilot             Slice 8: remaining themes/integration
5-10 pages, two weeks                            may overlap pilot
                 |                                 |
                 +----------------+----------------+
                                  |
                                  v
Checkpoint C3: all evidence + all four themes -> flag `all`
                                  |
                                  v
Observation -> temporary-code cleanup -> later migration 0008
```

### 3.2 Serial blockers

- Phase 0 production audit blocks migration design and determines whether artwork importer work exists.
- Shared V2 types, validator, `legacyToDoc()`, Paper registry skeleton, and flag parser block migration fixtures, bridge reads, and dual-write.
- Migration `0007` production verification blocks the bridge production deployment.
- Empty-allowlist bridge deployment and all-page Paper parity block any production pilot.
- Draft autosave/revision conflict proof blocks publication and the rest of the editor.
- Asset verification and cache-authorization evidence block image/portrait/gallery use in the pilot.
- All four themes and contrast artifacts block general cutover, but not a Paper-only pilot.
- Once any V2-only content is published, the bridge release becomes the minimum rollback floor.

### 3.3 Parallel lanes

- After Phase 1 contracts stabilize, migration SQL, bridge renderer/dual-write, admin moderation, R2 provisioning, and non-Paper theme design tokens may proceed in parallel.
- Admin moderation does not depend on editor UI and should be completed immediately after the migration contract exists.
- Newsprint, Blueprint, and Riso implementation may proceed while the Paper editor tracer slices are built, but editor integration occurs only after core editor behavior is stable.
- Automated test fixtures and manual evidence checklists should be authored alongside each lane, not deferred to cutover.

## 4. Phase 0 — foundation and read-only audit

### 4.1 Confirm repository and runtime baseline

**Owner**: implementation lead
**Mode**: read-only

Confirm and record:

- Node engine remains `>=24 <25` and the implementation runtime is Node 24;
- `next` is 16.3.1, `react`/`react-dom` are 19.2.8;
- runtime SQL still flows through `getDbClient()` and Neon HTTP outside loopback development;
- the current member-page routes, DAL, V1 editor, admin forms/actions, migration files, tests, and preflight behavior match the inventory in this plan; and
- the local Next.js guides listed in section 1.2 have been reviewed before code changes begin.

**Output**: a short implementation record attached to the first V2 code change listing exact versions, local guides read, and any changed Next.js API assumptions.

### 4.2 Read-only production database audit

**Owner**: Neon/database operator
**Mode**: read-only owner connection; no migration, table write, or role change

Follow the target-verification and credential-handling rules in `docs/NEON_MIGRATIONS.md`. Query production metadata and content only after confirming the expected TeamHam project and `production` branch.

The audit must determine:

1. whether the schema effects of `0005_member_pages.sql` exist, including `accounts.site_role`, `member_pages`, required columns, constraints, index, and runtime grants;
2. whether the schema effects of `0006_member_social_links.sql` exist, including `social_links`, its object constraint, and runtime grants;
3. whether either migration is absent, fully present, or partially/drifted;
4. total `member_pages` row count;
5. published and unpublished row counts;
6. showcase counts by `kind` (`project`, `external`, null/other);
7. count of external showcases with a non-empty `imageUrl` remote artwork value;
8. page IDs/slugs requiring artwork handling, without printing remote URLs or member-authored private content into logs; and
9. malformed or unexpected current rows that fail the existing V1 parser.

The audit result selects one prerequisite sequence:

| Audit state | Required migration sequence before bridge deployment |
|---|---|
| `0005` and `0006` fully present | Rehearse/apply `0007` only. |
| `0005` present, `0006` absent | Rehearse/apply unchanged `0006`, then `0007`. |
| `0005` and `0006` absent | Rehearse/apply unchanged `0005`, then `0006`, then `0007`. |
| Either migration partially present/drifted | Stop. Diagnose and commit a reviewed remediation; do not continue to `0007`. |

Each required migration file is applied and verified in order under the runbook. Do not combine files ad hoc or make `0007` silently recreate partially missing V1 objects.

**Exact audit output**:

- verified Neon organization/project/branch names and IDs;
- `0005`: `present`, `absent`, or `drifted`, with missing object names;
- `0006`: `present`, `absent`, or `drifted`, with missing object names;
- row counts: total, published, unpublished;
- showcase counts by category;
- remote-artwork count and affected page identifiers;
- malformed-row count and remediation status; and
- importer decision: `not required` when the remote-artwork count is zero, otherwise `required and blocking`.

Do not expose connection strings, full artwork URLs, draft-like member content, or Discord/account identifiers in the audit report.

### 4.3 Establish visual and metadata baseline

**Owner**: implementation lead with design/accessibility reviewer
**Mode**: read-only public capture

For every currently published page, capture the public V1 baseline needed for parity:

- rendered display name, summary, website/social placement, showcase facts/artwork, and order;
- page title, metadata description, canonical URL, and public 404 behavior for an unknown/unpublished page;
- representative desktop and mobile screenshots; and
- directory/homepage projection values and ordering.

If there are no production rows, record that parity will be fixture-based plus a reviewed seeded rehearsal page. Do not invent production content.

### 4.4 Dependency compatibility check

**Owner**: implementation lead
**Mode**: no installation yet

Verify current published package versions and peer/runtime requirements against Next 16.3.1, React 19.2.8, Node 24, TypeScript 5, and the repository's bundler before changing `package.json` or the lockfile. The allowed set is:

- `@tiptap/core`;
- `@tiptap/react`;
- `@tiptap/starter-kit`;
- `@tiptap/extension-link`;
- `@dnd-kit/core`;
- `@dnd-kit/sortable`;
- `@dnd-kit/utilities`;
- `aws4fetch`; and
- `image-size`.

Confirm whether each package ships its own TypeScript declarations. Do not add redundant `@types/*` packages. Record resolved versions and any compatibility concern before installation.

### 4.5 Infrastructure/configuration readiness decisions

**Owner**: release operator and Cloudflare operator

Produce an environment map with:

- one private production R2 bucket;
- one separate private non-production R2 bucket;
- the app environments allowed to use each bucket;
- separate bucket-scoped tokens/credentials;
- exact allowed upload origins for production and non-production CORS;
- confirmation that no bucket has a public domain; and
- a fail-closed rule preventing production-bucket configuration in local, preview, CI, VPS, or Neon-rehearsal work.

Also assign owners for unresolved launch inputs:

- curated Newsprint/Blueprint/Riso semantic tokens and accent IDs;
- contrast evidence format;
- centralized content/node/collection limits left open by the specification;
- cache invalidation/revalidation proof; and
- reassignment warning copy and review.

### 4.6 Phase 0 exit gate

Phase 1 may start only when:

- the production schema/content audit is recorded;
- any schema drift has an explicit remediation plan;
- the remote-artwork importer decision is known;
- all allowed dependencies have a compatibility decision;
- production/non-production R2 isolation has an operator-approved design;
- baseline parity evidence exists or a fixture-only reason is recorded;
- cache revocation is identified as a pre-pilot proof item rather than assumed; and
- owners are assigned for theme tokens, limits, R2 credentials, and accessibility evidence.

## 5. Phase 1 — document core, validation, conversion, themes, and flag

### 5.1 Create the shared V2 document core

Add a server/client-safe type module for the exact V2 document, frame, image reference, project union, block unions, rich-text AST types, and schema version. Keep it free of database, Next.js, TipTap, dnd-kit, and R2 imports.

Likely planned modules:

- `src/lib/members/v2/document.ts` — types, discriminators, schema version;
- `src/lib/members/v2/limits.ts` — centralized scalar, collection, serialized-size, and rich-text node limits;
- `src/lib/members/v2/validation.ts` — strict unknown-to-typed parsers and field/block error model;
- `src/lib/members/v2/rich-text.ts` — closed AST types, validator, and server rendering helpers; and
- `src/lib/members/v2/asset-references.ts` — pure extraction of referenced asset IDs from a validated document.

Use the current validation style: plain-object checks, allowed-key checks, explicit unions, trimmed text, absolute HTTPS URLs, and fail-closed results. Define final centralized limits before pilot; do not scatter magic numbers across editor and server modules.

### 5.2 Implement `legacyToDoc()`

Add one pure deterministic conversion function, likely `legacyToDoc()`, that converts the existing validated V1 content into a Paper V2 document:

- preserve display name and summary;
- preserve website/socials in the frame;
- set portrait null;
- select Paper/default accent;
- map a current showcase to one featured-project block; and
- accept an optional already-imported artwork asset ID for an external showcase rather than writing an image URL.

The function must not perform database, R2, network, Open Graph, or random-ID work. Supply deterministic IDs through a conversion input/helper so SQL and TypeScript fixtures can compare exact documents.

Add fixtures for:

- no showcase;
- HAM project showcase;
- external project without artwork;
- external project with a supplied imported asset ID;
- all supported socials;
- null/empty optional values; and
- every current project status.

### 5.3 Build the theme registry skeleton

Create a closed shared registry with theme IDs, accent IDs, default accent, semantic token names, and enabled state.

- Implement Paper first using current tokens and current appearance.
- Include Newsprint, Blueprint, and Riso registry slots without enabling unreviewed token mappings.
- Validation must reject disabled or unknown theme/accent pairs.
- The public renderer and editor consume registry values; documents never contain raw colors.
- Paper and the registry skeleton block migration, bridge rendering, and the pilot.
- Non-Paper theme token/component work may continue in parallel after this contract stabilizes; all three must be enabled with contrast evidence before C3.

### 5.4 Implement server-side rollout cohort and kill switch

Add a fail-closed environment parser, likely in `src/lib/members/v2/feature-flag.ts`, for two independent controls:

- `MEMBER_PAGE_V2_ALLOWLIST` defines the V2-authoritative cohort: empty or unset means no cohort; comma-separated immutable member slugs select pilot pages; the exact sentinel `all` selects every assigned page;
- `MEMBER_PAGE_V2_EDITOR_DISABLED` is a strict server-side boolean kill switch: `true` hides the editor and rejects V2 owner/content mutations without changing cohort membership;
- `all` cannot be combined with individual slugs;
- invalid/reserved/mixed-case entries fail configuration validation rather than being ignored; and
- the parsed result is server-only and never trusted from the client.

Likely helpers:

- `getMemberPageV2Rollout()`;
- `isMemberPageV2Cohort(slug)`;
- `isMemberPageV2EditorEnabled(slug)`; and
- `requireMemberPageV2EditorEnabled(slug)`.

The cohort and kill switch have different enforcement responsibilities:

- editor rendering, draft load, autosave, publish, unpublish, reset, upload allocation/finalize, private asset management, and every other V2 owner/content mutation require both cohort membership and an enabled editor;
- legacy owner-save and legacy administrator-publication actions reject every cohort page even when the editor kill switch is active; and
- emptying or changing the cohort after V2-only edits exist is prohibited unless a reviewed migration preserves those documents and explicitly changes the page's authoritative editor mode.

Public V2 parsing/rendering and administrator moderation are not disabled by an empty cohort or the editor kill switch.

### 5.5 Phase 1 acceptance

- Every valid specification fixture parses to one canonical typed document.
- Unknown keys, nodes, marks, blocks, variants, themes, accents, asset-ref states, and excess limits fail with typed errors.
- `legacyToDoc()` is deterministic and keeps website/socials in the frame.
- Paper fixtures preserve V1 public content and ordering.
- Rollout parsing covers empty, one/many slugs, duplicates, invalid slugs, `all`, invalid combinations, kill-switch states, and the rule that cohort pages remain rejected by legacy mutations while disabled.
- No Phase 1 module imports editor dependencies into the public renderer path.

## 6. Phase 2 — migration, bridge, dual-write, moderation, and R2 provisioning

Phase 2 begins after Phase 1 contracts stabilize. Lanes 2A-2E are parallel where shown, but C1 requires all bridge-critical lanes to converge.

### 6.1 Lane 2A — additive migration `0007`

Add planned `migrations/0007_member_page_personalization_v2.sql` with:

- additive V2 columns on `member_pages`;
- shallow JSON/state constraints;
- revision and timestamp defaults/backfill;
- `moderation_hold` state and its consistency constraint;
- `member_page_assets` metadata table, indexes, foreign keys, status checks, size/dimension checks, and a nullable deletion-claim marker for cross-service retry safety;
- exact least-privilege `app_runtime_role` grants; and
- a deterministic SQL backfill for every current page.

The backfill uses `jsonb_build_object`/equivalent SQL construction matching `legacyToDoc()` fixtures. It initializes:

- published rows with matching `draft_doc` and `published_doc`;
- unpublished rows with `draft_doc` and no fabricated historical published snapshot;
- Paper/default accent;
- current website/socials in the frame; and
- showcase as featured project.

Do not place remote artwork URLs in V2 JSON. If Phase 0 found remote artwork, the SQL backfill may create the otherwise complete external-project block without artwork, but the conditional importer must fill verified asset IDs before parity or application deployment. This temporary database-only state is never exposed publicly.

Test the SQL transformation against the same conceptual fixtures as `legacyToDoc()` using the real PostgreSQL integration harness. Parse every SQL-generated document through the shared TypeScript validator and compare exact normalized values.

### 6.2 Lane 2B — public renderer, fallback, and mandatory dual-write

Refactor public rendering into shared V2 frame/block components and a server-only reader:

- query valid `published_doc` for currently published pages;
- parse before rendering;
- render JSON to React without `dangerouslySetInnerHTML`;
- derive metadata and directory projection from published state only; and
- keep editor dependencies outside the public import graph.

The bridge release includes a temporary legacy fallback:

1. render a valid V2 published document when present;
2. otherwise render the existing published V1 fields through the current public presentation;
3. record a coarse fallback counter/diagnostic without logging content; and
4. never fall back from a private draft or expose draft data.

Before pilot, every published production page must use a valid V2 document and the fallback count must be zero for the audited page set. Keep fallback code through the observation/rollback period.

Mandatory legacy dual-write applies to every non-pilot page:

- Legacy owner save first validates existing V1 input, converts it with `legacyToDoc()`, and uses one guarded SQL statement.
- The statement updates old V1 columns and `draft_doc`/`draft_rev`.
- If the page is currently published, the same statement also updates `published_doc` and projection to preserve V1 immediate-public behavior.
- If the page is unpublished, it does not create a public snapshot.
- A V2-enabled/pilot page is rejected before legacy mutation SQL executes.
- Temporary legacy administrator publish/unpublish is rejected for V2-enabled pages and dual-writes consistent V2 publication state for non-pilot pages.

Add explicit tests proving a page cannot be accepted by both mutation systems.

### 6.3 Lane 2C — administrator moderation

Implement moderation after the migration contract is available; it does not wait for the owner editor.

- Add **Take down and hold** and **Clear hold** controls to `/admin/members`.
- Takedown-and-hold is one guarded update that sets non-public and held state and returns only operation metadata.
- Clear-hold is one guarded update that clears the hold and leaves the page unpublished.
- Admin list/read queries select state metadata and published projection only; they do not select `draft_doc`, draft revisions beyond operational need, private asset lists, or object keys.
- The admin UI has no draft preview, asset browser, or draft-image route.
- Hold does not appear in the owner autosave/reset `WHERE` guard; publish checks it.

This lane may ship in the empty-allowlist bridge release.

### 6.4 Lane 2D — R2 provisioning and storage adapter

**Operator-owned provisioning**:

- Create one private production bucket and one separate private non-production bucket.
- Create separate tokens scoped to the exact bucket and required object operations.
- Do not configure a public domain, anonymous read, or wildcard cross-environment credential.
- Configure CORS only for the exact required production/non-production upload origins, `PUT`, and the required `Content-Type` request header. Do not add broad methods, wildcard origins, or public reads.
- Record bucket identifiers and credential ownership without committing secrets.
- Add an environment-class assertion so production credentials/bucket cannot be loaded by a non-production app and vice versa.

**Application adapter**:

- Use `aws4fetch` for SigV4 signing/presigning and native `fetch` request/response streams.
- Do not add the AWS SDK.
- Keep object keys random and server-only outside the scoped presigned upload request.
- Use one non-public adapter interface for allocate/presign, head/range get, full get, and delete so tests can inject a narrow fake `fetch` function without MSW or MinIO.

The bridge may include validated configuration and adapter tests with no exposed upload UI. If importer work is required, non-production R2 must be available before rehearsal import and production R2 before production import.

### 6.5 Lane 2E — theme work

- Paper and the registry skeleton are serial requirements for C1 and the pilot.
- Newsprint, Blueprint, and Riso token mapping, renderer states, responsive behavior, and contrast artifacts may proceed in parallel.
- Do not enable a theme until all accent pairs, focus states, text/link/control contrast, and representative blocks pass review.
- Keep all themes light and inside fixed HAM frame behavior.

### 6.6 Phase 2 asset-verification design

Complete the verification module before the asset editor slice:

1. Read object metadata/size from R2.
2. Request a format-appropriate byte range and identify the format through strict magic bytes, not extension or submitted MIME.
3. Verify claimed/stored MIME consistency.
4. Use `image-size` for pure-JavaScript dimensions when enough bytes are available.
5. Increase the requested range when the format parser or `image-size` needs more bytes.
6. Fall back to fetching the complete object, bounded by the 5 MB limit, when a header range is insufficient.
7. Perform narrow custom static-animation checks:
   - reject PNG containing an APNG animation control chunk;
   - reject WebP with animation signaling/chunks;
   - reject AVIF when its ISO-BMFF item/track structure indicates an image sequence or animation;
   - reject rather than guess when the parser cannot confidently classify a file as static.
8. Verify neither dimension exceeds 4000 pixels and the object is no larger than 5 MB.
9. Delete invalid objects and remove/expire their pending metadata through a guarded cleanup statement. If object deletion fails, keep recoverable pending metadata for opportunistic retry rather than marking the asset ready.

Do not assume or document that a 4 KB prefix always suffices. Range size is format/input dependent and must be covered by fixtures that exercise larger metadata/header layouts and full-fetch fallback.

Valid finalization performs R2 verification first, then one guarded SQL update that:

- binds the pending asset to the exact page/owner;
- checks pending expiry/state;
- enforces fewer than 20 existing ready assets for that page;
- writes verified MIME/size/dimensions; and
- changes status to ready with `RETURNING`.

Asset deletion must claim the row before touching R2. The minimal planned protocol is:

1. one guarded SQL update sets a nullable deletion marker only when the owner/page match and neither document references the asset, then returns the object key;
2. document validation, allocation, and asset serving treat a claimed row as non-referenceable/non-servable;
3. delete the R2 object;
4. delete the claimed metadata row with one guarded statement; and
5. if R2 deletion fails, retain the claim for opportunistic retry instead of restoring readiness or losing the object key.

Do not delete the R2 object before the database claim, and do not delete the only metadata record before a recoverable R2 deletion attempt. Test a concurrent autosave/reference attempt against the claim guard.

### 6.7 Phase 2 acceptance

- Migration fixtures and `legacyToDoc()` produce equivalent validated documents.
- Public V2 rendering has no editor dependency in its import/bundle graph.
- Legacy saves always dual-write and cannot mutate pilot-enabled pages.
- Pilot-enabled pages cannot use legacy admin publication.
- Moderation hold/takedown works without selecting or changing drafts.
- Production/non-production R2 buckets, tokens, and CORS are demonstrably isolated.
- Asset verification fixtures cover all allowed formats, spoofing, larger ranges, full-fetch fallback, dimensions, size, APNG, animated WebP, animated AVIF, and uncertain classification.

## 7. Checkpoint C1 — deployment order and parity gate

### 7.1 Required deployment order

1. Complete code review and local/real-Postgres verification for migration `0007` and bridge code.
2. Rehearse every prerequisite selected by the Phase 0 audit (`0005`, `0006`, then `0007` as applicable) on a fresh expiring Neon branch from production.
3. If importer work is required, run its dry-run and import rehearsal against the rehearsal database and **non-production R2 only**.
4. Verify rehearsal schema, grants, backfill, validator results, runtime-role paths, importer results, and rollback assumptions.
5. Obtain explicit production migration authorization.
6. Recheck production for drift immediately before execution.
7. Apply and verify each required unchanged prerequisite migration in order, ending with `0007`, before deploying dependent application code.
8. If required, run the reviewed production artwork import against production DB and production R2, then validate every affected document/asset before application deployment.
9. Deploy the bridge release with `MEMBER_PAGE_V2_ALLOWLIST` empty.
10. Confirm V2 editor UI and V2 owner mutations are unavailable while public V2 parsing/rendering, fallback, legacy dual-write, moderation, and flag checks are active.
11. Exercise one non-pilot legacy save and publication transition to prove mandatory dual-write in production.
12. Run parity comparison across every published production page.

### 7.2 Parity gate

C1 passes only when:

- every production page has a valid `draft_doc`;
- every currently published page has a valid `published_doc`;
- no published page relies on the temporary fallback;
- Paper rendering preserves frame content, website/social placement, showcase/project content, artwork, order, directory projection, and metadata;
- legacy save/admin publication dual-write is proven on a non-pilot page;
- moderation actions work and administrator responses contain no draft/private-asset data;
- the V2 allowlist is empty and all V2 owner mutations fail closed;
- public/non-owner bundles contain no editor dependencies; and
- database/R2 production configuration is isolated from all non-production environments.

Any parity discrepancy blocks the pilot. Keep the empty allowlist, correct conversion/rendering/import data, and repeat the complete affected-page comparison.

## 8. Phase 3 — owner editor tracer bullets

Build the owner editor in the following order. Do not start later slices by bypassing acceptance for an earlier state transition.

### 8.1 Slice 1 — summary-only draft load, autosave, and revision conflict

**Purpose**: prove private reads, local immediacy, single-flight autosave, and optimistic conflict handling with the smallest useful field.

Likely planned changes:

- owner-only draft reader in `src/lib/members/v2/dal.ts`;
- guarded autosave mutation in `src/app/m/[member]/v2-actions.ts` or the current Next 16.3.1-approved equivalent;
- minimal client shell in `src/components/member-page-editor/editor-shell.tsx`;
- feature-flag checks at editor render and action entry; and
- autosave state/revision unit tests.

Acceptance:

- enabled owner loads only their latest draft and revision;
- non-owner/admin-non-owner cannot read it;
- summary changes render locally immediately;
- autosave is debounced and single-flight;
- one guarded SQL statement replaces the complete validated draft and increments revision;
- two tabs with the same revision produce one success and one typed conflict without silent overwrite;
- autosave failure preserves local state and exposes retry;
- no public page, projection, metadata, or cache invalidation changes; and
- empty/nonmatching feature flag rejects load and mutation.

### 8.2 Slice 2 — publish, unpublish, and reset

Add owner actions using complete-document validation even though the visible editor is still small.

Acceptance:

- publish flushes autosave and checks the expected revision;
- one SQL statement copies the complete draft to `published_doc`, sets publication state, and updates `display_name`/`blurb` projection atomically;
- publish fails on hold, invalid document, wrong owner, stale revision, or nonmatching feature flag;
- unpublish is one guarded statement and retains both documents;
- reset is one guarded statement, works while held, increments revision, and does not publish;
- owner/public views never mix draft and published frame/body values; and
- public invalidation occurs only after successful publish/unpublish, using the current verified Next.js mechanism.

### 8.3 Slice 3 — block shell, live canvas, inspector, and explicit move controls

Build the thin React block shell without drag-and-drop first:

- shared public frame/block renderer components;
- editor wrappers for selected/focus/error state;
- desktop canvas and pinned inspector;
- add, duplicate, delete/undo, Move up, and Move down controls;
- stable block/entry IDs and polite reorder announcements; and
- mobile-safe basic inspector behavior before final bottom-sheet polish.

`draft_doc` remains a canonical V2 document and autosave remains server-validated. Do not introduce undocumented draft-only block discriminators or persist structurally incomplete required-content blocks. For a block whose specification requires an initial project, link, asset, or gallery set, the **Add block** flow keeps creation state transient in the client and inserts the block only after enough valid content exists. If persistable incomplete blocks are required for the intended UX, amend the product specification and shared schema before Phase 1 rather than creating a second implicit draft format during editor implementation.

Acceptance:

- actual public components render inside the editor canvas;
- the stored flat order is the public DOM/read order;
- add/duplicate cannot exceed 12 blocks;
- adding a required-content block cannot autosave an invalid placeholder document;
- explicit movement is keyboard/touch/pointer operable without drag;
- deletion does not delete assets;
- selected, focus, and error states are distinct; and
- all block operations autosave through the existing single-flight/revision path.

### 8.4 Slice 4 — typed frame and non-asset blocks

Add typed inspectors/renderers for:

- remaining frame fields: display name, website, supported socials, Paper theme/accent;
- featured project;
- project list;
- Additional links;
- callout/quote; and
- image/gallery schema entries kept unavailable until the asset slice.

Acceptance:

- website/socials stay in the fixed frame and publish only with the complete document;
- one featured-project limit is enforced;
- HAM project facts resolve from the registry and external projects use validated HTTPS links;
- block variants are closed enums with no layout/style escape hatch;
- frame/body publish together; and
- migrated V1 showcase remains render-equivalent as featured project.

### 8.5 Slice 5 — R2 assets, portrait, image, and gallery

Add browser normalization and owner asset flows:

- client decode/orient/downscale/re-encode module that strips source metadata;
- upload-allocation Route Handler/action;
- direct presigned `PUT` client;
- finalize mutation using the Phase 2 verifier;
- same-origin asset GET route;
- explicit delete operation with dual-document reference guard;
- optional portrait inspector;
- image block and gallery inspectors/renderers; and
- opportunistic pending cleanup on owner asset operations.

Likely planned routes/modules:

- `src/app/api/member-page-assets/uploads/route.ts`;
- `src/app/api/member-page-assets/[assetId]/finalize/route.ts`;
- `src/app/member-assets/[assetId]/route.ts`;
- `src/lib/members/assets/config.ts`;
- `src/lib/members/assets/r2.ts`;
- `src/lib/members/assets/verify.ts`;
- `src/lib/members/assets/animation.ts`; and
- `src/lib/members/assets/dal.ts`.

Acceptance:

- only the enabled eligible owner can allocate/finalize/manage assets for their page;
- production/non-production credentials cannot cross environments;
- allowed static JPEG/PNG/WebP/AVIF pass; SVG/GIF, spoofed, animated, oversized, over-dimension, or uncertain files are rejected and deleted/queued for opportunistic cleanup;
- range verification expands or full-fetches when required;
- finalization uses one guarded quota/state statement;
- 20 means stored ready assets and includes portrait;
- documents contain asset IDs only;
- draft/non-public assets are owner-only/no-store and everyone else receives `404`;
- deletion fails while either document references the asset; and
- no pilot image use begins until public cache/revocation behavior passes the gate in section 8.9.

### 8.6 Slice 6 — TipTap rich text

Install/use only the approved TipTap packages and configure StarterKit to the specification's closed AST:

- paragraphs;
- H2/H3 only;
- bold/italic;
- absolute HTTPS links;
- ordered/unordered lists; and
- block quotes.

Disable/reject unsupported StarterKit nodes and marks. Convert editor JSON through the same strict validator used by public rendering; never store or render HTML/Markdown.

Acceptance:

- malformed or unsupported TipTap JSON fails server validation;
- H1, code, tables, embeds, raw HTML, and unknown extensions cannot persist;
- links are HTTPS-only and credential-free;
- server rendering is JSON-to-React without `dangerouslySetInnerHTML`;
- TipTap is loaded only for an enabled owner editing a rich-text block; and
- public/non-owner bundle inspection finds no TipTap package.

### 8.7 Slice 7 — drag enhancement, mobile editor, and accessibility completion

Add dnd-kit as an enhancement over explicit movement:

- visible drag handles;
- pointer/touch and keyboard sortable behavior;
- desktop pinned inspector completion;
- accessible mobile bottom-sheet inspector;
- persistent mobile Edit/Preview mode;
- virtual-keyboard and focus-return handling;
- complete live-region announcements;
- reduced-motion behavior; and
- error-summary/focus handling for publish.

Acceptance:

- drag and explicit controls produce identical order;
- drag is never required;
- the full editor works at 375 CSS pixels without horizontal scrolling;
- bottom-sheet focus and return behavior is correct;
- keyboard-only, touch, screen-reader, 200% text zoom, and reduced-motion flows pass;
- all targets meet 44 by 44 CSS pixels; and
- public bundles still exclude editor dependencies.

### 8.8 Slice 8 — remaining themes

After the editor/theme contract is stable, integrate Newsprint, Blueprint, and Riso into canvas and public rendering. Theme token/component work may have proceeded in parallel, but integration follows the established editor state path.

Acceptance:

- all four themes are light, HAM-contained, and use only curated accents;
- theme/accent changes remain private until publish;
- all frame and block states render in each theme;
- focus, text, controls, links, errors, and muted text have recorded WCAG 2.2 AA evidence; and
- no raw colors or member styling controls enter the document.

Slice 8 is not required to start a Paper-only pilot if slices 1-7 and every C2 gate pass, but it is a hard requirement for general cutover.

### 8.9 Public asset cache/revocation pre-pilot gate

Choose the cache strategy only after reading the installed Next.js cache/CDN guides and testing the actual deployment platform.

Required proof:

- a published asset can be requested anonymously through the same-origin route;
- after owner unpublish or administrator takedown, subsequent anonymous requests from shared-cache and fresh-client contexts receive `404` rather than cached bytes;
- owner requests still receive private/no-store bytes where allowed;
- cache keys do not vary incorrectly by cookie or leak private content; and
- publish makes newly referenced ready assets available only after the public transition.

Default conservatively:

- private/non-public responses: `private, no-store` with cookie variation as required;
- public responses: no long-lived or immutable shared-cache lifetime until purge/tag/revalidation behavior is proven;
- if proof is inconclusive, use `no-store` for public assets, do not claim the specification's cacheability criterion, and block the image-enabled pilot until a demonstrably safe cache strategy is available.

Do not state “immediate cache revocation” in release evidence based only on calling a framework invalidation API. Verify the externally observed response behavior.

## 9. Checkpoint C2 — production pilot, kill switch, evidence, and rollback floor

### 9.1 Pilot entry gate

Before establishing the pilot cohort and enabling the editor, require:

- C1 parity passed for every published page;
- slices 1-7 passed for the Paper theme;
- migration, dual-write, flag, owner/admin authorization, state, and asset tests passed;
- public asset cache/revocation proof passed, with designated pilot coverage for portrait/image/gallery flows;
- no editor dependencies in public/non-owner bundles;
- WCAG evidence for the complete Paper owner flow;
- no known draft loss, access leak, or cache leak; and
- a tested kill-switch deployment procedure.

### 9.2 Pilot operation

- Select 5-10 production pages/owners.
- Set `MEMBER_PAGE_V2_ALLOWLIST` to those immutable slugs, set `MEMBER_PAGE_V2_EDITOR_DISABLED=false`, and deploy.
- Confirm each allowlisted owner sees V2 and every non-pilot owner remains on the dual-writing legacy editor.
- Confirm legacy owner save and legacy admin publication reject each allowlisted page.
- Run for two weeks.
- Collect structured incident/evidence notes without adding member-facing analytics.
- Exercise draft save, conflict, publish, unpublish, reset, image privacy where enabled, and moderation with designated pilot accounts.

### 9.3 Kill switch

The kill switch is `MEMBER_PAGE_V2_EDITOR_DISABLED=true` followed by deployment/config activation. Keep `MEMBER_PAGE_V2_ALLOWLIST` unchanged so prior pilot pages remain V2-authoritative and continue to reject lossy legacy owner/admin publication paths.

Expected behavior:

- V2 editor rendering disappears;
- every V2 mutation rejects fail-closed;
- existing V2 `published_doc` pages continue through the bridge public renderer;
- drafts/assets remain stored and private;
- moderation remains available;
- cohort membership remains intact, so no pilot page is routed to a lossy legacy save path; and
- non-pilot legacy dual-write continues.

Do not empty the cohort after any pilot page has accepted V2-only edits unless a reviewed migration explicitly changes that page's authoritative editor mode without data loss.

Test the kill switch in non-production and in the production pilot setup before pilot sign-off.

### 9.4 Evidence collection

Record during the two-week pilot:

- draft conflict/failure incidents and whether local/server content was preserved;
- any wrong-owner/admin/private-asset access attempt result;
- cache behavior after every tested unpublish/takedown;
- desktop/mobile completion and assistive-technology findings;
- moderation hold behavior, including continued editing/reset;
- R2 ready/pending counts and quota behavior without making pricing claims;
- fallback use and legacy dual-write health; and
- all defects, severity, owner, fix, and retest evidence.

Any draft loss, unauthorized access, private asset leak, or stale public asset after an asserted revocation is a stop-ship issue. Empty the allowlist and return to the bridge behavior while investigating.

### 9.5 Rollback floor

Once a pilot owner publishes any V2-only content, never roll back to a pre-V2 binary. The minimum safe rollback is the C1 bridge release that:

- understands V2 documents;
- publicly renders existing V2 snapshots;
- keeps legacy dual-write for non-pilot pages;
- enforces feature flags;
- retains moderation; and
- does not expose the V2 editor when the allowlist is empty.

Database and R2 data remain in place during rollback. Do not down-convert V2 blocks to V1 showcase columns.

## 10. Checkpoint C3 — general cutover, observation, cleanup, and migration `0008`

### 10.1 General cutover gate

Require all of the following:

- complete all-page migration/render parity;
- two-week pilot completed without unresolved draft loss, access leaks, or cache leaks;
- all automated and manual evidence in section 14 passed;
- all four themes and curated accents enabled with contrast artifacts;
- desktop/mobile, keyboard, screen reader, touch, zoom, and reduced-motion flows complete;
- public visitors receive no editor dependency bundle;
- moderation behavior and admin draft privacy verified;
- public asset authorization/caching behavior proven;
- mandatory non-pilot legacy dual-write remained healthy through pilot; and
- rollback to the bridge release is still deployable.

### 10.2 Cutover action

- Set `MEMBER_PAGE_V2_ALLOWLIST=all`, set `MEMBER_PAGE_V2_EDITOR_DISABLED=false`, and deploy.
- Verify every assigned owner receives V2 and every legacy owner/admin publication path rejects all pages.
- Keep bridge fallback, dual-write code, feature flag, legacy columns, and rollback deployment available during the observation period even though normal traffic no longer uses legacy editing.
- Continue monitoring fallback counters, validation failures, draft conflicts, moderation, asset authorization, and cache behavior.

### 10.3 Observation and cleanup release

After a maintainer-approved observation period with no need to return selected pages to legacy behavior:

1. remove the legacy owner editor UI/action;
2. remove temporary legacy administrator publish/unpublish controls;
3. remove dual-write branches and legacy-only mutation tests;
4. remove the public renderer's legacy fallback after proving all published rows contain valid V2 documents;
5. remove or simplify the allowlist once `all` is permanent and no kill-switch requirement remains;
6. remove conditional artwork importer/audit tooling that is no longer operationally needed; and
7. keep `display_name` and `blurb` as the published directory/SEO projection.

Do not combine this application cleanup with destructive database migration `0008` unless the independent migration gate is satisfied.

### 10.4 Later migration `0008`

Plan a separate reviewed `migrations/0008_drop_legacy_member_page_content.sql` only after all application reads/writes and rollback plans no longer use legacy-only columns.

Expected scope:

- drop legacy-only `website_url`, `social_links`, and `showcase` columns and related constraints/grants;
- retain page identity/ownership/slug, `is_published`, V2 documents/state, and `display_name`/`blurb` projection;
- retire the Open Graph discovery module, action path, and tests;
- remove any remaining legacy importer/converter runtime use; and
- update runtime-role grants accordingly.

Rehearse and execute `0008` separately under `docs/NEON_MIGRATIONS.md`. After `0008`, the rollback floor must be a V2-only application release compatible with the reduced schema.

## 11. File-by-file change map

Paths marked **planned** do not currently exist and may be adjusted during implementation if the installed Next.js guides require a different route/action boundary. Preserve the responsibilities even if a filename changes.

### 11.1 Add

| Planned path | Purpose | Removal point |
|---|---|---|
| `migrations/0007_member_page_personalization_v2.sql` | Add V2 documents/state/assets and backfill all pages. | Permanent migration history. |
| `migrations/0008_drop_legacy_member_page_content.sql` | Later destructive cleanup of legacy-only columns. | Permanent migration history; created only at later gate. |
| `src/lib/members/v2/document.ts` | Closed V2 types and schema version. | Permanent. |
| `src/lib/members/v2/limits.ts` | Centralized content, collection, node, and serialized-size limits. | Permanent. |
| `src/lib/members/v2/validation.ts` | Strict deep parser and typed errors. | Permanent. |
| `src/lib/members/v2/legacy-to-doc.ts` | Pure `legacyToDoc()` conversion. | Remove after fallback/dual-write/import retirement. |
| `src/lib/members/v2/themes.ts` | Theme/accent registry and semantic token mappings. | Permanent. |
| `src/lib/members/v2/feature-flag.ts` | Server-side empty/list/`all` rollout parser. | Remove/simplify after observation. |
| `src/lib/members/v2/rich-text.tsx` | Closed AST validation/render helpers. | Permanent. |
| `src/lib/members/v2/asset-references.ts` | Extract/check document asset references. | Permanent. |
| `src/lib/members/v2/dal.ts` | Draft/public state reads and guarded owner transitions. | Permanent after legacy branches removed. |
| `src/lib/members/assets/config.ts` | R2 environment/config validation. | Permanent. |
| `src/lib/members/assets/r2.ts` | `aws4fetch` storage adapter and streams. | Permanent. |
| `src/lib/members/assets/verify.ts` | Signature/MIME/size/dimension verification with range/full fallback. | Permanent. |
| `src/lib/members/assets/animation.ts` | Narrow APNG/WebP/AVIF static-animation checks. | Permanent. |
| `src/lib/members/assets/dal.ts` | Pending/ready metadata, quota, deletion guards, cleanup. | Permanent. |
| `src/components/member-page-v2/*` | Shared public frame and typed block renderers. | Permanent. |
| `src/components/member-page-editor/*` | Editor shell, canvas, inspector, autosave, blocks, upload, mobile UI. | Permanent. |
| `src/app/m/[member]/v2-actions.ts` | Planned owner autosave/publish/unpublish/reset actions. | Permanent; exact boundary subject to local Next guide. |
| `src/app/api/member-page-assets/uploads/route.ts` | Planned upload allocation endpoint. | Permanent. |
| `src/app/api/member-page-assets/[assetId]/finalize/route.ts` | Planned finalize endpoint. | Permanent. |
| `src/app/member-assets/[assetId]/route.ts` | Planned same-origin public/private asset route. | Permanent. |
| `scripts/audit-member-pages-v2.ts` | Read-only schema/content audit helper if useful. | Remove/archive after cleanup. |
| `scripts/import-member-showcase-artwork.ts` or reviewed browser-assisted equivalent | Conditional importer only if Phase 0 finds remote artwork. | Remove/archive after verified migration. |
| `tests/unit/member-v2-*.test.ts(x)` | Types, validation, conversion, themes, flag, renderer, editor, assets. | Permanent. |
| `tests/integration/member-v2-*.test.ts` | Real DB statements, grants, route/auth/cache behavior. | Permanent; bridge-only cases removed later. |
| `tests/fixtures/member-v2/*` | Documents and static/animated/spoofed image fixtures. | Permanent where security regression value remains. |

### 11.2 Change

| Existing path | Planned change |
|---|---|
| `package.json` / lockfile | Add only approved compatible dependencies and no redundant type packages. |
| `src/lib/auth/config.ts` | Integrate server-side R2/rollout config or delegate to focused member config while preserving auth behavior. |
| `scripts/preflight.ts` | Validate rollout and R2 environment separation without printing secrets; keep disabled-mode behavior explicit. |
| `src/lib/members/model.ts` | Retain V1 bridge types temporarily; route public V2 types to new modules. |
| `src/lib/members/validation.ts` | Keep legacy validation for dual-write; invoke conversion and reject pilot pages in mutation layer. |
| `src/lib/members/dal.ts` | Add V2 published reads/fallback, dual-write, moderation, flag-aware legacy rejection, and projection behavior. Prefer extracting new modules over indefinite growth. |
| `src/app/m/[member]/page.tsx` | Render V2 public content; conditionally load owner editor only when enabled; preserve public 404/metadata behavior. |
| `src/app/m/[member]/actions.ts` | Keep temporary legacy save with mandatory dual-write and pilot rejection. |
| `src/components/member-editor.tsx` | Retain only as legacy non-pilot editor during bridge; later remove. |
| `src/app/admin/members/actions.ts` | Add hold/clear; restrict legacy publication by flag; preserve create/assign/reassign. |
| `src/components/admin-member-forms.tsx` | Add moderation state/actions and reassignment privacy warning; do not add draft preview. |
| `src/app/admin/members/page.tsx` | Display allowed state/projection metadata only. |
| `src/app/api/members/route.ts` | Continue minimal published projection from `display_name`/`blurb`. |
| `src/app/globals.css` | Add reviewed semantic theme tokens/editor states without member-authored CSS. |
| `tests/unit/member-dal.test.ts` | Replace V1 publication assumptions with bridge/V2 flag/moderation expectations. |
| `tests/unit/member-editor.test.tsx` | Keep bridge tests, then replace with V2 editor slice tests. |
| `tests/unit/member-page.test.tsx` | Add V2 rendering/parity/public-bundle expectations. |
| `tests/integration/db-queries.test.ts` | Apply/test `0007`, grants, backfill equivalence, guarded transitions, asset quota/deletion, and later bridge cleanup. |
| `tests/integration/cache-headers.test.ts` | Add draft/private asset/public asset and observed revocation cases. |
| `tests/integration/members-route.test.ts` | Add V2 published/fallback/unknown/unpublished/held behavior. |

### 11.3 Remove later, not during pilot implementation

| Path/surface | Deletion condition |
|---|---|
| `src/components/member-editor.tsx` legacy implementation | V2 `all`, observation complete, no legacy rollback need. |
| Legacy save branches in `src/app/m/[member]/actions.ts` and DAL | Same, after dual-write health and rollback floor change. |
| Legacy admin publish/unpublish controls | Same; moderation remains. |
| Public renderer legacy fallback | Every published row valid V2 and observation complete. |
| `src/lib/members/open-graph.ts` and `tests/unit/open-graph.test.ts` | Migration `0008` release; no legacy artwork URL path remains. |
| Legacy-only model/validation fields | Migration `0008` and V2-only code deployed. |
| Import/audit tooling | Production import/parity signed off and no operational reuse. |

## 12. Dependency, environment, and configuration changes

### 12.1 Dependencies

After compatibility verification, add only:

- TipTap: `@tiptap/core`, `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-link`;
- sorting: `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`;
- R2 signing/stream requests: `aws4fetch`; and
- dimensions: `image-size`.

Do not prescribe or add:

- Zustand or another global state library;
- AWS SDK packages;
- `sharp` or another native image pipeline;
- MSW;
- MinIO;
- an ORM;
- a background-job/queue/cron system;
- a new CDN; or
- redundant type packages for dependencies that ship types.

Use React state/reducers/context for editor state. Use native browser image decoding/canvas re-encoding for owner uploads and native `fetch` streams on the server.

### 12.2 Planned environment variables

Names are planned and should be finalized once in the configuration change:

| Variable | Scope | Rule |
|---|---|---|
| `MEMBER_PAGE_V2_ALLOWLIST` | Server | Empty/list/`all`; never exposed to client as authority. |
| `MEMBER_PAGE_V2_EDITOR_DISABLED` | Server | Strict boolean kill switch; disables V2 editor/mutations without changing cohort or legacy rejection. |
| `MEMBER_PAGE_R2_ENVIRONMENT` | Server | Exact `production` or `nonproduction`; checked against app environment. |
| `MEMBER_PAGE_R2_ACCOUNT_ID` | Server secret/config | Cloudflare account identifier. |
| `MEMBER_PAGE_R2_ACCESS_KEY_ID` | Server secret | Bucket-scoped access key. |
| `MEMBER_PAGE_R2_SECRET_ACCESS_KEY` | Server secret | Bucket-scoped secret. |
| `MEMBER_PAGE_R2_BUCKET` | Server config | Private bucket name for the current environment class. |
| `MEMBER_PAGE_R2_ENDPOINT` | Local server config | Optional nonproduction-only loopback origin for an S3-compatible development store; forbidden in production. |

There is no public bucket URL variable. Derive the private S3-compatible endpoint from reviewed server configuration.

### 12.3 Fail-closed environment separation

- Production app configuration must identify the production bucket/environment.
- Every local, preview, CI, test, VPS, and rehearsal workflow must identify non-production and use only the non-production bucket or an injected in-memory fake adapter.
- Rehearsal database branch names do not authorize production storage.
- Preflight must reject mismatched environment classes, missing secrets when asset functionality is enabled, malformed allowlists, and accidentally configured R2 secrets in modes where they are forbidden.
- Tests must never log secret values or presigned query strings.

## 13. Migration, backfill, rehearsal, and production execution plan

### 13.1 No execution from this plan

This section defines future execution order. Do not apply `0007` or `0008`, create branches, or mutate production without the explicit authorization and procedure in `docs/NEON_MIGRATIONS.md`.

### 13.2 Migration development

1. Write committed `0007` SQL; do not improvise schema at the prompt.
2. Extend the disposable real-Postgres integration suite to apply migrations through `0007`.
3. Compare SQL backfill results against `legacyToDoc()` fixtures and deep validator output.
4. Verify published/unpublished initialization, constraints, indexes, and grants.
5. Verify runtime-role least privilege for all planned reads and one-statement writes.
6. Verify the pre-V2 application can tolerate the additive schema for rollback.

The production application continues to use Neon HTTP single-statement calls. The existing `pg`-based local/VPS integration harness may exercise faithful parameterized SQL against disposable PostgreSQL; it does not justify interactive transactions in runtime code.

### 13.3 Required single-statement runtime transitions

For each operation, test both success and zero-row/conflict outcomes:

- autosave: owner + page + expected revision -> replace draft/increment revision;
- publish: owner + expected revision + no hold -> copy full draft/set public/update projection;
- reset: owner + expected revision + published snapshot -> copy to draft/increment revision;
- unpublish: owner + page -> set non-public/retain documents;
- takedown-and-hold: admin-authorized target -> set non-public and held;
- clear-hold: admin-authorized held target -> clear hold/remain non-public;
- finalize: pending asset + owner/page + expiry + ready-count guard -> ready metadata;
- delete metadata: owner/page + ready/pending state + no reference in either document -> remove/claim cleanup.

Do not split authorization/state checks across a select followed by an update. Deep validation may occur before the statement; the revision/state guard prevents a changed row from being published based on stale validation.

### 13.4 Rehearsal

1. Read the required Neon skills and current CLI help as required by the runbook.
2. Verify the TeamHam project/production parent.
3. Create an expiring branch from production.
4. Apply the audit-selected unchanged sequence (`0005`, `0006`, `0007` as applicable) through the direct owner connection, one committed file at a time, with `ON_ERROR_STOP` and `--single-transaction`.
5. Verify each file before advancing, then verify final V2 schema objects, constraints, indexes, backfill counts, validator pass, grants, and runtime-role operations.
6. Run conditional artwork importer only when Phase 0 requires it, using non-production R2.
7. Verify every affected asset/document and all-page parity fixtures.
8. Run the bridge application against the rehearsal branch/non-production R2 where practical.
9. Record branch expiration and all results without credentials.

Any partial schema drift, validator failure, privilege failure, importer ambiguity, or runtime-role failure stops production execution and requires a fresh rehearsal after correction.

### 13.5 Production

1. Obtain explicit authorization.
2. Re-run read-only production pre-state checks.
3. Stop on full-existing state or partial drift as the runbook requires.
4. Apply the audit-selected unchanged prerequisite files in order, ending with `0007`, before bridge app deployment.
5. Run every file's migration-specific production checks before advancing to the next file and repeat final V2 checks after `0007`.
6. Run conditional artwork import, if required, before exposing V2 rendering.
7. Verify every document and imported asset.
8. Deploy empty-allowlist bridge.
9. Verify production dual-write, moderation, parser/renderer, no editor exposure, and parity.

### 13.6 Later `0008`

Repeat the full runbook on a fresh rehearsal branch only after temporary architecture deletion and a source search prove no application path reads/writes legacy-only columns or Open Graph artwork fields.

## 14. Verification plan

### 14.1 Evidence ownership and claims

| Claim | Primary evidence owner | Automated evidence | Manual/operator evidence | Gate |
|---|---|---|---|---|
| Production pre-state is known | Database operator | Schema audit helper tests where added | Signed read-only audit report | Phase 0 |
| SQL and TS conversion agree | Database + implementation leads | Real-Postgres fixtures parsed by shared validator | Reviewed mismatch report is empty | C1 |
| Admins cannot access drafts/assets | Security/implementation lead | DAL/route negative tests and query-shape assertions | Admin network/UI inspection | C1/C2/C3 |
| Hold permits editing but blocks publish | Implementation lead | State-transition tests | Owner/admin smoke flow | C2/C3 |
| Frame/body publish atomically | Database lead | One-statement SQL + projection/document assertions | Before/after public capture | C2/C3 |
| Legacy dual-write is complete | Bridge owner | Published/unpublished save and admin-publication tests | Production non-pilot smoke | C1/pilot |
| Rollout controls are authoritative | Security/bridge owner | Empty/list/`all`, disabled/enabled, V2 mutation rejection, sticky cohort, and legacy rejection tests | Pilot/kill-switch exercise | C1/C2/C3 |
| R2 isolation/private storage | Cloudflare operator | Config/CORS/adapter tests | Bucket/token/domain inspection | C1/C2 |
| Image verification is strict | Asset owner | Format, range, full-fetch, animation, quota fixtures | Real non-prod uploads | C2/C3 |
| Asset revocation is externally observed | Cache/release owner | Route/header tests | Repeated deployed requests before/after unpublish/hold | C2/C3 |
| Public bundles exclude editor deps | Frontend owner | Import/bundle assertions where feasible | Production build artifact/network inspection | C1/C2/C3 |
| WCAG 2.2 AA flow | Accessibility owner | Component/interaction tests | Keyboard, screen reader, touch, zoom, reduced-motion audit | C2/C3 |
| All themes are contained/contrasted | Design + accessibility owners | Registry/allowlist tests | Four-theme visual/contrast artifacts | C3 |
| No draft loss during pilot | Release owner | Conflict/failure tests | Two-week incident/evidence record | C3 |

### 14.2 Automated test coverage

Add or extend tests for:

- V2 strict parser, limits, rich-text AST, asset refs, themes, and accents;
- deterministic `legacyToDoc()` conversion;
- migration `0007` constraints, backfill, indexes, and grants;
- one-statement SQL guards and stale-revision conflicts;
- flag gating in editor, V2 mutations, legacy saves, and admin publication;
- public/fallback rendering and no draft/public mixing;
- admin DTO/query privacy;
- upload allocation/finalization/deletion authorization;
- magic bytes, MIME, dimensions, range expansion, full-fetch fallback;
- APNG, animated WebP, animated AVIF, and uncertain-file rejection;
- 20-ready-asset quota including portrait and excluding pending rows;
- public/private/404 asset routing and conservative headers;
- publish/unpublish/takedown cache hooks and deployed cache evidence;
- TipTap allowed/forbidden nodes/marks and HTTPS links;
- explicit movement, dnd enhancement, live announcements, and mobile inspector;
- directory/SEO projection isolation; and
- bridge fallback/dual-write deletion conditions.

### 14.3 Manual evidence

Before pilot and cutover, test at least:

- eligible owner;
- different signed-in member;
- administrator non-owner;
- administrator who owns their own page;
- signed-out visitor;
- unpublished owner page;
- held owner page;
- ineligible/suspended/expired owner;
- two owner tabs creating a revision conflict;
- accepted and rejected image samples on desktop/mobile;
- publish/unpublish/takedown asset access from a fresh signed-out client;
- 375 px, keyboard only, screen reader, touch, 200% text zoom, and reduced motion; and
- each block/variant in Paper and then all four themes.

### 14.4 Commands and timing

Use the repository commands exactly as currently defined:

| Command | When required |
|---|---|
| `npm run test:unit` | During every Phase 1-3 change; required before each PR/checkpoint. |
| `npm run test:integration` | After DAL/action/route/cache changes; required at C1, C2, and C3. |
| `npm run test:integration:vps` | After `0007`, runtime grants, guarded SQL, asset metadata, and bridge changes; required before C1 and repeated before C3 using the approved disposable VPS test database. |
| `npm run typecheck` | Every implementation PR and all checkpoints. |
| `npm run lint` | Every implementation PR and all checkpoints. |
| `npm run preflight` | After config/env changes and for each intended disabled/development/production configuration at C1-C3. |
| `npm run build` | After public/editor boundary or dependency changes; required at C1, C2, and C3 with production-like configuration. |

`npm run build` invokes `preflight` through `prebuild`, but run `npm run preflight` separately for explicit environment-mode evidence.

### 14.5 Stronger fallback when evidence is inconclusive

Inconclusive evidence is a failed gate, not a pass. Use the narrowest stronger environment that can answer the claim:

- SQL/privilege uncertainty -> fresh disposable real Postgres plus the VPS integration path;
- Neon HTTP behavior uncertainty -> non-production Neon branch with the actual runtime client and one-statement query path;
- R2 format/range uncertainty -> real non-production R2 objects and captured range/full-fetch behavior;
- cache uncertainty -> deployed production-like route, repeated anonymous requests, response/cache headers, and before/after authorization checks; retain `no-store` and block pilot if still uncertain;
- bundle uncertainty -> inspect production build chunks/network requests for signed-out and non-owner sessions;
- accessibility uncertainty -> manual assistive-technology audit by the evidence owner; and
- parity uncertainty -> side-by-side capture for every published page, not sampling.

Do not replace missing evidence with assertions based on source inspection alone.

## 15. Deployment and rollback matrix

| Checkpoint/state | Database | App/flag | Public behavior | Allowed rollback | Floor |
|---|---|---|---|---|---|
| Before `0007` | Actual Phase 0 state | Current V1 code | Current V1 behavior if deployed | Current release | Pre-V2 |
| `0007` applied, bridge not deployed | Additive V2 schema/backfill | Existing app ignores additive fields | Existing public behavior | Existing app; do not remove schema | Pre-V2 until V2-only publication occurs |
| C1 bridge | `0007` verified | Empty allowlist; V2 renderer/fallback, dual-write, moderation | V2 Paper render with zero fallback dependency; no V2 editor | Redeploy bridge or prior additive-schema-compatible release while preserving dual-write data | Bridge preferred |
| C2 pilot | Same | 5-10-slug cohort; kill switch disables editor but retains cohort | Pilot V2 snapshots; non-pilot legacy dual-write | Disable editor and deploy bridge release | **Bridge mandatory after first V2-only publish** |
| C3 cutover | Same | `all`, editor enabled | All owners V2; legacy paths reject | Set editor-disabled kill switch while retaining `all`, then deploy bridge release | Bridge/V2-aware only |
| Post-observation cleanup | Same | Legacy code/fallback removed; flag simplified | V2-only app behavior | Last V2-only release with matching schema | V2-only |
| After `0008` | Legacy-only columns removed | V2-only app | V2-only | Release compatible with `0008`; no bridge fallback | Post-`0008` V2-only |

At every stage, rollback leaves V2 documents/assets intact. Never restore a pre-V2 binary after V2-only content exists, and never point a rollback deployment at the wrong R2 environment.

## 16. Risks and open implementation decisions

Resolve each item by its gate; do not silently choose during coding.

| Risk/decision | Required resolution | Owner | Blocking gate |
|---|---|---|---|
| Production schema/content state | Complete read-only `0005`/`0006`, row, showcase, and remote-artwork audit. | Database operator | Phase 0 |
| Partial V1 migration drift | Stop and write reviewed remediation before `0007`; do not layer onto unknown drift. | Database operator | Phase 0/C1 |
| External artwork importer conditionality | If count is zero, omit importer. If nonzero, select a compliant reviewed import method, normalize into private R2, and complete rehearsal/production parity. Do not add `sharp` solely for this path or store remote URLs in V2 docs. | Implementation + release operators | C1 |
| Theme tokens/accents | Supply reviewed Newsprint/Blueprint/Riso mappings and contrast artifacts; Paper uses current tokens. | Design/accessibility owners | C3; Paper blocks C1/C2 |
| Exact centralized content limits | Finalize document byte, text, list, gallery, link, caption, alt, and AST node/depth limits in one module with tests. | Product/implementation/security owners | C2 |
| R2 credentials/buckets | Create private production/non-production buckets and scoped credentials; verify no public domain and no cross-environment use. | Cloudflare operator | C1/C2 |
| Cache revocation approach | Prove actual Next/app/CDN behavior for asset route after unpublish/hold. Default to conservative/no-store and block image pilot if not proven. | Cache/release owner | C2 |
| Public-asset caching policy | Choose verified public headers/tags/purge strategy balancing cacheability with authorization revocation; document observed behavior, not framework assumptions. | Cache/release owner | C2/C3 |
| AVIF static-animation detection | Define and fixture the narrow ISO-BMFF cases accepted/rejected; reject uncertain structures. | Asset/security owner | C2 |
| Browser normalization support | Define output fallback when the browser cannot encode AVIF/WebP while preserving allowed static formats and metadata stripping. | Frontend/asset owner | C2 |
| Reassignment privacy warning | Finalize warning and tests that reassignment transfers page-scoped private draft/assets without exposing them to admin. | Product/security owner | C2 |
| Rollout identifiers and kill switch | This plan uses immutable slugs for sticky cohort authority plus a separate editor-disabled boolean; confirm parsing, whitespace/duplicate behavior, `all`, and disabled-state operations before implementation. | Release/implementation owner | Phase 1 |
| Next.js cache/action APIs | Confirm against installed 16.3.1 docs and avoid deprecated/training-data assumptions. | Implementation lead | Before affected code |
| R2 deletion failure | Define recoverable pending/cleanup state and opportunistic retry without a worker; never mark invalid objects ready. | Asset owner | C2 |
| TipTap canonical JSON | Confirm editor output normalization so semantically equivalent content does not churn autosave revisions. | Rich-text owner | C2 |
| Required-content block creation | Keep incomplete creation state transient and insert only canonical valid blocks; if persistable incomplete blocks are required, amend the spec/schema before Phase 1. | Product/editor owner | Phase 1/C2 |
| Cross-service asset deletion | Validate the planned deletion-claim marker and guarded sequence so races cannot create broken references and R2 failures remain retryable without a worker. | Asset/database owner | C2 |
| Rollback artifact retention | Preserve a deployable bridge release and its configuration after first V2-only publish. | Release owner | C2/C3 |

## 17. Temporary architecture deletion checklist

Track these items explicitly from bridge introduction through removal:

- [ ] **Mandatory legacy dual-write** — remove only after `all`, observation, and no legacy rollback need.
- [ ] **Public renderer legacy fallback** — remove only after every published row is valid V2 and fallback telemetry remains zero.
- [ ] **Server-side rollout cohort and editor kill switch** — keep through pilot/observation; remove or simplify only when `all` is permanent and an alternative safe kill switch is approved.
- [ ] **Legacy owner editor/action** — remove after general release observation.
- [ ] **Legacy administrator publication controls** — remove after `all`; retain create/assign/reassign and moderation.
- [ ] **Legacy-only website/social/showcase columns** — drop only in separately rehearsed migration `0008`.
- [ ] **Open Graph discovery surface** — remove code/tests with `0008`; V2 artwork is asset-ID based.
- [ ] **`legacyToDoc()` runtime use** — remove after fallback, dual-write, and importer retirement.
- [ ] **Conditional artwork importer** — remove/archive after production parity evidence and no replay need.
- [ ] **Bridge-only tests/diagnostics** — remove only with the code they protect; preserve permanent regression tests for privacy and migration validity.

Before deletion, use source search, runtime tests, and database query evidence to prove the target has no remaining callers or data dependency. Do not infer deletion safety from the feature flag alone.

## 18. Definition of done

V2 implementation is complete only when:

- every acceptance criterion in `MEMBER_PAGE_PERSONALIZATION_V2_SPEC.md` passes;
- Phase 0 production audit and all checkpoint evidence are recorded;
- migration `0007` is rehearsed, authorized, applied, and verified before dependent app deployment;
- all current pages are backfilled and Paper parity is complete;
- remote artwork, if present, is represented by verified private R2 asset IDs;
- the editor supports the complete frame and all launch blocks on desktop/mobile;
- autosave, conflict, publish, unpublish, reset, hold, and asset lifecycle statements are guarded single SQL calls;
- administrators cannot access drafts or non-public assets;
- hold permits draft editing/reset but blocks publish;
- website/socials remain fixed frame fields and frame/body publish atomically;
- the private R2 environment split, strict upload verification, 20-ready quota, deletion rules, and public/private asset routing pass;
- externally observed cache authorization after publish/unpublish/takedown is proven without unsupported immediacy claims;
- public visitor/non-owner bundles contain no editor dependencies;
- the 5-10 page two-week pilot completes with no unresolved draft loss, access leak, or cache leak;
- Paper, Newsprint, Blueprint, and Riso plus all curated accents have WCAG 2.2 AA evidence;
- `MEMBER_PAGE_V2_ALLOWLIST=all` with `MEMBER_PAGE_V2_EDITOR_DISABLED=false` is deployed successfully;
- the bridge rollback release remains available through observation;
- temporary architecture is removed only at its stated deletion points; and
- migration `0008` and Open Graph retirement occur later, separately, after the V2-only rollback floor is established.

## 19. Related documents

- [Member Page Personalization V2 Specification](MEMBER_PAGE_PERSONALIZATION_V2_SPEC.md)
- [Historical V1 member-page implementation plan](MEMBER_PAGES_IMPLEMENTATION.md)
- [Historical V1 member-page specification](MEMBER_PAGES_SPEC.md)
- [Members directory experience](MEMBERS_DIRECTORY_SPEC.md)
- [Member system and authentication](MEMBER_SYSTEM_SPEC.md)
- [Neon migration runbook](../../NEON_MIGRATIONS.md)
- [Repository implementation rules](../../../AGENTS.md)
