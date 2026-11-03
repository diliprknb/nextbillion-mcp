import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { KeyRing, randomToken, verifyPkceS256 } from '../../src/http/oauth/crypto.js';

describe('KeyRing', () => {
  const ring = new KeyRing([randomBytes(32)]);

  it('round-trips a payload and stamps iat/exp', () => {
    const token = ring.seal('access', { k: 'key-1', c: 'client' }, 60, 1000);
    expect(token.startsWith('v1.')).toBe(true);
    expect(ring.open('access', token, 1001)).toMatchObject({
      k: 'key-1',
      c: 'client',
      iat: 1000,
      exp: 1060,
    });
  });

  it('refuses expired, tampered, foreign-kind and foreign-key tokens', () => {
    const token = ring.seal('refresh', { k: 'key-1' }, 60, 1000);
    expect(ring.open('refresh', token, 1060)).toBeUndefined(); // expired exactly at exp
    expect(ring.open('access', token, 1001)).toBeUndefined(); // kind is bound as AAD
    const parts = token.split('.');
    parts[3] = parts[3]!.slice(0, -2) + (parts[3]!.endsWith('A') ? 'BB' : 'AA');
    expect(ring.open('refresh', parts.join('.'), 1001)).toBeUndefined();
    expect(new KeyRing([randomBytes(32)]).open('refresh', token, 1001)).toBeUndefined();
    expect(ring.open('refresh', 'garbage', 1001)).toBeUndefined();
    expect(ring.open('refresh', '', 1001)).toBeUndefined();
  });

  it('reads tokens sealed with an older key in the ring but seals with the first', () => {
    const oldKey = randomBytes(32);
    const newKey = randomBytes(32);
    const before = new KeyRing([oldKey]);
    const token = before.seal('client', { ru: ['https://a/cb'] });
    const rotated = new KeyRing([newKey, oldKey]);
    expect(rotated.open('client', token)).toMatchObject({ ru: ['https://a/cb'] });
    const fresh = rotated.seal('client', { ru: [] });
    expect(new KeyRing([newKey]).open('client', fresh)).toBeDefined();
    expect(new KeyRing([oldKey]).open('client', fresh)).toBeUndefined();
  });

  it('parses NBAI_TOKEN_KEY (base64, comma-separated) and falls back to an ephemeral key', () => {
    const a = randomBytes(32).toString('base64url');
    const b = randomBytes(32).toString('base64');
    expect(KeyRing.fromEnv(`${a}, ${b}`).ephemeral).toBe(false);
    expect(KeyRing.fromEnv(undefined).ephemeral).toBe(true);
    expect(KeyRing.fromEnv('   ').ephemeral).toBe(true);
    expect(() => KeyRing.fromEnv('dG9vc2hvcnQ=')).toThrow(/32 bytes/);
  });
});

describe('PKCE S256', () => {
  it('accepts the matching verifier and rejects others', () => {
    const verifier = randomToken(48);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    expect(verifyPkceS256(verifier, challenge)).toBe(true);
    expect(verifyPkceS256(verifier + 'x', challenge)).toBe(false);
    expect(
      verifyPkceS256('tooshort', createHash('sha256').update('tooshort').digest('base64url')),
    ).toBe(false);
  });
});
