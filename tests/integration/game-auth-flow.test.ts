import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as authorizeRoute from '@/app/api/auth/game/authorize/route';
import * as resumeRoute from '@/app/api/auth/game/authorize/resume/route';
import * as tokenRoute from '@/app/api/auth/game/token/route';
import * as introspectRoute from '@/app/api/auth/game/introspect/route';
import * as revokeRoute from '@/app/api/auth/game/revoke/route';
import * as gameDbModule from '@/lib/auth/game-db';
import * as dbModule from '@/lib/auth/db';
import {
  generateGameAccessToken,
  generateGameAuthorizationCode,
  generateGameClientSecret,
  generateGamePkce,
  generateGameState,
  hashGameToken,
  signGameAuthCookie,
  GAME_OAUTH_SCOPE,
} from '@/lib/auth/game-oauth';
import {
  GAME_AUTHORIZATION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from '@/lib/auth/http';
import { VALID_PROD_ENV, setTestEnv, clearAuthEnv } from '../helpers/test-fixtures';

vi.mock('@/lib/auth/game-db', () => ({
  getGameOAuthClient: vi.fn(),
  authenticateGameClient: vi.fn(),
  issueGameAuthorizationCode: vi.fn(),
  exchangeGameAuthorizationCode: vi.fn(),
  introspectGameAccessToken: vi.fn(),
  revokeGameAccessToken: vi.fn(),
}));

vi.mock('@/lib/auth/db', () => ({
  verifySession: vi.fn(),
}));

describe('Game Route Authorization Contract Integration Tests', () => {
  const originalEnv = { ...process.env };

  const TEST_CLIENT = {
    clientId: 'poker',
    audience: 'urn:teamham:game:poker',
    redirectUri: 'https://poker.teamham.world/auth/callback',
    clientSecret: generateGameClientSecret(),
    clientSecretHash: '',
    enabled: true,
  };
  TEST_CLIENT.clientSecretHash = hashGameToken(TEST_CLIENT.clientSecret);

  function createBasicAuthHeader(
    clientId = TEST_CLIENT.clientId,
    secret = TEST_CLIENT.clientSecret
  ): string {
    return `Basic ${Buffer.from(`${clientId}:${secret}`, 'utf8').toString('base64')}`;
  }

  function getSetCookieHeaders(response: Response): string[] {
    if (typeof response.headers.getSetCookie === 'function') {
      return response.headers.getSetCookie();
    }
    const header = response.headers.get('set-cookie');
    return header ? [header] : [];
  }

  function assertProtectedHeaders(response: Response, isOAuthJson = false) {
    expect(response.headers.get('cache-control')).toBe(
      'private, no-cache, no-store, max-age=0, must-revalidate'
    );
    expect(response.headers.get('pragma')).toBe('no-cache');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();

    const vary = response.headers.get('vary') || '';
    if (isOAuthJson) {
      expect(vary.toLowerCase()).toContain('authorization');
    } else {
      expect(vary.toLowerCase()).toContain('cookie');
    }
  }

  beforeEach(() => {
    vi.clearAllMocks();
    clearAuthEnv();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // ---------------------------------------------------------------------------
  // 1. DISABLED MODE CONTRACT (GAC-11)
  // ---------------------------------------------------------------------------
  describe('1. Disabled Mode 404 Isolation (AUTH_MODE=disabled)', () => {
    const routeHandlers = [
      { name: '/authorize', handlers: authorizeRoute },
      { name: '/authorize/resume', handlers: resumeRoute },
      { name: '/token', handlers: tokenRoute },
      { name: '/introspect', handlers: introspectRoute },
      { name: '/revoke', handlers: revokeRoute },
    ];

    const httpMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

    for (const route of routeHandlers) {
      for (const method of httpMethods) {
        it(`${route.name} returns generic 404 for ${method} when AUTH_MODE=disabled without touching secrets or DB`, async () => {
          setTestEnv({ AUTH_MODE: 'disabled' });

          const handler = (route.handlers as Record<string, (req: Request) => Promise<Response>>)[method];
          expect(handler).toBeDefined();

          const req = new Request(`https://teamham.world/api/auth/game${route.name === '/authorize' ? '/authorize' : route.name}`, {
            method,
          });

          const res = await handler(req);
          expect(res.status).toBe(404);
          expect(await res.text()).toBe('Not Found');
          expect(res.headers.get('content-type')).toContain('text/plain');
          assertProtectedHeaders(res);
          expect(getSetCookieHeaders(res)).toHaveLength(0);

          expect(gameDbModule.getGameOAuthClient).not.toHaveBeenCalled();
          expect(gameDbModule.authenticateGameClient).not.toHaveBeenCalled();
          expect(dbModule.verifySession).not.toHaveBeenCalled();
        });
      }
    }
  });

  // ---------------------------------------------------------------------------
  // 2. METHOD NOT ALLOWED (405) AND OPTIONS/HEAD BEHAVIOR
  // ---------------------------------------------------------------------------
  describe('2. Method Enforcement (405 Behavior & Allow Headers)', () => {
    beforeEach(() => {
      setTestEnv(VALID_PROD_ENV);
    });

    const getRoutes = [
      { name: '/authorize', handlers: authorizeRoute },
      { name: '/authorize/resume', handlers: resumeRoute },
    ];

    const postRoutes = [
      { name: '/token', handlers: tokenRoute },
      { name: '/introspect', handlers: introspectRoute },
      { name: '/revoke', handlers: revokeRoute },
    ];

    for (const route of getRoutes) {
      const disallowed = ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
      for (const method of disallowed) {
        it(`${route.name} returns 405 Method Not Allowed for ${method} with Allow: GET`, async () => {
          const handler = (route.handlers as Record<string, (req: Request) => Promise<Response>>)[method];
          const req = new Request(`https://teamham.world/api/auth/game${route.name === '/authorize' ? '/authorize' : route.name}`, {
            method,
          });
          const res = await handler(req);
          expect(res.status).toBe(405);
          expect(res.headers.get('allow')).toBe('GET');
          expect(await res.text()).toBe('Method Not Allowed');
          assertProtectedHeaders(res);
        });
      }
    }

    for (const route of postRoutes) {
      const disallowed = ['GET', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
      for (const method of disallowed) {
        it(`${route.name} returns 405 Method Not Allowed for ${method} with Allow: POST`, async () => {
          const handler = (route.handlers as Record<string, (req: Request) => Promise<Response>>)[method];
          const req = new Request(`https://teamham.world/api/auth/game${route.name}`, {
            method,
          });
          const res = await handler(req);
          expect(res.status).toBe(405);
          expect(res.headers.get('allow')).toBe('POST');
          expect(await res.text()).toBe('Method Not Allowed');
          assertProtectedHeaders(res);
        });
      }
    }
  });

  // ---------------------------------------------------------------------------
  // 3. PRODUCTION CANONICAL ORIGIN REPRESENTATION AGREEMENT
  // ---------------------------------------------------------------------------
  describe('3. Production Canonical Origin Representation Agreement', () => {
    beforeEach(() => {
      setTestEnv(VALID_PROD_ENV);
    });

    it('rejects mismatched x-forwarded-host on GET /authorize', async () => {
      const req = new Request('https://teamham.world/api/auth/game/authorize', {
        headers: {
          'x-forwarded-host': 'evil.com',
          'x-forwarded-proto': 'https',
        },
      });
      const res = await authorizeRoute.GET(req);
      expect(res.status).toBe(400);
      expect(await res.text()).toContain('Invalid request host');
      assertProtectedHeaders(res);
    });

    it('rejects non-https protocol on GET /authorize/resume', async () => {
      const req = new Request('https://teamham.world/api/auth/game/authorize/resume', {
        headers: {
          'x-forwarded-host': 'teamham.world',
          'x-forwarded-proto': 'http',
        },
      });
      const res = await resumeRoute.GET(req);
      expect(res.status).toBe(400);
      expect(await res.text()).toContain('Invalid request host');
      assertProtectedHeaders(res);
    });

    it('rejects mismatched x-forwarded-host on POST /token with OAuth error JSON', async () => {
      const req = new Request('https://teamham.world/api/auth/game/token', {
        method: 'POST',
        headers: {
          'x-forwarded-host': 'evil.com',
          'x-forwarded-proto': 'https',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=authorization_code',
      });
      const res = await tokenRoute.POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json).toEqual({ error: 'invalid_request', error_description: 'Invalid request host.' });
      assertProtectedHeaders(res, true);
    });

    it('rejects mismatched host on POST /introspect with OAuth error JSON', async () => {
      const req = new Request('https://teamham.world/api/auth/game/introspect', {
        method: 'POST',
        headers: {
          'x-forwarded-host': 'attacker.com',
          'x-forwarded-proto': 'https',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'token=tha_test',
      });
      const res = await introspectRoute.POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json).toEqual({ error: 'invalid_request', error_description: 'Invalid request host.' });
      assertProtectedHeaders(res, true);
    });

    it('rejects mismatched host on POST /revoke with OAuth error JSON', async () => {
      const req = new Request('https://teamham.world/api/auth/game/revoke', {
        method: 'POST',
        headers: {
          'x-forwarded-host': 'attacker.com',
          'x-forwarded-proto': 'https',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'token=tha_test',
      });
      const res = await revokeRoute.POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json).toEqual({ error: 'invalid_request', error_description: 'Invalid request host.' });
      assertProtectedHeaders(res, true);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. GET /api/auth/game/authorize ROUTE CONTRACT
  // ---------------------------------------------------------------------------
  describe('4. GET /api/auth/game/authorize Contract', () => {
    const validState = generateGameState();
    const pkce = generateGamePkce();

    function buildAuthorizeUrl(overrides: Record<string, string> = {}): string {
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: TEST_CLIENT.clientId,
        redirect_uri: TEST_CLIENT.redirectUri,
        scope: GAME_OAUTH_SCOPE,
        state: validState,
        code_challenge: pkce.challenge,
        code_challenge_method: 'S256',
        audience: TEST_CLIENT.audience,
        ...overrides,
      });
      return `https://teamham.world/api/auth/game/authorize?${params.toString()}`;
    }

    beforeEach(() => {
      setTestEnv(VALID_PROD_ENV);
    });

    it('rejects query string exceeding 2048 bytes with 400 HTML', async () => {
      const longState = 'a'.repeat(2050);
      const req = new Request(`https://teamham.world/api/auth/game/authorize?state=${longState}`);
      const res = await authorizeRoute.GET(req);
      expect(res.status).toBe(400);
      expect(await res.text()).toContain('exceeds maximum allowed size');
      assertProtectedHeaders(res);
    });

    it('rejects duplicate query parameters with 400 HTML', async () => {
      const url = `${buildAuthorizeUrl()}&client_id=poker`;
      const req = new Request(url);
      const res = await authorizeRoute.GET(req);
      expect(res.status).toBe(400);
      expect(await res.text()).toContain('Duplicate query parameters detected');
      assertProtectedHeaders(res);
    });

    it('rejects invalid or unsupported parameters (wrong scope, plain PKCE, invalid state/challenge)', async () => {
      // Wrong scope
      const resScope = await authorizeRoute.GET(new Request(buildAuthorizeUrl({ scope: 'openid' })));
      expect(resScope.status).toBe(400);

      // Wrong response_type
      const resResp = await authorizeRoute.GET(new Request(buildAuthorizeUrl({ response_type: 'token' })));
      expect(resResp.status).toBe(400);

      // Plain PKCE
      const resPkce = await authorizeRoute.GET(new Request(buildAuthorizeUrl({ code_challenge_method: 'plain' })));
      expect(resPkce.status).toBe(400);

      // Short state
      const resState = await authorizeRoute.GET(new Request(buildAuthorizeUrl({ state: 'short' })));
      expect(resState.status).toBe(400);
    });

    it('rejects unknown or disabled client with 400 HTML', async () => {
      vi.mocked(gameDbModule.getGameOAuthClient).mockResolvedValueOnce(null);

      const req = new Request(buildAuthorizeUrl());
      const res = await authorizeRoute.GET(req);
      expect(res.status).toBe(400);
      expect(await res.text()).toContain('Client is unknown or disabled');

      vi.mocked(gameDbModule.getGameOAuthClient).mockResolvedValueOnce({
        clientId: TEST_CLIENT.clientId,
        audience: TEST_CLIENT.audience,
        redirectUri: TEST_CLIENT.redirectUri,
        clientSecretHash: TEST_CLIENT.clientSecretHash,
        enabled: false,
      });

      const resDisabled = await authorizeRoute.GET(new Request(buildAuthorizeUrl()));
      expect(resDisabled.status).toBe(400);
      expect(await resDisabled.text()).toContain('Client is unknown or disabled');
    });

    it('rejects redirect_uri or audience mismatch against DB client record with 400 HTML', async () => {
      vi.mocked(gameDbModule.getGameOAuthClient).mockResolvedValueOnce({
        clientId: TEST_CLIENT.clientId,
        audience: TEST_CLIENT.audience,
        redirectUri: 'https://poker.teamham.world/registered/callback',
        clientSecretHash: TEST_CLIENT.clientSecretHash,
        enabled: true,
      });

      const resMismatchedRedirect = await authorizeRoute.GET(
        new Request(buildAuthorizeUrl())
      );
      expect(resMismatchedRedirect.status).toBe(400);
      expect(await resMismatchedRedirect.text()).toContain('Redirect URI does not match registered client configuration');
    });

    it('returns 503 HTML when database client lookup fails', async () => {
      vi.mocked(gameDbModule.getGameOAuthClient).mockRejectedValueOnce(new Error('DB unreachable'));
      const req = new Request(buildAuthorizeUrl());
      const res = await authorizeRoute.GET(req);
      expect(res.status).toBe(503);
      expect(await res.text()).toContain('Database temporarily unavailable');
      assertProtectedHeaders(res);
    });

    it('executes Silent SSO (Case A): issues code and redirects 302 to redirect_uri with code, state, iss', async () => {
      vi.mocked(gameDbModule.getGameOAuthClient).mockResolvedValueOnce({
        clientId: TEST_CLIENT.clientId,
        audience: TEST_CLIENT.audience,
        redirectUri: TEST_CLIENT.redirectUri,
        clientSecretHash: TEST_CLIENT.clientSecretHash,
        enabled: true,
      });

      const memberAccountId = '550e8400-e29b-41d4-a716-446655440000';
      const validSessionCookie = 'A'.repeat(43);

      vi.mocked(dbModule.verifySession).mockResolvedValueOnce({
        valid: true,
        account: {
          id: memberAccountId,
          accessStatus: 'active',
          membershipStatus: 'eligible',
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          username: 'hamfriend',
        },
      });

      vi.mocked(gameDbModule.issueGameAuthorizationCode).mockResolvedValueOnce({
        success: true,
        redirectUri: TEST_CLIENT.redirectUri,
        audience: TEST_CLIENT.audience,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      });

      const req = new Request(buildAuthorizeUrl(), {
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${validSessionCookie}`,
        },
      });

      const res = await authorizeRoute.GET(req);
      expect(res.status).toBe(302);
      assertProtectedHeaders(res);

      const location = res.headers.get('location');
      expect(location).toBeDefined();
      const redirectUrl = new URL(location!);

      expect(redirectUrl.origin).toBe('https://poker.teamham.world');
      expect(redirectUrl.pathname).toBe('/auth/callback');
      expect(redirectUrl.searchParams.get('state')).toBe(validState);
      expect(redirectUrl.searchParams.get('iss')).toBe('https://teamham.world');

      const issuedCode = redirectUrl.searchParams.get('code');
      expect(issuedCode).toMatch(/^thc_[A-Za-z0-9_-]{43}$/);

      // Verify DB was called with account ID and challenge
      expect(gameDbModule.issueGameAuthorizationCode).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: memberAccountId,
          clientId: TEST_CLIENT.clientId,
          codeChallenge: pkce.challenge,
        })
      );

      // No game_authz cookie set on silent SSO
      const cookies = getSetCookieHeaders(res);
      expect(cookies.some((c) => c.startsWith(`${GAME_AUTHORIZATION_COOKIE_NAME}=`))).toBe(false);
    });

    it('executes Interrupted Flow (Case B): unauthenticated member sets __Host-game_authz cookie and redirects to Discord login', async () => {
      vi.mocked(gameDbModule.getGameOAuthClient).mockResolvedValueOnce({
        clientId: TEST_CLIENT.clientId,
        audience: TEST_CLIENT.audience,
        redirectUri: TEST_CLIENT.redirectUri,
        clientSecretHash: TEST_CLIENT.clientSecretHash,
        enabled: true,
      });

      const req = new Request(buildAuthorizeUrl()); // No session cookie
      const res = await authorizeRoute.GET(req);

      expect(res.status).toBe(302);
      assertProtectedHeaders(res);

      const location = res.headers.get('location');
      expect(location).toBe('https://teamham.world/api/auth/discord/login?return_to=%2Fapi%2Fauth%2Fgame%2Fauthorize%2Fresume');

      const cookies = getSetCookieHeaders(res);
      const authCookie = cookies.find((c) => c.startsWith(`${GAME_AUTHORIZATION_COOKIE_NAME}=`));
      expect(authCookie).toBeDefined();
      expect(authCookie).toContain('Path=/');
      expect(authCookie).toContain('Max-Age=600');
      expect(authCookie).toContain('HttpOnly');
      expect(authCookie).toContain('Secure');
      expect(authCookie).toContain('SameSite=Lax');
      expect(authCookie).not.toContain('Domain=');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. GET /api/auth/game/authorize/resume ROUTE CONTRACT
  // ---------------------------------------------------------------------------
  describe('5. GET /api/auth/game/authorize/resume Contract', () => {
    const validState = generateGameState();
    const pkce = generateGamePkce();
    const memberAccountId = '550e8400-e29b-41d4-a716-446655440000';
    const validSessionCookie = 'B'.repeat(43);

    function createValidGameAuthCookie(): string {
      return signGameAuthCookie(
        {
          responseType: 'code',
          clientId: TEST_CLIENT.clientId,
          redirectUri: TEST_CLIENT.redirectUri,
          scope: GAME_OAUTH_SCOPE,
          audience: TEST_CLIENT.audience,
          state: validState,
          codeChallenge: pkce.challenge,
          codeChallengeMethod: 'S256',
          issuedAt: Math.floor(Date.now() / 1000),
        },
        VALID_PROD_ENV.GAME_AUTH_REQUEST_HMAC_SECRET,
        'production'
      );
    }

    beforeEach(() => {
      setTestEnv(VALID_PROD_ENV);
    });

    it('rejects query parameters with 400 and clears pending cookie', async () => {
      const req = new Request('https://teamham.world/api/auth/game/authorize/resume?foo=bar', {
        headers: {
          cookie: `${GAME_AUTHORIZATION_COOKIE_NAME}=${createValidGameAuthCookie()}`,
        },
      });
      const res = await resumeRoute.GET(req);
      expect(res.status).toBe(400);
      expect(await res.text()).toContain('Query parameters are not permitted');

      const cookies = getSetCookieHeaders(res);
      expect(cookies.some((c) => c.includes(`${GAME_AUTHORIZATION_COOKIE_NAME}=;`) && c.includes('Max-Age=0'))).toBe(true);
    });

    it('rejects missing or tampered __Host-game_authz cookie with 400 and clears cookie', async () => {
      const req = new Request('https://teamham.world/api/auth/game/authorize/resume', {
        headers: {
          cookie: `${GAME_AUTHORIZATION_COOKIE_NAME}=invalid.signature`,
        },
      });
      const res = await resumeRoute.GET(req);
      expect(res.status).toBe(400);

      const cookies = getSetCookieHeaders(res);
      expect(cookies.some((c) => c.includes(`${GAME_AUTHORIZATION_COOKIE_NAME}=;`))).toBe(true);
    });

    it('rejects missing central session with 401 and clears pending cookie', async () => {
      const req = new Request('https://teamham.world/api/auth/game/authorize/resume', {
        headers: {
          cookie: `${GAME_AUTHORIZATION_COOKIE_NAME}=${createValidGameAuthCookie()}`,
        },
      });
      const res = await resumeRoute.GET(req);
      expect(res.status).toBe(401);
      expect(await res.text()).toContain('Active member session is required');

      const cookies = getSetCookieHeaders(res);
      expect(cookies.some((c) => c.includes(`${GAME_AUTHORIZATION_COOKIE_NAME}=;`))).toBe(true);
    });

    it('rejects ineligible or suspended session with 403 and clears pending cookie', async () => {
      vi.mocked(dbModule.verifySession).mockResolvedValueOnce({
        valid: false,
      });

      const req = new Request('https://teamham.world/api/auth/game/authorize/resume', {
        headers: {
          cookie: `${GAME_AUTHORIZATION_COOKIE_NAME}=${createValidGameAuthCookie()}; ${SESSION_COOKIE_NAME}=${validSessionCookie}`,
        },
      });
      const res = await resumeRoute.GET(req);
      expect(res.status).toBe(403);
      expect(await res.text()).toContain('An active and eligible member session is required');

      const cookies = getSetCookieHeaders(res);
      expect(cookies.some((c) => c.includes(`${GAME_AUTHORIZATION_COOKIE_NAME}=;`))).toBe(true);
    });

    it('retains pending cookie on retryable 503 DB errors', async () => {
      vi.mocked(dbModule.verifySession).mockRejectedValueOnce(new Error('DB unreachable'));

      const req = new Request('https://teamham.world/api/auth/game/authorize/resume', {
        headers: {
          cookie: `${GAME_AUTHORIZATION_COOKIE_NAME}=${createValidGameAuthCookie()}; ${SESSION_COOKIE_NAME}=${validSessionCookie}`,
        },
      });
      const res = await resumeRoute.GET(req);
      expect(res.status).toBe(503);

      const cookies = getSetCookieHeaders(res);
      // Cookie MUST NOT be cleared on 503 outage
      expect(cookies.some((c) => c.includes(`${GAME_AUTHORIZATION_COOKIE_NAME}=;`))).toBe(false);
    });

    it('completes successful resume: issues code, redirects 302 with code/state/iss, and clears pending cookie', async () => {
      vi.mocked(dbModule.verifySession).mockResolvedValueOnce({
        valid: true,
        account: {
          id: memberAccountId,
          accessStatus: 'active',
          membershipStatus: 'eligible',
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          username: 'hamfriend',
        },
      });

      vi.mocked(gameDbModule.getGameOAuthClient).mockResolvedValueOnce({
        clientId: TEST_CLIENT.clientId,
        audience: TEST_CLIENT.audience,
        redirectUri: TEST_CLIENT.redirectUri,
        clientSecretHash: TEST_CLIENT.clientSecretHash,
        enabled: true,
      });

      vi.mocked(gameDbModule.issueGameAuthorizationCode).mockResolvedValueOnce({
        success: true,
        redirectUri: TEST_CLIENT.redirectUri,
        audience: TEST_CLIENT.audience,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      });

      const req = new Request('https://teamham.world/api/auth/game/authorize/resume', {
        headers: {
          cookie: `${GAME_AUTHORIZATION_COOKIE_NAME}=${createValidGameAuthCookie()}; ${SESSION_COOKIE_NAME}=${validSessionCookie}`,
        },
      });

      const res = await resumeRoute.GET(req);
      expect(res.status).toBe(302);
      assertProtectedHeaders(res);

      const location = res.headers.get('location');
      expect(location).toBeDefined();
      const redirectUrl = new URL(location!);

      expect(redirectUrl.origin).toBe('https://poker.teamham.world');
      expect(redirectUrl.pathname).toBe('/auth/callback');
      expect(redirectUrl.searchParams.get('state')).toBe(validState);
      expect(redirectUrl.searchParams.get('iss')).toBe('https://teamham.world');
      expect(redirectUrl.searchParams.get('code')).toMatch(/^thc_[A-Za-z0-9_-]{43}$/);

      // Verify pending cookie was cleared
      const cookies = getSetCookieHeaders(res);
      expect(cookies.some((c) => c.includes(`${GAME_AUTHORIZATION_COOKIE_NAME}=;`) && c.includes('Max-Age=0'))).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. POST /api/auth/game/token ROUTE CONTRACT
  // ---------------------------------------------------------------------------
  describe('6. POST /api/auth/game/token Contract', () => {
    const validCode = generateGameAuthorizationCode();
    const pkce = generateGamePkce();
    const pairwiseSubjectId = '550e8400-e29b-41d4-a716-446655440000';

    function buildTokenBody(overrides: Record<string, string> = {}): string {
      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code: validCode,
        redirect_uri: TEST_CLIENT.redirectUri,
        code_verifier: pkce.verifier,
        ...overrides,
      });
      return params.toString();
    }

    beforeEach(() => {
      setTestEnv(VALID_PROD_ENV);
    });

    it('rejects Content-Type other than application/x-www-form-urlencoded with 415', async () => {
      const req = new Request('https://teamham.world/api/auth/game/token', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: createBasicAuthHeader(),
        },
        body: JSON.stringify({ grant_type: 'authorization_code' }),
      });
      const res = await tokenRoute.POST(req);
      expect(res.status).toBe(415);
      const json = await res.json();
      expect(json.error).toBe('invalid_request');
      assertProtectedHeaders(res, true);
    });

    it('rejects query parameters on POST endpoint with 400', async () => {
      const req = new Request('https://teamham.world/api/auth/game/token?grant_type=code', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: createBasicAuthHeader(),
        },
        body: buildTokenBody(),
      });
      const res = await tokenRoute.POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('invalid_request');
    });

    it('rejects missing or invalid Basic client authentication with 401 and WWW-Authenticate header', async () => {
      // Missing auth
      const reqNoAuth = new Request('https://teamham.world/api/auth/game/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: buildTokenBody(),
      });
      const resNoAuth = await tokenRoute.POST(reqNoAuth);
      expect(resNoAuth.status).toBe(401);
      expect(resNoAuth.headers.get('www-authenticate')).toBe('Basic realm="teamham_game"');
      expect((await resNoAuth.json()).error).toBe('invalid_client');

      // Bad credentials in DB (valid 47-char format secret that is not registered)
      const validFormatWrongSecret = 'ths_' + 'x'.repeat(43);
      vi.mocked(gameDbModule.authenticateGameClient).mockResolvedValueOnce(null);
      const reqBadAuth = new Request('https://teamham.world/api/auth/game/token', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: createBasicAuthHeader('poker', validFormatWrongSecret),
        },
        body: buildTokenBody(),
      });
      const resBadAuth = await tokenRoute.POST(reqBadAuth);
      expect(resBadAuth.status).toBe(401);
      expect(resBadAuth.headers.get('www-authenticate')).toBe('Basic realm="teamham_game"');
    });

    it('rejects duplicate body parameters with 400 invalid_request', async () => {
      vi.mocked(gameDbModule.authenticateGameClient).mockResolvedValueOnce({
        clientId: TEST_CLIENT.clientId,
        audience: TEST_CLIENT.audience,
        redirectUri: TEST_CLIENT.redirectUri,
        clientSecretHash: TEST_CLIENT.clientSecretHash,
        enabled: true,
      });

      const body = `${buildTokenBody()}&code=thc_another`;
      const req = new Request('https://teamham.world/api/auth/game/token', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: createBasicAuthHeader(),
        },
        body,
      });
      const res = await tokenRoute.POST(req);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('invalid_request');
    });

    it('rejects unsupported grant_type with 400 unsupported_grant_type', async () => {
      vi.mocked(gameDbModule.authenticateGameClient).mockResolvedValueOnce({
        clientId: TEST_CLIENT.clientId,
        audience: TEST_CLIENT.audience,
        redirectUri: TEST_CLIENT.redirectUri,
        clientSecretHash: TEST_CLIENT.clientSecretHash,
        enabled: true,
      });

      const req = new Request('https://teamham.world/api/auth/game/token', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: createBasicAuthHeader(),
        },
        body: buildTokenBody({ grant_type: 'client_credentials' }),
      });
      const res = await tokenRoute.POST(req);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('unsupported_grant_type');
    });

    it('rejects expired, consumed, or PKCE-mismatched code from DB exchange with 400 invalid_grant', async () => {
      vi.mocked(gameDbModule.authenticateGameClient).mockResolvedValueOnce({
        clientId: TEST_CLIENT.clientId,
        audience: TEST_CLIENT.audience,
        redirectUri: TEST_CLIENT.redirectUri,
        clientSecretHash: TEST_CLIENT.clientSecretHash,
        enabled: true,
      });

      vi.mocked(gameDbModule.exchangeGameAuthorizationCode).mockResolvedValueOnce({
        success: false,
        reason: 'invalid_grant',
      });

      const req = new Request('https://teamham.world/api/auth/game/token', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: createBasicAuthHeader(),
        },
        body: buildTokenBody(),
      });
      const res = await tokenRoute.POST(req);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('invalid_grant');
    });

    it('returns 503 temporarily_unavailable when DB exchange fails', async () => {
      vi.mocked(gameDbModule.authenticateGameClient).mockResolvedValueOnce({
        clientId: TEST_CLIENT.clientId,
        audience: TEST_CLIENT.audience,
        redirectUri: TEST_CLIENT.redirectUri,
        clientSecretHash: TEST_CLIENT.clientSecretHash,
        enabled: true,
      });

      vi.mocked(gameDbModule.exchangeGameAuthorizationCode).mockRejectedValueOnce(
        new Error('DB connection pool timeout')
      );

      const req = new Request('https://teamham.world/api/auth/game/token', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: createBasicAuthHeader(),
        },
        body: buildTokenBody(),
      });
      const res = await tokenRoute.POST(req);
      expect(res.status).toBe(503);
      expect((await res.json()).error).toBe('temporarily_unavailable');
    });

    it('completes successful exchange: returns exact documented 200 JSON keys and headers', async () => {
      vi.mocked(gameDbModule.authenticateGameClient).mockResolvedValueOnce({
        clientId: TEST_CLIENT.clientId,
        audience: TEST_CLIENT.audience,
        redirectUri: TEST_CLIENT.redirectUri,
        clientSecretHash: TEST_CLIENT.clientSecretHash,
        enabled: true,
      });

      const expiryIso = new Date(Date.now() + 86400 * 1000).toISOString();
      vi.mocked(gameDbModule.exchangeGameAuthorizationCode).mockResolvedValueOnce({
        success: true,
        subjectId: pairwiseSubjectId,
        audience: TEST_CLIENT.audience,
        expiresAt: expiryIso,
      });

      const req = new Request('https://teamham.world/api/auth/game/token', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: createBasicAuthHeader(),
        },
        body: buildTokenBody(),
      });

      const res = await tokenRoute.POST(req);
      expect(res.status).toBe(200);
      assertProtectedHeaders(res, true);

      const data = await res.json();

      // Exact documented response keys contract verification
      const expectedKeys = ['access_token', 'audience', 'expires_in', 'scope', 'sub', 'token_type'].sort();
      expect(Object.keys(data).sort()).toEqual(expectedKeys);

      expect(data.access_token).toMatch(/^tha_[A-Za-z0-9_-]{43}$/);
      expect(data.token_type).toBe('Bearer');
      expect(typeof data.expires_in).toBe('number');
      expect(data.expires_in).toBeGreaterThan(0);
      expect(data.audience).toBe(TEST_CLIENT.audience);
      expect(data.sub).toBe(pairwiseSubjectId);
      expect(data.scope).toBe('identity');
    });
  });

  // ---------------------------------------------------------------------------
  // 7. POST /api/auth/game/introspect ROUTE CONTRACT
  // ---------------------------------------------------------------------------
  describe('7. POST /api/auth/game/introspect Contract', () => {
    const validAccessToken = generateGameAccessToken();
    const pairwiseSubjectId = '550e8400-e29b-41d4-a716-446655440000';

    beforeEach(() => {
      setTestEnv(VALID_PROD_ENV);
    });

    it('rejects Content-Type other than urlencoded with 415', async () => {
      const req = new Request('https://teamham.world/api/auth/game/introspect', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: createBasicAuthHeader(),
        },
        body: JSON.stringify({ token: validAccessToken }),
      });
      const res = await introspectRoute.POST(req);
      expect(res.status).toBe(415);
      assertProtectedHeaders(res, true);
    });

    it('rejects missing or bad Basic client auth with 401', async () => {
      const req = new Request('https://teamham.world/api/auth/game/introspect', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `token=${validAccessToken}`,
      });
      const res = await introspectRoute.POST(req);
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toBe('Basic realm="teamham_game"');
    });

    it('returns { active: false } exactly for malformed token format without calling DB', async () => {
      vi.mocked(gameDbModule.authenticateGameClient).mockResolvedValueOnce({
        clientId: TEST_CLIENT.clientId,
        audience: TEST_CLIENT.audience,
        redirectUri: TEST_CLIENT.redirectUri,
        clientSecretHash: TEST_CLIENT.clientSecretHash,
        enabled: true,
      });

      const req = new Request('https://teamham.world/api/auth/game/introspect', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: createBasicAuthHeader(),
        },
        body: 'token=invalid_token_format',
      });
      const res = await introspectRoute.POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ active: false });
      expect(Object.keys(data)).toEqual(['active']);
      expect(gameDbModule.introspectGameAccessToken).not.toHaveBeenCalled();
    });

    it('returns 503 temporarily_unavailable when DB fails (fails closed, never active: false on DB error)', async () => {
      vi.mocked(gameDbModule.authenticateGameClient).mockResolvedValueOnce({
        clientId: TEST_CLIENT.clientId,
        audience: TEST_CLIENT.audience,
        redirectUri: TEST_CLIENT.redirectUri,
        clientSecretHash: TEST_CLIENT.clientSecretHash,
        enabled: true,
      });

      vi.mocked(gameDbModule.introspectGameAccessToken).mockRejectedValueOnce(
        new Error('DB unreachable')
      );

      const req = new Request('https://teamham.world/api/auth/game/introspect', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: createBasicAuthHeader(),
        },
        body: `token=${validAccessToken}`,
      });
      const res = await introspectRoute.POST(req);
      expect(res.status).toBe(503);
      expect((await res.json()).error).toBe('temporarily_unavailable');
    });

    it('returns { active: false } for expired/revoked/invalid tokens per DB', async () => {
      vi.mocked(gameDbModule.authenticateGameClient).mockResolvedValueOnce({
        clientId: TEST_CLIENT.clientId,
        audience: TEST_CLIENT.audience,
        redirectUri: TEST_CLIENT.redirectUri,
        clientSecretHash: TEST_CLIENT.clientSecretHash,
        enabled: true,
      });

      vi.mocked(gameDbModule.introspectGameAccessToken).mockResolvedValueOnce({
        active: false,
      });

      const req = new Request('https://teamham.world/api/auth/game/introspect', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: createBasicAuthHeader(),
        },
        body: `token=${validAccessToken}`,
      });
      const res = await introspectRoute.POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ active: false });
      expect(Object.keys(data)).toEqual(['active']);
    });

    it('returns exact active token contract with NO iat field', async () => {
      vi.mocked(gameDbModule.authenticateGameClient).mockResolvedValueOnce({
        clientId: TEST_CLIENT.clientId,
        audience: TEST_CLIENT.audience,
        redirectUri: TEST_CLIENT.redirectUri,
        clientSecretHash: TEST_CLIENT.clientSecretHash,
        enabled: true,
      });

      const expDate = new Date(Date.now() + 3600 * 1000);
      const iatDate = new Date();
      vi.mocked(gameDbModule.introspectGameAccessToken).mockResolvedValueOnce({
        active: true,
        subject: pairwiseSubjectId,
        clientId: TEST_CLIENT.clientId,
        audience: TEST_CLIENT.audience,
        issuedAt: iatDate.toISOString(),
        expiresAt: expDate.toISOString(),
      });

      const req = new Request('https://teamham.world/api/auth/game/introspect', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: createBasicAuthHeader(),
        },
        body: `token=${validAccessToken}&token_type_hint=access_token`,
      });

      const res = await introspectRoute.POST(req);
      expect(res.status).toBe(200);
      assertProtectedHeaders(res, true);

      const data = await res.json();

      // Field contract verification: exactly active, sub, client_id, aud, iss, exp, scope, token_type
      const expectedKeys = ['active', 'aud', 'client_id', 'exp', 'iss', 'scope', 'sub', 'token_type'].sort();
      expect(Object.keys(data).sort()).toEqual(expectedKeys);

      expect(data.active).toBe(true);
      expect(data.sub).toBe(pairwiseSubjectId);
      expect(data.client_id).toBe(TEST_CLIENT.clientId);
      expect(data.aud).toBe(TEST_CLIENT.audience);
      expect(data.iss).toBe('https://teamham.world');
      expect(data.exp).toBe(Math.floor(expDate.getTime() / 1000));
      expect(data.scope).toBe('identity');
      expect(data.token_type).toBe('Bearer');

      // CRITICAL CONTRACT: No introspection iat field
      expect((data as Record<string, unknown>).iat).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 8. POST /api/auth/game/revoke ROUTE CONTRACT
  // ---------------------------------------------------------------------------
  describe('8. POST /api/auth/game/revoke Contract', () => {
    const validAccessToken = generateGameAccessToken();
    const validAuthCode = generateGameAuthorizationCode();

    beforeEach(() => {
      setTestEnv(VALID_PROD_ENV);
    });

    it('rejects Content-Type other than urlencoded with 415', async () => {
      const req = new Request('https://teamham.world/api/auth/game/revoke', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: createBasicAuthHeader(),
        },
        body: JSON.stringify({ token: validAccessToken }),
      });
      const res = await revokeRoute.POST(req);
      expect(res.status).toBe(415);
      assertProtectedHeaders(res, true);
    });

    it('rejects missing or bad Basic client auth with 401', async () => {
      const req = new Request('https://teamham.world/api/auth/game/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `token=${validAccessToken}`,
      });
      const res = await revokeRoute.POST(req);
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toBe('Basic realm="teamham_game"');
    });

    it('rejects unsupported token_type_hint with 400 unsupported_token_type', async () => {
      vi.mocked(gameDbModule.authenticateGameClient).mockResolvedValueOnce({
        clientId: TEST_CLIENT.clientId,
        audience: TEST_CLIENT.audience,
        redirectUri: TEST_CLIENT.redirectUri,
        clientSecretHash: TEST_CLIENT.clientSecretHash,
        enabled: true,
      });

      const req = new Request('https://teamham.world/api/auth/game/revoke', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: createBasicAuthHeader(),
        },
        body: `token=${validAccessToken}&token_type_hint=refresh_token`,
      });
      const res = await revokeRoute.POST(req);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('unsupported_token_type');
    });

    it('never treats thc_ authorization codes as access tokens; returns 200 OK without calling DB revoke', async () => {
      vi.mocked(gameDbModule.authenticateGameClient).mockResolvedValueOnce({
        clientId: TEST_CLIENT.clientId,
        audience: TEST_CLIENT.audience,
        redirectUri: TEST_CLIENT.redirectUri,
        clientSecretHash: TEST_CLIENT.clientSecretHash,
        enabled: true,
      });

      const req = new Request('https://teamham.world/api/auth/game/revoke', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: createBasicAuthHeader(),
        },
        body: `token=${validAuthCode}`,
      });

      const res = await revokeRoute.POST(req);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({});
      expect(gameDbModule.revokeGameAccessToken).not.toHaveBeenCalled();
    });

    it('returns 200 OK for malformed token string without calling DB revoke (RFC 7009 idempotency)', async () => {
      vi.mocked(gameDbModule.authenticateGameClient).mockResolvedValueOnce({
        clientId: TEST_CLIENT.clientId,
        audience: TEST_CLIENT.audience,
        redirectUri: TEST_CLIENT.redirectUri,
        clientSecretHash: TEST_CLIENT.clientSecretHash,
        enabled: true,
      });

      const req = new Request('https://teamham.world/api/auth/game/revoke', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: createBasicAuthHeader(),
        },
        body: 'token=not_a_valid_token',
      });

      const res = await revokeRoute.POST(req);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({});
      expect(gameDbModule.revokeGameAccessToken).not.toHaveBeenCalled();
    });

    it('revokes valid tha_ access token in database and returns 200 OK {}', async () => {
      vi.mocked(gameDbModule.authenticateGameClient).mockResolvedValueOnce({
        clientId: TEST_CLIENT.clientId,
        audience: TEST_CLIENT.audience,
        redirectUri: TEST_CLIENT.redirectUri,
        clientSecretHash: TEST_CLIENT.clientSecretHash,
        enabled: true,
      });

      vi.mocked(gameDbModule.revokeGameAccessToken).mockResolvedValueOnce({
        success: true,
      });

      const req = new Request('https://teamham.world/api/auth/game/revoke', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: createBasicAuthHeader(),
        },
        body: `token=${validAccessToken}&token_type_hint=access_token`,
      });

      const res = await revokeRoute.POST(req);
      expect(res.status).toBe(200);
      assertProtectedHeaders(res, true);

      const data = await res.json();
      expect(data).toEqual({});
      expect(Object.keys(data)).toHaveLength(0);

      const expectedTokenHash = hashGameToken(validAccessToken);
      expect(gameDbModule.revokeGameAccessToken).toHaveBeenCalledWith({
        authenticatedClientId: TEST_CLIENT.clientId,
        tokenHash: expectedTokenHash,
        databaseUrl: VALID_PROD_ENV.DATABASE_URL,
      });
    });

    it('returns 503 temporarily_unavailable when DB revoke fails', async () => {
      vi.mocked(gameDbModule.authenticateGameClient).mockResolvedValueOnce({
        clientId: TEST_CLIENT.clientId,
        audience: TEST_CLIENT.audience,
        redirectUri: TEST_CLIENT.redirectUri,
        clientSecretHash: TEST_CLIENT.clientSecretHash,
        enabled: true,
      });

      vi.mocked(gameDbModule.revokeGameAccessToken).mockRejectedValueOnce(
        new Error('DB unreachable')
      );

      const req = new Request('https://teamham.world/api/auth/game/revoke', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: createBasicAuthHeader(),
        },
        body: `token=${validAccessToken}`,
      });

      const res = await revokeRoute.POST(req);
      expect(res.status).toBe(503);
      expect((await res.json()).error).toBe('temporarily_unavailable');
    });
  });
});
