import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAuthConfig } from '@/lib/auth/config';
import { exchangeCodeAndCheckGuildRole } from '@/lib/auth/discord';
import { VALID_PROD_ENV } from '../helpers/test-fixtures';

const TOKEN_RESPONSE = {
  access_token: 'test_discord_access_token', token_type: 'Bearer',
  expires_in: 604800, scope: 'identify guilds.members.read',
};
const IDENTITY = { id: '123456789012345678', username: 'hamfriend' };

describe('Discord OAuth trust boundary', () => {
  beforeEach(() => {
    for (const [key, value] of Object.entries(VALID_PROD_ENV)) vi.stubEnv(key, value);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('keeps credentials at Discord, disables caching, and retains only the verified identity', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json(TOKEN_RESPONSE))
      .mockResolvedValueOnce(Response.json({ ...IDENTITY, email: 'private@example.com' }))
      .mockResolvedValueOnce(Response.json({ roles: [VALID_PROD_ENV.DISCORD_REQUIRED_ROLE_ID] }));
    vi.stubGlobal('fetch', fetch);

    expect(await exchangeCodeAndCheckGuildRole('code', 'verifier', getAuthConfig())).toEqual({
      status: 'eligible', discordUserId: IDENTITY.id, discordUsername: IDENTITY.username,
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    for (const [url, options] of fetch.mock.calls) {
      expect(new URL(url).origin).toBe('https://discord.com');
      expect(options).toMatchObject({ redirect: 'error', cache: 'no-store' });
    }
  });

  it.each([
    { ...TOKEN_RESPONSE, token_type: 'MAC' },
    { ...TOKEN_RESPONSE, scope: 'identify' },
    { ...TOKEN_RESPONSE, expires_in: 0 },
    { ...TOKEN_RESPONSE, access_token: 'injected\r\nheader' },
    { ...TOKEN_RESPONSE, access_token: 'a'.repeat(4097) },
    [], null,
  ])('rejects an invalid token response before fetching identity (%j)', async (response) => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(response));
    vi.stubGlobal('fetch', fetch);
    expect(await exchangeCodeAndCheckGuildRole('code', 'verifier', getAuthConfig())).toMatchObject({ status: 'upstream_error' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([[123], [VALID_PROD_ENV.DISCORD_REQUIRED_ROLE_ID, {}]])(
    'treats malformed membership data as an outage, never as permission or confirmed removal (%j)', async (...roles) => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(Response.json(TOKEN_RESPONSE))
        .mockResolvedValueOnce(Response.json(IDENTITY))
        .mockResolvedValueOnce(Response.json({ roles })));
      expect(await exchangeCodeAndCheckGuildRole('code', 'verifier', getAuthConfig())).toMatchObject({
        status: 'upstream_error', error: 'malformed_member_payload',
      });
    }
  );

  it.each([
    () => new Response(null, { status: 307, headers: { location: 'https://other.example/token' } }),
    () => new Response(JSON.stringify(TOKEN_RESPONSE), { headers: { 'content-type': 'text/html' } }),
    () => new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }),
    () => new Response(' '.repeat(65537), { headers: { 'content-type': 'application/json' } }),
  ])('fails closed on redirect, content-type, encoding, or size violations', async (response) => {
    const fetch = vi.fn().mockResolvedValueOnce(response());
    vi.stubGlobal('fetch', fetch);
    expect(await exchangeCodeAndCheckGuildRole('code', 'verifier', getAuthConfig())).toMatchObject({ status: 'upstream_error' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
