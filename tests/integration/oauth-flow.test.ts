import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import { GET as loginHandler } from '@/app/api/auth/discord/login/route';
import { GET as callbackHandler } from '@/app/api/auth/discord/callback/route';
import { POST as logoutHandler } from '@/app/api/auth/logout/route';
import {
  ALLOWED_OAUTH_RETURN_TO,
  AllowedOAuthReturnTo,
  generateOAuthState,
  generatePkceVerifier,
  generateSessionToken,
  hashSessionToken,
  signOAuthState,
  verifyOAuthStateCookie,
} from '@/lib/auth/crypto';
import {
  GAME_AUTHORIZATION_COOKIE_NAME,
  OAUTH_STATE_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from '@/lib/auth/http';
import { signGameAuthCookie, GameAuthRequestPayload } from '@/lib/auth/game-oauth';
import * as dbModule from '@/lib/auth/db';
import * as discordModule from '@/lib/auth/discord';
import {
  VALID_PROD_ENV,
  VALID_GAME_CLIENT_ID,
  VALID_GAME_AUDIENCE,
  VALID_GAME_REDIRECT_URI,
  setTestEnv,
  clearAuthEnv,
} from '../helpers/test-fixtures';

vi.mock('@/lib/auth/db', () => ({
  verifySession: vi.fn(),
  issueLoginSession: vi.fn(),
  recordIneligibleAccount: vi.fn(),
  deleteSessionByTokenHash: vi.fn(),
}));

vi.mock('@/lib/auth/discord', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/discord')>();
  return {
    ...actual,
    exchangeCodeAndCheckGuildRole: vi.fn(),
  };
});

describe('OAuth Flow Integration', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    clearAuthEnv();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  function getSetCookieHeaders(response: Response): string[] {
    if (typeof response.headers.getSetCookie === 'function') {
      return response.headers.getSetCookie();
    }
    const header = response.headers.get('set-cookie');
    return header ? [header] : [];
  }

  function assertProtectedHeaders(response: Response) {
    expect(response.headers.get('cache-control')).toBe(
      'private, no-cache, no-store, max-age=0, must-revalidate'
    );
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    const vary = response.headers.get('vary') || '';
    expect(vary.toLowerCase()).toContain('cookie');
  }

  function createValidGameAuthCookie(
    issuedAt = Math.floor(Date.now() / 1000)
  ): string {
    const payload: GameAuthRequestPayload = {
      responseType: 'code',
      clientId: VALID_GAME_CLIENT_ID,
      redirectUri: VALID_GAME_REDIRECT_URI,
      scope: 'identity',
      audience: VALID_GAME_AUDIENCE,
      state: 'E9Melhoa2OwvFrGMTJguCH5DTl4x74j3Pzh-cEBWb8g',
      codeChallenge: 'qjrzjdcxDhOqVmJ0q5fYGOMiaUhpxQtKW-2fTHC8-uo',
      codeChallengeMethod: 'S256',
      issuedAt,
    };
    return signGameAuthCookie(payload, VALID_PROD_ENV.GAME_AUTH_REQUEST_HMAC_SECRET, 'production');
  }

  describe('GET /api/auth/discord/login', () => {
    it('returns generic 404 when AUTH_MODE=disabled without touching secrets', async () => {
      setTestEnv({ AUTH_MODE: 'disabled' });

      const request = new Request('https://teamham.world/api/auth/discord/login');
      const response = await loginHandler(request);

      expect(response.status).toBe(404);
      const text = await response.text();
      expect(text).toBe('Not Found');
      assertProtectedHeaders(response);
      expect(getSetCookieHeaders(response)).toHaveLength(0);
    });

    it('rejects requests with invalid host in production mode', async () => {
      setTestEnv(VALID_PROD_ENV);

      const request = new Request('https://teamham.world/api/auth/discord/login', {
        headers: {
          'x-forwarded-host': 'evil.com',
          'x-forwarded-proto': 'https',
        },
      });
      const response = await loginHandler(request);

      expect(response.status).toBe(400);
      const html = await response.text();
      expect(html).toContain('Invalid request host');
      assertProtectedHeaders(response);
      expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    });

    it('enforces UTF-8 byte bounds on query string (>2048 UTF-8 bytes rejected)', async () => {
      setTestEnv(VALID_PROD_ENV);

      // Multi-byte UTF-8 string that exceeds 2048 bytes
      const longMultiByte = '?return_to=' + 'тест'.repeat(300);
      expect(Buffer.byteLength(longMultiByte, 'utf8')).toBeGreaterThan(2048);

      const request = new Request(`https://teamham.world/api/auth/discord/login${longMultiByte}`, {
        headers: {
          'x-forwarded-host': 'teamham.world',
          'x-forwarded-proto': 'https',
        },
      });
      const response = await loginHandler(request);

      expect(response.status).toBe(400);
      const html = await response.text();
      expect(html).toContain('Query string exceeds maximum allowed size');
    });

    it('rejects duplicate and unrecognized query parameters', async () => {
      setTestEnv(VALID_PROD_ENV);

      // Unrecognized param
      const unrecReq = new Request('https://teamham.world/api/auth/discord/login?foo=bar', {
        headers: {
          'x-forwarded-host': 'teamham.world',
          'x-forwarded-proto': 'https',
        },
      });
      const unrecRes = await loginHandler(unrecReq);
      expect(unrecRes.status).toBe(400);
      expect(await unrecRes.text()).toContain('Unrecognized query parameter');

      // Duplicate return_to param
      const dupReq = new Request(
        `https://teamham.world/api/auth/discord/login?return_to=${encodeURIComponent(ALLOWED_OAUTH_RETURN_TO)}&return_to=${encodeURIComponent(ALLOWED_OAUTH_RETURN_TO)}`,
        {
          headers: {
            'x-forwarded-host': 'teamham.world',
            'x-forwarded-proto': 'https',
          },
        }
      );
      const dupRes = await loginHandler(dupReq);
      expect(dupRes.status).toBe(400);
      expect(await dupRes.text()).toContain('Duplicate query parameters detected');
    });

    it('redirects 302 to Discord authorize URL with exact parameters and signed state cookie (standard flow)', async () => {
      setTestEnv(VALID_PROD_ENV);

      const request = new Request('https://teamham.world/api/auth/discord/login', {
        headers: {
          'x-forwarded-host': 'teamham.world',
          'x-forwarded-proto': 'https',
        },
      });
      const response = await loginHandler(request);

      expect(response.status).toBe(302);
      assertProtectedHeaders(response);

      const location = response.headers.get('location');
      expect(location).toBeDefined();

      const authUrl = new URL(location!);
      expect(authUrl.origin).toBe('https://discord.com');
      expect(authUrl.pathname).toBe('/oauth2/authorize');
      expect(authUrl.searchParams.get('client_id')).toBe(VALID_PROD_ENV.DISCORD_CLIENT_ID);
      expect(authUrl.searchParams.get('response_type')).toBe('code');
      expect(authUrl.searchParams.get('redirect_uri')).toBe('https://teamham.world/api/auth/discord/callback');
      expect(authUrl.searchParams.get('scope')).toBe('identify guilds.members.read');
      expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
      expect(authUrl.searchParams.get('prompt')).toBe('consent');

      const stateParam = authUrl.searchParams.get('state');
      const challengeParam = authUrl.searchParams.get('code_challenge');
      expect(stateParam).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(challengeParam).toMatch(/^[A-Za-z0-9_-]{43}$/);

      // Verify Set-Cookie header
      const cookies = getSetCookieHeaders(response);
      expect(cookies.length).toBeGreaterThanOrEqual(1);

      const stateCookieHeader = cookies.find((c) => c.startsWith(`${OAUTH_STATE_COOKIE_NAME}=`));
      expect(stateCookieHeader).toBeDefined();
      expect(stateCookieHeader).toContain('Path=/');
      expect(stateCookieHeader).toContain('Max-Age=600');
      expect(stateCookieHeader).toContain('HttpOnly');
      expect(stateCookieHeader).toContain('Secure');
      expect(stateCookieHeader).toContain('SameSite=Lax');

      // Extract cookie value and verify HMAC payload
      const cookieVal = stateCookieHeader!.split(';')[0].split('=')[1];
      const verifiedPayload = verifyOAuthStateCookie(cookieVal, VALID_PROD_ENV.OAUTH_STATE_HMAC_SECRET);
      expect(verifiedPayload).not.toBeNull();
      expect(verifiedPayload!.state).toBe(stateParam);
      expect(verifiedPayload!.returnTo).toBeNull();

      // Verify challenge calculation against verifier in cookie
      const expectedChallenge = crypto
        .createHash('sha256')
        .update(verifiedPayload!.verifier, 'utf8')
        .digest('base64url');
      expect(challengeParam).toBe(expectedChallenge);
    });

    describe('Discord continuation / game auth resume flow', () => {
      it('rejects invalid return_to values and clears pending game cookie', async () => {
        setTestEnv(VALID_PROD_ENV);

        const request = new Request(
          'https://teamham.world/api/auth/discord/login?return_to=%2Fevil-path',
          {
            headers: {
              'x-forwarded-host': 'teamham.world',
              'x-forwarded-proto': 'https',
            },
          }
        );
        const response = await loginHandler(request);

        expect(response.status).toBe(400);
        expect(await response.text()).toContain('Invalid return_to parameter');

        const cookies = getSetCookieHeaders(response);
        expect(
          cookies.some(
            (c) => c.includes(`${GAME_AUTHORIZATION_COOKIE_NAME}=;`) && c.includes('Max-Age=0')
          )
        ).toBe(true);
      });

      it('rejects valid return_to when __Host-game_authz is missing and clears cookie', async () => {
        setTestEnv(VALID_PROD_ENV);

        const request = new Request(
          `https://teamham.world/api/auth/discord/login?return_to=${encodeURIComponent(ALLOWED_OAUTH_RETURN_TO)}`,
          {
            headers: {
              'x-forwarded-host': 'teamham.world',
              'x-forwarded-proto': 'https',
            },
          }
        );
        const response = await loginHandler(request);

        expect(response.status).toBe(400);
        expect(await response.text()).toContain('Game authorization session is missing or expired');

        const cookies = getSetCookieHeaders(response);
        expect(
          cookies.some(
            (c) => c.includes(`${GAME_AUTHORIZATION_COOKIE_NAME}=;`) && c.includes('Max-Age=0')
          )
        ).toBe(true);
      });

      it('rejects valid return_to when __Host-game_authz is invalid/tampered and clears cookie', async () => {
        setTestEnv(VALID_PROD_ENV);
        const gameCookie = createValidGameAuthCookie();
        const tamperedGameCookie = gameCookie.slice(0, -4) + 'zzzz';

        const request = new Request(
          `https://teamham.world/api/auth/discord/login?return_to=${encodeURIComponent(ALLOWED_OAUTH_RETURN_TO)}`,
          {
            headers: {
              'x-forwarded-host': 'teamham.world',
              'x-forwarded-proto': 'https',
              cookie: `${GAME_AUTHORIZATION_COOKIE_NAME}=${tamperedGameCookie}`,
            },
          }
        );
        const response = await loginHandler(request);

        expect(response.status).toBe(400);
        expect(await response.text()).toContain('Game authorization session is invalid or expired');

        const cookies = getSetCookieHeaders(response);
        expect(
          cookies.some(
            (c) => c.includes(`${GAME_AUTHORIZATION_COOKIE_NAME}=;`) && c.includes('Max-Age=0')
          )
        ).toBe(true);
      });

      it('binds returnTo into signed state cookie when valid return_to and __Host-game_authz present', async () => {
        setTestEnv(VALID_PROD_ENV);
        const gameCookie = createValidGameAuthCookie();

        const request = new Request(
          `https://teamham.world/api/auth/discord/login?return_to=${encodeURIComponent(ALLOWED_OAUTH_RETURN_TO)}`,
          {
            headers: {
              'x-forwarded-host': 'teamham.world',
              'x-forwarded-proto': 'https',
              cookie: `${GAME_AUTHORIZATION_COOKIE_NAME}=${gameCookie}`,
            },
          }
        );
        const response = await loginHandler(request);

        expect(response.status).toBe(302);
        const cookies = getSetCookieHeaders(response);
        const stateCookieHeader = cookies.find((c) => c.startsWith(`${OAUTH_STATE_COOKIE_NAME}=`));
        expect(stateCookieHeader).toBeDefined();

        const cookieVal = stateCookieHeader!.split(';')[0].split('=')[1];
        const verifiedPayload = verifyOAuthStateCookie(cookieVal, VALID_PROD_ENV.OAUTH_STATE_HMAC_SECRET);
        expect(verifiedPayload).not.toBeNull();
        expect(verifiedPayload!.returnTo).toBe(ALLOWED_OAUTH_RETURN_TO);
      });
    });
  });

  describe('GET /api/auth/discord/callback', () => {
    const validState = generateOAuthState();
    const validVerifier = generatePkceVerifier();
    const nowSec = Math.floor(Date.now() / 1000);

    function createValidSignedCookie(
      state = validState,
      verifier = validVerifier,
      returnTo: AllowedOAuthReturnTo | null = null
    ): string {
      return signOAuthState(
        { state, verifier, issuedAt: nowSec, returnTo },
        VALID_PROD_ENV.OAUTH_STATE_HMAC_SECRET
      );
    }

    it('returns generic 404 in disabled mode', async () => {
      setTestEnv({ AUTH_MODE: 'disabled' });

      const request = new Request('https://teamham.world/api/auth/discord/callback?code=test&state=test');
      const response = await callbackHandler(request);

      expect(response.status).toBe(404);
      assertProtectedHeaders(response);
    });

    it('enforces UTF-8 byte bounds on query string (>2048 UTF-8 bytes rejected)', async () => {
      setTestEnv(VALID_PROD_ENV);
      const signedCookie = createValidSignedCookie();

      const longQuery = `?code=abc&state=${validState}&extra=` + 'тест'.repeat(300);
      expect(Buffer.byteLength(longQuery, 'utf8')).toBeGreaterThan(2048);

      const request = new Request(`https://teamham.world/api/auth/discord/callback${longQuery}`, {
        headers: {
          'x-forwarded-host': 'teamham.world',
          'x-forwarded-proto': 'https',
          cookie: `${OAUTH_STATE_COOKIE_NAME}=${signedCookie}`,
        },
      });
      const response = await callbackHandler(request);
      expect(response.status).toBe(400);
      expect(await response.text()).toContain('Query string exceeds maximum allowed size');
    });

    it('rejects duplicate query parameters and clears both OAuth and pending game cookies', async () => {
      setTestEnv(VALID_PROD_ENV);
      const signedCookie = createValidSignedCookie();

      const duplicateReq = new Request(
        `https://teamham.world/api/auth/discord/callback?code=abc&code=def&state=${validState}`,
        {
          headers: {
            'x-forwarded-host': 'teamham.world',
            'x-forwarded-proto': 'https',
            cookie: `${OAUTH_STATE_COOKIE_NAME}=${signedCookie}`,
          },
        }
      );

      const response = await callbackHandler(duplicateReq);
      expect(response.status).toBe(400);
      const html = await response.text();
      expect(html).toContain('Duplicate query parameters detected');
      expect(discordModule.exchangeCodeAndCheckGuildRole).not.toHaveBeenCalled();
      expect(dbModule.issueLoginSession).not.toHaveBeenCalled();

      // Terminal error clears both OAuth state and pending game cookie
      const cookies = getSetCookieHeaders(response);
      expect(
        cookies.some((c) => c.includes(`${OAUTH_STATE_COOKIE_NAME}=;`) && c.includes('Max-Age=0'))
      ).toBe(true);
      expect(
        cookies.some((c) => c.includes(`${GAME_AUTHORIZATION_COOKIE_NAME}=;`) && c.includes('Max-Age=0'))
      ).toBe(true);
    });

    it('rejects unsolicited errors or invalid state without clearing cookies', async () => {
      setTestEnv(VALID_PROD_ENV);

      // Unsolicited error without state
      const noStateReq = new Request(
        'https://teamham.world/api/auth/discord/callback?error=access_denied',
        {
          headers: {
            'x-forwarded-host': 'teamham.world',
            'x-forwarded-proto': 'https',
          },
        }
      );
      const noStateRes = await callbackHandler(noStateReq);
      expect(noStateRes.status).toBe(400);
      expect(await noStateRes.text()).toContain('Invalid or missing state parameter');
      expect(getSetCookieHeaders(noStateRes)).toHaveLength(0);

      // Invalid state format
      const badStateReq = new Request(
        'https://teamham.world/api/auth/discord/callback?code=abc&state=bad_short',
        {
          headers: {
            'x-forwarded-host': 'teamham.world',
            'x-forwarded-proto': 'https',
          },
        }
      );
      const badStateRes = await callbackHandler(badStateReq);
      expect(badStateRes.status).toBe(400);
      expect(await badStateRes.text()).toContain('Invalid or missing state parameter');
      expect(getSetCookieHeaders(badStateRes)).toHaveLength(0);
    });

    it('rejects oversized code parameters after state verification and clears cookies', async () => {
      setTestEnv(VALID_PROD_ENV);
      const signedCookie = createValidSignedCookie();

      const oversizedCodeReq = new Request(
        `https://teamham.world/api/auth/discord/callback?code=${'a'.repeat(257)}&state=${validState}`,
        {
          headers: {
            'x-forwarded-host': 'teamham.world',
            'x-forwarded-proto': 'https',
            cookie: `${OAUTH_STATE_COOKIE_NAME}=${signedCookie}`,
          },
        }
      );

      const response = await callbackHandler(oversizedCodeReq);
      expect(response.status).toBe(400);
      expect(await response.text()).toContain('Invalid or missing authorization code parameter');
      expect(discordModule.exchangeCodeAndCheckGuildRole).not.toHaveBeenCalled();

      const cookies = getSetCookieHeaders(response);
      expect(
        cookies.some((c) => c.includes(`${OAUTH_STATE_COOKIE_NAME}=;`) && c.includes('Max-Age=0'))
      ).toBe(true);
      expect(
        cookies.some((c) => c.includes(`${GAME_AUTHORIZATION_COOKIE_NAME}=;`) && c.includes('Max-Age=0'))
      ).toBe(true);
    });

    it('handles Discord error parameters with appropriate status and clears both cookies', async () => {
      setTestEnv(VALID_PROD_ENV);
      const signedCookie = createValidSignedCookie();

      // Access denied
      const deniedReq = new Request(
        `https://teamham.world/api/auth/discord/callback?error=access_denied&error_description=The+user+denied&state=${validState}`,
        {
          headers: {
            'x-forwarded-host': 'teamham.world',
            'x-forwarded-proto': 'https',
            cookie: `${OAUTH_STATE_COOKIE_NAME}=${signedCookie}`,
          },
        }
      );
      const deniedRes = await callbackHandler(deniedReq);
      expect(deniedRes.status).toBe(403);
      const deniedHtml = await deniedRes.text();
      expect(deniedHtml).toContain('cancelled or denied');

      const deniedCookies = getSetCookieHeaders(deniedRes);
      expect(
        deniedCookies.some((c) => c.includes(`${OAUTH_STATE_COOKIE_NAME}=;`) && c.includes('Max-Age=0'))
      ).toBe(true);
      expect(
        deniedCookies.some((c) => c.includes(`${GAME_AUTHORIZATION_COOKIE_NAME}=;`) && c.includes('Max-Age=0'))
      ).toBe(true);

      // Other Discord error
      const otherErrReq = new Request(
        `https://teamham.world/api/auth/discord/callback?error=server_error&state=${validState}`,
        {
          headers: {
            'x-forwarded-host': 'teamham.world',
            'x-forwarded-proto': 'https',
            cookie: `${OAUTH_STATE_COOKIE_NAME}=${signedCookie}`,
          },
        }
      );
      const otherErrRes = await callbackHandler(otherErrReq);
      expect(otherErrRes.status).toBe(400);
      expect(await otherErrRes.text()).toContain('An error occurred during Discord authorization');
    });

    it('rejects missing, duplicate, or tampered OAuth state cookies', async () => {
      setTestEnv(VALID_PROD_ENV);

      // Missing cookie
      const missingReq = new Request(
        `https://teamham.world/api/auth/discord/callback?code=testcode&state=${validState}`,
        {
          headers: {
            'x-forwarded-host': 'teamham.world',
            'x-forwarded-proto': 'https',
          },
        }
      );
      const missingRes = await callbackHandler(missingReq);
      expect(missingRes.status).toBe(403);
      expect(await missingRes.text()).toContain('OAuth state cookie missing or expired');

      // Duplicate cookies
      const signedCookie = createValidSignedCookie();
      const duplicateReq = new Request(
        `https://teamham.world/api/auth/discord/callback?code=testcode&state=${validState}`,
        {
          headers: {
            'x-forwarded-host': 'teamham.world',
            'x-forwarded-proto': 'https',
            cookie: `${OAUTH_STATE_COOKIE_NAME}=${signedCookie}; ${OAUTH_STATE_COOKIE_NAME}=${signedCookie}`,
          },
        }
      );
      const dupRes = await callbackHandler(duplicateReq);
      expect(dupRes.status).toBe(400);
      expect(await dupRes.text()).toContain('Duplicate OAuth state cookies detected');

      // Tampered cookie
      const tamperedCookie = signedCookie.slice(0, -4) + 'abcd';
      const tamperedReq = new Request(
        `https://teamham.world/api/auth/discord/callback?code=testcode&state=${validState}`,
        {
          headers: {
            'x-forwarded-host': 'teamham.world',
            'x-forwarded-proto': 'https',
            cookie: `${OAUTH_STATE_COOKIE_NAME}=${tamperedCookie}`,
          },
        }
      );
      const tamperedRes = await callbackHandler(tamperedReq);
      expect(tamperedRes.status).toBe(403);
      expect(await tamperedRes.text()).toContain('OAuth state verification failed');
    });

    it('rejects state parameter mismatch with verified cookie state', async () => {
      setTestEnv(VALID_PROD_ENV);
      const signedCookie = createValidSignedCookie(validState);
      const differentState = generateOAuthState();

      const req = new Request(
        `https://teamham.world/api/auth/discord/callback?code=testcode&state=${differentState}`,
        {
          headers: {
            'x-forwarded-host': 'teamham.world',
            'x-forwarded-proto': 'https',
            cookie: `${OAUTH_STATE_COOKIE_NAME}=${signedCookie}`,
          },
        }
      );

      const res = await callbackHandler(req);
      expect(res.status).toBe(403);
      expect(await res.text()).toContain('OAuth state parameter mismatch');
      expect(discordModule.exchangeCodeAndCheckGuildRole).not.toHaveBeenCalled();
    });

    it('returns retryable 502 and RETAINS pending game cookie when Discord upstream fails', async () => {
      setTestEnv(VALID_PROD_ENV);
      const signedCookie = createValidSignedCookie(validState, validVerifier, ALLOWED_OAUTH_RETURN_TO);
      const gameCookie = createValidGameAuthCookie();

      vi.mocked(discordModule.exchangeCodeAndCheckGuildRole).mockResolvedValueOnce({
        status: 'upstream_error',
        error: 'unknown_guild',
        httpStatus: 502,
      });

      const req = new Request(
        `https://teamham.world/api/auth/discord/callback?code=testcode&state=${validState}`,
        {
          headers: {
            'x-forwarded-host': 'teamham.world',
            'x-forwarded-proto': 'https',
            cookie: `${OAUTH_STATE_COOKIE_NAME}=${signedCookie}; ${GAME_AUTHORIZATION_COOKIE_NAME}=${gameCookie}`,
          },
        }
      );

      const res = await callbackHandler(req);
      expect(res.status).toBe(502);
      expect(dbModule.issueLoginSession).not.toHaveBeenCalled();
      expect(dbModule.recordIneligibleAccount).not.toHaveBeenCalled();

      // Clears OAuth state cookie but RETAINS pending game cookie
      const cookies = getSetCookieHeaders(res);
      expect(
        cookies.some((c) => c.includes(`${OAUTH_STATE_COOKIE_NAME}=;`) && c.includes('Max-Age=0'))
      ).toBe(true);
      expect(cookies.some((c) => c.includes(`${GAME_AUTHORIZATION_COOKIE_NAME}=;`))).toBe(false);
    });

    it('returns retryable 502 and RETAINS pending game cookie when Discord network fetch throws', async () => {
      setTestEnv(VALID_PROD_ENV);
      const signedCookie = createValidSignedCookie(validState, validVerifier, ALLOWED_OAUTH_RETURN_TO);
      const gameCookie = createValidGameAuthCookie();

      vi.mocked(discordModule.exchangeCodeAndCheckGuildRole).mockRejectedValueOnce(
        new Error('Network failure connecting to Discord')
      );

      const req = new Request(
        `https://teamham.world/api/auth/discord/callback?code=testcode&state=${validState}`,
        {
          headers: {
            'x-forwarded-host': 'teamham.world',
            'x-forwarded-proto': 'https',
            cookie: `${OAUTH_STATE_COOKIE_NAME}=${signedCookie}; ${GAME_AUTHORIZATION_COOKIE_NAME}=${gameCookie}`,
          },
        }
      );

      const res = await callbackHandler(req);
      expect(res.status).toBe(502);
      expect(await res.text()).toContain('Failed to communicate with Discord authentication services');

      // Clears OAuth state cookie but RETAINS pending game cookie
      const cookies = getSetCookieHeaders(res);
      expect(
        cookies.some((c) => c.includes(`${OAUTH_STATE_COOKIE_NAME}=;`) && c.includes('Max-Age=0'))
      ).toBe(true);
      expect(cookies.some((c) => c.includes(`${GAME_AUTHORIZATION_COOKIE_NAME}=;`))).toBe(false);
    });

    it('handles confirmed ineligibility: calls recordIneligibleAccount, clears session, OAuth, and game cookies, returns 403', async () => {
      setTestEnv(VALID_PROD_ENV);
      const signedCookie = createValidSignedCookie(validState, validVerifier, ALLOWED_OAUTH_RETURN_TO);
      const gameCookie = createValidGameAuthCookie();
      const discordUserId = '123456789012345678';

      vi.mocked(discordModule.exchangeCodeAndCheckGuildRole).mockResolvedValueOnce({
        status: 'ineligible',
        reason: 'missing_role',
        discordUserId,
      });
      vi.mocked(dbModule.recordIneligibleAccount).mockResolvedValueOnce({ success: true });

      const req = new Request(
        `https://teamham.world/api/auth/discord/callback?code=testcode&state=${validState}`,
        {
          headers: {
            'x-forwarded-host': 'teamham.world',
            'x-forwarded-proto': 'https',
            cookie: `${OAUTH_STATE_COOKIE_NAME}=${signedCookie}; ${GAME_AUTHORIZATION_COOKIE_NAME}=${gameCookie}`,
          },
        }
      );

      const res = await callbackHandler(req);
      expect(res.status).toBe(403);
      expect(dbModule.recordIneligibleAccount).toHaveBeenCalledWith(discordUserId, VALID_PROD_ENV.DATABASE_URL);
      expect(dbModule.issueLoginSession).not.toHaveBeenCalled();

      const html = await res.text();
      expect(html).toContain('do not have the required role');

      const cookies = getSetCookieHeaders(res);
      expect(
        cookies.some((c) => c.includes(`${OAUTH_STATE_COOKIE_NAME}=;`) && c.includes('Max-Age=0'))
      ).toBe(true);
      expect(
        cookies.some((c) => c.includes(`${SESSION_COOKIE_NAME}=;`) && c.includes('Max-Age=0'))
      ).toBe(true);
      expect(
        cookies.some((c) => c.includes(`${GAME_AUTHORIZATION_COOKIE_NAME}=;`) && c.includes('Max-Age=0'))
      ).toBe(true);
    });

    it('handles suspended account: returns terminal 403, clears OAuth and game cookies, no session cookie', async () => {
      setTestEnv(VALID_PROD_ENV);
      const signedCookie = createValidSignedCookie(validState, validVerifier, ALLOWED_OAUTH_RETURN_TO);
      const gameCookie = createValidGameAuthCookie();
      const discordUserId = '123456789012345678';

      vi.mocked(discordModule.exchangeCodeAndCheckGuildRole).mockResolvedValueOnce({
        status: 'eligible',
        discordUserId,
      });
      vi.mocked(dbModule.issueLoginSession).mockResolvedValueOnce({
        success: false,
        suspended: true,
      });

      const req = new Request(
        `https://teamham.world/api/auth/discord/callback?code=testcode&state=${validState}`,
        {
          headers: {
            'x-forwarded-host': 'teamham.world',
            'x-forwarded-proto': 'https',
            cookie: `${OAUTH_STATE_COOKIE_NAME}=${signedCookie}; ${GAME_AUTHORIZATION_COOKIE_NAME}=${gameCookie}`,
          },
        }
      );

      const res = await callbackHandler(req);
      expect(res.status).toBe(403);
      expect(await res.text()).toContain('Your account has been suspended');

      const cookies = getSetCookieHeaders(res);
      expect(
        cookies.some((c) => c.includes(`${OAUTH_STATE_COOKIE_NAME}=;`) && c.includes('Max-Age=0'))
      ).toBe(true);
      expect(
        cookies.some((c) => c.includes(`${GAME_AUTHORIZATION_COOKIE_NAME}=;`) && c.includes('Max-Age=0'))
      ).toBe(true);
      expect(cookies.some((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`) && !c.includes('Max-Age=0'))).toBe(false);
    });

    it('handles DB failure on session issuance with retryable 503 and RETAINS pending game cookie', async () => {
      setTestEnv(VALID_PROD_ENV);
      const signedCookie = createValidSignedCookie(validState, validVerifier, ALLOWED_OAUTH_RETURN_TO);
      const gameCookie = createValidGameAuthCookie();
      const discordUserId = '123456789012345678';

      vi.mocked(discordModule.exchangeCodeAndCheckGuildRole).mockResolvedValueOnce({
        status: 'eligible',
        discordUserId,
      });
      vi.mocked(dbModule.issueLoginSession).mockRejectedValueOnce(new Error('Database connection failed'));

      const req = new Request(
        `https://teamham.world/api/auth/discord/callback?code=testcode&state=${validState}`,
        {
          headers: {
            'x-forwarded-host': 'teamham.world',
            'x-forwarded-proto': 'https',
            cookie: `${OAUTH_STATE_COOKIE_NAME}=${signedCookie}; ${GAME_AUTHORIZATION_COOKIE_NAME}=${gameCookie}`,
          },
        }
      );

      const res = await callbackHandler(req);
      expect(res.status).toBe(503);

      const cookies = getSetCookieHeaders(res);
      // Clears OAuth state cookie
      expect(
        cookies.some((c) => c.includes(`${OAUTH_STATE_COOKIE_NAME}=;`) && c.includes('Max-Age=0'))
      ).toBe(true);
      // RETAINS pending game cookie (no Clear cookie)
      expect(cookies.some((c) => c.includes(`${GAME_AUTHORIZATION_COOKIE_NAME}=;`))).toBe(false);
      // No session cookie
      expect(cookies.some((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`) && !c.includes('Max-Age=0'))).toBe(false);
    });

    it('completes valid eligible flow (standard portal login): sets session cookie, clears state & game cookie, redirects 302 to /account', async () => {
      setTestEnv(VALID_PROD_ENV);
      const signedCookie = createValidSignedCookie(validState, validVerifier, null);
      const discordUserId = '123456789012345678';

      vi.mocked(discordModule.exchangeCodeAndCheckGuildRole).mockResolvedValueOnce({
        status: 'eligible',
        discordUserId,
      });
      vi.mocked(dbModule.issueLoginSession).mockResolvedValueOnce({
        success: true,
        accountId: '550e8400-e29b-41d4-a716-446655440000',
        accessStatus: 'active',
      });

      const req = new Request(
        `https://teamham.world/api/auth/discord/callback?code=valid_auth_code&state=${validState}`,
        {
          headers: {
            'x-forwarded-host': 'teamham.world',
            'x-forwarded-proto': 'https',
            cookie: `${OAUTH_STATE_COOKIE_NAME}=${signedCookie}`,
          },
        }
      );

      const res = await callbackHandler(req);

      // Verify Discord was called with verified verifier from cookie
      expect(discordModule.exchangeCodeAndCheckGuildRole).toHaveBeenCalledWith(
        'valid_auth_code',
        validVerifier,
        expect.anything()
      );

      // Verify DB was called with valid Discord user ID and 64-char lowercase hash
      expect(dbModule.issueLoginSession).toHaveBeenCalledTimes(1);
      const [calledUserId, calledTokenHash] = vi.mocked(dbModule.issueLoginSession).mock.calls[0];
      expect(calledUserId).toBe(discordUserId);
      expect(calledTokenHash).toMatch(/^[0-9a-f]{64}$/);

      // Verify 302 redirect to /account
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/account');
      assertProtectedHeaders(res);

      // Verify cookies
      const cookies = getSetCookieHeaders(res);
      const sessionCookie = cookies.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
      expect(sessionCookie).toBeDefined();
      expect(sessionCookie).toContain('Path=/');
      expect(sessionCookie).toContain('Max-Age=86400');
      expect(sessionCookie).toContain('HttpOnly');
      expect(sessionCookie).toContain('Secure');
      expect(sessionCookie).toContain('SameSite=Lax');

      // Extract raw token from cookie and verify that tokenHash in DB matches hashSessionToken(rawToken)
      const rawToken = sessionCookie!.split(';')[0].split('=')[1];
      expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(rawToken).not.toBe(calledTokenHash);
      expect(hashSessionToken(rawToken)).toBe(calledTokenHash);

      // Verify OAuth cookie is cleared
      expect(cookies.some((c) => c.includes(`${OAUTH_STATE_COOKIE_NAME}=;`) && c.includes('Max-Age=0'))).toBe(true);
      // Clears game auth cookie for standard login
      expect(cookies.some((c) => c.includes(`${GAME_AUTHORIZATION_COOKIE_NAME}=;`) && c.includes('Max-Age=0'))).toBe(true);
    });

    describe('Continuation / Game Resume callback handling', () => {
      it('redirects 302 to /api/auth/game/authorize/resume and RETAINS __Host-game_authz when valid', async () => {
        setTestEnv(VALID_PROD_ENV);
        const signedCookie = createValidSignedCookie(validState, validVerifier, ALLOWED_OAUTH_RETURN_TO);
        const gameCookie = createValidGameAuthCookie();
        const discordUserId = '123456789012345678';

        vi.mocked(discordModule.exchangeCodeAndCheckGuildRole).mockResolvedValueOnce({
          status: 'eligible',
          discordUserId,
        });
        vi.mocked(dbModule.issueLoginSession).mockResolvedValueOnce({
          success: true,
          accountId: '550e8400-e29b-41d4-a716-446655440000',
          accessStatus: 'active',
        });

        const req = new Request(
          `https://teamham.world/api/auth/discord/callback?code=valid_auth_code&state=${validState}`,
          {
            headers: {
              'x-forwarded-host': 'teamham.world',
              'x-forwarded-proto': 'https',
              cookie: `${OAUTH_STATE_COOKIE_NAME}=${signedCookie}; ${GAME_AUTHORIZATION_COOKIE_NAME}=${gameCookie}`,
            },
          }
        );

        const res = await callbackHandler(req);

        // Redirects to /api/auth/game/authorize/resume
        expect(res.status).toBe(302);
        expect(res.headers.get('location')).toBe(ALLOWED_OAUTH_RETURN_TO);
        assertProtectedHeaders(res);

        const cookies = getSetCookieHeaders(res);
        // Session cookie is set
        expect(cookies.some((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`))).toBe(true);
        // OAuth state cookie is cleared
        expect(cookies.some((c) => c.includes(`${OAUTH_STATE_COOKIE_NAME}=;`) && c.includes('Max-Age=0'))).toBe(true);
        // Pending game cookie is RETAINED (no Clear cookie in header)
        expect(cookies.some((c) => c.includes(`${GAME_AUTHORIZATION_COOKIE_NAME}=;`))).toBe(false);
      });

      it('falls back to /account and clears __Host-game_authz when pending game cookie is missing', async () => {
        setTestEnv(VALID_PROD_ENV);
        const signedCookie = createValidSignedCookie(validState, validVerifier, ALLOWED_OAUTH_RETURN_TO);
        const discordUserId = '123456789012345678';

        vi.mocked(discordModule.exchangeCodeAndCheckGuildRole).mockResolvedValueOnce({
          status: 'eligible',
          discordUserId,
        });
        vi.mocked(dbModule.issueLoginSession).mockResolvedValueOnce({
          success: true,
          accountId: '550e8400-e29b-41d4-a716-446655440000',
          accessStatus: 'active',
        });

        const req = new Request(
          `https://teamham.world/api/auth/discord/callback?code=valid_auth_code&state=${validState}`,
          {
            headers: {
              'x-forwarded-host': 'teamham.world',
              'x-forwarded-proto': 'https',
              cookie: `${OAUTH_STATE_COOKIE_NAME}=${signedCookie}`,
            },
          }
        );

        const res = await callbackHandler(req);

        // Fallback to /account
        expect(res.status).toBe(302);
        expect(res.headers.get('location')).toBe('/account');

        const cookies = getSetCookieHeaders(res);
        expect(cookies.some((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`))).toBe(true);
        expect(cookies.some((c) => c.includes(`${OAUTH_STATE_COOKIE_NAME}=;`) && c.includes('Max-Age=0'))).toBe(true);
        expect(cookies.some((c) => c.includes(`${GAME_AUTHORIZATION_COOKIE_NAME}=;`) && c.includes('Max-Age=0'))).toBe(true);
      });

      it('falls back to /account and clears __Host-game_authz when pending game cookie is invalid or tampered', async () => {
        setTestEnv(VALID_PROD_ENV);
        const signedCookie = createValidSignedCookie(validState, validVerifier, ALLOWED_OAUTH_RETURN_TO);
        const tamperedGameCookie = createValidGameAuthCookie() + 'tampered';
        const discordUserId = '123456789012345678';

        vi.mocked(discordModule.exchangeCodeAndCheckGuildRole).mockResolvedValueOnce({
          status: 'eligible',
          discordUserId,
        });
        vi.mocked(dbModule.issueLoginSession).mockResolvedValueOnce({
          success: true,
          accountId: '550e8400-e29b-41d4-a716-446655440000',
          accessStatus: 'active',
        });

        const req = new Request(
          `https://teamham.world/api/auth/discord/callback?code=valid_auth_code&state=${validState}`,
          {
            headers: {
              'x-forwarded-host': 'teamham.world',
              'x-forwarded-proto': 'https',
              cookie: `${OAUTH_STATE_COOKIE_NAME}=${signedCookie}; ${GAME_AUTHORIZATION_COOKIE_NAME}=${tamperedGameCookie}`,
            },
          }
        );

        const res = await callbackHandler(req);

        // Fallback to /account
        expect(res.status).toBe(302);
        expect(res.headers.get('location')).toBe('/account');

        const cookies = getSetCookieHeaders(res);
        expect(cookies.some((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`))).toBe(true);
        expect(cookies.some((c) => c.includes(`${OAUTH_STATE_COOKIE_NAME}=;`) && c.includes('Max-Age=0'))).toBe(true);
        expect(cookies.some((c) => c.includes(`${GAME_AUTHORIZATION_COOKIE_NAME}=;`) && c.includes('Max-Age=0'))).toBe(true);
      });
    });
  });

  describe('Real Discord client function classification (mocked fetch)', () => {
    let unmockedDiscord: typeof import('@/lib/auth/discord');

    beforeEach(async () => {
      unmockedDiscord = await vi.importActual<typeof import('@/lib/auth/discord')>('@/lib/auth/discord');
    });

    it('checkGuildMembership classifies eligible role correctly', async () => {
      setTestEnv(VALID_PROD_ENV);
      const config = {
        mode: 'production' as const,
        appBaseUrl: VALID_PROD_ENV.APP_BASE_URL,
        canonicalOrigin: VALID_PROD_ENV.APP_BASE_URL,
        oauthStateHmacSecret: VALID_PROD_ENV.OAUTH_STATE_HMAC_SECRET,
        gameAuthRequestHmacSecret: VALID_PROD_ENV.GAME_AUTH_REQUEST_HMAC_SECRET,
        discordClientId: VALID_PROD_ENV.DISCORD_CLIENT_ID,
        discordClientSecret: VALID_PROD_ENV.DISCORD_CLIENT_SECRET,
        discordGuildId: VALID_PROD_ENV.DISCORD_GUILD_ID,
        discordRequiredRoleId: VALID_PROD_ENV.DISCORD_REQUIRED_ROLE_ID,
        databaseUrl: VALID_PROD_ENV.DATABASE_URL,
        redirectUri: 'https://teamham.world/api/auth/discord/callback',
      };

      global.fetch = vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ roles: [config.discordRequiredRoleId, 'other_role'] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );

      const result = await unmockedDiscord.checkGuildMembership('access_token_123', config);
      expect(result).toEqual({ status: 'eligible' });
    });

    it('checkGuildMembership classifies missing role correctly', async () => {
      setTestEnv(VALID_PROD_ENV);
      const config = {
        mode: 'production' as const,
        appBaseUrl: VALID_PROD_ENV.APP_BASE_URL,
        canonicalOrigin: VALID_PROD_ENV.APP_BASE_URL,
        oauthStateHmacSecret: VALID_PROD_ENV.OAUTH_STATE_HMAC_SECRET,
        gameAuthRequestHmacSecret: VALID_PROD_ENV.GAME_AUTH_REQUEST_HMAC_SECRET,
        discordClientId: VALID_PROD_ENV.DISCORD_CLIENT_ID,
        discordClientSecret: VALID_PROD_ENV.DISCORD_CLIENT_SECRET,
        discordGuildId: VALID_PROD_ENV.DISCORD_GUILD_ID,
        discordRequiredRoleId: VALID_PROD_ENV.DISCORD_REQUIRED_ROLE_ID,
        databaseUrl: VALID_PROD_ENV.DATABASE_URL,
        redirectUri: 'https://teamham.world/api/auth/discord/callback',
      };

      global.fetch = vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ roles: ['other_role_only'] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );

      const result = await unmockedDiscord.checkGuildMembership('access_token_123', config);
      expect(result).toEqual({ status: 'ineligible', reason: 'missing_role' });
    });

    it('checkGuildMembership classifies Discord 10007 (Unknown Member) as ineligible', async () => {
      setTestEnv(VALID_PROD_ENV);
      const config = {
        mode: 'production' as const,
        appBaseUrl: VALID_PROD_ENV.APP_BASE_URL,
        canonicalOrigin: VALID_PROD_ENV.APP_BASE_URL,
        oauthStateHmacSecret: VALID_PROD_ENV.OAUTH_STATE_HMAC_SECRET,
        gameAuthRequestHmacSecret: VALID_PROD_ENV.GAME_AUTH_REQUEST_HMAC_SECRET,
        discordClientId: VALID_PROD_ENV.DISCORD_CLIENT_ID,
        discordClientSecret: VALID_PROD_ENV.DISCORD_CLIENT_SECRET,
        discordGuildId: VALID_PROD_ENV.DISCORD_GUILD_ID,
        discordRequiredRoleId: VALID_PROD_ENV.DISCORD_REQUIRED_ROLE_ID,
        databaseUrl: VALID_PROD_ENV.DATABASE_URL,
        redirectUri: 'https://teamham.world/api/auth/discord/callback',
      };

      global.fetch = vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 10007, message: 'Unknown Member' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        })
      );

      const result = await unmockedDiscord.checkGuildMembership('access_token_123', config);
      expect(result).toEqual({ status: 'ineligible', reason: 'unknown_member' });
    });

    it('checkGuildMembership classifies Discord 10004 (Unknown Guild) as upstream_error 502', async () => {
      setTestEnv(VALID_PROD_ENV);
      const config = {
        mode: 'production' as const,
        appBaseUrl: VALID_PROD_ENV.APP_BASE_URL,
        canonicalOrigin: VALID_PROD_ENV.APP_BASE_URL,
        oauthStateHmacSecret: VALID_PROD_ENV.OAUTH_STATE_HMAC_SECRET,
        gameAuthRequestHmacSecret: VALID_PROD_ENV.GAME_AUTH_REQUEST_HMAC_SECRET,
        discordClientId: VALID_PROD_ENV.DISCORD_CLIENT_ID,
        discordClientSecret: VALID_PROD_ENV.DISCORD_CLIENT_SECRET,
        discordGuildId: VALID_PROD_ENV.DISCORD_GUILD_ID,
        discordRequiredRoleId: VALID_PROD_ENV.DISCORD_REQUIRED_ROLE_ID,
        databaseUrl: VALID_PROD_ENV.DATABASE_URL,
        redirectUri: 'https://teamham.world/api/auth/discord/callback',
      };

      global.fetch = vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 10004, message: 'Unknown Guild' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        })
      );

      const result = await unmockedDiscord.checkGuildMembership('access_token_123', config);
      expect(result).toEqual({ status: 'upstream_error', error: 'unknown_guild', httpStatus: 502 });
    });

    it('checkGuildMembership handles malformed payload shapes with upstream_error 502', async () => {
      setTestEnv(VALID_PROD_ENV);
      const config = {
        mode: 'production' as const,
        appBaseUrl: VALID_PROD_ENV.APP_BASE_URL,
        canonicalOrigin: VALID_PROD_ENV.APP_BASE_URL,
        oauthStateHmacSecret: VALID_PROD_ENV.OAUTH_STATE_HMAC_SECRET,
        gameAuthRequestHmacSecret: VALID_PROD_ENV.GAME_AUTH_REQUEST_HMAC_SECRET,
        discordClientId: VALID_PROD_ENV.DISCORD_CLIENT_ID,
        discordClientSecret: VALID_PROD_ENV.DISCORD_CLIENT_SECRET,
        discordGuildId: VALID_PROD_ENV.DISCORD_GUILD_ID,
        discordRequiredRoleId: VALID_PROD_ENV.DISCORD_REQUIRED_ROLE_ID,
        databaseUrl: VALID_PROD_ENV.DATABASE_URL,
        redirectUri: 'https://teamham.world/api/auth/discord/callback',
      };

      global.fetch = vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ roles: 'not-an-array' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );

      const result = await unmockedDiscord.checkGuildMembership('access_token_123', config);
      expect(result).toEqual({
        status: 'upstream_error',
        error: 'malformed_member_payload',
        httpStatus: 502,
      });
    });

    it('exchangeCodeAndCheckGuildRole handles non-JSON Discord responses gracefully with 502', async () => {
      setTestEnv(VALID_PROD_ENV);
      const config = {
        mode: 'production' as const,
        appBaseUrl: VALID_PROD_ENV.APP_BASE_URL,
        canonicalOrigin: VALID_PROD_ENV.APP_BASE_URL,
        oauthStateHmacSecret: VALID_PROD_ENV.OAUTH_STATE_HMAC_SECRET,
        gameAuthRequestHmacSecret: VALID_PROD_ENV.GAME_AUTH_REQUEST_HMAC_SECRET,
        discordClientId: VALID_PROD_ENV.DISCORD_CLIENT_ID,
        discordClientSecret: VALID_PROD_ENV.DISCORD_CLIENT_SECRET,
        discordGuildId: VALID_PROD_ENV.DISCORD_GUILD_ID,
        discordRequiredRoleId: VALID_PROD_ENV.DISCORD_REQUIRED_ROLE_ID,
        databaseUrl: VALID_PROD_ENV.DATABASE_URL,
        redirectUri: 'https://teamham.world/api/auth/discord/callback',
      };

      global.fetch = vi.fn().mockResolvedValueOnce(
        new Response('not json at all', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        })
      );

      const result = await unmockedDiscord.exchangeCodeAndCheckGuildRole('code', 'verifier', config);
      expect(result.status).toBe('upstream_error');
      expect((result as { httpStatus?: number }).httpStatus).toBe(502);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('returns generic 404 in disabled mode', async () => {
      setTestEnv({ AUTH_MODE: 'disabled' });

      const req = new Request('https://teamham.world/api/auth/logout', {
        method: 'POST',
      });
      const res = await logoutHandler(req);

      expect(res.status).toBe(404);
      assertProtectedHeaders(res);
    });

    it('rejects missing or mismatched Origin before accessing DB', async () => {
      setTestEnv(VALID_PROD_ENV);

      // Missing origin
      const missingOriginReq = new Request('https://teamham.world/api/auth/logout', {
        method: 'POST',
      });
      const missingOriginRes = await logoutHandler(missingOriginReq);
      expect(missingOriginRes.status).toBe(403);
      expect(dbModule.deleteSessionByTokenHash).not.toHaveBeenCalled();

      // Mismatched origin
      const evilOriginReq = new Request('https://teamham.world/api/auth/logout', {
        method: 'POST',
        headers: { origin: 'https://attacker.com' },
      });
      const evilOriginRes = await logoutHandler(evilOriginReq);
      expect(evilOriginRes.status).toBe(403);
      expect(dbModule.deleteSessionByTokenHash).not.toHaveBeenCalled();
    });

    it('clears session cookie and redirects 303 to / when no/invalid/duplicate cookie without calling DB', async () => {
      setTestEnv(VALID_PROD_ENV);

      // Missing cookie
      const noCookieReq = new Request('https://teamham.world/api/auth/logout', {
        method: 'POST',
        headers: { origin: 'https://teamham.world' },
      });
      const noCookieRes = await logoutHandler(noCookieReq);
      expect(noCookieRes.status).toBe(303);
      expect(noCookieRes.headers.get('location')).toBe('/');
      expect(dbModule.deleteSessionByTokenHash).not.toHaveBeenCalled();
      const cookies = getSetCookieHeaders(noCookieRes);
      expect(cookies.some((c) => c.includes(`${SESSION_COOKIE_NAME}=;`) && c.includes('Max-Age=0'))).toBe(true);

      // Invalid format cookie
      const invalidCookieReq = new Request('https://teamham.world/api/auth/logout', {
        method: 'POST',
        headers: {
          origin: 'https://teamham.world',
          cookie: `${SESSION_COOKIE_NAME}=invalid_short_token`,
        },
      });
      const invalidRes = await logoutHandler(invalidCookieReq);
      expect(invalidRes.status).toBe(303);
      expect(dbModule.deleteSessionByTokenHash).not.toHaveBeenCalled();
    });

    it('deletes session by token hash in DB, clears cookie, and redirects 303 to / on success', async () => {
      setTestEnv(VALID_PROD_ENV);
      const rawToken = generateSessionToken();
      const expectedHash = hashSessionToken(rawToken);

      vi.mocked(dbModule.deleteSessionByTokenHash).mockResolvedValueOnce({ success: true });

      const req = new Request('https://teamham.world/api/auth/logout', {
        method: 'POST',
        headers: {
          origin: 'https://teamham.world',
          cookie: `${SESSION_COOKIE_NAME}=${rawToken}`,
        },
      });

      const res = await logoutHandler(req);

      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('/');
      assertProtectedHeaders(res);

      expect(dbModule.deleteSessionByTokenHash).toHaveBeenCalledWith(
        expectedHash,
        VALID_PROD_ENV.DATABASE_URL
      );

      const cookies = getSetCookieHeaders(res);
      expect(cookies.some((c) => c.includes(`${SESSION_COOKIE_NAME}=;`) && c.includes('Max-Age=0'))).toBe(true);
    });

    it('returns 503 and RETAINS cookie when database deletion fails', async () => {
      setTestEnv(VALID_PROD_ENV);
      const rawToken = generateSessionToken();

      vi.mocked(dbModule.deleteSessionByTokenHash).mockRejectedValueOnce(
        new Error('Database unavailable')
      );

      const req = new Request('https://teamham.world/api/auth/logout', {
        method: 'POST',
        headers: {
          origin: 'https://teamham.world',
          cookie: `${SESSION_COOKIE_NAME}=${rawToken}`,
        },
      });

      const res = await logoutHandler(req);

      expect(res.status).toBe(503);
      assertProtectedHeaders(res);

      // Cookie MUST NOT be cleared on failure
      const cookies = getSetCookieHeaders(res);
      expect(cookies.some((c) => c.includes(`${SESSION_COOKIE_NAME}=;`))).toBe(false);
    });
  });
});
