# Member Page Personalization V2 Specification

**Document Status**: READY FOR IMPLEMENTATION
**Last Updated**: 2026-08-25
**Route**: `teamham.world/m/<slug>`
**Scope**: Member-owned content, personalization, editing, uploads, publication, and moderation for database-backed HAM member pages.

## 1. Status, scope, and supersession

This document defines V2 of HAM member-page personalization. Its goal is to let assigned members create distinctive, polished pages while every page remains unmistakably part of HAM.

This specification supersedes [Member Page Self-Service Specification](MEMBER_PAGES_SPEC.md) **only** for:

- the member-editable content model;
- the owner editor experience;
- image uploads and asset delivery; and
- draft, publication, unpublication, and moderation workflow.

The original specification remains a historical record of V1. Unless this document explicitly changes a behavior in the four areas above, the existing member-page system remains authoritative. In particular:

- the canonical route remains `/m/<slug>`;
- only an administrator can create and assign a page;
- each page has exactly one owner and each account owns at most one page;
- only the assigned owner may edit that page;
- administrators may create, assign, and reassign pages but administrator status alone does not grant content-editing access;
- the lowercase DNS-label slug remains immutable after creation;
- unknown and non-public pages remain indistinguishable to unauthorized visitors and return the same branded not-found behavior;
- optional sites at `<slug>.teamham.world` remain independently hosted and outside this editor; and
- the apex `__Host-session` cookie is not shared with member subdomains.

V2 replaces ordinary administrator-controlled publication with owner-controlled publish and unpublish actions. Administrator publication controls remain only as a temporary legacy bridge for non-pilot pages and must be removed from the V2 path. V2 administrator moderation is the takedown-and-hold workflow defined below.

The words **must**, **must not**, **required**, and **may** are normative. Sections explicitly labeled **Implementation guidance** describe the preferred architecture without changing the product requirements.

## 2. Goals and non-goals

### 2.1 Goals

- Give an assigned member meaningful visual and editorial control without exposing arbitrary styling or layout primitives.
- Preserve HAM's shared navigation, footer, typography, interaction language, accessibility baseline, and recognizable member identity.
- Make editing direct and visual through a structured WYSIWYG canvas built from the same components used on the public page.
- Separate continuous private drafting from deliberate public publication.
- Let a member publish or unpublish their own page while giving administrators a narrow moderation takedown mechanism.
- Support first-party image uploads through a private Cloudflare R2 bucket with explicit ownership, validation, quota, and lifecycle rules.
- Migrate every current member page without a visible public change before personalization is expanded.
- Keep public pages server-rendered, cacheable, indexable when published, and free of the editor bundle for ordinary visitors.

### 2.2 Non-goals

- A general-purpose website builder, freeform canvas, nested layout system, or design-token editor.
- Member-created pages, multiple owners, delegated editors, collaborative editing, comments, or approval queues.
- Custom domains or management of `<slug>.teamham.world` DNS and hosting.
- A public asset bucket, media CDN URL stored in content, or third-party media embed system.
- Historical revision browsing, scheduled publication, shareable preview links, page analytics, or password protection.
- Automated content moderation or image scanning in V1 of personalization.

## 3. Terminology

| Term | Meaning |
|---|---|
| **Member page** | The database-backed page at `/m/<slug>` assigned to one account. |
| **Owner** | The single account assigned to the page. Owner actions also require a current authenticated, active, eligible member session. |
| **HAM frame** | The fixed site and member-page structure that members cannot replace: navigation, footer, content width, typography system, member identity treatment, interaction rules, and placement of primary website/social links. |
| **Frame content** | Member-editable values rendered inside the fixed frame: display name, short summary, website, supported social links, optional portrait, theme, and accent. |
| **Body** | One flat, ordered array of member-selected content blocks below the structural member identity. |
| **Draft document** | The owner's private current frame content and body. Autosave updates only this document. |
| **Published snapshot** | The last document copied atomically from the draft by a successful publish action. Public rendering never combines draft and published values. |
| **Draft revision** | A monotonically increasing integer used for optimistic conflict detection on draft mutations. |
| **Preview** | An authenticated owner-only rendering of the current draft using public rendering components. It is not a shareable URL. |
| **Moderation hold** | An administrator-controlled flag that prevents publication. Placing a hold also takes down the page. A hold does not prevent draft editing, uploads, autosave, preview, unpublish, or reset. |
| **Pending asset** | An upload allocation or object that has not passed server verification and is not referenceable by a document. |
| **Ready asset** | A verified stored image that may be referenced by the owning page's draft or published document. The 20-asset quota counts only ready assets. |
| **HAM project registry** | The reviewed public project catalog currently represented by `src/data/projects.ts`. |
| **Legacy editor** | The pre-V2 immediate-save editor retained temporarily for non-pilot pages during the bridge period. |

## 4. Roles and authorization

### 4.1 Authorization matrix

| Actor | Public page | Draft and preview | Draft changes and uploads | Publish state | Administration and moderation |
|---|---|---|---|---|---|
| Signed-out visitor | View a currently published snapshot. | None. | None. | None. | None. |
| Signed-in non-owner member | Same as a visitor. | None. | None. | None. | None. |
| Eligible page owner | View the public snapshot; access the private editor and preview for their one assigned page. | Read the draft for their page only. | Create, update, reorder, duplicate, delete, autosave, reset, and manage page assets for their page. | Publish when no hold exists; unpublish at any time. | None unless separately an administrator. |
| Administrator who is not the owner | Same public view as any visitor. | **No draft document, draft preview, draft-only image, or private asset access.** | None. | No ordinary V2 publish action. | Create, assign, and reassign pages; inspect state metadata; atomically take down and place a hold; clear a hold without republishing. |
| Administrator who owns the page | Owner powers apply only to their own page; administrator status does not broaden draft access. | Owner access for their own page only. | Owner access for their own page only. | Owner workflow for their own page. | Administrator controls for all pages, without privileged draft access. |
| Domain maintainer | No special application access. | None. | None. | None. | May manage separately hosted subdomain DNS outside this system. |

Every request that reads private data or changes state must authenticate the session and authorize the exact page on the server. Submitted account IDs, slugs, block IDs, asset IDs, revision values, or client feature flags are never authority.

### 4.2 Eligibility and assignment rules

- Owner access requires the current verified-account rules from the member system: active access, eligible membership, and a non-expired session.
- Losing eligibility, being suspended, logging out, or allowing the session to expire removes editing, preview, upload, reset, publish, and unpublish access.
- Loss of eligibility does **not** automatically remove the last live page. The page remains published pending administrator review unless an administrator performs takedown-and-hold.
- Reassignment changes the owner authorization boundary atomically. The new owner receives page-owner access to page-scoped draft data and assets; the previous owner loses it immediately. The administration UI must warn that reassignment transfers private page-scoped material without revealing that material to the administrator.

## 5. Experience flows

### 5.1 Public visitor flow

1. A visitor opens `/m/<slug>`.
2. If the page is currently published, the server renders only `published_doc` inside the fixed HAM frame.
3. If the page is unknown, unpublished, or held, the visitor receives the same branded not-found result with no indication that a page, draft, owner, or asset exists.
4. Links and uploaded images resolve through public-safe rendering and same-origin asset delivery. No editor code is sent to the visitor.

### 5.2 Administrator creation and assignment flow

1. An eligible account signs in so it can be selected.
2. An active administrator creates a page with an available immutable slug, one eligible owner, and the initial display name required by the existing creation flow.
3. Creation seeds an unpublished V2 draft using the Paper theme and its default accent. It does not grant the administrator ongoing draft read or edit access.
4. The owner opens `/m/<slug>`, enters the editor, completes the page, and publishes it.

New V2 pages begin unpublished. The temporary legacy path may preserve its existing initial-publication control only for non-pilot pages while dual-write is active.

### 5.3 Owner editing flow

1. The owner opens their page and chooses **Edit page**.
2. The editor loads the latest private draft and `draft_rev`.
3. Changes appear immediately in the live canvas. Frame values and body blocks use the same public components and theme registry used by server rendering.
4. The owner adds, selects, edits, duplicates, deletes, and reorders blocks through the canvas and inspector.
5. Local changes autosave continuously through a debounced, single-flight server request. A visible status reports unsaved, saving, saved, failed, or conflicted state.
6. Autosave never changes the public page, directory, SEO metadata, public image authorization, or public caches.

### 5.4 Publish flow

1. The owner selects **Publish**.
2. The editor flushes any local pending change and waits for the latest autosave to succeed.
3. The server re-authenticates the owner, deep-validates the complete draft, verifies the expected `draft_rev`, verifies that no moderation hold exists, and verifies every referenced asset is ready and belongs to the page.
4. One guarded SQL statement copies the complete draft document to the published snapshot, updates publication state and timestamps, and denormalizes the published display name and summary to the directory projection.
5. Only after the guarded update succeeds are the public page, directory/API projection, SEO result, and referenced public asset caches invalidated or refreshed.

The frame and body publish as one unit. It must be impossible for a visitor to receive a new display name with an old body, a new body with old website/social links, or any other mixed snapshot.

### 5.5 Unpublish and reset flow

- The owner may explicitly unpublish their page. Unpublishing leaves both draft and last published snapshot stored, but immediately removes public page access and public asset authorization.
- **Reset draft to live** copies the last published snapshot into the draft and increments `draft_rev`. It is available whenever a published snapshot exists, including while the page is currently unpublished or under a moderation hold.
- Reset does not publish, clear a hold, create revision history, or delete unreferenced assets.
- If no published snapshot exists, reset is unavailable.

### 5.6 Moderation flow

1. Moderation begins from community policy, a report, or administrator observation of content that was publicly available. V1 performs no automated scanning.
2. An administrator invokes one **Take down and hold** action.
3. One guarded SQL statement sets the page non-public and enables `moderation_hold` without selecting or changing `draft_doc`, `draft_rev`, or private assets.
4. Public page and asset caches are invalidated immediately.
5. The owner may continue private editing, uploads, preview, autosave, and reset. Publish is rejected while the hold remains.
6. An administrator may later clear the hold. Clearing a hold does not publish the page; the owner must explicitly publish a valid draft.

Administrators receive no private preview capability. After takedown, they have no special access to the unpublished page or its assets.

## 6. HAM design-system contract

### 6.1 Fixed frame

Every V2 page must retain the following HAM-controlled structure and behavior:

- the shared site navigation and footer;
- the current member-page maximum content width and responsive horizontal gutters;
- Bricolage Grotesque for display type and Atkinson Hyperlegible for body/UI type;
- the established HAM type scale and heading hierarchy;
- 2 px structural borders;
- zero or near-zero corner radii;
- hard offset shadows rather than soft elevation;
- the single site paper-grain treatment behind content;
- high-visibility focus rings;
- minimum 44 by 44 CSS pixel interactive targets;
- reduced-motion behavior that removes non-essential movement without removing information;
- one structural page `h1`, the HAM member identity treatment, and consistent `h2`/`h3` generation below it; and
- the primary website action and supported social links in the profile frame rather than in the body.

The public renderer owns spacing, breakpoints, card geometry, shadow offsets, allowable decorative marks, and responsive composition. A member cannot set these values.

### 6.2 Editable frame content

The complete editable frame is part of the draft/published document:

- display name;
- plain-text short summary;
- optional absolute HTTPS personal website;
- optional supported social-profile links;
- optional framed portrait;
- one launch theme; and
- one curated accent allowed by that theme.

The short summary is the only member-authored description used by `/members`, the homepage member preview, and SEO metadata. Rich-text body content is not substituted into directory cards or metadata.

Website and supported socials remain fixed profile-frame fields even when an **Additional links** block exists. The links block is for other destinations and cannot move or replace the structural website/social treatment.

### 6.3 Launch themes and accents

The launch theme IDs are:

| Theme | Requirement |
|---|---|
| `paper` | Default. Must preserve the current member-page appearance on migrated pages. |
| `newsprint` | A light, editorial HAM treatment using only approved internal tokens. |
| `blueprint` | A light technical-drawing HAM treatment; it must not become a dark theme. |
| `riso` | A light print-inspired HAM treatment using restrained approved ink layering. |

Each theme exposes a finite curated accent allowlist and one default accent. Documents store theme and accent IDs, never color values. Every theme/accent pair must have a reviewed semantic token mapping and WCAG 2.2 AA contrast evidence before it can be enabled. An invalid or retired pair fails validation; it does not fall back silently during a write.

The existing Paper tokens are the only exact color values established by current code and this specification:

| Paper token | Current value |
|---|---|
| `paper` | `#f6f1e5` |
| `ink` / `border` | `#1c1a17` |
| `muted` | `#5c5648` |
| `surface` | `#fffdf6` |
| `decorative-red` | `#d93625` |
| `interactive-blue` | `#1d4ed8` |

No exact color is specified here for Newsprint, Blueprint, Riso, or their proposed accents. Their reviewed token table is a required implementation artifact.

### 6.4 Design containment

V2 provides no member controls for:

- arbitrary colors or custom hex values;
- fonts, type sizes, line heights, or letter spacing;
- CSS, classes, scripts, or HTML attributes;
- spacing, widths, columns, grids, breakpoints, or nesting;
- border thickness, radii, shadow shape/offset, rotation/tilt, or grain;
- page or block background images;
- animation, transition, parallax, or motion timing; or
- reordering/removing the structural member identity, website/social region, site navigation, or footer.

## 7. V2 content document

### 7.1 Canonical shape

The document is a closed, versioned JSON object. The following TypeScript-like shape is normative at the field and union level; validators must reject unknown keys.

```ts
type MemberPageDocumentV2 = {
  schemaVersion: 2;
  frame: {
    displayName: string;
    summary: string | null;
    websiteUrl: string | null;
    socialLinks: Partial<Record<SocialPlatformId, string>>;
    portrait: MemberImageRef | null;
    theme: {
      id: "paper" | "newsprint" | "blueprint" | "riso";
      accentId: string;
    };
  };
  blocks: MemberBlock[];
};

type MemberImageRef = {
  assetId: string;
  alt: string | null;
  decorative: boolean;
};

type MemberBlock =
  | RichTextBlock
  | FeaturedProjectBlock
  | ProjectListBlock
  | AdditionalLinksBlock
  | ImageBlock
  | GalleryBlock
  | CalloutQuoteBlock;
```

Every block has a stable opaque `id` generated by the application and a closed `type` discriminator. Asset references contain asset IDs only. A document must never contain an R2 object key, presigned URL, public asset route, data URL, blob URL, or remote image URL.

### 7.2 Frame validation

- `displayName` is trimmed plain text, required, and retains the current maximum of 80 characters.
- `summary` is trimmed plain text or `null` and retains the current maximum of 500 characters.
- `websiteUrl` is `null` or an absolute HTTPS URL without embedded credentials, with the current maximum of 2048 characters.
- `socialLinks` may contain only the server-defined supported keys. The launch set remains `github`, `bluesky`, `mastodon`, `instagram`, `youtube`, `twitch`, and `x`; each value is an absolute HTTPS URL with the current maximum of 2048 characters.
- `portrait`, when present, references one ready asset owned by the page and counts toward the ready-asset quota.
- `theme.id` and `accentId` must resolve to an enabled pair in the shared theme registry.
- All strings are Unicode plain text. Control characters and invalid Unicode must be rejected or normalized consistently by the shared validator.

### 7.3 Image alternative text

Every `MemberImageRef` must satisfy exactly one of these states:

- informative: `decorative` is `false` and `alt` is non-empty plain text; or
- decorative: `decorative` is `true` and `alt` is `null`.

Whitespace-only alt text is invalid. The editor must require the owner to choose and must explain that decorative images are ignored by assistive technology. Captions do not replace alternative text.

### 7.4 Rich-text AST

Rich text is stored as a closed JSON AST, not HTML or Markdown. The root is a `doc` containing only:

- paragraphs;
- level-two and level-three headings;
- unordered lists;
- ordered lists;
- list items containing allowed block nodes;
- block quotes; and
- text nodes with optional bold, italic, or link marks.

Links must be absolute HTTPS URLs without embedded credentials. The AST does not permit `h1`, raw HTML, code blocks, inline code, tables, images, iframes, embeds, scripts, styles, arbitrary attributes, or editor-specific passthrough nodes. Empty structural nodes, excessive nesting, and malformed marks are rejected.

The server renders the validated AST directly from JSON to React elements. It must never render stored rich text through `dangerouslySetInnerHTML`.

### 7.5 Project references

Featured-project and project-list blocks use this closed union:

```ts
type MemberProjectRef =
  | {
      kind: "ham";
      projectSlug: string;
    }
  | {
      kind: "external";
      name: string;
      shortDescription: string;
      type: string;
      status:
        | "planning"
        | "in-development"
        | "playable"
        | "released"
        | "paused"
        | "retired";
      url?: string;
      repository?: string;
      artwork?: MemberImageRef;
    };
```

- A HAM reference is valid only while its slug resolves in the confirmed public HAM project registry. Registry facts remain read-only to the member.
- External project names, short descriptions, type labels, statuses, and URLs retain the current strict server-validation pattern. Existing limits of 80 characters for name/type, 500 for description, and 2048 for URLs remain.
- External project URLs and repository URLs are optional absolute HTTPS links and are not fetched during public rendering.
- External project artwork, when present, is an uploaded ready asset ID. Remote artwork URLs are not stored in V2 documents.

### 7.6 Block field shapes

The launch block payloads use these closed shapes. `null` is used instead of omitted optional member-authored text where shown so editor and server normalization remain deterministic.

```ts
type RichTextBlock = {
  id: string;
  type: "richText";
  content: RichTextDoc;
};

type FeaturedProjectBlock = {
  id: string;
  type: "featuredProject";
  variant: "card" | "artwork-first";
  project: MemberProjectRef;
};

type ProjectListBlock = {
  id: string;
  type: "projectList";
  variant: "stacked" | "compact";
  projects: Array<{
    id: string;
    project: MemberProjectRef;
  }>;
};

type AdditionalLinksBlock = {
  id: string;
  type: "additionalLinks";
  variant: "list" | "buttons";
  links: Array<{
    id: string;
    label: string;
    url: string;
    description: string | null;
  }>;
};

type ImageBlock = {
  id: string;
  type: "image";
  variant: "framed" | "wide";
  image: MemberImageRef;
  caption: string | null;
};

type GalleryBlock = {
  id: string;
  type: "gallery";
  variant: "grid" | "strip";
  items: Array<{
    id: string;
    image: MemberImageRef;
    caption: string | null;
  }>;
};

type CalloutQuoteBlock = {
  id: string;
  type: "calloutQuote";
  variant: "note" | "quote";
  text: string;
  attribution: string | null;
};
```

- Project-list and additional-link arrays must be non-empty. Gallery arrays must contain at least two items.
- Entry IDs are stable opaque application-generated IDs used for focus, errors, and reorder operations; they are not public database identifiers.
- Labels, descriptions, captions, callout text, and attribution are plain text. Their centralized limits must be set before pilot as required by strict validation; none may be interpreted as rich text.
- `attribution` is valid only for the `quote` variant and must be `null` for `note`.
- Duplicate project or link destinations may be warned about in the editor but are not a new layout capability. The server remains authoritative for structural validity.

## 8. Block catalog and limits

### 8.1 Page-level limits

- A body contains zero to 12 blocks. Attempts to add, duplicate, restore, or save a thirteenth block must fail visibly.
- The block array is flat and its stored order is the public reading order.
- Blocks cannot contain other member blocks. There are no member-authored columns, nested sections, free grids, or breakpoint controls.
- A page may contain at most one `featuredProject` block.
- The page may contain project-list blocks in addition to the one featured project.
- A page may store at most 20 **ready** assets. The optional portrait is included. Reusing one asset ID in more than one valid location does not consume another stored-asset slot.

### 8.2 Launch blocks

| Block | Required content | Launch variants and rules |
|---|---|---|
| **Rich text** | One valid rich-text AST. | One renderer-controlled presentation. H2/H3 styling follows the page hierarchy beneath the frame H1. |
| **Featured project** | One valid HAM or external project reference. | `card` (default) or `artwork-first`. At most one block of this type per page. Both remain single responsive components, not layout containers. |
| **Project list** | One or more valid HAM/external project references. | `stacked` or `compact`. The member cannot select column count or card dimensions. |
| **Additional links** | Labeled absolute HTTPS links, with optional short plain-text descriptions. | `list` or `buttons`. This block supplements but does not replace frame website/social links. No platform embeds or URL previews. |
| **Image** | One valid image reference; optional plain-text caption. | `framed` or `wide`. `wide` means the renderer's approved wide treatment inside the HAM page width, never viewport-controlled full bleed. |
| **Gallery** | An ordered set of two or more valid image references; optional per-image captions. | `grid` or `strip`. Responsive layout is fixed by the renderer; there is no masonry, arbitrary placement, or member-selected column count. |
| **Callout / quote** | Plain text; quote attribution is optional. | `note` or `quote`. This is a semantic visual block, not arbitrary rich HTML. |

Variants are closed enums. They may select only reviewed public components and semantic theme tokens. Adding a new block or variant requires a schema-version-compatible validator, public renderer, editor control, accessibility evidence, migration/default behavior, and test coverage.

### 8.3 Block operations

- **Add** inserts a valid default block at a deterministic location chosen by the user.
- **Duplicate** creates a new block ID and copies content. Asset IDs may be shared; duplication does not duplicate stored objects.
- **Delete** removes the block from the draft only. It does not delete an asset still referenced by either document.
- **Reorder** changes only the flat array order.
- Every operation participates in the same autosave and optimistic-revision workflow as field edits.

## 9. Editor behavior, responsive design, and accessibility

### 9.1 Shared rendering architecture

- The editor is a structured WYSIWYG canvas, not a form that approximates the public result.
- Canvas blocks and frame content use the actual public rendering components and theme registry.
- Editor-only selection outlines, handles, controls, validation messages, and drop indicators must be layered around those components and must never appear in public output.
- TipTap is used only inside rich-text blocks. Other blocks use typed React controls.
- Public rendering is server-side JSON-to-React. Public visitors must not download TipTap, sortable/editor libraries, inspector code, upload code, or draft state logic.

### 9.2 Desktop editor

- The primary desktop layout is a public-page canvas beside a pinned inspector panel.
- The canvas preserves the real page width, responsive block components, theme, and frame structure at a useful editing scale.
- Selecting a frame region or block opens its typed controls in the inspector and creates an unmistakable selected state in the canvas.
- Keyboard focus and validation errors remain distinguishable from selection and are not indicated by color alone.
- The add-block control, publication controls, and autosave state remain discoverable without requiring hover.

### 9.3 Mobile editor

- Full editing is supported on mobile; mobile is not preview-only.
- A persistent **Edit / Preview** mode control lets the owner switch between interaction with editing chrome and an unobstructed draft preview.
- The inspector appears as an accessible bottom sheet sized around the current field group. It must not hide the active input behind the virtual keyboard.
- Focus returns to the selected block or invoking control when the sheet closes.
- The editor must work without horizontal scrolling at 375 CSS pixels and through text zoom and large-text settings.

### 9.4 Block manipulation

- Pointer/touch dragging uses an accessible sortable library and visible drag handles.
- Dragging is never the only reorder mechanism. Every selected block provides explicit **Move up** and **Move down** controls with correct disabled states.
- Reorder results are announced through a polite live region, for example, “Moved Gallery to position 3 of 7.”
- Keyboard sorting, explicit movement, and pointer sorting must produce the same stored order.
- Add, duplicate, delete, and reorder controls meet the 44 by 44 CSS pixel target minimum and have accessible names that include the block type where useful.
- Destructive deletion requires a clear confirmation or an immediately available undo before the delete autosaves.

### 9.5 Autosave and feedback

- Local state updates the canvas immediately.
- Server saves are debounced and single-flight: at most one draft save is in progress, and later local edits are coalesced into the next request.
- The editor exposes at least these states in text and through an appropriate live region: **Unsaved changes**, **Saving…**, **Saved**, **Save failed**, and **Conflict detected**.
- A save error leaves local changes intact and provides a retry path.
- A revision conflict must stop automatic overwriting, preserve the local in-memory document, and ask the owner to reload the server draft or explicitly retry from a newly fetched revision. V2 has no revision browser or automatic merge UI.
- Navigating away with unsaved or failed local changes must produce an appropriate warning where the platform permits it.

### 9.6 Validation and error UX

- Client validation is advisory; the server validator is authoritative.
- Errors are shown in a summary and at the relevant frame field, block, project entry, rich-text region, or image reference.
- The first invalid control receives or is offered focus after a failed explicit publish.
- A block with an error remains selectable and movable; errors must not corrupt or silently remove content.
- Theme, focus, hover, press, selected, saving, conflict, and error states must satisfy WCAG 2.2 AA and reduced-motion requirements.

## 10. Draft, publication, and moderation state machine

### 10.1 Stored state

Each page has:

- exactly one private `draft_doc`;
- zero or one `published_doc` snapshot;
- a monotonically increasing `draft_rev`;
- an `is_published` public-state flag retained from the existing row;
- draft and publication timestamps; and
- a `moderation_hold` flag with moderation timestamps.

`published_doc` may remain stored while `is_published = FALSE` so reset and reference-safe asset deletion remain possible. Stored does not mean publicly accessible.

### 10.2 Transitions

| Event | Actor | Preconditions | Atomic result | Public cache effect |
|---|---|---|---|---|
| Autosave draft | Owner | Active owner session; expected `draft_rev`; deeply valid draft. | Replace `draft_doc`, increment `draft_rev`, update draft timestamp. Hold is not checked. | None. |
| Reset draft to live | Owner | Active owner session; expected `draft_rev`; `published_doc` exists. | Copy `published_doc` to `draft_doc`, increment `draft_rev`, update draft timestamp. Hold is not checked. | None. |
| Publish | Owner | Active owner session; expected `draft_rev`; valid complete draft; all assets ready and owned; no hold. | Copy entire draft to `published_doc`; set public; update projection and timestamps. | Revalidate page, directory/API, SEO, and referenced assets. |
| Unpublish | Owner | Active owner session. | Set non-public and update timestamp; retain both documents. | Immediately invalidate page, directory/API, SEO, and public asset authorization. |
| Take down and hold | Administrator | Active admin session; target page exists. | Set non-public and set hold in one statement; do not read or alter draft. | Same invalidation as unpublish. |
| Clear hold | Administrator | Active admin session; target page is held. | Clear hold; leave page non-public. | No public page becomes available. |
| Eligibility loss | Authentication system | Owner no longer qualifies for a verified account. | No automatic document or publication mutation. | None until administrator review/action. |

### 10.3 Invariants

1. Public page, directory, API, metadata, and public assets are derived only from a currently published snapshot.
2. Autosave cannot change any public result or trigger public cache revalidation.
3. Publish copies the whole member-editable frame and body atomically.
4. The published display name and summary projection is updated in the same guarded publish statement as `published_doc`.
5. A moderation hold blocks publish only. It does not block draft reads by the owner, editing, uploads, autosave, preview, reset, or unpublish.
6. Takedown-and-hold does not grant the administrator draft or asset access and does not mutate the draft.
7. Assets are page-owned and cannot be referenced across pages. Unpublishing or takedown immediately makes every asset owned by that page non-public.
8. A failed revision guard changes nothing and returns a typed conflict result.
9. The public renderer never overlays draft frame fields onto a published body or vice versa.
10. There is no shareable draft token, historical revision list, scheduled state, or per-block publication state.

### 10.4 Guarded SQL pattern

**Implementation guidance**: Because the current Neon HTTP driver does not provide interactive transactions, each database state transition must be one SQL statement with all authorization/state guards in `WHERE` and exact output in `RETURNING`.

Autosave follows this shape after server validation:

```sql
UPDATE public.member_pages
SET draft_doc = $validated_doc,
    draft_rev = draft_rev + 1,
    draft_updated_at = NOW(),
    updated_at = NOW()
WHERE id = $page_id
  AND owner_account_id = $verified_account_id
  AND draft_rev = $expected_draft_rev
RETURNING draft_rev, draft_updated_at;
```

Publish follows this shape, with projection values derived from the already validated draft held by the server:

```sql
UPDATE public.member_pages
SET published_doc = draft_doc,
    display_name = $validated_display_name,
    blurb = $validated_summary,
    is_published = TRUE,
    published_at = NOW(),
    updated_at = NOW()
WHERE id = $page_id
  AND owner_account_id = $verified_account_id
  AND draft_rev = $expected_draft_rev
  AND moderation_hold = FALSE
RETURNING slug, draft_rev, published_at;
```

Equivalent single-statement guards are required for reset, unpublish, takedown-and-hold, clear-hold, reassignment, ready-asset finalization, and asset deletion eligibility.

## 11. Uploads, storage, and asset lifecycle

### 11.1 Storage boundary

- Member images are stored in a Cloudflare R2 general-availability bucket configured as **private**.
- The bucket must have no public bucket URL or public custom domain.
- Browsers upload through short-lived presigned direct `PUT` requests issued only to the authenticated owner for that page.
- Public and private reads use a same-origin application asset route keyed by asset ID. Documents never store delivery URLs.
- R2 credentials remain server-only. Object keys are opaque application-generated values and may appear only inside the narrowly scoped presigned upload request; they must not appear in member documents, public DTOs, logs, or ordinary UI.

### 11.2 Accepted images

- Accepted formats: JPEG, PNG, WebP, and AVIF.
- Rejected formats include SVG and GIF regardless of filename or claimed MIME type.
- The normalized stored file must be no larger than 5 MB.
- Neither pixel dimension may exceed 4000 pixels.
- Animated WebP/AVIF and any other member-authored animated image are rejected for V1.
- Every use requires valid alternative text or explicit decorative status as defined above.

### 11.3 Upload sequence

1. The client decodes the selected image, applies orientation, downsizes it when needed, and re-encodes it to an allowed safe format. This normalization strips EXIF and other source metadata before upload.
2. The client requests an upload allocation with the page ID and normalized size/type metadata.
3. The server re-authenticates the owner, verifies exact page ownership, applies rate/outstanding-upload limits, allocates an opaque asset ID and random object key, records a short-lived pending row, and returns a narrowly scoped presigned `PUT`.
4. The client uploads directly to R2 without making the bucket public.
5. The client calls a finalize endpoint for the asset ID.
6. The server verifies the stored object's signature-derived format, MIME consistency, byte size, pixel dimensions, animation status, and page/object binding. It must not trust the filename, browser MIME value, or submitted dimensions.
7. A guarded statement marks the asset ready only if the owning page remains valid and fewer than 20 ready assets already exist for that page.
8. Only ready assets may be inserted into a draft document.

A failed upload or finalize does not consume a ready-asset quota slot. It may leave a pending object eligible for opportunistic cleanup.

### 11.4 Asset authorization and delivery

For a ready asset, the same-origin route authorizes each request as follows:

1. If the asset ID is referenced by the `published_doc` of its page and that page is currently published and not held, the route may serve it publicly with cacheable headers.
2. Otherwise, if the requester is the current eligible owner of the page, the route may serve it privately with `Cache-Control: private, no-store` and `Vary: Cookie` as appropriate.
3. Everyone else, including an administrator who is not the owner, receives `404`.

Unpublishing and takedown must invalidate CDN/application authorization for the page and its assets so subsequent requests are private immediately. Previously downloaded bytes in a browser cannot be recalled, but the origin and shared caches must stop serving them publicly.

Ready assets are immutable. Replacing an image creates a new asset ID; it does not overwrite the object behind an existing ID. Width, height, byte size, and verified MIME metadata are used to reserve layout space and provide correct response headers.

### 11.5 Quota and deletion

- The quota is **20 stored ready assets per page**, not 20 references, uploads attempted, or pending rows.
- The portrait counts toward the same quota.
- Pending allocations are separately short-lived and rate-limited so they cannot bypass storage controls.
- An asset may be deleted only when its ID is unreferenced by both `draft_doc` and `published_doc`.
- Removing a reference from the draft is insufficient when the last published snapshot still references the asset.
- Deleting or duplicating a block never silently deletes an object.
- Explicit asset deletion must use a guarded reference check and return a conflict if either document gained a reference.
- Expired pending rows and unfinalized objects are cleaned opportunistically during editor load, upload allocation/finalization, or other owner asset operations. V1 adds no background worker, queue, or cron infrastructure.

R2's permanent free allowances are expected to cover the projected modest usage, but this expectation is non-normative and must not appear as a product or availability claim. Quotas remain enforced regardless of current vendor pricing or allowances.

## 12. Validation, security, moderation, and privacy

### 12.1 Strict validation

- Follow the current codebase pattern: accept `unknown`, require plain objects, allow only known keys, parse closed discriminated unions, normalize strings, and return typed validation errors.
- Validate the complete document deeply in TypeScript on every draft write, reset result, publish, migration read, and public read boundary.
- PostgreSQL constraints provide shallow defense: JSON object/array shape, schema version presence where practical, nullability, scalar limits, state values, foreign keys, and uniqueness. They do not replace deep TypeScript validation.
- Reject documents above the 12-block limit, unknown themes/accents/blocks/variants/nodes/marks/social platforms, invalid asset references, a second featured project, or invalid alt/decorative combinations.
- Apply bounded serialized-document, text, collection, and rich-text node limits as centralized shared constants so malformed JSON cannot create excessive CPU, memory, database, or rendered-DOM work. The implementation must record and test the final constants before pilot enablement.

### 12.2 Link and content safety

- Every member-authored link is an absolute HTTPS URL without credentials.
- Public external links use appropriate `rel="noopener noreferrer"` behavior and visible or accessible labels.
- No document field is interpreted as HTML, Markdown, CSS, JavaScript, a URL template, or a React component name.
- Text is rendered through normal React escaping.
- Public rendering performs no arbitrary remote fetch based on member content. External project links remain links, not embeds or automatic previews.

### 12.3 Authentication and authorization

- Continue using the verified `__Host-session` flow and repeat active-session checks for every private read and mutation.
- Resolve the owner from the verified account and database assignment, never from a submitted owner ID.
- Bind draft writes, publish, unpublish, reset, upload, finalize, and deletion queries to the exact page and verified owner.
- Bind administrator create/assign/reassign/hold operations to a freshly verified active administrator.
- Apply CSRF protections inherent to the current server action/route pattern and do not expose mutation endpoints as unauthenticated cross-origin operations.
- Rate-limit or otherwise bound upload allocation/finalization, publish, and abusive autosave retry paths.

### 12.4 Privacy boundary

- Administrator queries and DTOs must not select, serialize, log, cache, or return `draft_doc`, draft rich text, draft asset lists, presigned URLs, or private asset bytes.
- The administration UI may show slug, owner assignment, eligibility signal, publication state, hold state, public directory projection, and timestamps needed for operations.
- A draft response is owner-only, private, no-store, and varies by cookie. It must not be included in static generation, public cache keys, error telemetry, or analytics payloads.
- Public DTOs contain only published member content. They never expose account IDs, Discord IDs, roles, revision numbers, object keys, moderation metadata, or draft timestamps.
- Asset responses use `404`, not `403`, when the requester must not learn that a private asset exists.

### 12.5 Moderation model

V1 moderation consists of:

- technical validation before storage/publication;
- the applicable HAM community content policy;
- reports and administrator review; and
- the atomic takedown-and-hold action.

There is no automated text classification, image scanning, facial recognition, hash matching, or third-party moderation service in V1. Technical image parsing and format validation are security controls, not content moderation.

## 13. Architecture direction

### 13.1 Required boundaries

- Use a thin custom typed React block shell.
- Use TipTap only for rich-text block editing.
- Use an accessible sortable library for pointer/keyboard drag behavior and retain explicit move controls.
- Use standard React state, reducers, and context as appropriate. This specification does not prescribe Zustand or another global state library.
- Keep one shared schema/validator vocabulary for editor payloads, server mutations, migration verification, and public rendering.
- Render rich-text JSON and block JSON to React on the server; never use `dangerouslySetInnerHTML`.
- Split owner editor code from public rendering so ordinary public visitors receive no editor bundle.
- Keep public block components independent of authenticated editor state.

### 13.2 Suggested module separation

**Implementation guidance**: The existing `src/lib/members/` boundary should continue to own server-only member DTOs, validation, authorization, and data access. Add focused modules for V2 document types/validation, themes, block rendering, draft mutations, and assets rather than expanding one file without bound. Public block components may live in a shared component directory; editor wrappers should remain client-only and separately imported.

## 14. Data model

### 14.1 `member_pages` additive columns

Use the existing `member_pages` row as the source of page identity, assignment, slug, and publication projection. Add the simplest robust V2 state:

| Column | Rule |
|---|---|
| `draft_doc JSONB` | One private V2 document. Non-null after backfill. |
| `published_doc JSONB` | Last V2 published snapshot or `NULL` when none has ever existed. |
| `draft_rev BIGINT` | Non-negative monotonic revision used by guarded draft writes. |
| `draft_updated_at TIMESTAMPTZ` | Last successful draft mutation. |
| `published_at TIMESTAMPTZ` | Last successful publish time, nullable. |
| `unpublished_at TIMESTAMPTZ` | Last owner/admin takedown time, nullable. |
| `moderation_hold BOOLEAN` | Non-null, default false. A true value must imply the page is not public. |
| `moderation_held_at TIMESTAMPTZ` | Last hold time, nullable. |

Existing `display_name` and `blurb` remain the published directory/SEO projection and are updated only by the appropriate publish or legacy bridge statement. Existing `website_url`, `social_links`, `showcase`, `is_published`, and other legacy columns remain through the pilot and rollback window.

The migration may add narrowly necessary moderation timestamps or actor IDs for auditability, but it must not add a second draft table, revision-history table, collaborative-edit table, or generalized workflow engine.

### 14.2 `member_page_assets`

Add a separate metadata table with at least:

| Column | Rule |
|---|---|
| `id UUID` | Publicly opaque asset identifier and primary key. |
| `member_page_id UUID` | Required foreign key to the owning page. |
| `object_key TEXT` | Required random private R2 key, unique and server-only. |
| `status` | Closed values for `pending` and `ready`. |
| `mime_type` | Server-verified JPEG/PNG/WebP/AVIF MIME value; nullable until ready. |
| `byte_size` | Server-verified byte count; nullable until ready. |
| `width`, `height` | Server-verified pixel dimensions; nullable until ready. |
| `created_at`, `ready_at` | Lifecycle timestamps. |
| `pending_expires_at` | Cleanup boundary for unfinalized uploads. |

Alternative text and captions remain use-specific content in the documents, not global asset metadata. Runtime-role grants must be limited to the exact columns and operations used by owner and public serving paths.

### 14.3 Database constraints and statements

- Additive migration constraints enforce nullability, status values, non-negative revisions/dimensions/sizes, foreign keys, uniqueness, and shallow JSON type checks.
- Deep document validity remains a TypeScript responsibility and must fail closed on read as well as write.
- Publication, autosave, reset, unpublish, hold, and projection changes are single guarded SQL statements with `RETURNING`.
- R2 and Postgres cannot be one transaction. Pending/ready metadata states provide the recovery boundary; no document may reference a pending asset.

## 15. Migration, cutover, and rollback

### 15.1 Backfill

The additive migration/backfill covers every existing page, not only pilot pages:

- `display_name` -> `frame.displayName`;
- `blurb` -> `frame.summary`;
- `website_url` -> `frame.websiteUrl`;
- `social_links` -> `frame.socialLinks`;
- no current portrait -> `frame.portrait = null`;
- theme -> `paper` with the Paper default accent; and
- current `showcase`, when present, -> the single `featuredProject` block.

A registered showcase maps to a HAM registry project reference. An external showcase maps to an external project reference. Essential website/social destinations remain in the frame and must not be converted into an Additional links block.

Because V2 documents may contain asset IDs but never image URLs, any existing external showcase artwork URL required for render parity must be safely fetched by reviewed migration tooling, revalidated across redirects/DNS, normalized, uploaded to the private bucket, verified, and represented by a ready asset ID. A failed import blocks parity sign-off for that page; it must not cause a remote URL to be written into V2 JSON.

For a currently published page, initialize `draft_doc` and `published_doc` to the same converted document and preserve its current projection/public state. For an unpublished page, initialize `draft_doc` and leave `published_doc` null unless a verified historical published snapshot is available. Initialize a known `draft_rev` and timestamps consistently.

Backfill verification must compare every existing public page against the V2 Paper rendering and demonstrate no visible content loss or reordering.

### 15.2 Neon procedure

- Commit the migration SQL before execution.
- Rehearse it on an expiring Neon branch created directly from production, following [Neon migration runbook](../../NEON_MIGRATIONS.md).
- Use the direct non-pooled owner connection and the runbook's single-transaction procedure.
- Verify columns, constraints, indexes, least-privilege grants, row counts, converted document validity, publication parity, and runtime-role queries.
- Apply the database migration before deploying code that requires the new columns.
- Recheck production state immediately before applying the unchanged migration.

### 15.3 Pilot bridge and dual-write

- Backfill all pages before the production pilot starts.
- A server-side feature flag allowlists 5-10 production member pages/accounts for the V2 editor.
- Pilot owners use only the V2 draft/publish workflow.
- Non-pilot owners continue to use the legacy editor during the bridge.
- Every legacy editor save must also write a V2-compatible `draft_doc` and increment `draft_rev` in the same guarded statement.
- To preserve the legacy editor's current immediate-public behavior, a legacy save to a currently published non-pilot page must also update `published_doc` and the public projection in that same statement.
- Temporary legacy administrator publish/unpublish actions must keep `published_doc`, `is_published`, and projection state consistent for non-pilot pages.
- The V2 editor must never write legacy content by reducing a rich V2 document to the old showcase-only model. V2 documents remain authoritative for pilot pages.

Legacy dual-write is a release requirement, not optional cleanup. It prevents non-pilot edits during the two-week pilot from becoming stale or unconvertible at general cutover.

### 15.4 Cutover

General release requires:

- successful production backfill and V2 validation for all pages;
- Paper render parity for migrated pages;
- no observed draft loss or unresolved revision corruption during the pilot;
- complete desktop and mobile editing flows;
- WCAG 2.2 AA evidence for the end-to-end owner flow;
- design containment across all themes, accents, blocks, and responsive widths;
- passing owner/admin/visitor authorization and state-transition tests;
- passing asset privacy, quota, cache-revocation, and lifecycle tests; and
- verified moderation takedown, hold, continued draft editing, reset, hold release, and owner republish behavior.

After the gate passes, enable the V2 editor for all assigned owners. Remove the legacy editor only in a later cleanup release after confirming no legacy-only writes remain.

### 15.5 Rollback

- The schema migration is additive and remains in place during an application rollback.
- The safe rollback target after pilot data exists is the bridge release that can read V2 documents and preserves legacy dual-write, not a pre-V2 binary that is unaware of pilot content.
- Rollback may disable V2 editing/publishing while retaining a V2 read-only public renderer for already published V2 snapshots.
- Do not delete V2 documents or R2 assets, decrement revisions, or perform a lossy conversion back to the legacy showcase model.
- Existing legacy columns remain available through the pilot and rollback period.
- Dropping old content columns requires a separate later migration after the V2 editor has been generally available and the legacy path has been removed.

## 16. Performance, caching, SEO, and directory behavior

### 16.1 Public rendering and bundles

- Published pages are server-rendered from validated `published_doc` data.
- The 12-block and 20-ready-asset ceilings bound page and editor complexity.
- Ready asset metadata supplies intrinsic dimensions to prevent layout shift.
- Public pages load no editor, TipTap, sortable, upload, inspector, or autosave JavaScript for visitors.
- Owner editor/preview responses are private and no-store.
- Public rendering must fail closed rather than expose raw malformed JSON. Operational errors use the branded error/not-found behavior without leaking private data.

### 16.2 Cache rules

- Draft fetches, preview, autosave, upload allocation/finalization, and private asset responses are private/no-store and never populate shared public caches.
- Autosave and reset do not invalidate `/m/<slug>`, `/members`, `/api/members`, metadata, or public asset caches.
- Publish invalidates or refreshes the member page, directory/API projection, metadata, and all assets newly authorized by the snapshot.
- Unpublish and takedown invalidate the member page, directory/API projection, metadata, and all assets previously public through that page.
- Public asset cache keys are based on immutable asset IDs. Cache invalidation/tagging must still revoke shared-cache authorization when the page becomes non-public.

### 16.3 Directory and homepage projection

- `/members`, the homepage member preview, and `/api/members` include only currently published pages.
- Their data remains the minimal projection: `slug`, published `displayName`, and published optional `blurb`/summary.
- Theme, accent, portrait, body blocks, account IDs, revision state, and moderation state are not added to the directory DTO in V2.
- Stable ordering remains case-insensitive published display name, then slug, unless the directory specification is separately revised.
- A draft display-name or summary change does not appear in any directory surface until publish succeeds.

### 16.4 SEO

- A published page title remains `<published display name> — HAM`.
- The metadata description uses only the published plain-text summary, with the existing HAM member fallback when summary is null.
- Canonical URLs remain `/m/<slug>`.
- Unpublished, held, unknown, editor, and owner-preview states are not indexable and must not expose draft metadata.
- Rich-text body content is not automatically used as an SEO description.

## 17. Acceptance criteria

### 17.1 Authorization and privacy

- An administrator can create and assign one immutable-slug page to one eligible account, and one account cannot own two pages.
- Only the current eligible owner can read or mutate the draft, preview it, upload assets, reset it, publish it, or unpublish it.
- An administrator who is not the owner cannot retrieve draft JSON, preview HTML, presigned upload data, or non-public assets.
- Public unknown, unpublished, and held pages produce indistinguishable not-found behavior.
- Loss of owner eligibility removes editing access while leaving the last published snapshot live pending administrator review.
- Reassignment removes previous-owner access and grants new-owner page access atomically.

### 17.2 Content and design containment

- A page publishes the complete frame and body atomically.
- Display name, plain summary, website, socials, portrait, theme, and accent all remain draft-only until publish.
- Website and supported socials always render in the fixed profile frame, not as migrated body links.
- Paper migration preserves current appearance and content.
- Newsprint, Blueprint, and Riso are light themes with finite curated accents and documented contrast evidence.
- No payload can introduce arbitrary colors, fonts, CSS, layout, shadows, tilts, background images, HTML, Markdown, embeds, or animation controls.
- A valid page contains no more than 12 flat ordered blocks and no more than one featured project.

### 17.3 Editor and accessibility

- The canvas and public page use the same block/frame rendering components.
- Desktop provides a usable canvas with pinned inspector; mobile provides full editing, a bottom-sheet inspector, and Edit/Preview modes.
- Add, duplicate, delete, drag, explicit move, and reorder announcement flows work with pointer, touch, and keyboard.
- Selection, focus, errors, and autosave state are distinguishable and announced appropriately.
- The complete owner flow works at 375 CSS pixels, with keyboard only, screen reader, touch, 200% text zoom, and reduced motion.
- All interactive targets meet the 44 by 44 CSS pixel minimum and all required flow contrast meets WCAG 2.2 AA.

### 17.4 Draft and publication

- Local edits render immediately and autosave through debounced single-flight requests.
- Autosave changes only `draft_doc`/revision/timestamps and never changes public caches or directory/SEO output.
- Two editors with the same starting revision cannot silently overwrite each other; the loser receives a conflict.
- Publish flushes pending local changes, verifies the expected revision, and produces one exact public snapshot.
- Unpublish immediately returns the page and all page assets to private behavior while retaining the snapshot for reset/reference safety.
- Reset copies the last published snapshot to the draft even while held and does not publish.
- No revision browser or shareable preview route exists.

### 17.5 Moderation

- The administrator takedown action sets non-public and hold state atomically.
- A held owner can continue editing, uploading, previewing, autosaving, and resetting.
- A held owner cannot publish.
- Clearing a hold does not republish; the owner must publish explicitly.
- Moderation actions never expose or alter private draft content.
- No automated moderation/scanning service is present.

### 17.6 Assets

- The R2 bucket remains private and uploads use owner-authorized short-lived direct `PUT` URLs.
- Client normalization strips EXIF and enforces downscaling/re-encoding before upload; server verification independently enforces actual signature, MIME, size, dimensions, and non-animation.
- JPEG, PNG, WebP, and AVIF up to 5 MB and 4000 pixels per dimension can become ready; SVG, GIF, spoofed, oversized, over-dimension, and animated files cannot.
- Documents reference ready asset IDs only.
- The quota allows at most 20 stored ready assets per page including portrait; pending uploads do not count as ready.
- Published references are publicly/cacheably served, non-public references are owner-only/no-store, and every other requester receives `404`.
- An asset cannot be deleted while referenced by either draft or published document.
- Expired pending uploads can be cleaned without a background worker.

### 17.7 Migration and rollout

- Every current page has a valid V2 draft before pilot enablement.
- Current published pages have matching initial draft/published documents and no visible public change in Paper.
- Current showcase maps to featured project; website/social remain frame fields.
- Existing remote showcase artwork, if any, is migrated to a verified private R2 asset ID rather than retained as a document URL.
- The migration is rehearsed on an expiring Neon branch according to the runbook and applied before dependent application code.
- The 5-10 member production pilot runs for two weeks behind a server-side flag.
- Every non-pilot legacy edit dual-writes a current V2-compatible document through cutover.
- Old columns are not dropped during pilot, general enablement, or immediate legacy-editor removal.

## 18. Test and evidence matrix

| Area | Automated evidence | Manual/release evidence |
|---|---|---|
| Schema and migration | Constraint/index/grant tests; backfill validator; published/unpublished conversion fixtures; idempotence/drift checks. | Expiring-branch rehearsal record, production pre/post state, row counts, runtime-role query results. |
| Document validation | Closed-union tests for every theme, accent, block, variant, rich-text node/mark, URL, social key, project ref, alt state, and limit. | Review of finalized schema constants and representative validation messages. |
| Owner authorization | Signed-out, wrong-owner, forged page/asset/revision, expired, ineligible, and suspended-session tests. | Smoke test as owner, different member, administrator non-owner, and signed-out visitor. |
| Admin privacy | DTO/query tests proving draft/private asset fields are not selected or returned; asset-route `404` tests. | Network and UI inspection of `/admin/members`; verify no draft preview path exists. |
| Autosave/conflicts | Debounce/single-flight tests; revision guard race; retry/failure behavior; no public revalidation assertion. | Multi-tab conflict exercise and network-interruption recovery without draft loss. |
| Publication state | Atomic publish/projection test; unpublish; reset; no-snapshot reset; cache invalidation hooks. | Observe exact frame/body snapshot before and after publish and immediate public 404 after unpublish. |
| Moderation | Takedown-and-hold single-statement behavior; hold publish rejection; editing/reset allowed; clear hold remains unpublished. | Report-to-takedown smoke flow without administrator draft access. |
| Upload security | Signature/MIME mismatch, SVG/GIF, animated image, EXIF, oversized, over-dimension, wrong owner/page, expired presign, and quota race tests. | Upload accepted formats on desktop/mobile; inspect normalized metadata and private bucket configuration. |
| Asset lifecycle | Pending/ready transition, 20-ready quota, portrait count, dual-document reference guard, cleanup, public/private/404 route tests. | Publish/unpublish cache-revocation check using a previously public asset URL. |
| Rendering security | JSON-to-React rich-text fixtures; URL sanitation; no `dangerouslySetInnerHTML`; no editor imports in public visitor graph. | Inspect rendered headings, lists, quotes, links, and production public bundles. |
| Accessibility | Component and flow tests for labels, focus, live regions, move controls, bottom-sheet focus, reduced motion, and target sizes. | WCAG 2.2 AA audit with keyboard, screen reader, touch, 375 px, 200% text zoom, and reduced motion. |
| Design containment | Schema rejection tests for arbitrary style/layout fields; theme registry allowlist tests. | Visual review of all themes/accents/blocks at phone, tablet, and desktop widths; contrast evidence. |
| Directory, SEO, cache | Projection-only query tests; draft isolation; canonical/title/description; unknown/unpublished/held behavior. | Signed-out checks of `/`, `/members`, `/m/<slug>`, metadata, and cache changes only on public transitions. |
| Pilot bridge | Legacy-save dual-write tests for published/unpublished pages; feature-flag authorization; V2-to-legacy lossy write prohibition. | Two-week pilot record covering draft-loss incidents, desktop/mobile completion, moderation behavior, and cutover gate sign-off. |

## 19. Pilot rollout

1. **Schema and storage readiness** — Create the private R2 bucket/configuration, commit and rehearse the additive Neon migration, verify grants, and backfill all pages.
2. **Bridge deployment** — Deploy V2 read/validation support and mandatory legacy dual-write before enabling any V2 editor.
3. **Parity gate** — Compare every migrated published page in Paper against the current public result. Resolve all document and artwork conversion failures.
4. **Production pilot** — Allowlist 5-10 assigned members for two weeks. Pilot owners use the V2 editor; all other owners remain on the dual-writing legacy editor.
5. **Pilot evidence review** — Confirm no draft loss, no unauthorized draft/asset access, no cache leaks, successful desktop/mobile editing, WCAG 2.2 AA flow evidence, design containment, correct moderation behavior, and acceptable operational storage behavior.
6. **General enablement** — Enable V2 for all assigned owners only after every cutover criterion passes.
7. **Later cleanup** — Remove the legacy editor after an observation period. Drop old columns only through a separate later migration after rollback dependence ends.

The feature flag must be enforced on the server. A client flag must not grant editor, draft, upload, or publication access.

## 20. Out of scope for V1 personalization

- Nightshift or any other dark theme.
- Nested blocks, sections as layout containers, member-defined columns, or a free grid.
- Custom hex colors, fonts, CSS, HTML, JavaScript, spacing, shadows, tilts, radii, or breakpoints.
- Video, audio, iframes, third-party embeds, live URL previews, or remote image hotlinking.
- Raw HTML, Markdown input/storage, or arbitrary TipTap extensions.
- Shareable draft links or administrator/private preview links.
- Historical revisions, revision browsing, scheduled publishing, or per-block visibility/publication.
- Multiple owners, collaboration, comments, approval workflows, or delegated editors.
- Page analytics, popularity signals, or member-facing traffic reports.
- Automated content moderation, image scanning, or third-party policy classification.
- Password-protected pages.
- Page or block background images.
- Member-authored animation or motion controls, including animated uploads.
- Background workers, durable queues, or cron infrastructure for upload cleanup.
- Public R2 bucket access or storing asset URLs in member documents.
- DNS automation or integration with separately hosted member subdomains.

## 21. Related documents

- [Historical V1 member-page specification](MEMBER_PAGES_SPEC.md)
- [Historical V1 member-page implementation plan](MEMBER_PAGES_IMPLEMENTATION.md)
- [Members directory experience](MEMBERS_DIRECTORY_SPEC.md)
- [Member system and authentication](MEMBER_SYSTEM_SPEC.md)
- [Neon migration runbook](../../NEON_MIGRATIONS.md)
