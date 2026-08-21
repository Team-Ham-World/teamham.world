import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { proxy, config as proxyConfig } from '@/proxy';
import { generateSessionToken, hashSessionToken } from '@/lib/auth/crypto';
import { SESSION_COOKIE_NAME } from '@/lib/auth/http';
import * as dbModule from '@/lib/auth/db';
import { VALID_PROD_ENV, setTestEnv, clearAuthEnv } from '../helpers/test-fixtures';

vi.mock('@/lib/auth/db', () => ({
  verifySession: vi.fn(),
  issueLoginSession: vi.fn(),
  recordIneligibleAccount: vi.fn(),
  deleteSessionByTokenHash: vi.fn(),
}));

describe('Proxy and Cache Headers Integration', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    clearAuthEnv();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
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

  describe('Proxy Matcher Contract (AC-7)', () => {
    it('matches account routes and excludes static homepage and auth API routes', () => {
      const matchers = proxyConfig.matcher;

      expect(matchers).toEqual(['/account', '/account/:path*']);

      // Direct assertion that public / and /api/auth are excluded from matcher list
      expect(matchers).not.toContain('/');
      expect(matchers).not.toContain('/api/auth/discord/login');
      expect(matchers).not.toContain('/api/auth/discord/callback');
      expect(matchers).not.toContain('/api/auth/logout');
    });
  });

  describe('Public Homepage Contract (AC-7 Static Hub)', () => {
    it('verifies src/app/page.tsx does not use dynamic auth, cookies, headers, or force-dynamic', () => {
      const pagePath = path.resolve(__dirname, '../../src/app/page.tsx');
      const pageSource = fs.readFileSync(pagePath, 'utf8');

      // Static hub invariant: no next/headers, no cookies, no auth imports, no dynamic forced
      expect(pageSource).not.toContain('next/headers');
      expect(pageSource).not.toContain('cookies()');
      expect(pageSource).not.toContain('headers()');
      expect(pageSource).not.toContain('@/lib/auth');
      expect(pageSource).not.toContain('force-dynamic');
      expect(pageSource).not.toContain('revalidate = 0');
    });

    it('verifies src/app/account/page.tsx reads headers for auth state', () => {
      const accountPath = path.resolve(__dirname, '../../src/app/account/page.tsx');
      const accountSource = fs.readFileSync(accountPath, 'utf8');

      expect(accountSource).toContain('headers()');
      expect(accountSource).toContain('x-teamham-authenticated');
    });
  });

  describe('Proxy Authentication Routing & Header Behavior', () => {
    it('returns generic 404 in disabled mode with protected headers and zero DB calls', async () => {
      setTestEnv({ AUTH_MODE: 'disabled' });

      const req = new NextRequest('https://teamham.world/account');
      const res = await proxy(req);

      expect(res.status).toBe(404);
      expect(await res.text()).toBe('Not Found');
      assertProtectedHeaders(res);
      expect(dbModule.verifySession).not.toHaveBeenCalled();
    });

    it('returns 400 Bad Request on host mismatch in production mode before DB calls', async () => {
      setTestEnv(VALID_PROD_ENV);

      const req = new NextRequest('https://teamham.world/account', {
        headers: {
          'x-forwarded-host': 'evil.com',
          'x-forwarded-proto': 'https',
        },
      });
      const res = await proxy(req);

      expect(res.status).toBe(400);
      assertProtectedHeaders(res);
      expect(dbModule.verifySession).not.toHaveBeenCalled();
    });

    it('forwards unauthenticated request when session cookie is missing without clearing cookie', async () => {
      setTestEnv(VALID_PROD_ENV);

      const req = new NextRequest('https://teamham.world/account', {
        headers: {
          'x-forwarded-host': 'teamham.world',
          'x-forwarded-proto': 'https',
        },
      });
      const res = await proxy(req);

      expect(res.status).toBe(200);
      assertProtectedHeaders(res);

      // Downstream auth status forced to 0
      const forwardedAuthHeader =
        res.headers.get('x-middleware-request-x-teamham-authenticated') ||
        res.headers.get('x-teamham-authenticated');
      expect(forwardedAuthHeader).toBe('0');

      // No Set-Cookie clear header appended
      const cookies = getSetCookieHeaders(res);
      expect(cookies.some((c) => c.includes(`${SESSION_COOKIE_NAME}=`))).toBe(false);
      expect(dbModule.verifySession).not.toHaveBeenCalled();
    });

    it('overwrites client-supplied x-teamham-authenticated: 1 header to 0 when unauthenticated', async () => {
      setTestEnv(VALID_PROD_ENV);

      const req = new NextRequest('https://teamham.world/account', {
        headers: {
          'x-forwarded-host': 'teamham.world',
          'x-forwarded-proto': 'https',
          'x-teamham-authenticated': '1', // Spoofed client header
        },
      });
      const res = await proxy(req);

      expect(res.status).toBe(200);
      const forwardedAuthHeader =
        res.headers.get('x-middleware-request-x-teamham-authenticated') ||
        res.headers.get('x-teamham-authenticated');
      expect(forwardedAuthHeader).toBe('0');
    });

    it('clears session cookie and forwards auth 0 when duplicate or malformed session cookie', async () => {
      setTestEnv(VALID_PROD_ENV);

      // Duplicate cookies
      const dupReq = new NextRequest('https://teamham.world/account', {
        headers: {
          'x-forwarded-host': 'teamham.world',
          'x-forwarded-proto': 'https',
          cookie: `${SESSION_COOKIE_NAME}=token1; ${SESSION_COOKIE_NAME}=token2`,
        },
      });
      const dupRes = await proxy(dupReq);

      expect(dupRes.status).toBe(200);
      const dupAuthHeader =
        dupRes.headers.get('x-middleware-request-x-teamham-authenticated') ||
        dupRes.headers.get('x-teamham-authenticated');
      expect(dupAuthHeader).toBe('0');

      const dupCookies = getSetCookieHeaders(dupRes);
      expect(dupCookies.some((c) => c.includes(`${SESSION_COOKIE_NAME}=;`) && c.includes('Max-Age=0'))).toBe(true);
      expect(dbModule.verifySession).not.toHaveBeenCalled();

      // Malformed cookie format
      const malformedReq = new NextRequest('https://teamham.world/account', {
        headers: {
          'x-forwarded-host': 'teamham.world',
          'x-forwarded-proto': 'https',
          cookie: `${SESSION_COOKIE_NAME}=too-short`,
        },
      });
      const malformedRes = await proxy(malformedReq);
      expect(malformedRes.status).toBe(200);
      const malformedCookies = getSetCookieHeaders(malformedRes);
      expect(malformedCookies.some((c) => c.includes(`${SESSION_COOKIE_NAME}=;`) && c.includes('Max-Age=0'))).toBe(true);
      expect(dbModule.verifySession).not.toHaveBeenCalled();
    });

    it('verifies valid session: sets downstream auth 1, protects headers, does not expose token/hash', async () => {
      setTestEnv(VALID_PROD_ENV);
      const rawToken = generateSessionToken();
      const expectedHash = hashSessionToken(rawToken);

      vi.mocked(dbModule.verifySession).mockResolvedValueOnce({
        valid: true,
        account: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          accessStatus: 'active',
          membershipStatus: 'eligible',
          expiresAt: new Date(Date.now() + 86400000),
        },
      });

      const req = new NextRequest('https://teamham.world/account', {
        headers: {
          'x-forwarded-host': 'teamham.world',
          'x-forwarded-proto': 'https',
          cookie: `${SESSION_COOKIE_NAME}=${rawToken}`,
        },
      });
      const res = await proxy(req);

      expect(res.status).toBe(200);
      assertProtectedHeaders(res);

      expect(dbModule.verifySession).toHaveBeenCalledWith(
        expectedHash,
        VALID_PROD_ENV.DATABASE_URL
      );

      const authHeader =
        res.headers.get('x-middleware-request-x-teamham-authenticated') ||
        res.headers.get('x-teamham-authenticated');
      expect(authHeader).toBe('1');

      // Ensure token hash is never leaked or passed in downstream/response headers
      for (const [key, value] of res.headers.entries()) {
        expect(value).not.toContain(expectedHash);
        expect(key).not.toContain(expectedHash);
      }

      // No Set-Cookie header modifying or clearing session on valid verification pass
      const cookies = getSetCookieHeaders(res);
      expect(cookies.some((c) => c.includes(`${SESSION_COOKIE_NAME}=`))).toBe(false);
    });

    it('clears stale/expired session cookie and sets downstream auth 0 when verifySession returns valid: false', async () => {
      setTestEnv(VALID_PROD_ENV);
      const rawToken = generateSessionToken();

      vi.mocked(dbModule.verifySession).mockResolvedValueOnce({ valid: false });

      const req = new NextRequest('https://teamham.world/account', {
        headers: {
          'x-forwarded-host': 'teamham.world',
          'x-forwarded-proto': 'https',
          cookie: `${SESSION_COOKIE_NAME}=${rawToken}`,
        },
      });
      const res = await proxy(req);

      expect(res.status).toBe(200);
      assertProtectedHeaders(res);

      const authHeader =
        res.headers.get('x-middleware-request-x-teamham-authenticated') ||
        res.headers.get('x-teamham-authenticated');
      expect(authHeader).toBe('0');

      const cookies = getSetCookieHeaders(res);
      expect(cookies.some((c) => c.includes(`${SESSION_COOKIE_NAME}=;`) && c.includes('Max-Age=0'))).toBe(true);
    });

    it('returns 503 and RETAINS session cookie when DB verification throws/fails', async () => {
      setTestEnv(VALID_PROD_ENV);
      const rawToken = generateSessionToken();

      vi.mocked(dbModule.verifySession).mockRejectedValueOnce(
        new Error('Database connection failed')
      );

      const req = new NextRequest('https://teamham.world/account', {
        headers: {
          'x-forwarded-host': 'teamham.world',
          'x-forwarded-proto': 'https',
          cookie: `${SESSION_COOKIE_NAME}=${rawToken}`,
        },
      });
      const res = await proxy(req);

      expect(res.status).toBe(503);
      assertProtectedHeaders(res);

      // Session cookie MUST NOT be cleared on DB failure
      const cookies = getSetCookieHeaders(res);
      expect(cookies.some((c) => c.includes(`${SESSION_COOKIE_NAME}=;`))).toBe(false);
    });
  });
});
