# Team HAM platform: threat model

Scan scope: `Team-Ham-World/teamham.world`, `jeoparty.teamham.world` (HAM Quiz), `pusoy.teamham.world`, `strokies.teamham.world`, `join.teamham.world`. These five repositories are scanned as one system: the three games sign in through teamham.world's game OAuth, and join is HAM's public front door. No separate infrastructure repository exists. Deployment facts come from in-repo config (`wrangler.jsonc`, `deploy/*.caddy`, Docker Compose files) and the owner's answers.

Existing security docs this model builds on: `teamham.world/docs/GAME_OAUTH.md`, `jeoparty.teamham.world/docs/SECURITY.md`, `pusoy.teamham.world/docs/OAUTH.md`, `strokies.teamham.world/docs/authentication.md`, `docs/moderation_operations.md`, `docs/safety_and_privacy.md`, and `join.teamham.world/docs/ARCHITECTURE.md`.

## 1. System overview and trust boundaries

| Component | Code | Runtime (production) | Trust boundary |
|---|---|---|---|
| **HAM Identity** | teamham.world `src/lib/auth/*`, `src/app/api/auth/**` (discord login/callback, game authorize/resume/token/introspect/revoke, session, logout), `src/proxy.ts` | Next.js App Router, Neon Postgres (`@neondatabase/serverless`) | Browser ↔ IdP, and game backends ↔ IdP (client credentials) |
| **HAM Member Site** | teamham.world `src/lib/members/**` (incl. `assets/` R2 uploads, `v2/` pages and moderation), `src/app/{admin,account,m,members,member-assets,puffcade,puffdle}`, `src/app/api/{members,member-page-assets,puff,puffdle}`, `src/lib/puff*`, `src/components/**` | Next.js, Neon, Cloudflare R2 | Member ↔ own page, admin ↔ all pages, public ↔ published pages |
| **Pusoy** | pusoy `apps/worker` (deployed), `apps/server` + `deploy/` Docker/Caddy (documented, **not deployed**), `apps/web`, `packages/shared` | Cloudflare Worker + Durable Objects at `pusoy.teamham.world` | Player browser/WebSocket ↔ authoritative room; Pusoy backend ↔ HAM Identity |
| **Quiz** | jeoparty `src/server/**` (`app.ts`, `http.ts`, `auth.ts`, `ham/client.ts`, `rooms/room.ts`, `packs.ts`, `pictures.ts`, `rate-limit.ts`, `validation.ts`, `db.ts`), `src/app/**`, `src/features/**` | Node 24 + Next.js, SQLite WAL, Docker behind Caddy (`deploy/quiz.caddy`) | Host / player / display ↔ server; server ↔ HAM Identity |
| **Strokies** | strokies `apps/server/src/*.mjs` (deployed), `packages/{protocol,game-rules,canvas-engine}`, `apps/web`, `apps/worker` + wrangler configs (compatibility path, **not deployed**), `deploy/` | Node server + SQLite behind Caddy, Docker Compose | Guest/account players ↔ rooms; operators ↔ moderation console; server ↔ HAM Identity |
| **Join** | join `src/index.ts`, `src/progress.ts`, `src/challenges/*`, `src/wordle.ts`, `src/pages/*`, `public/*` | Cloudflare Worker (Hono) at `join.teamham.world`, stateless | Anonymous internet ↔ Discord invite |

## 2. Entry points and who can reach them

- **HAM Identity**: Discord OAuth login/callback (internet). Game `authorize`/`resume` (signed-in browser). `token`, `introspect` and `revoke` (game backends with HTTP Basic client credentials). Only Discord users in the HAM guild holding `DISCORD_REQUIRED_ROLE_ID` get a session.
- **HAM Member Site**:
  - public member directory and pages (`/m`, `/members`, `/member-assets`);
  - public puff/puffdle leaderboards and score submissions;
  - member page editor and presigned R2 uploads (signed-in member);
  - `/admin`, protected only by `requireAdmin()` / `site_role=admin`, with no extra network restriction (owner-confirmed).
- **Pusoy / Quiz**:
  - HTTP APIs and WebSocket upgrades. Signed-in HAM members play.
  - Quiz hosting and question-pack editing are open to any vetted HAM member (owner-confirmed).
  - Quiz display screens use room-bound display grants.
- **Strokies**: guest play is open to **anyone on the internet** (rooms, drawing, chat, reports). Account features use HAM sign-in. The operator console sits behind Cloudflare Access/OIDC with MFA and a subject allowlist (owner-confirmed as enabled in production).
- **Join**: fully anonymous internet: `/`, `/begin`, `/challenge`, `/answer`, `/wordle/*`, `/restart`, `/clearance`.

## 3. Assets and sensitivity

**Most critical (owner):** HAM accounts, sessions, game OAuth tokens and OAuth client secrets. These include HAM session cookies, game authorization codes, access tokens, the PKCE/state stores, the client secrets held by the Pusoy, Quiz and Strokies backends, `GAME_*`/OAuth HMAC secrets, and `DATABASE_URL`.

Other assets, which the owner did not single out:
- member pages and uploaded assets in R2;
- game integrity (scores, leaderboards, hidden answers, private hands);
- Strokies moderation evidence and operator audit records;
- the Discord invite URL (`DISCORD_INVITE_URL`) and `PROGRESS_SECRET` behind Join.

## 4. Attacker profiles

- **Anonymous internet attacker:**
  - Join;
  - Strokies guest play;
  - HAM Identity's public login and OAuth endpoints;
  - public member pages and leaderboards;
  - the games' unauthenticated HTTP endpoints.
- **Authenticated HAM member (owner: the required Discord role is granted manually to vetted members only):**
  - Findings that need a valid HAM account are limited to a small, vetted population. Completing Join does *not* grant the role.
  - Any vetted member can host Quiz games and edit question packs (owner), so Quiz host/editor privileges are *not* trusted like admin privileges.
- **Malicious game client / room participant:** a vetted member, or for Strokies any guest, who tampers with WebSocket messages to cheat, read others' private state or affect other rooms.
- **Compromised game backend:** a game backend holding a client secret, attacking HAM Identity or other clients' tokens.
- **Trusted, out of scope (owner):** HAM site admins (`site_role=admin`) and the database owner. Issues that need admin access or DB-owner access are **low priority**.
- **Operators (Strokies):** reachable only through Cloudflare Access/OIDC + MFA (owner-confirmed).

## 5. Existing controls

- **HAM Identity:**
  - Discord scopes `identify guilds.members.read`, with guild membership plus required-role check (`src/lib/auth/discord.ts`).
  - DB-backed sessions (`src/lib/auth/session.ts`, `db.ts`).
  - HMAC-SHA256 signed payloads verified with `crypto.timingSafeEqual` (`src/lib/auth/crypto.ts`).
  - `proxy.ts` validates production Origin and strips client-supplied `x-teamham-authenticated`. It is not the authorization boundary.
  - Game OAuth (`game-oauth.ts`, `game-db.ts`, `game-route.ts`): confidential clients, exact pre-registered HTTPS callbacks, state + PKCE S256, one-time codes, tokens ≤24h and never outliving the source session, no refresh/implicit/password/public grants, Basic-auth introspection.
- **HAM Member Site:**
  - `requireAdmin()` / owner checks in `src/lib/members/dal.ts` re-verify the DB session on every mutation.
  - R2 uploads use presigned PUTs with server-chosen keys and a MIME allowlist (`MemberAssetMimeType`), then `finalize` + verify (`assets/verify.ts`, `dimensions.ts`, `animation.ts`).
  - The runtime DB role is least-privilege (`app_runtime_role`).
- **Pusoy:**
  - Confidential code + PKCE S256 flow, with server-side, session-bound state/verifier.
  - Duplicate-parameter rejection, issuer check, single-use exchange and session rotation.
  - Exact Origin + session-bound CSRF token on mutations.
  - WebSocket upgrades require exact Origin, a valid session and seat membership.
  - The server is authoritative; player views omit other hands.
  - 60s verification lease, with fresh introspection on admission/start.
- **Quiz:**
  - Per-request introspection for HTTP, WebSocket admission and `startGame`.
  - ≤30s in-socket lease (owner-approved).
  - Room-bound display grants that cannot issue commands.
  - The server is authoritative.
  - Answers never go in player/display payloads.
  - `rate-limit.ts`, `validation.ts`.
- **Strokies:**
  - Exact Origin and CSRF on cookie mutations, secure cookies.
  - Payload limits, schema validation in `packages/protocol`.
  - Plain-text chat rendering, parameterized SQL.
  - Room authorization in command handlers.
  - Operator OIDC with issuer/audience/signature checks, subject allowlist and MFA.
  - Retention/deletion policies.
- **Join:**
  - Stateless HMAC-signed progress cookie (`src/progress.ts`).
  - Server-side answer validation; clients only get an allowlisted public prompt.
  - Encrypted Wordle state.
  - Strikes and cooldown lockouts.
  - Hono `secureHeaders()` with strict CSP (`script-src 'self'`, `frame-ancestors 'none'`, `form-action 'self'`).
  - The dev challenge picker is gated by `DEV_CHALLENGE_PICKER === "true"`.

## 6. Security invariants

- **Authentication (CWE-287/384/613):**
  - Every HAM session is a DB-backed record looked up via `getCurrentVerifiedAccount()`. Never trust a cookie or the `x-teamham-authenticated` header alone.
  - A session is issued only after the Discord guild + `DISCORD_REQUIRED_ROLE_ID` check.
  - Games derive identity only from HAM introspection results, never from client-sent user IDs.
  - Sessions rotate on login.
  - Leases never exceed their documented window (Quiz 30s, Pusoy 60s, Strokies documented delay) or the token's expiry.
- **Game OAuth (CWE-346/352/601/640):**
  - `redirect_uri` is an exact match against registered HTTPS callbacks (no prefix or wildcard).
  - `state` and the PKCE S256 verifier are bound to the browser session and single-use.
  - Codes are single-use, short-lived and bound to client + redirect + verifier.
  - `token`/`introspect`/`revoke` authenticate clients with constant-time secret comparison.
  - Introspection never reveals one client's tokens to another client.
  - Tokens, codes and secrets never appear in logs, URLs returned to browsers, or client bundles.
- **Authorization / IDOR (CWE-639/862/863):**
  - Member page and asset mutations check the exact owner or `requireAdmin()` in `src/lib/members/dal.ts` / `assets/dal.ts`, never only in `proxy.ts` or UI.
  - Game commands are authorized in the server room handler (Pusoy `apps/worker` / `apps/server/src/rooms`, Quiz `src/server/rooms/room.ts`, Strokies `apps/server/src/rooms.mjs`) against seat/role/host. Disabled UI controls are not a control.
  - Quiz pack edits are limited to the pack's owner, since any vetted member can edit packs.
  - Quiz display grants are room-bound and read-only.
- **Information disclosure in game views (CWE-200):**
  - Pusoy player views never include other players' hands.
  - Quiz player/display payloads never include answers.
  - Strokies non-drawers never get the secret word before reveal.
  - No view includes another user's session or account data.
- **Injection (CWE-89/79):**
  - teamham.world uses Neon tagged-template `sql` (parameterized). Building SQL strings with string concatenation or `sql.unsafe`/raw query text is the unsafe pattern.
  - SQLite in Quiz/Pusoy/Strokies uses prepared statements with bound parameters.
  - React/Hono JSX escape output by default. `dangerouslySetInnerHTML`, Hono `raw()`/`html` with interpolated user data, and markdown/HTML rendering of member page content are the escape hatches to watch.
  - Join's CSP blocks inline script.
- **CSRF / Origin (CWE-352/1385):**
  - Cookie-authenticated mutations require exact Origin and, in Pusoy/Strokies, a session-bound CSRF token.
  - WebSocket upgrades check exact Origin before accepting a cookie session (cross-site WebSocket hijacking).
- **File handling / SSRF (CWE-434/918/22):**
  - R2 object keys are server-generated (`member-page-assets/<dir>/<size>-<mime>-<nonce>`), never taken from user paths.
  - Finalize verifies bytes, size and type against the declared MIME.
  - Assets are served with a safe content type.
  - Quiz `pictures.ts` validates uploads and uses unguessable names.
  - No server-side fetch of user-supplied URLs, including avatars and social links, without an allowlist.
- **Rate limiting / DoS (CWE-770):**
  - Bounded queues, payload limits and per-connection rate limits on WebSocket messages (Quiz `rate-limit.ts`, Pusoy emote limits, Strokies protocol limits).
  - Join cooldowns.
  - Score submission endpoints validate plausibility.
- **Secrets and crypto (CWE-798/327/208):**
  - HMAC verification is constant-time (`timingSafeEqual` in `src/lib/auth/crypto.ts`; Join `progress.ts` via WebCrypto).
  - Secrets come only from env/Worker secrets, never committed or shipped to clients.
  - Join's `PROGRESS_SECRET` signs progress and the invite is revealed only server-side after `done` covers every challenge.
- **Deployment / supply chain:** Caddy terminates TLS for Quiz/Strokies, and the apps are not exposed directly. Docker images and CI pin Node. Lockfiles are frozen.

## 7. Out of scope / accepted risk (owner-confirmed)

- **Admins and DB owner are trusted.** Issues that need `site_role=admin` or DB-owner access are low priority. `/admin` has no network restriction beyond `site_role=admin`, so a bypass of the admin check by a non-admin is *not* covered by this rule.
- **Join:** widget self-reporting/spoofing of client-side challenges and sharing the Discord invite after clearance are accepted risk.
- **Quiz:** the ≤30s authenticated-socket introspection lease is accepted risk.
- **Quiz:** picture URLs are public but unguessable. Anyone holding the URL can fetch it, and that is accepted risk.
- **Non-deployed paths are lower priority:** Strokies `apps/worker` / wrangler Cloudflare path, and Pusoy's Docker/Node stack (`apps/server`, `deploy/`). Findings affecting only these paths rank lower.
- **Strokies operator console:** production access is behind Cloudflare Access/OIDC with MFA. Console findings need an attacker past that gateway, unless the finding bypasses it.

## 8. Open questions

None at present.
