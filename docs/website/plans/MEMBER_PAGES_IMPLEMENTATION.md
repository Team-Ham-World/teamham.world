# Member Page Self-Service Implementation Plan

**Document Status**: IMPLEMENTED IN CODE / NOT YET DEPLOYED
**Depends on**: The deployed Discord authentication and session system in `MEMBER_SYSTEM_IMPLEMENTATION.md`.

## 1. Target architecture

Keep the existing Next.js application and Neon database. Replace the static `MEMBERS` catalog with a server-only data access layer and database-backed public pages.

| Layer | Responsibility |
|---|---|
| `src/app/members/` | Render the public, animated directory of published members. |
| `src/app/m/[member]/` | Render public content and the owner-only editing experience. |
| `src/app/admin/members/` | Admin-only page creation, assignment, and publication controls. |
| `src/app/api/members/` | Return the minimal published directory used by the static homepage. |
| Server Actions | Validate form input, verify the session again, authorize the exact resource, mutate data, and refresh affected pages. |
| `src/lib/members/` | Server-only queries, validation, DTOs, and authorization helpers. |
| Neon Postgres | Store roles, page ownership, publication state, and editable content. |

Do not rely on `proxy.ts` as the authorization boundary. It may gate admin-page navigation, but every Server Action and data mutation must verify the session and permission itself.

## 2. Data model

Add `migrations/0005_member_pages.sql` as a committed, additive migration.

### `accounts.site_role`

- Checked values: `member` or `admin`.
- Default: `member`.
- The runtime role may read this column but may not change it.
- Bootstrap the first administrator with a reviewed `neondb_owner` transaction after the migration.

### `member_pages`

| Column | Rule |
|---|---|
| `id` | UUID primary key. |
| `owner_account_id` | Required, unique foreign key to `accounts`; one page per account. |
| `created_by_account_id` | Required foreign key to the administrator account. |
| `slug` | Required, unique lowercase DNS label, maximum 63 characters. |
| `display_name` | Required plain text, maximum 80 characters. |
| `blurb` | Optional plain text, maximum 500 characters. |
| `website_url` | Optional absolute HTTPS URL, maximum 2048 characters. |
| `showcase` | Optional JSON object matching a server-defined editable showcase union. External showcases may contain one optional absolute HTTPS artwork URL; when it is omitted and a project URL exists, the authorized save path may discover and persist a public Open Graph image. Validate the union on every read and write. |
| `is_published` | Required boolean, controlled by an administrator. |
| `created_at`, `updated_at` | Required timestamps. |

Use database constraints for uniqueness, nullability, lengths, role values, and foreign keys. Keep the existing reserved-label check in shared application validation because it also protects non-database consumers.

Grant `app_runtime_role` only the column operations needed by the implemented queries. Role changes remain owner-only. Page creation and updates still require application authorization; database grants limit accidental access but do not replace it.

## 3. Application changes

### Authentication and authorization

1. Extend the verified-account DTO with `siteRole`.
2. Add a server-only helper that reads and verifies the session cookie for Server Components and Server Actions.
3. Add `requireAdmin()` and page-owner checks in the member data access layer.
4. Bind member updates in SQL to both `slug` and the verified `owner_account_id`. Never accept ownership from form data.
5. Keep admin-role mutation out of the application.

### Public reads

1. Replace `MEMBERS`, `findMember`, and `generateStaticParams` with database queries.
2. Move the showcase model, reserved labels, and slug validation out of `src/data/members.ts` before removing that file.
3. Return a minimal public DTO containing only page content.
4. Render `/m/<slug>` at request time so builds never require database credentials.
5. Keep `/` static. Load its member preview from a public endpoint that returns published pages in stable order and degrades to an empty directory when auth/database access is disabled.
6. Keep unknown and unpublished pages on the same branded 404 path for non-owners.
7. Refresh the member page after a successful mutation so the owner sees the saved content immediately.

### Members directory

1. Add `/members` as the complete discovery route and make the homepage “Who” section a compact link into it.
2. Server-render the semantic member list from public DTOs; add search and motion as client-side enhancement.
3. Derive visual variation deterministically from the slug so server and client output remain stable.
4. Follow `MEMBERS_DIRECTORY_SPEC.md` for motion, responsive behavior, reduced-motion parity, and accessible selection.

### Member editor

1. Reuse the public page at `/m/<slug>`; add an owner-only **Edit page** control.
2. Use a progressively enhanced form backed by a Server Action.
3. Validate the same field bounds and showcase union on the server regardless of client validation.
4. Return field-level errors without echoing secrets or internal identifiers.
5. Preserve the current page design and metadata behavior.
6. Resolve a missing external-project artwork URL from Open Graph metadata as a best-effort save-time enhancement. Revalidate every HTTPS redirect and DNS result, block non-public destinations, cap time and response size, and continue saving without artwork when discovery fails.

### Admin page

Create `/admin/members` with:

- a list of eligible accounts and existing pages;
- a create form for owner, slug, display name, and initial publication state;
- publish/unpublish and owner-reassignment controls; and
- clear handling for duplicate owners, duplicate slugs, ineligible accounts, and reserved labels.

The admin action must recheck `site_role = 'admin'` and active membership at submission time.

## 4. Cutover plan

1. Add the schema and query tests.
2. Rehearse the migration on an expiring Neon branch created from production, using the direct owner connection and `docs/NEON_MIGRATIONS.md`.
3. Implement the data access layer, authorization helpers, admin page, and member editor behind tests.
4. Import every existing `MEMBERS` entry into `member_pages` using a reviewed slug-to-account mapping; never infer ownership from a display name or Discord username. The catalog is currently empty, but keep the import step so cutover is safe if that changes.
5. Switch `/m/<slug>` and the homepage directory to database reads.
6. Remove the static member catalog only after data parity is verified.
7. Apply the unchanged migration to production before deploying dependent code, then run production smoke checks.

Rollback the application deployment if the new routes fail. The additive tables and column may remain; do not drop migrated member data during an application rollback.

## 5. Verification

Automated coverage must include:

- migration constraints and least-privilege grants;
- role parsing and session DTOs;
- admin-only creation, assignment, publishing, and unpublishing;
- owner-only updates, including forged slug and owner inputs;
- field limits, HTTPS URL checks, reserved slugs, malformed showcases, Open Graph parsing, and private-address rejection;
- public DTO privacy and unpublished-page behavior;
- homepage preview, members-directory search and navigation, and member-page metadata;
- keyboard, touch, reduced-motion, and 375 px directory behavior; and
- `AUTH_MODE=disabled`, development, and production build behavior.

Before release, run the repository's lint, typecheck, unit, integration, and production build commands. Then smoke-test one administrator, one page owner, a different signed-in member, and a signed-out visitor.

## 6. Completion criteria

- All acceptance criteria in the specification pass.
- Production contains at least one reviewed administrator account.
- `src/data/members.ts` is no longer a source of public member content.
- `/members` satisfies the directory experience specification across pointer, touch, keyboard, and reduced-motion modes.
- The admin and owner mutation paths are covered by authorization tests.
- The repository README and organization documentation describe the database-backed flow.

## Related documents

- [Feature specification](MEMBER_PAGES_SPEC.md)
- [Members directory experience](MEMBERS_DIRECTORY_SPEC.md)
- [Neon migration runbook](../../../teamham.world/docs/NEON_MIGRATIONS.md)
- [Member authentication implementation](../reference/MEMBER_SYSTEM_IMPLEMENTATION.md)
- [Self-hosted sites and subdomain delegation](../reference/MEMBER_PAGES_AND_SUBDOMAINS.md)
- [Next.js authentication guidance](https://nextjs.org/docs/app/guides/authentication)
- [Next.js data security guidance](https://nextjs.org/docs/app/guides/data-security)
- [Neon branching workflow](https://neon.com/docs/get-started-with-neon/workflow-primer)
