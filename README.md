# teamham.world

Public source repository for [teamham.world](https://teamham.world).

## Tech Stack

- [Next.js](https://nextjs.org/) (App Router)
- [TypeScript](https://www.typescriptlang.org/)
- [Tailwind CSS](https://tailwindcss.com/)
- [ESLint](https://eslint.org/)

## Getting Started

### Prerequisites

- Node.js `>=24 <25` (see `.nvmrc`)
- npm

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

Open [https://localhost:3000](https://localhost:3000) to view the application.

The dev server runs over HTTPS deliberately. `APP_BASE_URL` is
`https://localhost:3000`, the session cookies are `__Host-`/`Secure`, and the
logout route requires the request `Origin` to match `APP_BASE_URL` exactly — so
serving dev over plain http breaks sign-in and logout with origin errors.

The first run generates a local certificate into `certificates/` via `mkcert`
and may prompt for your password. Later runs reuse it. The directory is
gitignored and must not be committed.

If you see `Failed to generate self-signed certificate. Falling back to http.`,
fix the certificate rather than browsing over http — the fallback is what
produces those origin errors.

## Validation & Scripts

- `npm run lint` - Run ESLint checks
- `npm run typecheck` - Run TypeScript type checking (`tsc --noEmit`)
- `npm run build` - Build the production bundle
- `npm run start` - Start the production server
- `npm run test:integration:vps` - Run real-Postgres tests through the secured VPS tunnel

The VPS test database is isolated from Neon and is not publicly exposed. See
[`docs/LOCAL_TESTING.md`](docs/LOCAL_TESTING.md) for the complete local development,
database, S3-compatible storage, reset, and troubleshooting workflow. VPS-specific
operations remain in [`docs/VPS_TEST_DATABASE.md`](docs/VPS_TEST_DATABASE.md).

## Project Structure

- `src/app/` - Root layout, metadata, global styles and design tokens
- `src/app/m/[member]/` - Member pages, at `/m/<member>`
- `src/app/members/` - Public member directory
- `src/app/admin/members/` - Admin member-page management
- `src/lib/members/` - Member validation, authorization, and database access
- `src/components/` - Shared server and client UI
- `src/data/projects.ts` - Typed public project catalog
- `migrations/0005_member_pages.sql` - Member roles and page storage
- `migrations/0006_member_social_links.sql` - Member-owned social profiles
- `src/app/fonts/` - Drop point for the approved WOFF2 files (see its README)

## Member pages

Member pages are stored in Postgres and served at `teamham.world/m/<member>`.
Published pages appear in the animated `/members` directory and in the compact
homepage preview. The homepage remains static; it loads its minimal public data
from `/api/members` after hydration.

An administrator creates, assigns, publishes, and unpublishes pages at
`/admin/members`. The assigned owner edits the content directly on their
`/m/<member>` page. Every mutation re-verifies the database-backed session and
checks the exact role or owner in the server-only data layer; `proxy.ts` is not
an authorization boundary for these operations.

Apply `migrations/0005_member_pages.sql` and then
`migrations/0006_member_social_links.sql` before deploying dependent code,
using `docs/NEON_MIGRATIONS.md`. The migrations do not appoint an administrator.
Bootstrap the first `accounts.site_role = 'admin'` in a separately reviewed
owner transaction; the application runtime role cannot change that column.

Page content supports a display name, optional blurb and HTTPS website, supported
social profiles, and an optional HAM-project or external-project showcase.
External showcase artwork can use an HTTPS image URL or a discovered Open Graph
image. Unknown and unpublished pages share the branded 404 for anyone other than
the assigned owner.

When `AUTH_MODE=disabled`, database-backed member reads return an empty public
preview and the protected/member discovery routes expose no member content.
The complete specification and implementation notes live in
[`docs/website/plans/`](docs/website/plans/).

DNS setup and offboarding for a member's independently hosted site are kept
separate in `website/reference/MEMBER_PAGES_AND_SUBDOMAINS.md`.

`<member>.teamham.world` is **not** served by this app. That subdomain is
delegated to the member, who points it at whatever they deploy. This app
therefore claims no wildcard domain and installs no host rewrite — doing so
would race the members' own DNS records and silently serve a HAM page whenever
one was missing or mid-migration.

### Delegating a subdomain

Add a DNS record for `<member>.teamham.world` pointing at the member's host, and
have the member add that hostname to their own project so it can be issued a
certificate. Two standing obligations come with this:

- **Remove the DNS record when a member leaves or moves host.** A record left
  pointing at a deployment that no longer exists can be claimed by whoever
  registers that name next, who then serves content from a `teamham.world`
  address.
- **Treat member subdomains as third-party origins.** They are same-*site* with
  the apex even though they are not same-origin, so anything scoped to the
  registrable domain is shared with them.

The apex is already built for this: session cookies use the `__Host-` prefix,
which pins them to the exact apex host and forbids a `Domain` attribute, so a
member subdomain can neither read the session cookie nor overwrite it. `/account`
is the only path the auth proxy matches, and in production its origin check
rejects any host other than `teamham.world`.

### Game OAuth clients and delegated subdomains

The `redirect_uri` CHECK in `migrations/0002_game_backend_authorization.sql`
accepts any `*.teamham.world` host. That was written when every subdomain was
HAM-controlled, and delegation makes it broader than the trust model behind it.

It is not an open hole. A redirect is matched by exact string equality against
the registered value (`compareRedirectUris`), and redeeming an authorization
code additionally requires the client secret and the PKCE verifier — so control
of a redirect host alone yields codes that cannot be exchanged. Registration is
out of reach of the app entirely: `app_runtime_role` holds `SELECT` alone on
`game_oauth_clients`.

The mitigation is therefore a naming rule rather than a schema change:

> **The host label of every game OAuth client must be present in
> `RESERVED_SUBDOMAINS` (`src/lib/members/model.ts`) before the client row is
> inserted.**

A reserved label can never be delegated to a member, which closes the path where
a client's redirect host is one someone else controls. The auth- and game-shaped
labels are reserved in advance; add any new one in the same commit that
registers the client.

Narrowing the CHECK to name those hosts exactly was considered and deliberately
deferred: no game client is registered yet, and the only game project's slug is
still marked provisional, so a constraint written now would be pinned to guessed
labels and need rewriting once the names settle. Tighten it in the same
migration that registers the first real client.

## Note

Content and design are governed privately. Two production assets are still
outstanding and are tracked as acceptance gates:

- **Fonts**: Bagel Fat One and Atkinson Hyperlegible are not yet self-hosted;
  the site currently renders with the approved fallback stacks. See
  [`src/app/fonts/README.md`](src/app/fonts/README.md).
- **Wordmark**: the canonical physical cut-and-scan wordmark, favicon, and
  OpenGraph image are not yet produced. The hero shows a plainly labeled text
  placeholder in the meantime.
