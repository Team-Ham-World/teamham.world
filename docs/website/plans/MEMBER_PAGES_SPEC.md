# Member Page Self-Service Specification

**Document Status**: IMPLEMENTED IN CODE / NOT YET DEPLOYED
**Scope**: Member pages hosted at `teamham.world/m/<slug>`. Self-hosted member sites at `<slug>.teamham.world` remain a separate DNS process.

## 1. Goal

Move member-page content out of the public repository and into `teamham.world` so that:

- only an administrator can create and assign a member page;
- the assigned member can edit that page directly at `/m/<slug>` after signing in;
- members do not need repository access, a pull request, or a deployment to update their page; and
- public visitors can continue to view published member pages without signing in.

## 2. Roles and permissions

Discord membership proves that an account may sign in. It does not decide who owns a page or who is an administrator. Those permissions are stored by the application.

| Actor | Permissions |
|---|---|
| Visitor | View published member pages. |
| Member | Edit the one page assigned to their account. Cannot create pages, change the slug or owner, or edit another member's page. |
| Administrator | Open `/admin/members`; create, assign, publish, unpublish, or reassign pages. Administrator status alone does not permit editing another member's content. |
| Domain maintainer | Add or remove DNS records for optional self-hosted sites. This is outside the member-page editor. |

Every write must repeat authentication and authorization on the server. Hiding an edit control is not an authorization check.

## 3. User experience

### Administrator flow

1. The member signs in once so an eligible account exists.
2. An administrator opens `/admin/members`, selects that account, chooses an available slug and display name, and creates the page.
3. The administrator may publish immediately or leave the page unpublished while the member prepares it.

The admin page lists existing pages, owners, slugs, publication state, and last update time. Role promotion is not part of this UI; the first administrator and later role changes use a reviewed maintainer operation.

### Member flow

- `/m/<slug>` remains the public page.
- When the signed-in account owns the page, the page shows an **Edit page** control and an inline form.
- Saving updates the public page immediately and returns a clear success or validation error.
- A signed-out visitor or a different member sees only the public page. A direct unauthorized write returns `403`.
- An unpublished page is visible to its owner for editing and otherwise behaves as not found.

### Editable content

The first release preserves the existing member-page content model:

- display name;
- short introduction;
- optional absolute HTTPS website URL; and
- optional single showcase, either a registered HAM project or an external project.

Slugs, ownership, and publication state are administrator-managed. Slugs are lowercase DNS labels, must not be reserved, and are immutable after creation in v1.

## 4. Functional requirements

- Each account owns at most one member page, and each page has exactly one owner.
- Only an authenticated, active administrator can create or assign a page.
- Only the authenticated owner can update page content.
- Public reads return only published content and never expose account IDs, Discord IDs, roles, or administrative metadata.
- Text is plain text; rich HTML and Markdown are not accepted.
- All URLs are validated server-side as absolute HTTPS URLs.
- Content length limits are enforced in both the form and the server-side write path.
- The member directory is generated from published pages rather than `src/data/members.ts`.
- A database or authorization failure must not be reported as a successful save.

## 5. Security and lifecycle

- Continue using the existing `__Host-session` cookie and active-session checks.
- Resolve ownership from the verified session account, never from a submitted account ID.
- Keep administrator-role changes outside the runtime UI for v1.
- Prefer unpublishing over deletion so a page can be recovered and its slug is not silently reused.
- Losing Discord eligibility, suspension, logout, or session expiry removes editing access under the existing authentication rules.
- A delegated `<slug>.teamham.world` site is independently hosted and does not receive the apex session cookie or editing privileges.

## 6. Acceptance criteria

- An administrator can create and assign a page to an eligible account.
- A non-administrator cannot create, assign, publish, or unpublish a page.
- The assigned member can edit their page from `/m/<slug>` and see the saved result.
- That member cannot edit another slug, including by submitting a modified request.
- An administrator who is not the owner cannot use the member edit action for that page.
- Published pages, the homepage preview, and `/members` work for signed-out visitors.
- Unpublished and unknown pages return the same public not-found result.
- Existing static member data, if any exists at cutover, is preserved.
- No member-page update requires a repository change or deployment.

## 7. Out of scope

- Member-created pages or slug changes.
- Multiple page owners, delegated editors, revision history, or approval workflows.
- Image/file uploads and arbitrary page layouts.
- DNS automation or hosting member subdomains from the hub.
- Administrator role management through the web UI.

## Related documents

- [Members directory experience](MEMBERS_DIRECTORY_SPEC.md)
- [Implementation plan](MEMBER_PAGES_IMPLEMENTATION.md)
- [Member authentication implementation](../reference/MEMBER_SYSTEM_IMPLEMENTATION.md)
- [Self-hosted sites and subdomain delegation](../reference/MEMBER_PAGES_AND_SUBDOMAINS.md)
