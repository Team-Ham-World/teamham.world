import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GET as sessionHandler } from '@/app/api/auth/session/route';
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

/**
 * The session status endpoint is the only way the statically prerendered home
 * page learns who is signed in, so these cases pin both the payload it exposes
 * and the headers that keep the answer uncacheable.
 */
describe('Session Status Endpoint', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    clearAuthEnv();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function buildRequest(cookieHeader?: string): Request {
    const headers: Record<string, string> = {
      'x-forwarded-host': 'teamham.world',
      'x-forwarded-proto': 'https',
    };
    if (cookieHeader) {
      headers.cookie = cookieHeader;
    }
    return new Request('https://teamham.world/api/auth/session', { headers });
  }

  function assertUncacheable(response: Response) {
    expect(response.headers.get('cache-control')).toBe(
      'private, no-cache, no-store, max-age=0, must-revalidate'
    );
    expect(response.headers.get('referrer-policy')).toBe('same-origin');
    expect((response.headers.get('vary') || '').toLowerCase()).toContain('cookie');
  }

  it('returns 404 in disabled mode without touching the database', async () => {
    setTestEnv({ AUTH_MODE: 'disabled' });

    const response = await sessionHandler(buildRequest());

    expect(response.status).toBe(404);
    assertUncacheable(response);
    expect(dbModule.verifySession).not.toHaveBeenCalled();
  });

  it('reports a signed-out visitor when no session cookie is present', async () => {
    setTestEnv(VALID_PROD_ENV);

    const response = await sessionHandler(buildRequest());

    expect(response.status).toBe(200);
    assertUncacheable(response);
    expect(await response.json()).toEqual({ authenticated: false, username: null });
    expect(dbModule.verifySession).not.toHaveBeenCalled();
  });

  it('reports a signed-out visitor for a malformed session token', async () => {
    setTestEnv(VALID_PROD_ENV);

    const response = await sessionHandler(buildRequest(`${SESSION_COOKIE_NAME}=not-a-token`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authenticated: false, username: null });
    expect(dbModule.verifySession).not.toHaveBeenCalled();
  });

  it('never mutates cookies, leaving revocation to the proxy and logout route', async () => {
    setTestEnv(VALID_PROD_ENV);
    const token = generateSessionToken();
    vi.mocked(dbModule.verifySession).mockResolvedValueOnce({ valid: false });

    const response = await sessionHandler(buildRequest(`${SESSION_COOKIE_NAME}=${token}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authenticated: false, username: null });
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('returns the username for a verified session', async () => {
    setTestEnv(VALID_PROD_ENV);
    const token = generateSessionToken();
    vi.mocked(dbModule.verifySession).mockResolvedValueOnce({
      valid: true,
      account: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        accessStatus: 'active',
        membershipStatus: 'eligible',
        siteRole: 'member',
        expiresAt: new Date(Date.now() + 86400000),
        username: 'hamfriend',
      },
    });

    const response = await sessionHandler(buildRequest(`${SESSION_COOKIE_NAME}=${token}`));

    expect(response.status).toBe(200);
    assertUncacheable(response);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ authenticated: true, username: 'hamfriend' });

    // The cookie is hashed before it reaches the database, never sent raw.
    expect(dbModule.verifySession).toHaveBeenCalledWith(hashSessionToken(token), expect.anything());
  });

  it('reports an authenticated session that has no stored username', async () => {
    setTestEnv(VALID_PROD_ENV);
    const token = generateSessionToken();
    vi.mocked(dbModule.verifySession).mockResolvedValueOnce({
      valid: true,
      account: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        accessStatus: 'active',
        membershipStatus: 'eligible',
        siteRole: 'member',
        expiresAt: new Date(Date.now() + 86400000),
        username: null,
      },
    });

    const response = await sessionHandler(buildRequest(`${SESSION_COOKIE_NAME}=${token}`));

    expect(await response.json()).toEqual({ authenticated: true, username: null });
  });

  it('surfaces a database outage as 503 rather than a signed-out state', async () => {
    setTestEnv(VALID_PROD_ENV);
    const token = generateSessionToken();
    vi.mocked(dbModule.verifySession).mockRejectedValueOnce(new Error('connection refused'));

    const response = await sessionHandler(buildRequest(`${SESSION_COOKIE_NAME}=${token}`));

    expect(response.status).toBe(503);
    assertUncacheable(response);
    expect(await response.json()).toEqual({ error: 'service_unavailable' });
  });

  it('rejects a request whose host is not the canonical origin in production', async () => {
    setTestEnv(VALID_PROD_ENV);

    const response = await sessionHandler(
      new Request('https://teamham.world/api/auth/session', {
        headers: { 'x-forwarded-host': 'attacker.example', 'x-forwarded-proto': 'https' },
      })
    );

    expect(response.status).toBe(400);
    expect(dbModule.verifySession).not.toHaveBeenCalled();
  });

  it('treats duplicate session cookies as signed out', async () => {
    setTestEnv(VALID_PROD_ENV);
    const token = generateSessionToken();

    const response = await sessionHandler(
      buildRequest(`${SESSION_COOKIE_NAME}=${token}; ${SESSION_COOKIE_NAME}=${token}`)
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authenticated: false, username: null });
    expect(dbModule.verifySession).not.toHaveBeenCalled();
  });
});
