import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Stateless tokens. Everything the authorization server hands out (authorization codes,
 * access and refresh tokens, dynamically registered client ids) is the payload itself,
 * encrypted with a server-side key: the server stores nothing and any instance can open a
 * token issued by any other. AES-256-GCM authenticates the ciphertext, and the token kind
 * is bound in as associated data so a refresh token can never be presented as a code.
 *
 * Wire format: `v1.<kid>.<iv>.<ciphertext>.<tag>` with base64url parts. `kid` names the key
 * in the ring so keys can be rotated: new tokens use the first key, old ones stay readable
 * until they expire.
 */
export type TokenKind = 'code' | 'access' | 'refresh' | 'client';

export interface SealedPayload {
  /** Unix seconds; absent for payloads that do not expire (registered clients). */
  exp?: number;
  iat: number;
  [field: string]: unknown;
}

export class KeyRing {
  private readonly keys: Array<{ kid: string; key: Buffer }>;

  constructor(keys: ReadonlyArray<Buffer>) {
    if (keys.length === 0) throw new Error('KeyRing needs at least one key');
    this.keys = keys.map((key) => {
      if (key.length !== 32) throw new Error('token keys must be 32 bytes (AES-256)');
      return { kid: createHash('sha256').update(key).digest('base64url').slice(0, 8), key };
    });
  }

  /**
   * Parses NBAI_TOKEN_KEY: one or more base64/base64url 32-byte keys separated by commas,
   * current key first. Without the variable a random key is generated, which is fine for
   * local runs but means tokens die with the process (and are unreadable by other instances).
   */
  static fromEnv(value: string | undefined): { ring: KeyRing; ephemeral: boolean } {
    const parts = (value ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) return { ring: new KeyRing([randomBytes(32)]), ephemeral: true };
    return {
      ring: new KeyRing(
        parts.map((p, i) => {
          const key = Buffer.from(p, 'base64');
          if (key.length !== 32) {
            throw new Error(
              `NBAI_TOKEN_KEY entry ${i + 1} must decode to 32 bytes (got ${key.length})`,
            );
          }
          return key;
        }),
      ),
      ephemeral: false,
    };
  }

  seal(
    kind: TokenKind,
    payload: Record<string, unknown>,
    ttlSeconds?: number,
    now = nowSeconds(),
  ): string {
    const { kid, key } = this.keys[0]!;
    const body: SealedPayload = { ...payload, iat: now };
    if (ttlSeconds !== undefined) body.exp = now + ttlSeconds;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(`${kind}.${kid}`));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(body), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', kid, b64(iv), b64(ciphertext), b64(tag)].join('.');
  }

  /** Returns the payload, or undefined when the token is malformed, tampered, of another kind, or expired. */
  open(kind: TokenKind, token: string, now = nowSeconds()): SealedPayload | undefined {
    const parts = token.split('.');
    if (parts.length !== 5 || parts[0] !== 'v1') return undefined;
    const [, kid, ivB, ctB, tagB] = parts as [string, string, string, string, string];
    const entry = this.keys.find((k) => k.kid === kid);
    if (!entry) return undefined;
    try {
      const decipher = createDecipheriv('aes-256-gcm', entry.key, Buffer.from(ivB, 'base64url'));
      decipher.setAAD(Buffer.from(`${kind}.${kid}`));
      decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
      const plain = Buffer.concat([
        decipher.update(Buffer.from(ctB, 'base64url')),
        decipher.final(),
      ]);
      const payload = JSON.parse(plain.toString('utf8')) as SealedPayload;
      if (typeof payload.exp === 'number' && payload.exp <= now) return undefined;
      return payload;
    } catch {
      return undefined;
    }
  }
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

/** PKCE (RFC 7636) S256: the challenge is base64url(sha256(verifier)). */
export function verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean {
  if (codeVerifier.length < 43 || codeVerifier.length > 128) return false;
  const digest = Buffer.from(
    createHash('sha256').update(codeVerifier, 'ascii').digest('base64url'),
  );
  const expected = Buffer.from(codeChallenge);
  return digest.length === expected.length && timingSafeEqual(digest, expected);
}

/** Opaque, URL-safe random string (state values, test verifiers). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
