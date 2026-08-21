import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import {
  generateOAuthState,
  generatePkceVerifier,
  generatePkceChallenge,
  generateSessionToken,
  hashSessionToken,
  isValidOAuthState,
  isValidPkceVerifier,
  isValidSessionToken,
  isValidTokenHash,
  isValidDiscordId,
  isValidUuid,
  signOAuthState,
  verifyOAuthStateCookie,
  ALLOWED_OAUTH_RETURN_TO,
  OAuthStatePayload,
} from '@/lib/auth/crypto';

describe('lib/auth/crypto', () => {
  const TEST_SECRET_HEX = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  describe('generateOAuthState', () => {
    it('generates 22 base64url characters and non-constant values', () => {
      const state1 = generateOAuthState();
      const state2 = generateOAuthState();

      expect(state1).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(state2).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(isValidOAuthState(state1)).toBe(true);
      expect(isValidOAuthState(state2)).toBe(true);
      expect(state1).not.toBe(state2);
    });
  });

  describe('generatePkceVerifier', () => {
    it('generates 43 base64url characters and non-constant values', () => {
      const verifier1 = generatePkceVerifier();
      const verifier2 = generatePkceVerifier();

      expect(verifier1).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(verifier2).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(isValidPkceVerifier(verifier1)).toBe(true);
      expect(isValidPkceVerifier(verifier2)).toBe(true);
      expect(verifier1).not.toBe(verifier2);
    });
  });

  describe('generatePkceChallenge', () => {
    it('matches an independent Node crypto SHA-256 base64url calculation', () => {
      const verifier = generatePkceVerifier();
      const challenge = generatePkceChallenge(verifier);

      const expected = crypto.createHash('sha256').update(verifier, 'utf8').digest('base64url');
      expect(challenge).toBe(expected);
      expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it('throws on invalid PKCE verifier format', () => {
      expect(() => generatePkceChallenge('too-short')).toThrow('Invalid PKCE verifier format');
      expect(() => generatePkceChallenge('invalid$characters!are@rejected#by=the$pkce-check')).toThrow(
        'Invalid PKCE verifier format'
      );
    });
  });

  describe('generateSessionToken', () => {
    it('generates 43 base64url characters and non-constant values', () => {
      const token1 = generateSessionToken();
      const token2 = generateSessionToken();

      expect(token1).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(token2).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(isValidSessionToken(token1)).toBe(true);
      expect(isValidSessionToken(token2)).toBe(true);
      expect(token1).not.toBe(token2);
    });
  });

  describe('hashSessionToken', () => {
    it('computes exact lowercase 64-character SHA-256 hex digest distinct from raw token', () => {
      const token = generateSessionToken();
      const hash = hashSessionToken(token);

      const expected = crypto.createHash('sha256').update(token, 'utf8').digest('hex').toLowerCase();
      expect(hash).toBe(expected);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(isValidTokenHash(hash)).toBe(true);
      expect(hash).not.toBe(token);
    });

    it('throws on invalid session token format', () => {
      expect(() => hashSessionToken('short')).toThrow('Invalid session token format');
      expect(() => hashSessionToken('not-valid-base64url-with-symbols!!@#$%^&*()_+')).toThrow(
        'Invalid session token format'
      );
    });
  });

  describe('validation helpers', () => {
    it('validates Discord ID snowflakes correctly', () => {
      expect(isValidDiscordId('123456789012345678')).toBe(true);
      expect(isValidDiscordId('1')).toBe(true);
      expect(isValidDiscordId('12345678901234567890')).toBe(true);
      expect(isValidDiscordId('123456789012345678901')).toBe(false); // >20 digits
      expect(isValidDiscordId('abc123')).toBe(false);
      expect(isValidDiscordId('-12345')).toBe(false);
      expect(isValidDiscordId('')).toBe(false);
      expect(isValidDiscordId(null)).toBe(false);
      expect(isValidDiscordId(undefined)).toBe(false);
    });

    it('validates UUIDs correctly', () => {
      expect(isValidUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(isValidUuid('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
      expect(isValidUuid('not-a-uuid')).toBe(false);
      expect(isValidUuid('550e8400-e29b-41d4-a716')).toBe(false);
      expect(isValidUuid(null)).toBe(false);
    });

    it('validates OAuth states, PKCE verifiers, session tokens, and token hashes', () => {
      expect(isValidOAuthState('a'.repeat(22))).toBe(true);
      expect(isValidOAuthState('a'.repeat(21))).toBe(false);
      expect(isValidOAuthState('a'.repeat(23))).toBe(false);
      expect(isValidOAuthState('a'.repeat(21) + '@')).toBe(false);

      expect(isValidPkceVerifier('b'.repeat(43))).toBe(true);
      expect(isValidPkceVerifier('b'.repeat(42))).toBe(false);

      expect(isValidSessionToken('c'.repeat(43))).toBe(true);
      expect(isValidSessionToken('c'.repeat(44))).toBe(false);

      expect(isValidTokenHash('0123456789abcdef'.repeat(4))).toBe(true);
      expect(isValidTokenHash('0123456789ABCDEF'.repeat(4))).toBe(false); // only lowercase
      expect(isValidTokenHash('0123456789abcdef'.repeat(3))).toBe(false);
    });
  });

  describe('signOAuthState and verifyOAuthStateCookie', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('round-trips an exact valid payload with null returnTo', () => {
      const nowSec = 1700000000;
      vi.setSystemTime(new Date(nowSec * 1000));

      const payload: OAuthStatePayload = {
        state: generateOAuthState(),
        verifier: generatePkceVerifier(),
        issuedAt: nowSec,
        returnTo: null,
      };

      const signedCookie = signOAuthState(payload, TEST_SECRET_HEX);
      expect(typeof signedCookie).toBe('string');
      expect(signedCookie.split('.')).toHaveLength(2);

      const verified = verifyOAuthStateCookie(signedCookie, TEST_SECRET_HEX);
      expect(verified).toEqual(payload);
    });

    it('round-trips an exact valid payload with fixed resume returnTo', () => {
      const nowSec = 1700000000;
      vi.setSystemTime(new Date(nowSec * 1000));

      const payload: OAuthStatePayload = {
        state: generateOAuthState(),
        verifier: generatePkceVerifier(),
        issuedAt: nowSec,
        returnTo: ALLOWED_OAUTH_RETURN_TO,
      };

      const signedCookie = signOAuthState(payload, TEST_SECRET_HEX);
      const verified = verifyOAuthStateCookie(signedCookie, TEST_SECRET_HEX);
      expect(verified).toEqual(payload);
    });

    it('rejects tampered payload', () => {
      const nowSec = 1700000000;
      vi.setSystemTime(new Date(nowSec * 1000));

      const payload: OAuthStatePayload = {
        state: generateOAuthState(),
        verifier: generatePkceVerifier(),
        issuedAt: nowSec,
        returnTo: null,
      };

      const signedCookie = signOAuthState(payload, TEST_SECRET_HEX);
      const [, signature] = signedCookie.split('.');

      // Tamper payload
      const tamperedPayload = Buffer.from(
        JSON.stringify({ ...payload, state: generateOAuthState() }),
        'utf8'
      ).toString('base64url');

      const tamperedCookie = `${tamperedPayload}.${signature}`;
      expect(verifyOAuthStateCookie(tamperedCookie, TEST_SECRET_HEX)).toBeNull();
    });

    it('rejects tampered signature and wrong secret', () => {
      const nowSec = 1700000000;
      vi.setSystemTime(new Date(nowSec * 1000));

      const payload: OAuthStatePayload = {
        state: generateOAuthState(),
        verifier: generatePkceVerifier(),
        issuedAt: nowSec,
        returnTo: null,
      };

      const signedCookie = signOAuthState(payload, TEST_SECRET_HEX);
      const [rawPayload, signature] = signedCookie.split('.');

      // Tamper signature
      const tamperedSig = signature.slice(0, -2) + 'aa';
      expect(verifyOAuthStateCookie(`${rawPayload}.${tamperedSig}`, TEST_SECRET_HEX)).toBeNull();

      // Wrong secret
      const wrongSecret = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
      expect(verifyOAuthStateCookie(signedCookie, wrongSecret)).toBeNull();
    });

    it('rejects malformed encoding and duplicate segment cookies', () => {
      expect(verifyOAuthStateCookie(null, TEST_SECRET_HEX)).toBeNull();
      expect(verifyOAuthStateCookie(undefined, TEST_SECRET_HEX)).toBeNull();
      expect(verifyOAuthStateCookie('', TEST_SECRET_HEX)).toBeNull();
      expect(verifyOAuthStateCookie('nosignatureshere', TEST_SECRET_HEX)).toBeNull();
      expect(verifyOAuthStateCookie('seg1.seg2.seg3', TEST_SECRET_HEX)).toBeNull();
      expect(verifyOAuthStateCookie('.signatureonly', TEST_SECRET_HEX)).toBeNull();
      expect(verifyOAuthStateCookie('payloadonly.', TEST_SECRET_HEX)).toBeNull();
    });

    it('rejects oversized cookies (> 512 chars) and undersized cookies (< 10 chars)', () => {
      const hugeCookie = 'a'.repeat(300) + '.' + 'b'.repeat(300);
      expect(verifyOAuthStateCookie(hugeCookie, TEST_SECRET_HEX)).toBeNull();

      const tinyCookie = 'a.b';
      expect(verifyOAuthStateCookie(tinyCookie, TEST_SECRET_HEX)).toBeNull();
    });

    it('rejects payloads with extra keys or invalid fields', () => {
      const nowSec = 1700000000;
      vi.setSystemTime(new Date(nowSec * 1000));

      const validState = generateOAuthState();
      const validVerifier = generatePkceVerifier();

      // Extra key
      const extraPayload = {
        state: validState,
        verifier: validVerifier,
        issuedAt: nowSec,
        returnTo: null,
        isAdmin: true,
      };
      const extraRaw = Buffer.from(JSON.stringify(extraPayload), 'utf8').toString('base64url');
      const key = Buffer.from(TEST_SECRET_HEX, 'hex');
      const extraSig = crypto.createHmac('sha256', key).update(extraRaw).digest('base64url');
      expect(verifyOAuthStateCookie(`${extraRaw}.${extraSig}`, TEST_SECRET_HEX)).toBeNull();

      // Missing field (missing returnTo)
      const missingPayload = { state: validState, verifier: validVerifier, issuedAt: nowSec };
      const missingRaw = Buffer.from(JSON.stringify(missingPayload), 'utf8').toString('base64url');
      const missingSig = crypto.createHmac('sha256', key).update(missingRaw).digest('base64url');
      expect(verifyOAuthStateCookie(`${missingRaw}.${missingSig}`, TEST_SECRET_HEX)).toBeNull();

      // Non-integer timestamp
      const floatPayload = {
        state: validState,
        verifier: validVerifier,
        issuedAt: 1700000000.5,
        returnTo: null,
      };
      const floatRaw = Buffer.from(JSON.stringify(floatPayload), 'utf8').toString('base64url');
      const floatSig = crypto.createHmac('sha256', key).update(floatRaw).digest('base64url');
      expect(verifyOAuthStateCookie(`${floatRaw}.${floatSig}`, TEST_SECRET_HEX)).toBeNull();

      // Invalid returnTo (arbitrary path or URL)
      const invalidReturnPayload = {
        state: validState,
        verifier: validVerifier,
        issuedAt: nowSec,
        returnTo: '/account',
      };
      const invalidReturnRaw = Buffer.from(JSON.stringify(invalidReturnPayload), 'utf8').toString('base64url');
      const invalidReturnSig = crypto.createHmac('sha256', key).update(invalidReturnRaw).digest('base64url');
      expect(verifyOAuthStateCookie(`${invalidReturnRaw}.${invalidReturnSig}`, TEST_SECRET_HEX)).toBeNull();
    });

    it('enforces age boundaries (valid <= 600s, expired > 600s)', () => {
      const issuedTime = 1700000000;
      vi.setSystemTime(new Date(issuedTime * 1000));

      const payload: OAuthStatePayload = {
        state: generateOAuthState(),
        verifier: generatePkceVerifier(),
        issuedAt: issuedTime,
        returnTo: null,
      };
      const cookie = signOAuthState(payload, TEST_SECRET_HEX);

      // Exactly at issued time
      expect(verifyOAuthStateCookie(cookie, TEST_SECRET_HEX)).toEqual(payload);

      // At exactly 600s after issuance
      vi.setSystemTime(new Date((issuedTime + 600) * 1000));
      expect(verifyOAuthStateCookie(cookie, TEST_SECRET_HEX)).toEqual(payload);

      // At 601s after issuance -> expired
      vi.setSystemTime(new Date((issuedTime + 601) * 1000));
      expect(verifyOAuthStateCookie(cookie, TEST_SECRET_HEX)).toBeNull();
    });

    it('rejects materially future-issued timestamps (> 60s in future)', () => {
      const issuedTime = 1700000000;
      vi.setSystemTime(new Date(issuedTime * 1000));

      // 60s in future -> accepted
      const payload60: OAuthStatePayload = {
        state: generateOAuthState(),
        verifier: generatePkceVerifier(),
        issuedAt: issuedTime + 60,
        returnTo: null,
      };
      const cookie60 = signOAuthState(payload60, TEST_SECRET_HEX);
      expect(verifyOAuthStateCookie(cookie60, TEST_SECRET_HEX)).toEqual(payload60);

      // 61s in future -> rejected
      const payload61: OAuthStatePayload = {
        state: generateOAuthState(),
        verifier: generatePkceVerifier(),
        issuedAt: issuedTime + 61,
        returnTo: null,
      };
      const cookie61 = signOAuthState(payload61, TEST_SECRET_HEX);
      expect(verifyOAuthStateCookie(cookie61, TEST_SECRET_HEX)).toBeNull();
    });

    it('signOAuthState throws on invalid payload contents', () => {
      expect(() =>
        signOAuthState(
          { state: 'short', verifier: generatePkceVerifier(), issuedAt: 1700000000, returnTo: null },
          TEST_SECRET_HEX
        )
      ).toThrow('Invalid OAuth state in payload');

      expect(() =>
        signOAuthState(
          { state: generateOAuthState(), verifier: 'short-verifier', issuedAt: 1700000000, returnTo: null },
          TEST_SECRET_HEX
        )
      ).toThrow('Invalid PKCE verifier in payload');

      expect(() =>
        signOAuthState(
          { state: generateOAuthState(), verifier: generatePkceVerifier(), issuedAt: NaN, returnTo: null },
          TEST_SECRET_HEX
        )
      ).toThrow('Invalid issuedAt in payload');

      expect(() =>
        signOAuthState(
          {
            state: generateOAuthState(),
            verifier: generatePkceVerifier(),
            issuedAt: 1700000000,
            returnTo: '/account' as unknown as null,
          },
          TEST_SECRET_HEX
        )
      ).toThrow('Invalid returnTo in payload');
    });
  });
});
