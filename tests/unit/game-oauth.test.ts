import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  GAME_OAUTH_SCOPE,
  GAME_REDIRECT_URI_MAX_BYTES,
  GAME_OAUTH_PRODUCTION_ISSUER,
  isValidGameClientId,
  isValidGameAudience,
  deriveGameAudience,
  isGameAudienceForClientId,
  isValidGameAuthorizationCode,
  isValidGameAccessToken,
  isValidGameClientSecret,
  isValidGamePkceVerifier,
  isValidGamePkceChallenge,
  isValidGameState,
  isValidSha256Hex,
  isValidGameRedirectUri,
  compareRedirectUris,
  generateGameAuthorizationCode,
  generateGameAccessToken,
  generateGameClientSecret,
  generateGameState,
  derivePkceChallenge,
  generateGamePkce,
  hashGameToken,
  verifyPkceChallenge,
  parseBasicClientAuth,
  verifyClientSecret,
  signGameAuthCookie,
  verifyGameAuthCookie,
  readBoundedUrlEncodedForm,
  GameAuthRequestPayload,
} from '@/lib/auth/game-oauth';

describe('lib/auth/game-oauth', () => {
  const TEST_SECRET_HEX = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  describe('1. Format validation regexes and boundary rejection', () => {
    describe('Constants and canonical values', () => {
      it('exports canonical constants matching spec', () => {
        expect(GAME_OAUTH_SCOPE).toBe('identity');
        expect(GAME_OAUTH_PRODUCTION_ISSUER).toBe('https://teamham.world');
        expect(GAME_REDIRECT_URI_MAX_BYTES).toBe(512);
      });
    });

    describe('isValidGameClientId', () => {
      it('accepts valid lowercase client IDs starting with a-z (3-64 chars)', () => {
        expect(isValidGameClientId('poker')).toBe(true);
        expect(isValidGameClientId('poker_game')).toBe(true);
        expect(isValidGameClientId('poker-game-123')).toBe(true);
        expect(isValidGameClientId('abc')).toBe(true); // min 3 chars
        expect(isValidGameClientId('a' + 'b'.repeat(63))).toBe(true); // max 64 chars
      });

      it('rejects invalid client IDs', () => {
        expect(isValidGameClientId('')).toBe(false);
        expect(isValidGameClientId('ab')).toBe(false); // too short (<3)
        expect(isValidGameClientId('a' + 'b'.repeat(64))).toBe(false); // too long (>64)
        expect(isValidGameClientId('123poker')).toBe(false); // starts with digit
        expect(isValidGameClientId('_poker')).toBe(false); // starts with underscore
        expect(isValidGameClientId('-poker')).toBe(false); // starts with hyphen
        expect(isValidGameClientId('PokerGame')).toBe(false); // uppercase
        expect(isValidGameClientId('poker.game')).toBe(false); // dot
        expect(isValidGameClientId('poker game')).toBe(false); // space
        expect(isValidGameClientId('poker$game')).toBe(false); // special char
      });
    });

    describe('isValidGameAudience, deriveGameAudience, and isGameAudienceForClientId', () => {
      it('accepts valid URN game audiences matching urn:teamham:game:<client_id>', () => {
        expect(isValidGameAudience('urn:teamham:game:poker')).toBe(true);
        expect(isValidGameAudience('urn:teamham:game:poker_game')).toBe(true);
        expect(isValidGameAudience('urn:teamham:game:chess-123')).toBe(true);
      });

      it('correctly validates matching and non-matching clientId parameter', () => {
        expect(isValidGameAudience('urn:teamham:game:poker', 'poker')).toBe(true);
        expect(isValidGameAudience('urn:teamham:game:poker_game', 'poker_game')).toBe(true);
        expect(isValidGameAudience('urn:teamham:game:poker', 'chess')).toBe(false);
        expect(isGameAudienceForClientId('urn:teamham:game:poker', 'poker')).toBe(true);
        expect(isGameAudienceForClientId('urn:teamham:game:poker', 'other')).toBe(false);
      });

      it('derives canonical URN game audience from client ID', () => {
        expect(deriveGameAudience('poker')).toBe('urn:teamham:game:poker');
        expect(deriveGameAudience('poker_game')).toBe('urn:teamham:game:poker_game');
        expect(deriveGameAudience('chess-123')).toBe('urn:teamham:game:chess-123');
      });

      it('rejects invalid game audiences', () => {
        expect(isValidGameAudience('')).toBe(false);
        expect(isValidGameAudience('https://poker.teamham.world')).toBe(false); // URL format not URN
        expect(isValidGameAudience('urn:teamham:game:ab')).toBe(false); // <3 client suffix
        expect(isValidGameAudience('urn:teamham:game:123game')).toBe(false); // digit start
        expect(isValidGameAudience('urn:teamham:game:Poker')).toBe(false); // uppercase
        expect(isValidGameAudience('urn:other:game:poker')).toBe(false); // wrong prefix
        expect(isValidGameAudience('urn:teamham:game:' + 'a'.repeat(120))).toBe(false); // >128 total
      });
    });

    describe('isValidGameAuthorizationCode', () => {
      it('accepts thc_ prefix followed by 43 base64url chars (47 total)', () => {
        const validCode = 'thc_' + 'A'.repeat(43);
        expect(isValidGameAuthorizationCode(validCode)).toBe(true);
        expect(isValidGameAuthorizationCode('thc_' + '0123456789abcdefghijklmnopqrstuvwxyzABCDEF-')).toBe(true);
      });

      it('rejects invalid authorization codes', () => {
        expect(isValidGameAuthorizationCode('')).toBe(false);
        expect(isValidGameAuthorizationCode('thc_' + 'A'.repeat(42))).toBe(false); // 42 chars
        expect(isValidGameAuthorizationCode('thc_' + 'A'.repeat(44))).toBe(false); // 44 chars
        expect(isValidGameAuthorizationCode('tha_' + 'A'.repeat(43))).toBe(false); // wrong prefix
        expect(isValidGameAuthorizationCode('thc_' + 'A'.repeat(41) + '==')).toBe(false); // padded
        expect(isValidGameAuthorizationCode('thc_' + 'A'.repeat(42) + '+')).toBe(false); // non-base64url
      });
    });

    describe('isValidGameAccessToken', () => {
      it('accepts tha_ prefix followed by 43 base64url chars (47 total)', () => {
        const validToken = 'tha_' + 'B'.repeat(43);
        expect(isValidGameAccessToken(validToken)).toBe(true);
      });

      it('rejects invalid access tokens', () => {
        expect(isValidGameAccessToken('')).toBe(false);
        expect(isValidGameAccessToken('tha_' + 'B'.repeat(42))).toBe(false);
        expect(isValidGameAccessToken('tha_' + 'B'.repeat(44))).toBe(false);
        expect(isValidGameAccessToken('thc_' + 'B'.repeat(43))).toBe(false);
        expect(isValidGameAccessToken('tha_' + 'B'.repeat(41) + '==')).toBe(false);
      });
    });

    describe('isValidGameClientSecret', () => {
      it('accepts ths_ prefix followed by 43 base64url chars (47 total)', () => {
        const validSecret = 'ths_' + 'C'.repeat(43);
        expect(isValidGameClientSecret(validSecret)).toBe(true);
      });

      it('rejects invalid client secrets', () => {
        expect(isValidGameClientSecret('')).toBe(false);
        expect(isValidGameClientSecret('ths_' + 'C'.repeat(42))).toBe(false);
        expect(isValidGameClientSecret('ths_' + 'C'.repeat(44))).toBe(false);
        expect(isValidGameClientSecret('secret_' + 'C'.repeat(43))).toBe(false);
        expect(isValidGameClientSecret('ths_' + 'C'.repeat(41) + '==')).toBe(false);
      });
    });

    describe('isValidGamePkceVerifier, isValidGamePkceChallenge, isValidGameState', () => {
      it('accepts 43 base64url characters', () => {
        const val = 'D'.repeat(43);
        expect(isValidGamePkceVerifier(val)).toBe(true);
        expect(isValidGamePkceChallenge(val)).toBe(true);
        expect(isValidGameState(val)).toBe(true);
      });

      it('rejects invalid verifier / challenge / state lengths or chars', () => {
        expect(isValidGamePkceVerifier('D'.repeat(42))).toBe(false);
        expect(isValidGamePkceVerifier('D'.repeat(44))).toBe(false);
        expect(isValidGamePkceVerifier('D'.repeat(42) + '=')).toBe(false);
        expect(isValidGamePkceChallenge('D'.repeat(42))).toBe(false);
        expect(isValidGamePkceChallenge('D'.repeat(44))).toBe(false);
        expect(isValidGameState('D'.repeat(42))).toBe(false);
        expect(isValidGameState('D'.repeat(44))).toBe(false);
      });
    });

    describe('isValidSha256Hex', () => {
      it('accepts lowercase 64-char hex strings', () => {
        expect(isValidSha256Hex('0123456789abcdef'.repeat(4))).toBe(true);
      });

      it('rejects uppercase or non-64 hex strings', () => {
        expect(isValidSha256Hex('0123456789ABCDEF'.repeat(4))).toBe(false); // uppercase
        expect(isValidSha256Hex('0123456789abcdef'.repeat(3) + '0123456789abcde')).toBe(false); // 63 chars
        expect(isValidSha256Hex('0123456789abcdef'.repeat(4) + '0')).toBe(false); // 65 chars
        expect(isValidSha256Hex('g'.repeat(64))).toBe(false); // non-hex
      });
    });

    describe('Generator functions', () => {
      it('generates valid, cryptographically non-constant codes, tokens, secrets, states, and PKCE pairs', () => {
        const code1 = generateGameAuthorizationCode();
        const code2 = generateGameAuthorizationCode();
        expect(isValidGameAuthorizationCode(code1)).toBe(true);
        expect(isValidGameAuthorizationCode(code2)).toBe(true);
        expect(code1).not.toBe(code2);

        const token1 = generateGameAccessToken();
        const token2 = generateGameAccessToken();
        expect(isValidGameAccessToken(token1)).toBe(true);
        expect(isValidGameAccessToken(token2)).toBe(true);
        expect(token1).not.toBe(token2);

        const secret1 = generateGameClientSecret();
        const secret2 = generateGameClientSecret();
        expect(isValidGameClientSecret(secret1)).toBe(true);
        expect(isValidGameClientSecret(secret2)).toBe(true);
        expect(secret1).not.toBe(secret2);

        const state1 = generateGameState();
        const state2 = generateGameState();
        expect(isValidGameState(state1)).toBe(true);
        expect(isValidGameState(state2)).toBe(true);
        expect(state1).not.toBe(state2);

        const pkce = generateGamePkce();
        expect(isValidGamePkceVerifier(pkce.verifier)).toBe(true);
        expect(isValidGamePkceChallenge(pkce.challenge)).toBe(true);
        expect(derivePkceChallenge(pkce.verifier)).toBe(pkce.challenge);
      });
    });
  });

  describe('2. Redirect URI validation', () => {
    describe('Production mode', () => {
      it('accepts valid non-apex HTTPS *.teamham.world subdomains with non-root path', () => {
        expect(isValidGameRedirectUri('https://poker.teamham.world/auth/callback', 'production')).toBe(true);
        expect(isValidGameRedirectUri('https://chess-v2.sub.teamham.world/callback', 'production')).toBe(true);
      });

      it('rejects HTTP scheme', () => {
        expect(isValidGameRedirectUri('http://poker.teamham.world/auth/callback', 'production')).toBe(false);
      });

      it('rejects apex teamham.world', () => {
        expect(isValidGameRedirectUri('https://teamham.world/auth/callback', 'production')).toBe(false);
      });

      it('rejects third-party / external domains', () => {
        expect(isValidGameRedirectUri('https://evil.com/auth/callback', 'production')).toBe(false);
        expect(isValidGameRedirectUri('https://notteamham.world/auth/callback', 'production')).toBe(false);
        expect(isValidGameRedirectUri('https://poker.teamham.world.evil.com/callback', 'production')).toBe(false);
      });

      it('rejects userinfo / credentials', () => {
        expect(
          isValidGameRedirectUri('https://user:pass@poker.teamham.world/auth/callback', 'production')
        ).toBe(false);
      });

      it('rejects query parameters and fragments', () => {
        expect(
          isValidGameRedirectUri('https://poker.teamham.world/auth/callback?key=val', 'production')
        ).toBe(false);
        expect(
          isValidGameRedirectUri('https://poker.teamham.world/auth/callback#section', 'production')
        ).toBe(false);
      });

      it('rejects root path', () => {
        expect(isValidGameRedirectUri('https://poker.teamham.world/', 'production')).toBe(false);
        expect(isValidGameRedirectUri('https://poker.teamham.world', 'production')).toBe(false);
      });

      it('rejects explicit non-default ports in production', () => {
        expect(
          isValidGameRedirectUri('https://poker.teamham.world:8080/auth/callback', 'production')
        ).toBe(false);
        expect(
          isValidGameRedirectUri('https://poker.teamham.world:3000/auth/callback', 'production')
        ).toBe(false);
      });

      it('rejects oversized URLs (>512 UTF-8 bytes) and accepts <=512 UTF-8 bytes', () => {
        expect(GAME_REDIRECT_URI_MAX_BYTES).toBe(512);

        const base = 'https://poker.teamham.world/callback';
        const remainingValid = 512 - base.length;
        const exact512 = base + 'a'.repeat(remainingValid);
        expect(Buffer.byteLength(exact512, 'utf8')).toBe(512);
        expect(isValidGameRedirectUri(exact512, 'production')).toBe(true);

        const tooLong513 = exact512 + 'a';
        expect(Buffer.byteLength(tooLong513, 'utf8')).toBe(513);
        expect(isValidGameRedirectUri(tooLong513, 'production')).toBe(false);

        // Multi-byte UTF-8 test
        const multiByte = base + '/тест';
        expect(isValidGameRedirectUri(multiByte, 'production')).toBe(true);
      });
    });

    describe('Development mode', () => {
      it('accepts reviewed HTTPS loopback / local test hosts', () => {
        expect(isValidGameRedirectUri('https://localhost:3001/auth/callback', 'development')).toBe(true);
        expect(isValidGameRedirectUri('https://127.0.0.1:3001/auth/callback', 'development')).toBe(true);
        expect(isValidGameRedirectUri('https://[::1]:3001/auth/callback', 'development')).toBe(true);
      });

      it('still strictly requires HTTPS for loopback hosts', () => {
        expect(isValidGameRedirectUri('http://localhost:3001/auth/callback', 'development')).toBe(false);
        expect(isValidGameRedirectUri('http://127.0.0.1:3001/auth/callback', 'development')).toBe(false);
      });

      it('accepts production-compatible *.teamham.world hosts in development', () => {
        expect(isValidGameRedirectUri('https://poker.teamham.world/auth/callback', 'development')).toBe(true);
      });

      it('rejects arbitrary external hosts in development', () => {
        expect(isValidGameRedirectUri('https://example.com/callback', 'development')).toBe(false);
        expect(isValidGameRedirectUri('https://evil.com/callback', 'development')).toBe(false);
      });
    });

    describe('compareRedirectUris', () => {
      it('performs exact byte-for-byte comparison', () => {
        expect(
          compareRedirectUris(
            'https://poker.teamham.world/auth/callback',
            'https://poker.teamham.world/auth/callback'
          )
        ).toBe(true);
        expect(
          compareRedirectUris(
            'https://poker.teamham.world/auth/callback',
            'https://poker.teamham.world/auth/callback/'
          )
        ).toBe(false);
      });
    });
  });

  describe('3. Pending authorization cookie signing and verification (__Host-game_authz)', () => {
    const validPayload: GameAuthRequestPayload = {
      responseType: 'code',
      clientId: 'poker_game',
      redirectUri: 'https://poker.teamham.world/auth/callback',
      scope: 'identity',
      audience: 'urn:teamham:game:poker_game',
      state: 'E9Melhoa2OwvFrGMTJguCH5DTl4x74j3Pzh-cEBWb8g',
      codeChallenge: 'qjrzjdcxDhOqVmJ0q5fYGOMiaUhpxQtKW-2fTHC8-uo',
      codeChallengeMethod: 'S256',
      issuedAt: Math.floor(Date.now() / 1000),
    };

    it('round-trips signed cookie correctly in production mode', () => {
      const cookie = signGameAuthCookie(validPayload, TEST_SECRET_HEX, 'production');
      expect(cookie).toContain('.');
      const verified = verifyGameAuthCookie(cookie, TEST_SECRET_HEX, 'production');
      expect(verified).toEqual(validPayload);
    });

    it('round-trips signed cookie correctly in development mode with local redirect', () => {
      const devPayload: GameAuthRequestPayload = {
        ...validPayload,
        redirectUri: 'https://localhost:3001/auth/callback',
      };
      const cookie = signGameAuthCookie(devPayload, TEST_SECRET_HEX, 'development');
      const verified = verifyGameAuthCookie(cookie, TEST_SECRET_HEX, 'development');
      expect(verified).toEqual(devPayload);

      // Fails when verified under production mode
      expect(verifyGameAuthCookie(cookie, TEST_SECRET_HEX, 'production')).toBeNull();
    });

    it('rejects payload with invalid scope', () => {
      const badScopePayload = {
        ...validPayload,
        scope: 'userinfo' as unknown as typeof GAME_OAUTH_SCOPE,
      };
      expect(() => signGameAuthCookie(badScopePayload, TEST_SECRET_HEX, 'production')).toThrow(
        /Invalid payload fields/
      );

      // Tampered scope in verified cookie
      const tamperedScope = Buffer.from(
        JSON.stringify({ ...validPayload, scope: 'openid' }),
        'utf8'
      ).toString('base64url');
      const sig = crypto
        .createHmac('sha256', Buffer.from(TEST_SECRET_HEX, 'hex'))
        .update(tamperedScope, 'utf8')
        .digest('base64url');
      expect(verifyGameAuthCookie(`${tamperedScope}.${sig}`, TEST_SECRET_HEX, 'production')).toBeNull();
    });

    it('rejects oversized cookie (>2048 characters)', () => {
      const longCookie = 'a'.repeat(2049);
      expect(verifyGameAuthCookie(longCookie, TEST_SECRET_HEX, 'production')).toBeNull();
    });

    it('rejects tampered payload or tampered signature', () => {
      const cookie = signGameAuthCookie(validPayload, TEST_SECRET_HEX, 'production');
      const [payloadPart, sigPart] = cookie.split('.');

      // Tamper payload
      const tamperedPayload = Buffer.from(
        JSON.stringify({ ...validPayload, clientId: 'evil_client' }),
        'utf8'
      ).toString('base64url');
      expect(verifyGameAuthCookie(`${tamperedPayload}.${sigPart}`, TEST_SECRET_HEX)).toBeNull();

      // Tamper signature
      const tamperedSig = sigPart.slice(0, -2) + (sigPart.endsWith('a') ? 'b' : 'a');
      expect(verifyGameAuthCookie(`${payloadPart}.${tamperedSig}`, TEST_SECRET_HEX)).toBeNull();
    });

    it('rejects expired cookie (>600s age)', () => {
      const expiredPayload: GameAuthRequestPayload = {
        ...validPayload,
        issuedAt: Math.floor(Date.now() / 1000) - 601,
      };
      const cookie = signGameAuthCookie(expiredPayload, TEST_SECRET_HEX, 'production');
      expect(verifyGameAuthCookie(cookie, TEST_SECRET_HEX, 'production')).toBeNull();
    });

    it('rejects future timestamp (>60s in future)', () => {
      const futurePayload: GameAuthRequestPayload = {
        ...validPayload,
        issuedAt: Math.floor(Date.now() / 1000) + 65,
      };
      const cookie = signGameAuthCookie(futurePayload, TEST_SECRET_HEX, 'production');
      expect(verifyGameAuthCookie(cookie, TEST_SECRET_HEX, 'production')).toBeNull();
    });

    it('rejects wrong secret or non-hex secret', () => {
      const otherSecret = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
      const cookie = signGameAuthCookie(validPayload, TEST_SECRET_HEX, 'production');
      expect(verifyGameAuthCookie(cookie, otherSecret, 'production')).toBeNull();

      expect(verifyGameAuthCookie(cookie, 'bad-secret', 'production')).toBeNull();
      expect(() => signGameAuthCookie(validPayload, 'bad-secret', 'production')).toThrow(
        /Invalid secret format/
      );
    });

    it('rejects malformed cookie structures (no dot, multiple dots, non-base64url)', () => {
      expect(verifyGameAuthCookie('nodot', TEST_SECRET_HEX)).toBeNull();
      expect(verifyGameAuthCookie('.leadingdot', TEST_SECRET_HEX)).toBeNull();
      expect(verifyGameAuthCookie('trailingdot.', TEST_SECRET_HEX)).toBeNull();
      expect(verifyGameAuthCookie('one.two.three', TEST_SECRET_HEX)).toBeNull();
      expect(verifyGameAuthCookie('payload!with#bad$chars.sig', TEST_SECRET_HEX)).toBeNull();
      expect(verifyGameAuthCookie('', TEST_SECRET_HEX)).toBeNull();
    });

    it('rejects extra, missing, or wrong-shape payload fields', () => {
      // Missing field
      const incomplete = Buffer.from(
        JSON.stringify({
          responseType: 'code',
          clientId: 'poker_game',
          // missing redirectUri, audience, etc.
        }),
        'utf8'
      ).toString('base64url');
      const sig = crypto
        .createHmac('sha256', Buffer.from(TEST_SECRET_HEX, 'hex'))
        .update(incomplete, 'utf8')
        .digest('base64url');
      expect(verifyGameAuthCookie(`${incomplete}.${sig}`, TEST_SECRET_HEX)).toBeNull();

      // Extra unexpected field
      const extra = Buffer.from(
        JSON.stringify({
          ...validPayload,
          injectedField: 'malicious',
        }),
        'utf8'
      ).toString('base64url');
      const sigExtra = crypto
        .createHmac('sha256', Buffer.from(TEST_SECRET_HEX, 'hex'))
        .update(extra, 'utf8')
        .digest('base64url');
      expect(verifyGameAuthCookie(`${extra}.${sigExtra}`, TEST_SECRET_HEX)).toBeNull();
    });
  });

  describe('4. Basic client authentication parsing (parseBasicClientAuth)', () => {
    it('parses valid Basic auth header with case-insensitive scheme', () => {
      const clientId = 'poker_game';
      const clientSecret = generateGameClientSecret();
      const rawCreds = `${clientId}:${clientSecret}`;
      const b64 = Buffer.from(rawCreds, 'utf8').toString('base64');

      const header1 = `Basic ${b64}`;
      expect(parseBasicClientAuth(header1)).toEqual({ clientId, clientSecret });

      const header2 = `basic ${b64}`;
      expect(parseBasicClientAuth(header2)).toEqual({ clientId, clientSecret });

      const header3 = `BASIC ${b64}`;
      expect(parseBasicClientAuth(header3)).toEqual({ clientId, clientSecret });
    });

    it('rejects missing, null, empty, or oversized headers', () => {
      expect(parseBasicClientAuth(null)).toBeNull();
      expect(parseBasicClientAuth('')).toBeNull();
      expect(parseBasicClientAuth('Basic ' + 'a'.repeat(600))).toBeNull();
    });

    it('rejects multiple or comma-combined auth headers', () => {
      const validB64 = Buffer.from(`poker_game:${generateGameClientSecret()}`).toString('base64');
      expect(parseBasicClientAuth(`Basic ${validB64}, Bearer some_token`)).toBeNull();
    });

    it('rejects control characters, NUL bytes, and malformed base64', () => {
      expect(parseBasicClientAuth('Basic \x00abc')).toBeNull();
      expect(parseBasicClientAuth('Basic !!!notbase64!!!')).toBeNull();
      expect(parseBasicClientAuth('Basic abc')).toBeNull(); // not length % 4 == 0
    });

    it('rejects missing colon or multiple colons in decoded credentials', () => {
      const noColon = Buffer.from('poker_gameths_secret').toString('base64');
      expect(parseBasicClientAuth(`Basic ${noColon}`)).toBeNull();

      const multiColon = Buffer.from(`poker:game:${generateGameClientSecret()}`).toString('base64');
      expect(parseBasicClientAuth(`Basic ${multiColon}`)).toBeNull();
    });

    it('rejects invalid client_id format or invalid client_secret format', () => {
      // Invalid clientId
      const badClient = Buffer.from(`123bad_client:${generateGameClientSecret()}`).toString('base64');
      expect(parseBasicClientAuth(`Basic ${badClient}`)).toBeNull();

      // Invalid secret
      const badSecret = Buffer.from('poker_game:plain_password').toString('base64');
      expect(parseBasicClientAuth(`Basic ${badSecret}`)).toBeNull();
    });
  });

  describe('5. PKCE derivation and verification', () => {
    it('derives matching SHA-256 base64url challenge and verifies correctly', () => {
      const { verifier, challenge } = generateGamePkce();
      expect(verifyPkceChallenge(verifier, challenge)).toBe(true);

      const wrongVerifier = generateGamePkce().verifier;
      expect(verifyPkceChallenge(wrongVerifier, challenge)).toBe(false);
    });

    it('rejects invalid verifier / challenge formats in verifyPkceChallenge', () => {
      expect(verifyPkceChallenge('short', 'D'.repeat(43))).toBe(false);
      expect(verifyPkceChallenge('D'.repeat(43), 'short')).toBe(false);
    });
  });

  describe('6. Bounded URL-encoded form reader (readBoundedUrlEncodedForm)', () => {
    it('parses valid application/x-www-form-urlencoded body with and without charset=utf-8', async () => {
      const body = 'grant_type=authorization_code&code=thc_123&redirect_uri=https%3A%2F%2Fpoker.teamham.world';
      const req1 = new Request('https://teamham.world/api/auth/game/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });

      const res1 = await readBoundedUrlEncodedForm(req1);
      expect(res1.success).toBe(true);
      if (res1.success) {
        expect(res1.params.get('grant_type')).toBe('authorization_code');
        expect(res1.params.get('code')).toBe('thc_123');
      }

      const req2 = new Request('https://teamham.world/api/auth/game/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
        body,
      });
      const res2 = await readBoundedUrlEncodedForm(req2);
      expect(res2.success).toBe(true);
    });

    it('rejects wrong content types with invalid_content_type', async () => {
      const reqJson = new Request('https://teamham.world/api/auth/game/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'thc_123' }),
      });
      const resJson = await readBoundedUrlEncodedForm(reqJson);
      expect(resJson).toEqual({ success: false, error: 'invalid_content_type' });

      const reqNoType = new Request('https://teamham.world/api/auth/game/token', {
        method: 'POST',
        body: 'code=123',
      });
      const resNoType = await readBoundedUrlEncodedForm(reqNoType);
      expect(resNoType).toEqual({ success: false, error: 'invalid_content_type' });
    });

    it('rejects query parameters in URL with invalid_url_query', async () => {
      const req = new Request('https://teamham.world/api/auth/game/token?code=123', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=authorization_code',
      });
      const res = await readBoundedUrlEncodedForm(req);
      expect(res).toEqual({ success: false, error: 'invalid_url_query' });
    });

    it('retains duplicate body parameters in URLSearchParams for route-level duplicate detection', async () => {
      const req = new Request('https://teamham.world/api/auth/game/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'code=thc_1&code=thc_2',
      });
      const res = await readBoundedUrlEncodedForm(req);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.params.getAll('code')).toEqual(['thc_1', 'thc_2']);
      }
    });

    it('rejects payload >4096 bytes via Content-Length header and streaming reader', async () => {
      const largeBody = 'data=' + 'a'.repeat(5000);
      const reqHeader = new Request('https://teamham.world/api/auth/game/token', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'content-length': '5005',
        },
        body: largeBody,
      });
      const resHeader = await readBoundedUrlEncodedForm(reqHeader);
      expect(resHeader).toEqual({ success: false, error: 'payload_too_large' });

      // Without content-length header (streaming limit)
      const reqStream = new Request('https://teamham.world/api/auth/game/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: largeBody,
      });
      const resStream = await readBoundedUrlEncodedForm(reqStream, 4096);
      expect(resStream).toEqual({ success: false, error: 'payload_too_large' });
    });
  });

  describe('7. Token / secret hashing and pairwise subject identity', () => {
    it('hashes tokens into lowercase 64-char SHA-256 hex digests', () => {
      const token = generateGameAccessToken();
      const hash = hashGameToken(token);
      expect(isValidSha256Hex(hash)).toBe(true);
      expect(hash).toBe(crypto.createHash('sha256').update(token, 'utf8').digest('hex').toLowerCase());
    });

    it('verifies client secrets in constant time with dummy hash fallback for safe unknown client comparisons', () => {
      const secret = generateGameClientSecret();
      const secretHash = hashGameToken(secret);

      expect(verifyClientSecret(secret, secretHash)).toBe(true);
      expect(verifyClientSecret('ths_' + 'x'.repeat(43), secretHash)).toBe(false);

      // Unknown client (dummy hash) safely returns false without throwing
      expect(verifyClientSecret(secret, '0000000000000000000000000000000000000000000000000000000000000000')).toBe(false);
      expect(verifyClientSecret(secret, 'invalid-hex-stored-hash')).toBe(false);
    });
  });
});
