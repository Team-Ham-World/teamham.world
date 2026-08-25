# Member System & Authentication Specification

**Status**: `Approved for Implementation` by Organization Maintainer CyR1en on 2026-08-20. Production release remains strictly gated by [MEMBER_SYSTEM_IMPLEMENTATION.md §12](../reference/MEMBER_SYSTEM_IMPLEMENTATION.md#12-readiness-record--delivery-gates) delivery evidence.
**Target Audience / Scale**: Existing Team Ham World members (<100 accounts).
**Last Updated**: 2026-08-20

---

## 1. Context & Scope Supersession

The initial website launch ([Website Planning](../README.md), [Implementation Record](../reference/IMPLEMENTATION_RECORD.md)) delivered a zero-maintenance, statically prerendered public hub at `teamham.world` without dynamic compute, database dependencies, or account storage.

This specification defines the member authentication layer for verified HAM members. **Scope Boundary**: This planned phase supersedes *only* the historical launch boundary of "no backend/accounts" recorded in `../reference/IMPLEMENTATION_RECORD.md`. It does **not** alter the delivered public hub visual direction, brand identity, or the statically prerendered project shelf on `/`.

---

## 2. Goals & Non-Goals

### 2.1 Goals
- **Discord-Only Authentication**: Sign-up and sign-in exclusively via Discord OAuth 2.0.
- **Role-Gated Membership**: Permit access only to users who belong to the configured Team Ham World Discord guild and hold the designated HAM member role.
- **Existing-Member Portal**: Designed solely for existing community members. No public registration, no join CTA, and no Discord invite link on the website.
- **Durable Local Identity**: Assign each authorized member a persistent local UUID (`accounts.id`) to anchor future features (such as account settings or future game profiles) without coupling downstream systems directly to Discord IDs.
- **Data Minimization & Ephemeral Tokens**: Store only the minimum data necessary for access control (`discord_user_id` and verified status). Profile snapshots (`discord_username`, `discord_global_name`, `discord_avatar_hash`) are discarded and not persisted. Discord access and refresh tokens exist exclusively in transient server memory during the OAuth callback exchange and are never persisted, logged, or exposed to the client.

### 2.2 Non-Goals (v1)
- **Alternative Auth Providers / Passwords**: No email/password, magic links, Passkeys/WebAuthn, or third-party OAuth (GitHub, Google).
- **Public Registration / Open Onboarding**: No self-service registration or Discord server invitations for non-members.
- **User Profiles & User-Generated Content (UGC)**: No public profile pages, bio editing, custom avatars, or UGC submission.
- **Bot / Gateway / Background Daemons**: No Discord bot token, WebSocket Gateway connection, or recurring cron worker in v1.
- **Administrative UI**: No web-based member admin panel in v1; administrative suspensions or manual overrides are executed directly via reviewed database operations by authorized maintainers.
- **Cross-Subdomain SSO / Shared Auth**: No cross-subdomain cookie sharing or wildcard domain sessions.
- **Game Token Issuer / OpenID Connect Provider**: No JWT signing keys, JWKS endpoints, or OAuth2 authorization server capabilities for external or downstream game servers in v1.

---

## 3. Architecture & Topology

```
                  +----------------------------------------------+
                  |               Public Visitor                 |
                  +----------------------+-----------------------+
                                         |
             GET / (Statically prerendered, cached at Edge)
                                         v
                  +----------------------------------------------+
                  |         Vercel Edge / CDN Cache              |
                  +----------------------------------------------+
                                         |
                         Protected & Auth Dynamic Routes
                                         |
                                         v
+---------------------------------------------------------------------------------+
| Vercel Serverless (Next.js 16 App Router) [Nearest supported DB region]       |
|                                                                                 |
|  - GET /api/auth/discord/login       -> Generates state/PKCE, redirects         |
|  - GET /api/auth/discord/callback    -> Validates state, exchanges code,        |
|                                         checks guild+role, creates session      |
|  - POST /api/auth/logout             -> Revokes DB session, clears cookie       |
|  - GET /account                      -> Server-rendered protected page          |
+------------------------+--------------------------------+-----------------------+
                         |                                |
        HTTPS (Direct)   |                                | Serverless Driver
                         v                                v
+------------------------------------+         +----------------------------------+
|           Discord API              |         |         Neon Postgres            |
| https://discord.com/api/v10        |         | (Serverless Postgres driver)     |
|  - /oauth2/token                   |         |  - accounts                      |
|  - /users/@me                      |         |  - sessions                      |
|  - /users/@me/guilds/{id}/member   |         +----------------------------------+
+------------------------------------+
```

- **Static Front Door**: The root `/` remains statically prerendered and cached at the CDN edge.
- **Dynamic Route Handlers**: Authentication flows reside under `/api/auth/*` as Next.js 16 dynamic Route Handlers (`force-dynamic`, `Cache-Control: no-store`).
- **Protected Member Surface**: A single protected server component at `/account` for session inspection, membership verification status, and manual logout.
- **Database Engine**: Neon Serverless Postgres deployed in the nearest region supported by both Neon and Vercel; record the selected topology during setup. Connect via `@neondatabase/serverless`.
- **Schema Management**: Explicit, versioned SQL migration files committed to git and executed via migration scripts; no heavy ORM abstraction in v1.

---

## 4. Discord OAuth & Gate Protocol (v1)

### 4.1 OAuth Scope & Protocol Parameters
- **Grant Type**: Authorization Code Grant (`response_type=code`).
- **Client Authentication**: Confidential Client using `DISCORD_CLIENT_ID` (non-secret configuration) and `DISCORD_CLIENT_SECRET` (platform secret).
- **Exact Scopes**: `identify guilds.members.read`.
  - `identify`: Validates identity and retrieves user ID via `/users/@me` (all other profile fields are discarded).
  - `guilds.members.read`: Retrieves the user's membership object (including assigned `roles` array) in the target guild via `/users/@me/guilds/{guild_id}/member`.
  - **Explicitly Excluded Scopes**: Do **not** request `email` (violates data minimization) or generic `guilds` (unnecessary full guild list).
- **Redirect URI**: Exact, strict string match configured in the Discord Developer Portal (e.g., `https://teamham.world/api/auth/discord/callback`).
- **CSRF State Parameter**: Cryptographically random string (`>= 128 bits` of entropy from `crypto.getRandomValues()`), stored in a short-lived (`Max-Age=600`, 10 minutes), `HttpOnly`, `Secure`, `SameSite=Lax` cookie. Single-use: consumed and cleared upon arrival at the callback.
- **PKCE (Proof Key for Code Exchange)**: Generate `code_verifier` (high entropy) and `code_challenge` (S256). S256 PKCE is implemented as defense-in-depth against authorization code interception.

### 4.2 Step-by-Step Authorization Sequence

```
User (Browser)          Next.js Route Handler            Discord API              Neon Postgres
     |                            |                            |                         |
 1.  |--- Click "Member Login" -->|                            |                         |
     |                            |-- Gen state + PKCE verifier|                         |
     |                            |-- Set __Host-oauth_state --|                         |
 2.  |<-- 302 to Discord Auth ----|                            |                         |
     |                            |                            |                         |
 3.  |--- User approves on Discord --------------------------->|                         |
     |<-- 302 to /api/auth/discord/callback?code=...&state=...-|                         |
     |                            |                            |                         |
 4.  |--- GET /callback --------->|                            |                         |
     |                            |-- Verify & clear state cookie                        |
     |                            |-- POST /oauth2/token ----->|                         |
     |                            |<-- { access_token } -------|                         |
     |                            |-- GET /users/@me --------->|                         |
     |                            |<-- { id } (Discard rest) --|                         |
     |                            |-- GET /users/@me/guilds/{guild_id}/member            |
     |                            |<-- 200 { roles: [...] } OR 404 Not Member            |
     |                            |                                                      |
 5.  |                            |-- Server-side Role Check:                            |
     |                            |   Is DISCORD_REQUIRED_ROLE_ID in roles?              |
     |                            |                                                      |
     |   [IF INELIGIBLE / 404]    |                                                      |
     |   - Drop Discord tokens    |-- (If existing account)                              |
     |   - Log outcome            |   UPDATE membership_status='ineligible'              |
     |   - Return 403 Page        |   DELETE FROM sessions WHERE account_id=... -------->|
     |                            |   [In one atomic transaction]                        |
     |<-- 403 Forbidden / Denied -|                                                      |
     |                            |                                                      |
     |   [IF ELIGIBLE]            |                                                      |
     |   - Drop Discord tokens    |-- UPSERT account (last_login, checked_at) ---------->|
     |   - Gen random session     |-- INSERT session token_hash ------------------------>|
     |   - Set __Host-session     |   [In one atomic transaction]                        |
 6.  |<-- 302 to /account --------|                                                      |
```

### 4.3 Endpoint Error Handling & Provider Tokens
- **Provider Token Isolation**: The Discord `access_token` and `refresh_token` are kept solely in ephemeral server-side variable memory during the execution of the callback Route Handler. They are **never** written to Postgres, never stored in browser storage (`localStorage`, `sessionStorage`, cookies), never logged, and never forwarded to the client browser or JavaScript bundle.
- **Provider Failure Handling**:
  - Discord API timeout, rate limit (429), or 5xx outage: The handler aborts immediately and returns an HTTP 502/504 error response instructing the member to retry. Stored account eligibility is **not** altered on upstream provider outages.
  - User denied OAuth authorization on Discord screen (`error=access_denied`): Redirects cleanly to `/` without creating records or setting session cookies.
- **Registration on First Login**: If a user is eligible upon their first successful OAuth exchange, their account is provisioned automatically. A clear pre-login disclosure on the site informs users that signing in records their Discord ID and membership status. Non-qualifying users are rejected without creating partial or orphaned account rows.

---

## 5. Session Architecture & Cookie Security

### 5.1 Token Generation, Hashing & Session Lifecycle
- **Client Session Token**: 256 bits of cryptographically secure random bytes generated via `crypto.getRandomValues()`, base64url-encoded.
- **Storage Hash**: The raw session token is **never stored** in the database. The server computes the `SHA-256` digest (hex-encoded) and stores only the hash (`sessions.token_hash`).
- **Session Lookup**: Incoming requests hash the presented cookie value with SHA-256 and perform an exact index lookup against `sessions.token_hash`.
- **Minimal Session Lifecycle (v1)**:
  - Each successful OAuth login generates and returns a brand-new opaque session token.
  - Any pre-existing active sessions for that account remain valid until their fixed absolute expiration, manual logout, confirmed ineligibility, account deletion, or administrative suspension.
  - There is no custom session-management UI, device list, or arbitrary device cap in v1.

### 5.2 Cookie Specifications

| Cookie Name | Scope / Flags | Purpose | Expiration |
| :--- | :--- | :--- | :--- |
| `__Host-session` | `Secure; HttpOnly; SameSite=Lax; Path=/` | Active session token | Fixed at login (Max-Age <= 86,400s) |
| `__Host-oauth_state` | `Secure; HttpOnly; SameSite=Lax; Path=/` | OAuth CSRF state + PKCE verifier | Short-lived (`Max-Age=600`, 10 min) |

- **`__Host-` Prefix Enforcement**: Enforces that cookies must be set with `Secure`, must originate from an HTTPS host, must use `Path=/`, and cannot be scoped across subdomains.
- **Apex Host Binding**: Prevents subdomains from reading, overriding, or injecting session cookies into the canonical hub host.
- **Cache Isolation**: All responses that read or set cookies, or return authenticated member content, must emit `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate` and `Vary: Cookie`.

### 5.3 Destination Redirection Security
- **Exact Server-Side Allowlist**: Post-login redirection destinations are strictly validated against an exact server-side allowlist. In v1, the **only** permitted post-login destination is `/account`.
- **Attacker Rejection**: Any other destination value, relative path variation, external URL, or protocol-relative target (`//attacker.com`) is rejected and replaced with `/account`.

---

## 6. Eligibility Freshness, Revocation SLA & Bot Tradeoffs

### 6.1 Approved 24-Hour Membership Freshness SLA
- **Policy Invariant**: A maximum **24-hour membership freshness window** (`MAX_MEMBERSHIP_AGE = 86400` seconds), approved by Organization Maintainers on 2026-08-20.
- **Fresh Login Check**: Every fresh OAuth login queries Discord directly, updating `accounts.membership_checked_at` and `accounts.membership_status`.
- **Absolute Session Expiration**: App sessions are strictly bounded by absolute lifetime. A session **never expires after `membership_checked_at + 24h`** and does **not** slide or extend on user activity.
- **Stale Session Handling**: Once a session reaches the 24-hour boundary, it is treated as expired. The user must perform a fresh OAuth login to re-verify current guild and role membership.
- **Revocation Enforcement**:
  - If a member is removed from the Discord guild or stripped of the qualifying role, and subsequently initiates an OAuth flow, the callback detects the missing role, immediately sets `accounts.membership_status = 'ineligible'`, and revokes all active database sessions for that account in a single atomic transaction.
  - Manual suspension by an Organization Maintainer (`UPDATE accounts SET admin_status = 'suspended'`) invalidates all active sessions immediately on the subsequent HTTP request.

### 6.2 Bot-Backed Evaluation & Architectural Tradeoff

| Feature / Characteristic | v1 OAuth-Only Flow | Future Bot-Assisted Option |
| :--- | :--- | :--- |
| **Discord Bot Credential** | None (Not required) | Required (`DISCORD_BOT_TOKEN` secret) |
| **Operational Overhead** | Zero bot infrastructure | Bot token management and permission auditing |
| **Membership Re-check Trigger** | User-initiated OAuth login | On-demand / lazy server-side REST query |
| **Re-check Without OAuth Redirect** | No (requires OAuth flow) | Yes (queried transparently during page request) |
| **Privileged Gateway Intent** | Not applicable | **Not required** for single-member REST lookup |

- **Tradeoff Analysis**:
  - *v1 Choice (OAuth-Only)*: Avoids introducing a Discord bot account, bot credentials, and extra API management. This keeps v1 proportionate for fewer than 100 members using authenticated website sessions.
  - *Future Bot-Assisted Option*: If maintainers later require on-demand or lazy membership re-checks during active sessions without user-facing OAuth redirects, the server can query the Discord REST API (`GET /guilds/{guild_id}/members/{user_id}`) using a Bot token.
  - *Intent & Permission Verification*: Official Discord developer documentation confirms that the single-member REST endpoint (`GET /guilds/{guild.id}/members/{user.id}`) does **not** require the privileged `GUILD_MEMBERS` Gateway Intent. Bot credentials and operations are intentionally deferred from v1.

---

## 7. Minimal Data Model & Fail-Closed Schema

All identifiers use native PostgreSQL `UUID` for local keys and `TEXT` for Discord 64-bit snowflake IDs (preventing JavaScript integer precision truncation).

```sql
-- Team Ham World: Member System v1 Minimal Schema
-- Database: Neon Serverless PostgreSQL

CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    discord_user_id TEXT NOT NULL UNIQUE,
    membership_status TEXT NOT NULL
        CHECK (membership_status IN ('eligible', 'ineligible')),
    admin_status TEXT NOT NULL DEFAULT 'active'
        CHECK (admin_status IN ('active', 'suspended')),
    first_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    membership_checked_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for combined status checks during session authentication
CREATE INDEX idx_accounts_status ON accounts (membership_status, admin_status);

CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

-- Indexes for active session lookup and expiration pruning
CREATE INDEX idx_sessions_account_id ON sessions (account_id);
CREATE INDEX idx_sessions_expires_at ON sessions (expires_at);
```

### 7.1 Data Minimization & Fail-Closed Column Details
- **Fail-Closed Inserts**: `membership_status` and `membership_checked_at` have **no default values** in the schema. Inserts must explicitly supply verified `'eligible'` status and timestamp upon successful role verification, preventing accidental unverified account creation.
- **Strict ID-Only Data Minimization**: Profile snapshots (`discord_username`, `discord_global_name`, `discord_avatar_hash`) are omitted from the schema and not stored.
- **Status Value Semantics**:
  - `membership_status`: `eligible` (user verified with qualifying Discord role) or `ineligible` (user confirmed missing guild or role).
  - `admin_status`: `active` (standard account) or `suspended` (manually blocked by maintainer).
- **Application Timestamp Updates**: The `updated_at` column is maintained explicitly by application queries when updating account state.
- **Explicitly Excluded Fields**:
  - `email`: Not requested from Discord; not stored.
  - `discord_username`, `discord_global_name`, `discord_avatar_hash`: Not stored.
  - `discord_access_token` / `discord_refresh_token`: Never stored in database.
  - `discord_roles`: The raw array of user roles is checked in memory and discarded; not stored.
  - `guild_list`: Not queried and not stored.
  - `passwords`: No password or hash fields exist.
- **Ineligible User Handling**: Users who fail the guild or role check on their first login are rejected immediately; no row is created in `accounts`.
- **Account Deletion**: Deleting an account removes the `accounts` record and cascades via `ON DELETE CASCADE` to delete all associated `sessions`.

---

## 8. Logs, Privacy & Data Minimization

### 8.1 Structured Security Logging & Platform Retention
Security logs record coarse operational events for auditability without collecting sensitive credentials or personal payloads.

- **Permitted Operational Event Names**: `auth.oauth.login_start`, `auth.oauth.callback_success`, `auth.gate.denied_role`, `auth.gate.not_in_guild`, `auth.session.created`, `auth.session.revoked`, `auth.session.expired`.
- **Prohibited Log Fields**: Authorization codes, Discord access/refresh tokens, raw session tokens, full Discord user profile payloads, full Discord role arrays, and user IP addresses.
- **Platform Log & Backup Retention Facts (v1)**:
  - Vercel Hobby serverless runtime logs retain data for up to 1 hour with no external log export in v1.
  - Neon Free tier point-in-time recovery (PITR) retains data for up to 6 hours; no manual database snapshots or external log storage exist in v1.
  - Direct database administrative actions (such as setting an account to `suspended`) must be documented in the maintainers' reviewed change or incident log.
  - Retention parameters must be rechecked if infrastructure plans change.

### 8.2 User-Facing Privacy Disclosure
Before initiating the Discord OAuth redirect, the login interface must display a plain-language disclosure:

> *"Signing in with Discord verifies your membership in the Team Ham World Discord server. We store your Discord ID and membership status to authenticate your account. We never receive your password or email address, and we do not store Discord authorization tokens or profile snapshots. To request data deletion, contact CyR1en (@cyr1en on Discord)."*

---

## 9. Free-Tier Platform & Storage Comparison

*(Checked 2026-08-20 — Procurement verification required prior to production launch; free tiers are subject to vendor change and do not constitute formal SLAs).*

| Platform | Engine | Free Tier Limits | Inactivity / Compute Behavior | Evaluation & Recommendation |
| :--- | :--- | :--- | :--- | :--- |
| **[Neon](https://neon.com/docs/introduction/plans)** *(Recommended)* | Postgres | 0.5 GB storage, 100 CU-hrs/month, 5 GB egress/month | Compute scales to zero after 5 min of inactivity; wakes automatically upon request | **Recommended**: Standard Postgres improves portability; fits the checked free tier at projected scale (<100 members) on Vercel. |
| **[Turso](https://turso.tech/pricing)** | libSQL (SQLite) | 5 GB storage, 500M row reads/mo, 10M writes/mo, up to 100 DBs | No inactivity auto-pause | **Strong Alternative**: Generous read/write allowances and no auto-pause, but SQLite dialect requires small query adjustments. |
| **[Supabase](https://supabase.com/pricing)** | Postgres | 500 MB storage, 50k MAU, 5 GB egress/mo, 2 active projects | **Auto-pauses after 7 days of inactivity**; requires manual dashboard unpause | **Not Recommended for v1**: 7-day auto-pause creates operational maintenance burden for small or low-activity private sites. |
| **[Cloudflare D1](https://developers.cloudflare.com/d1/platform/pricing/)** | SQLite | 5 GB storage (500 MB/DB), 5M reads/day, 100k writes/day, 10 DBs | No inactivity auto-pause | **Not Recommended for Vercel**: Excellent on Workers, but accessing D1 from Vercel Serverless requires operating a separate Cloudflare Worker/service because native bindings are unavailable. |

### Official Documentation References:
- Discord OAuth2 Documentation: [https://docs.discord.com/developers/topics/oauth2](https://docs.discord.com/developers/topics/oauth2)
- Discord Current User Guild Member Endpoint: [https://docs.discord.com/developers/resources/user#get-current-user-guild-member](https://docs.discord.com/developers/resources/user#get-current-user-guild-member)
- Discord Bot Guild Member Endpoint: [https://docs.discord.com/developers/resources/guild#get-guild-member](https://docs.discord.com/developers/resources/guild#get-guild-member)
- Neon Plans & Pricing: [https://neon.com/docs/introduction/plans](https://neon.com/docs/introduction/plans)
- Neon Scale to Zero & Autosuspend: [https://neon.com/docs/introduction/scale-to-zero](https://neon.com/docs/introduction/scale-to-zero)
- Turso Pricing: [https://turso.tech/pricing](https://turso.tech/pricing)
- Turso Usage & Billing: [https://docs.turso.tech/help/usage-and-billing](https://docs.turso.tech/help/usage-and-billing)
- Supabase Pricing: [https://supabase.com/pricing](https://supabase.com/pricing)
- Supabase Project Pausing Policy: [https://supabase.com/docs/guides/platform/free-project-pausing](https://supabase.com/docs/guides/platform/free-project-pausing)
- Cloudflare D1 Pricing: [https://developers.cloudflare.com/d1/platform/pricing/](https://developers.cloudflare.com/d1/platform/pricing/)
- Cloudflare D1 Limits: [https://developers.cloudflare.com/d1/platform/limits/](https://developers.cloudflare.com/d1/platform/limits/)

---

## 10. Configuration & Secrets Management

In accordance with [SECURITY.md §2](../../SECURITY.md#2-secrets--credential-management), secrets must be injected via platform environment variables and never committed to source control.

### 10.1 Platform Secrets
| Secret Name | Environment | Description |
| :--- | :--- | :--- |
| `DISCORD_CLIENT_SECRET` | Production, Preview (Isolated) | Discord Application Client Secret |
| `DATABASE_URL` | Production, Preview (Isolated) | Neon Postgres runtime connection string with SSL enabled |

### 10.2 Non-Secret Server Configuration
| Variable Name | Environment | Description |
| :--- | :--- | :--- |
| `DISCORD_CLIENT_ID` | Production, Preview (Isolated) | Discord Application Client ID |
| `DISCORD_GUILD_ID` | Production, Preview (Isolated) | Target Team Ham World Discord Guild Snowflake ID |
| `DISCORD_REQUIRED_ROLE_ID`| Production, Preview (Isolated) | Exact qualifying HAM Member Role Snowflake ID (Leadership/mods must hold this role) |
| `APP_BASE_URL` | Production, Preview (Isolated) | Server-only canonical base URL (e.g. `https://teamham.world`) |

### 10.3 Platform Access & Redundancy Exception
- **Documented Exception (v1)**: CyR1en is designated as the sole administrator for Vercel, Discord Developer Application, and Neon Database for v1.
- **Safeguards & Risk Acceptance**: This is an Organization Maintainer-approved exception to standard recovery redundancy ([SECURITY.md §1](../../SECURITY.md#1-access-control--authentication)), backed by verified 2FA and offline emergency recovery keys. The recovery risk is accepted for the initial v1 scale (<100 community members).

---

## 11. Acceptance Criteria & Test Gates

Implementation must satisfy the following automated and manual test gates before production release:

1. **OAuth State Verification & Anti-Replay**:
   - Initiating the callback with an invalid, expired, missing, or malformed `state` returns `HTTP 400 Bad Request` via timing-safe comparison.
   - Replaying a previously used `state` or authorization `code` fails cleanly.
2. **Exact Allowlisted Post-Login Redirect**:
   - Post-login redirect strictly navigates to `/account`.
   - Any external destination, absolute URL (e.g., `https://evil.com`), or protocol-relative value (e.g., `//evil.com`) is rejected and falls back to `/account`.
3. **Role Gate Enforcement**:
   - A Discord user with the target guild and qualifying role successfully authenticates and has their account created/updated.
   - A Discord user belonging to the guild **without** the required role receives `HTTP 403 Forbidden` and no database record is created.
   - A Discord user **not present** in the guild (404 response) receives `HTTP 403 Forbidden`.
4. **Provider Resilience & Failure Modes**:
   - Upstream Discord API 5xx, rate limit (429), or network timeout aborts gracefully with `HTTP 502/504` without modifying local account records or invalidating existing sessions prematurely.
5. **Token Security & Privacy**:
   - Discord access and refresh tokens are strictly absent from client cookies, `localStorage`, `sessionStorage`, client JavaScript bundles, database tables, application logs, and HTTP response bodies.
   - Platform secrets (`DISCORD_CLIENT_SECRET`, `DATABASE_URL`) are absent from the source repository and client bundles.
6. **Cookie Architecture & Hash Storage**:
   - `__Host-session` cookie is issued with `Secure`, `HttpOnly`, `SameSite=Lax`, and `Path=/`.
   - Database stores only the `SHA-256` digest of the session token.
7. **Session Rotation & Concurrency**:
   - A new OAuth login mints a newly generated session token that differs from any existing token.
   - Pre-existing sessions for that user remain valid until their fixed expiry, logout, confirmed ineligibility, deletion, or administrative suspension.
8. **24-Hour Expiration & Role Removal SLA**:
   - A session exceeding 24 hours (or exceeding `membership_checked_at + 24h`) is rejected by `/account`, prompting fresh OAuth re-authentication.
   - Role removal in Discord results in access denial no later than the approved 24-hour window when fresh OAuth verification is required.
9. **Session Revocation, Suspension & Deletion**:
   - Calling `/api/auth/logout` deletes the active session from the database and clears the browser cookie.
   - Setting `admin_status = 'suspended'` immediately denies subsequent requests from that account.
   - Account deletion cascades and deletes all active sessions; the previously issued session cookie cannot be reused.
10. **Cache Isolation**:
    - Authenticated responses from `/account` and `/api/auth/*` return `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate` and `Vary: Cookie` (preserving RSC vary tokens).
    - Distinct authenticated users never receive cached responses belonging to another user.
    - Statically prerendered caching for public `/` is fully preserved without `Vary: Cookie`.
11. **Identity Stability Without Profile Persistence**:
    - Modifying a user's Discord username or avatar and re-authenticating preserves the stable local `id` (UUID); no profile snapshots are persisted.
12. **CI Testing Baseline**:
    - Automated unit and integration test suites covering state generation, hashing, role filtering, redirect validation, and session verification must run and pass in CI prior to merge.

---

## 12. Future Game Integration Boundaries

To maintain clean architectural decoupling between the web hub and future game servers:

- **Local UUID as Future-Proof Anchor**: Game systems will interact solely with the persistent `accounts.id` (UUID).
- **No Shared Database Access**: External game servers will **never** receive direct database credentials or direct SQL access to the website's Postgres database.
- **No Leaked Discord Tokens**: Discord access tokens are not held by the hub and cannot be provided to downstream games.
- **No Cookie Delegation**: Browser session cookies (`__Host-session`) are scoped exclusively to the web hub apex domain and are not valid for game authentication.
- **Federation Postponement**: Any cross-system token issuance (such as short-lived signed game tokens or OIDC federation) will be designed during the implementation of the first connected game project, tailored to that game's specific hosting and trust model.

---

## 13. OAuth Implementation Architecture

To ensure security and maintainability without over-engineering:

- **Approved Native Standards Implementation (2026-08-20)**: The authentication flow uses a small, dedicated application orchestration layer built on Node 24 native `fetch`, `URLSearchParams`, and Web Standard `crypto`. No general OAuth library or framework is added in v1. The application strictly decodes Discord responses and owns one fail-closed error taxonomy across token exchange, identity lookup, and guild-role verification.
- **Why Auth.js / NextAuth is Not Chosen**:
  - *Custom Role Requirement*: Team Ham World requires a mandatory, strict guild and role validation step against `/users/@me/guilds/{guild_id}/member` before account creation, which requires custom callback handling regardless of framework.
  - *Scope & Token Persistence*: Framework defaults often capture unnecessary scopes (e.g., email) or attempt to manage refresh tokens and complex multi-provider accounts in database adapters.
  - *Session Model Alignment*: The 24-hour fixed SLA and non-sliding session revocation rules are cleaner and more auditable in a focused, transparent Route Handler than working against complex framework session lifecycles or beta packages.

---

## 14. Staged Rollout & Rollback Plan

```
+-----------------------------------------------------------------------------+
| Stage 1: Governance & Policy Approval                                      |
|  - COMPLETE (2026-08-20): Approved by Organization Maintainer CyR1en.       |
|  - Approved 24h SLA, data retention runbooks, contact, and ID-only scope.   |
+-------------------------------------+---------------------------------------+
                                      |
+-------------------------------------v---------------------------------------+
| Stage 2: Ownership & Secret Setup                                           |
|  - Configure isolated Neon Postgres project & Discord OAuth client.         |
|  - Record 2FA and offline emergency recovery credentials.                   |
+-------------------------------------+---------------------------------------+
                                      |
+-------------------------------------v---------------------------------------+
| Stage 3: Integration Spike & Validation                                     |
|  - Verify Neon driver transaction path and response proxy headers.          |
|  - Verify guild & role queries against live Discord test accounts.          |
+-------------------------------------+---------------------------------------+
                                      |
+-------------------------------------v---------------------------------------+
| Stage 4: Production Implementation & CI Gate                                |
|  - Implement Route Handlers, migration runner, and /account UI.             |
|  - Enforce automated unit/integration test gate in CI.                      |
+-------------------------------------+---------------------------------------+
                                      |
+-------------------------------------v---------------------------------------+
| Stage 5: Rollout & Rollback Readiness                                       |
|  - Deploy dynamic routes to production Vercel environment.                  |
|  - Rollback plan: redeploy the previous static-only production deployment.   |
|    If credential compromise is suspected, immediately rotate or revoke      |
|    Discord application secrets and Neon credentials.                        |
+-----------------------------------------------------------------------------+
```

---

## 15. Resolved Maintainer Decisions (Approved 2026-08-20)

Organization Maintainer CyR1en formally resolved and approved all policy decisions on 2026-08-20:

1. **24-Hour Revocation SLA**: Approved 24-hour absolute session window (`MAX_MEMBERSHIP_AGE = 86400`). Daily re-login required.
2. **Data Retention & Deletion Policy**: Approved. Account retained until voluntary deletion request; acknowledge within 2 business days; live database rows deleted within 72 hours of identity verification; expired sessions pruned monthly (on-demand); no automatic dormant account deletion. Vercel Hobby runtime logs expire within 1 hour; Neon PITR expires within 6 hours.
3. **Named Incident / Privacy Contact**: Designated CyR1en (@cyr1en on Discord).
4. **Platform Access & Redundancy Exception**: CyR1en approved as sole administrator for Vercel, Discord App, and Neon DB for v1 with 2FA/offline recovery keys and accepted recovery risk.
5. **Qualifying Role Semantics**: Single exact `DISCORD_REQUIRED_ROLE_ID`. Leadership/moderator roles must hold this role to qualify.
6. **Profile Snapshot Retention**: Option A (Minimal ID-Only) approved. No Discord username, global name, or avatar hash stored. Identity anchored strictly to `discord_user_id` and local `accounts.id` UUID.
