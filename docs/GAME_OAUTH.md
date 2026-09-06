# Game OAuth integration

HAM games use the site's authorization-code flow, backed by Discord sign-in.
This is for reviewed game **backends**: keep the client secret and game access
token on the server. Browser or downloadable game code must not contain a
confidential client secret.

## Identity contract

Authenticate to `POST /api/auth/game/introspect` with HTTP Basic client
credentials and an `application/x-www-form-urlencoded` body containing `token`.
An active token returns:

```json
{
  "active": true,
  "sub": "550e8400-e29b-41d4-a716-446655440000",
  "username": "hamfriend",
  "client_id": "example_game",
  "aud": "urn:teamham:game:example_game",
  "iss": "https://teamham.world",
  "exp": 1788659999,
  "scope": "identity",
  "token_type": "Bearer"
}
```

Use `sub` as the game's account key. It stays stable for an account/client pair
and differs between games. `username` is the Discord username last captured at
successful sign-in; it can change or be `null`. Use it only for display, never
for account linking or permissions. Discord IDs, email, roles, and Discord
tokens are not included. The `username` field is an addition to the previous
introspection response; clients with exact-key decoders must accept it.

Inactive or other-client tokens return exactly `{"active":false}`. Database
failures return 503; a game must not authorize a user from an error response.
Introspection checks the central session, membership freshness, account access,
client enablement, and token expiry on every call. Logout, replacement of the
central session, or confirmed ineligibility invalidates its game tokens.

## Authorization flow

1. Register the reviewed backend's client ID, hashed secret, exact HTTPS
   callback, and `urn:teamham:game:<client_id>` audience through the database
   owner. Follow the [reserved-subdomain rule](../README.md#game-oauth-clients-and-delegated-subdomains)
   before registering a callback host. The application cannot register clients.
2. Generate independent random 32-byte base64url `state` and PKCE verifier
   values (43 characters). Store them in the game's server-side browser session.
   Hash the verifier with SHA-256 and base64url-encode it for `code_challenge`.
3. Navigate to `/api/auth/game/authorize` with `response_type=code`, `client_id`,
   the exact `redirect_uri`, `scope=identity`, `audience`, `state`,
   `code_challenge`, and `code_challenge_method=S256`. An eligible member session
   uses SSO; otherwise HAM redirects through Discord and resumes the bound request.
4. At the game callback, reject duplicate parameters and verify the returned
   `state` against that browser session and `iss` against `https://teamham.world`.
   Consume the stored state once and remove the callback query from browser
   history. Never log the code, verifier, token, or Basic authorization header.
5. Within 60 seconds, exchange the code server-to-server at
   `POST /api/auth/game/token`, using HTTP Basic authentication and a form body
   with `grant_type=authorization_code`, `code`, `redirect_uri`, and
   `code_verifier`. The token response includes `sub`, `audience`, `scope`,
   `token_type`, and `expires_in`. Do not retry a consumed code: replay revokes
   the corresponding active game token. Start a fresh authorization instead.
6. Introspect before granting access. For game-specific sign-out, call
   `POST /api/auth/game/revoke` with the same Basic credentials and a `token`
   form field. Revocation is idempotent and restricted to that client's tokens.

Game tokens expire within 24 hours and never outlive their source session.
There is no refresh-token, implicit, password, or public-client grant.

## Verification and operations

OAuth route regressions live in `tests/integration/oauth-flow.test.ts` and
`tests/integration/game-auth-flow.test.ts`; real PostgreSQL tests in
`tests/integration/db-queries.test.ts` cover replay races, redirect registration
changes, client isolation, session invalidation, and database privileges.
Use the disposable database instructions in [LOCAL_TESTING.md](LOCAL_TESTING.md).
The hardening changes require no schema migration. In-flight login cookies from
before the request-binding change fail closed; users can start sign-in again.

Only reviewed callback hosts should be registered. Apply deployment-level
request limits to authentication endpoints, keep secrets out of request logs,
and rotate or disable clients whose backend or callback host is compromised.
The source-code tests do not establish those deployed infrastructure settings.

Protocol references: [OAuth security BCP](https://www.rfc-editor.org/rfc/rfc9700.html),
[Discord OAuth](https://docs.discord.com/developers/topics/oauth2), and
[token introspection](https://www.rfc-editor.org/rfc/rfc7662.html).
