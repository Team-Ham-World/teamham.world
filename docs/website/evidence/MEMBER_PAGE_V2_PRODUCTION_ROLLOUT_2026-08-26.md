# Member page V2 production rollout — 2026-08-26

This record captures the production database and object-storage rollout for
member page personalization V2. It intentionally excludes credentials,
connection strings, presigned URLs, and object keys.

## Neon migration

- Organization: `TeamHam` (`org-little-star-80689271`)
- Project: `TeamHam` (`dawn-shadow-64303881`)
- Production branch: `production` (`br-wispy-cloud-axvw73sw`)
- Database/owner/runtime: `neondb` / `neondb_owner` / `app_runtime_role`
- Migration files, applied unchanged and in order:
  - `migrations/0007_member_page_personalization_v2.sql`
    (`135d25a3f50a602a06023379c3d76dd2fdaeda1909150b4a0b00da343c80d096`)
  - `migrations/0008_member_page_moderation_privileges.sql`
    (`12c84c62c7eaaafb80f86e23aab27f9c62118a531db6c83b3eca87741bfc7c8e`)

The unchanged files were rehearsed first on
`rehearsal-member-page-v2-20260826t213430z`
(`br-green-lab-axnikgw7`), a direct child of production that expires at
`2026-08-27T21:34:30Z`.

Rehearsal and production verification both confirmed:

- all 12 V2 `member_pages` columns;
- `member_page_assets` and `member_page_mutation_rate_limits`;
- 24 V2-related constraints and the expected asset/rate-limit indexes;
- canonical conversion of the existing published page to schema version 2;
- zero initial asset and rate-limit rows;
- `app_runtime_role` reads plus rolled-back moderation, rate-limit, and asset
  create/finalize/delete transactions; and
- the `updated_at` `SELECT` privilege required by moderation `RETURNING`.

After migration, `https://teamham.world/`, `/m/cyr1en`, and `/api/members`
each returned HTTP 200.

## Cloudflare R2

Cloudflare account: `bbf40503411bd5303c04e14eb32ef814`.

| Environment | Private bucket | Account token | Vercel target |
| --- | --- | --- | --- |
| Production | `teamham-member-assets-production` | `teamham-member-assets-production-app` | Production |
| Non-production | `teamham-member-assets-nonproduction` | `teamham-member-assets-nonproduction-app` | Development |

Both buckets use Standard storage in Western North America. Public development
URLs and custom domains are disabled. Each account token is active, has Object
Read & Write permission, and is restricted to its matching bucket.

Production CORS permits only:

- origin `https://teamham.world`;
- method `PUT`; and
- request header `Content-Type`.

Non-production CORS permits the same method and header from only
`https://localhost:3000` and `https://127.0.0.1:3000`. Preview remains
unconfigured until it has a stable, reviewed origin; the empty V2 rollout
cohort keeps that environment fail-closed in the meantime.

Live preflight checks returned HTTP 204 with the exact origin and `PUT` method
for all three approved origins. `https://example.invalid` received no
`Access-Control-Allow-Origin` header.

## Deployment configuration

Vercel Production and Development each contain the matching values for:

- `MEMBER_PAGE_R2_ENVIRONMENT`;
- `MEMBER_PAGE_R2_ACCOUNT_ID`;
- `MEMBER_PAGE_R2_ACCESS_KEY_ID`;
- `MEMBER_PAGE_R2_SECRET_ACCESS_KEY`; and
- `MEMBER_PAGE_R2_BUCKET`.

Access keys and secret keys are stored as Vercel secrets. The production
endpoint override remains unset, as required by the application preflight.
