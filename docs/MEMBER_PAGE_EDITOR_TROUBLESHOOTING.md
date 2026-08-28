# Member page editor troubleshooting

Use this runbook when the V2 member page editor, publishing flow, public renderer, or member assets behave unexpectedly. Start with the recovery steps. Use the durable fix sections when changing the system.

The public page is authoritative when Preview and the public route disagree. Do not repair stored documents to compensate for a renderer defect.

## Issue classification

| Issue | Classification | Current response |
| --- | --- | --- |
| Public and editor rendering can drift | Code defect worth changing | Repair both render paths, then centralize shared decisions |
| Asset deletion is blocked by saved references | Intentional invariant | Remove references from both saved snapshots before deletion |
| A stale tab can unpublish the current page | Accepted tradeoff | Republish from a fresh editor |
| Retiring a theme can make pages fail closed | Operational procedure | Restore the registry entry, then migrate affected documents |
| One invalid asset can make the page return 404 | Code defect worth changing | Repair the media reference, then add per-media degradation |
| Public assets use `no-store` | Accepted tradeoff | Keep revocation safety until deployed caching is proven |
| Autosave conflicts require manual reconciliation | Accepted tradeoff | Preserve both versions and reconcile them manually |
| The allowlist does not control public rendering | Intentional invariant | Use the kill switch, unpublish, or moderation hold |
| Legacy and V2 editors coexist | Accepted temporary tradeoff | Keep V2 cohort membership sticky |
| Preview parity does not mean identical DOM | Accepted tradeoff | Compare semantic output at equivalent widths |
| Browser-only behavior is not fully automated | Code defect worth changing | Run the Playwright suite; manual flow for remaining gaps |
| The kill switch disables all owner mutations | Intentional invariant | Use administrator takedown for emergencies |

## Troubleshooting

### Preview and the public page render different content

**Classification.** Code defect worth changing.

**Symptom.** A block, variant, order, showcase layout, spacing rule, or media fallback differs between Preview and the signed-out public page.

**Recover now.** Treat the signed-out public page as authoritative. Fix the public and editor render paths together. Do not reset or rewrite the member document because the mismatch is presentation code.

**Cause.** The public renderer and editor canvas share leaf components, but they have separate block dispatch switches and showcase composition. A change can reach one path without reaching the other.

**Durable fix.** Introduce one dependency-pure, exhaustive leaf block dispatcher. Add a small pure helper that defines showcase eligibility and body order. Keep the public and editor outer trees separate because the editor still needs selection wrappers, drag-and-drop structure, and private draft assets. Share layout values only when parity requires them.

**Source.** Inspect these files:

- `src/components/member-page-v2/blocks/MemberPageV2Body.tsx`
- `src/components/member-page-editor/canvas-block.tsx`
- `src/components/member-page-v2/MemberPageV2View.tsx`
- `src/components/member-page-editor/editor-canvas.tsx`

**Verification.** Render the same fixture through both paths. Check every block type, block order, variants, showcase selection, theme identifiers, links, media fallbacks, and accessible names. Add an exhaustive `assertNever` check for new block types. Compare browser screenshots at equivalent content widths.

**Completion criterion.** A new block type or showcase rule has one shared decision point, and the semantic parity tests pass for both render paths.

### An asset cannot be deleted after it disappears from the editor

**Classification.** Intentional invariant.

**Symptom.** Asset deletion returns `409` or `asset_referenced` after the image no longer appears in local editor state. An unpublished page can remain blocked.

**Recover now.** Follow this sequence:

1. Remove every use of the asset from the draft.
2. Wait until the editor reports **Saved**.
3. If the last published snapshot references the asset, publish the cleaned draft.
4. If the page must remain private, unpublish it after publishing the cleaned snapshot.
5. Delete the asset.

Unpublish alone does not change `published_doc`. Do not briefly republish a private or moderation-held page only to free asset quota. Keep the asset or use a reviewed operator repair in that case.

**Cause.** Deletion checks both `draft_doc` and `published_doc`. This guard prevents broken drafts, broken public pages, and broken Reset-to-live snapshots. Local editor state does not count until autosave finishes.

**Durable fix.** Keep the database guard. Return whether the reference comes from the draft, the last published snapshot, or both. Update UI copy to name the last published snapshot. Do not claim that unpublish removes the reference.

**Source.** Inspect these symbols and files:

- `deleteOwnedMemberPageAsset` in `src/lib/members/assets/dal.ts`
- `unpublishOwnedMemberPageV2` in `src/lib/members/v2/dal.ts`
- `src/components/member-page-editor/asset-library.tsx`
- `src/components/member-page-editor/asset-api.ts`

**Verification.** Test draft-only, published-only, and dual references against real Postgres. Confirm that unpublish alone remains blocked. Confirm that publishing a clean snapshot permits deletion. Include a concurrent re-reference attempt during deletion.

**Completion criterion.** The asset is absent from both stored documents before deletion, and the deletion succeeds without breaking Reset-to-live or public rendering.

### A stale tab unpublishes a newer live page

**Classification.** Accepted tradeoff.

**Symptom.** Tab A unpublishes after Tab B publishes a newer version. The newest public page becomes private even though Tab A loaded an older state.

**Recover now.** Open a fresh editor. Confirm the current stored draft. Publish again, then refresh every stale tab. Unpublish does not overwrite either document.

**Cause.** Unpublish changes publication state only. It does not accept or check `draft_rev`. The operation acts as an owner safety action and remains idempotent.

**Durable fix.** Keep the current behavior unless product requirements demand stale-intent rejection. If a guard is required, compare a publication generation such as the loaded `publishedAt` value. Do not use `draft_rev`, because a private autosave must not block an emergency unpublish.

**Source.** Inspect these symbols:

- `unpublishMemberPageV2Action` in `src/app/m/[member]/v2-actions.ts`
- `unpublishOwnedMemberPageV2` in `src/lib/members/v2/dal.ts`

**Verification.** Load two browser contexts. Publish a new version in one context, then unpublish from the stale context. Confirm that the public route returns 404 and that the newest `draft_doc` and `published_doc` remain unchanged. If a publication token is added, require a conflict instead.

**Completion criterion.** Recovery republishes the newest stored document, or a publication-generation guard rejects stale unpublish intent without blocking fresh emergency takedown.

### A theme registry change makes member pages return 404

**Classification.** Operational procedure.

**Symptom.** A public page and its metadata route fail closed after a referenced theme or accent is disabled or removed. The owner may also be unable to enter the editor.

**Recover now.** Restore the exact theme and accent registry entry, then redeploy. Do not silently substitute the Paper theme. A silent fallback changes published presentation without an owner publication and hides invalid stored state.

If the theme was revoked for a safety reason, keep affected pages unavailable until a reviewed repair updates both drafts and published snapshots.

**Cause.** The same enabled registry controls picker availability, document validation, draft reads, and public rendering. The registry has no state for a theme that remains renderable but cannot be selected for new changes.

**Durable fix.** Add explicit lifecycle states:

- `active` means selectable and renderable.
- `legacy` means renderable but absent from the picker.
- `revoked` means rejected everywhere.

Before moving a theme or accent to `revoked`, audit every `draft_doc` and `published_doc` against the proposed registry. Migrate affected documents through a reviewed process.

**Source.** Inspect these files:

- `src/lib/members/v2/themes.ts`
- `src/lib/members/v2/validation.ts`
- `src/app/m/[member]/page.tsx`

**Verification.** Add registry tests for all lifecycle states. Prove that legacy themes render but cannot be newly selected. Run a proposed-registry audit against stored drafts and snapshots before deployment. Keep revoked themes fail closed.

**Completion criterion.** The registry change has no unexpected affected documents, or every affected document has a reviewed migration before revocation.

### One broken published asset makes the whole page return 404

**Classification.** Code defect worth changing.

**Symptom.** One missing, deletion-claimed, or invalid asset makes `/m/<slug>` return the full branded 404. Unaffected text and media disappear with it.

**Recover now.** The owner opens the editor, removes or replaces the unavailable media, waits for **Saved**, and publishes the repaired draft. If the owner cannot recover it, an operator must restore and verify the exact stored object and metadata before clearing any deletion claim.

**Cause.** `getPublicMemberPageAssetMetadata` requires metadata for every referenced asset before rendering. The leaf renderers already support safe media fallback, but the route never reaches them when one metadata entry is missing.

**Durable fix.** Return valid metadata with a bounded set of degraded asset IDs. Keep unaffected content at HTTP 200. Omit an invalid standalone image or portrait, use the existing artwork fallback for projects, and omit invalid gallery items. Keep malformed documents and unsafe themes as whole-page failures. Report storage or database outages as service failures instead of normal 404 responses. Add a slug-only degraded-render diagnostic.

**Source.** Inspect these files and symbols:

- `getPublicMemberPageAssetMetadata` in `src/lib/members/assets/dal.ts`
- `src/app/m/[member]/page.tsx`
- `src/components/member-page-v2/blocks/MemberPageV2Image.tsx`
- `src/components/member-page-v2/blocks/MemberPageV2Project.tsx`

**Verification.** Publish a document with two valid assets, then remove or claim one. Require HTTP 200 for the page, retained unaffected content, retained valid media, and the expected fallback for the invalid use. The direct invalid asset request must remain 404. Test the chosen service-error path separately.

**Completion criterion.** One bad media object cannot remove unrelated page content, and document or theme corruption still fails closed.

### Public asset requests repeat storage work

**Classification.** Accepted tradeoff.

**Symptom.** Every public image request repeats authorization, database, and object-storage work. Browser and shared-cache reuse remain disabled even though responses contain ETags.

**Recover now.** Keep `Cache-Control: no-store`. During a latency or capacity incident, fix database, storage, or image-use pressure. Do not enable public caching as an emergency change.

**Cause.** The deployment has not proven that cached public bytes become unavailable immediately after unpublish or moderation hold. The current policy favors revocation over performance.

**Durable fix.** Change caching only after deployed revocation tests prove the behavior of browsers and shared caches. A valid design may use targeted CDN purges, tag purges, or a protected internal byte cache that still performs authorization for each request. `revalidatePath("/m/<slug>")` does not prove that asset URLs were purged.

**Source.** Inspect these files:

- `src/lib/members/assets/config.ts`
- `src/app/member-assets/[assetId]/route.ts`

**Verification.** Request the same published asset from fresh anonymous and shared-cache contexts. Unpublish or place the page on moderation hold. Require the same URL to return 404 in every fresh context. Confirm that the owner receives only the permitted private response. Repeat the proof after any cache design change.

**Completion criterion.** Keep `no-store` until deployed evidence proves that every public cache stops serving the bytes within the required revocation window.

### Autosave stops after another tab wins a revision race

**Classification.** Accepted tradeoff with UX fixes.

**Symptom.** Autosave and publish stop after a conflict. The conflicted tab still displays local changes, but reloading discards them.

**Recover now.** Keep the conflicted tab open. Open the same editor in a second tab to load the stored draft. Manually copy or reconcile the local changes. Close or reload the conflicted tab only after the recovered version saves.

**Cause.** The editor rejects last-write-wins and has no automatic merge model. The controller preserves the local version in memory and stops all further writes, but the current recovery action is a destructive reload.

**Durable fix.** Preserve the no-auto-merge rule. Add **Open latest draft in a new tab**. Rename the reload action to **Discard this local version and reload**. Consider a copy or export action only after reviewing the privacy impact of retaining draft content outside React memory.

**Source.** Inspect these files:

- `src/components/member-page-editor/autosave-controller.ts`
- `src/components/member-page-editor/editor-topbar.tsx`
- `src/components/member-page-editor/use-member-page-editor.ts`

**Verification.** Use two browser contexts. Save from one context and force a conflict in the other. Confirm that the conflicted context sends no later autosave or publish request, retains local content, and warns before navigation. Confirm that a new tab loads the server version.

**Completion criterion.** The owner can preserve and reconcile both versions before any destructive reload, and the system never performs an automatic merge or overwrite.

### Removing a slug from the allowlist does not roll back public V2 rendering

**Classification.** Intentional invariant.

**Symptom.** A valid V2 `published_doc` still renders after the slug leaves `MEMBER_PAGE_V2_ALLOWLIST` or the editor kill switch is enabled. The owner may see the legacy editor while the public page remains V2.

**Recover now.** Do not use the allowlist as a public-render rollback switch.

- To pause V2 owner editing, keep cohort membership and set `MEMBER_PAGE_V2_EDITOR_DISABLED=true`.
- To remove public access, unpublish the page or apply moderation hold.
- To restore V2 owner authority, restore the slug to the cohort.

**Cause.** `MEMBER_PAGE_V2_ALLOWLIST` controls V2 authority and editor access. `getPublishedMemberPageV2` reads valid public snapshots without a cohort check so that existing V2 pages continue to render safely during rollout.

**Durable fix.** Keep the behavior. Document the variable as an authority and editor cohort. Rename it only through a managed environment-variable transition.

**Source.** Inspect these files and symbols:

- `src/lib/members/v2/feature-flag.ts`
- `getPublishedMemberPageV2` in `src/lib/members/v2/dal.ts`
- `src/app/m/[member]/page.tsx`

**Verification.** With an empty cohort and the editor disabled, confirm that a valid `published_doc` renders publicly and owner V2 mutations fail. Confirm that a cohort page without a V2 row never exposes stale V1 content.

**Completion criterion.** Operators use the kill switch for editing incidents and publication state or moderation for public takedown. Cohort membership remains sticky.

### A V2 page becomes editable through the legacy editor

**Classification.** Accepted temporary tradeoff with high risk.

**Symptom.** A public V2 page shows the limited legacy editor after its slug leaves the cohort. Saving through that editor can remove V2-only blocks, portrait, theme, galleries, rich text, and other content. A live legacy save can replace the public snapshot immediately.

**Recover now.** Follow this sequence:

1. Restore the slug to `MEMBER_PAGE_V2_ALLOWLIST`.
2. Do not use legacy owner or administrator controls.
3. Determine whether a legacy save occurred.
4. If an intact V2 `published_doc` remains, use Reset-to-live only after V2 access returns.
5. If a live legacy save replaced both documents, restore from a backup or reconstruct the page manually.

The application does not keep document revision history.

**Cause.** Rollout state lives in environment configuration. Legacy saves rebuild V2 documents from the smaller legacy model. The legacy mutation guard rejects current cohort members but cannot identify historical V2 authority after cohort removal.

**Durable fix.** In the short term, reject a legacy save when the existing draft is not exactly representable by the legacy model. If coexistence continues, persist V2 authority on the page and use that field for routing, administrator controls, and mutation guards. Let environment configuration control availability, not ownership of the data model.

**Source.** Inspect these files:

- `src/lib/members/dal.ts`
- `src/app/m/[member]/actions.ts`
- `src/app/m/[member]/page.tsx`

**Verification.** Create a V2-only draft, simulate cohort removal, and attempt a legacy save. Require rejection and byte-for-byte unchanged documents. Retain coverage for legitimate non-cohort legacy saves and cohort rejection while the kill switch is active.

**Completion criterion.** An established V2 page cannot enter a lossy legacy mutation path because of an environment configuration change.

### Preview does not have the same DOM as the public page

**Classification.** Accepted tradeoff.

**Symptom.** Preview differs in outer wrappers, page chrome, texture scope, workbench sizing, drag-and-drop spacing, or image resource hints. A raw DOM or full-page screenshot comparison fails.

**Recover now.** Compare both paths with the same document, theme, and asset metadata at the same content width. Treat public output as authoritative. Do not rewrite member content to match editor-only composition.

**Cause.** The editor needs one sortable list, selection wrappers, private asset access, and editor viewport constraints. Rendering the complete public route tree inside the workbench would couple the public page to editor behavior.

**Durable fix.** Define the parity contract explicitly.

These parts must match:

- Frame content.
- Block output, variants, and order.
- Showcase eligibility.
- Theme tokens.
- Link and accessibility semantics.
- Media fallback behavior.

These parts may differ:

- Editor chrome and wrappers.
- Header, footer, and page scope.
- Workbench sizing.
- Drag-and-drop spacing.
- Image `sizes` hints for the containing viewport.

Use the shared dispatcher and composition helper described in the first issue. Do not force full-tree reuse.

**Source.** Inspect these files:

- `src/components/member-page-v2/MemberPageV2View.tsx`
- `src/components/member-page-editor/editor-canvas.tsx`
- `src/components/member-page-editor/editor-shell.tsx`
- `src/components/member-page-v2/index.ts`

**Verification.** Add semantic contract tests for every block, theme, and showcase rule. Compare browser output at equivalent content widths. Crop editor-only surroundings before visual comparison. Do not require identical DOM strings or full-page screenshots.

**Completion criterion.** Every required semantic and visual contract matches while documented editor-only differences remain allowed.

### Browser-only editor failures

**Classification.** Code defect worth changing.

**Symptom.** Unit and integration tests pass while hydration, focus, pointer drag-and-drop, keyboard interaction, responsive sheets, direct upload CORS, `beforeunload`, or multi-tab conflicts fail in a real browser.

**Recover now.** Run the Playwright suite in `tests/e2e/` against the local stack (see [Local testing environment](LOCAL_TESTING.md)); CI runs it on every push and pull request and fails the job when a named requirement is missing or a test skips. Reproduce a reported failure locally with `npm run test:e2e:vps`, then inspect the trace and screenshot artifacts uploaded from `/tmp/teamham-e2e-artifacts`. For failures the suite cannot reach — visual layout drift, browser extensions, or production-only delivery behavior — run the manual member-page flow and record evidence for these cases:

1. Edit, autosave, Preview, publish, and signed-out public rendering.
2. Upload, select, publish, and delete an asset.
3. Trigger a two-tab conflict and preserve both versions.
4. Exercise responsive inspector and focus behavior.
5. Reorder with the keyboard and a pointer.
6. Verify public page and asset revocation from a fresh anonymous client.

**Cause.** Some editor behavior exists only in a real browser (hydration, focus, pointer, multi-tab). The Playwright suite covers the critical owner and anonymous flows against disposable Postgres and local MinIO, including multi-context conflicts and revocation, but it does not cover every browser-specific defect.

**Durable fix.** Extend the Playwright suite when a recurring browser-only defect escapes it. Seed real accounts, pages, and sessions through the test fixtures and the real session cookie; never add an application authentication bypass. Keep the named-requirement contract explicit so a missing service skips locally with a named reason and fails in CI.

**Source.** Inspect these files:

- `tests/e2e/`
- `playwright.config.ts`
- `.github/workflows/ci.yml`
- `docs/LOCAL_TESTING.md`

**Verification.** Run the suite with clean disposable services. Require no shared production credentials, no authentication bypass, and deterministic cleanup. CI must fail on missing requirements and skipped tests, not only on test failures.

**Completion criterion.** CI drives the critical owner and anonymous browser flows against disposable services, including multi-context and revocation behavior, and recurring browser-only defects are added to the suite instead of a manual checklist.

### The editor kill switch prevents an owner from unpublishing

**Classification.** Intentional invariant.

**Symptom.** With `MEMBER_PAGE_V2_EDITOR_DISABLED=true`, the owner cannot open the editor, unpublish, reset, autosave, or manage assets.

**Recover now.** For an urgent public removal, use the administrator **Take down and hold** action. Otherwise, re-enable the editor. Keep the slug in the V2 cohort. Removing the slug can expose the lossy legacy path.

**Cause.** All owner V2 mutations pass through the same editor authorization boundary. The kill switch disables the complete owner mutation capability rather than only hiding the workbench.

**Durable fix.** Keep the behavior if the kill switch must remain absolute. If product requirements demand owner emergency takedown, add a narrowly authorized unpublish action that remains separate from content writes and asset management. Do not weaken V2 cohort authority generally.

**Source.** Inspect these symbols and files:

- `authorizeEditorRequest` in `src/lib/members/v2/dal.ts`
- Asset authorization in `src/lib/members/assets/dal.ts`
- `src/app/m/[member]/page.tsx`
- `src/lib/members/v2/moderation.ts`

**Verification.** Enable the kill switch. Confirm that every owner mutation and the V2 editor are unavailable. Confirm that legacy mutation remains rejected for cohort pages. Apply administrator takedown and require the public page and public asset requests to become unavailable.

**Completion criterion.** Operators can remove an unsafe page while the owner mutation system remains disabled, without moving the slug into the legacy editor path.

## Related documents

- [Local testing environment](LOCAL_TESTING.md)
- [Neon migration runbook](NEON_MIGRATIONS.md)
- [Member page personalization V2 implementation plan](website/plans/MEMBER_PAGE_PERSONALIZATION_V2_IMPLEMENTATION.md)
- [Member page personalization V2 specification](website/plans/MEMBER_PAGE_PERSONALIZATION_V2_SPEC.md)
