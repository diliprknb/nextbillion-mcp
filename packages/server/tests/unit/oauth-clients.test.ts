import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ClientError, ClientResolver, redirectUriAllowed } from '../../src/http/oauth/clients.js';
import { KeyRing } from '../../src/http/oauth/crypto.js';

const CLAUDE_CODE = 'https://claude.ai/oauth/claude-code-client-metadata';
const CIMD_DOC = {
  client_id: CLAUDE_CODE,
  client_name: 'Claude Code',
  redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
  token_endpoint_auth_method: 'none',
};

function fakeFetch(docs: Record<string, unknown>): typeof fetch & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    const doc = docs[url];
    return doc ? Response.json(doc) : new Response('nope', { status: 404 });
  }) as unknown as typeof fetch & { calls: string[] };
  fn.calls = calls;
  return fn;
}

describe('ClientResolver', () => {
  const keyRing = new KeyRing([randomBytes(32)]);

  it('resolves a Client ID Metadata Document and caches it', async () => {
    const fetchFn = fakeFetch({ [CLAUDE_CODE]: CIMD_DOC });
    const resolver = new ClientResolver({ keyRing, fetchFn });
    const client = await resolver.resolve(CLAUDE_CODE);
    expect(client).toMatchObject({
      kind: 'cimd',
      displayHost: 'claude.ai',
      clientName: 'Claude Code',
    });
    expect(client.redirectUris).toEqual(CIMD_DOC.redirect_uris);
    await resolver.resolve(CLAUDE_CODE);
    expect(fetchFn.calls).toHaveLength(1);
  });

  it('rejects documents that do not name themselves and non-https ids', async () => {
    const resolver = new ClientResolver({
      keyRing,
      fetchFn: fakeFetch({ 'https://evil.example/doc': { ...CIMD_DOC, client_id: CLAUDE_CODE } }),
    });
    await expect(resolver.resolve('https://evil.example/doc')).rejects.toBeInstanceOf(ClientError);
    await expect(resolver.resolve('http://claude.ai/x')).rejects.toMatchObject({
      code: 'invalid_client',
    });
    await expect(resolver.resolve('https://missing.example/doc')).rejects.toMatchObject({
      code: 'invalid_client',
    });
  });

  it('registers a public client statelessly and resolves the returned id', async () => {
    const resolver = new ClientResolver({ keyRing, fetchFn: fakeFetch({}) });
    const info = resolver.register({
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      client_name: 'Claude',
      token_endpoint_auth_method: 'none',
    });
    expect(info).toMatchObject({ token_endpoint_auth_method: 'none', client_name: 'Claude' });
    const client = await resolver.resolve(info.client_id as string);
    expect(client).toMatchObject({
      kind: 'dcr',
      redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
    });
    // Another server (another key) cannot forge a registration.
    const other = new ClientResolver({
      keyRing: new KeyRing([randomBytes(32)]),
      fetchFn: fakeFetch({}),
    });
    await expect(other.resolve(info.client_id as string)).rejects.toMatchObject({
      code: 'invalid_client',
    });
  });

  it('refuses registrations without redirect URIs or with client secrets', () => {
    const resolver = new ClientResolver({ keyRing, fetchFn: fakeFetch({}) });
    expect(() => resolver.register({})).toThrow(ClientError);
    expect(() =>
      resolver.register({
        redirect_uris: ['https://a/cb'],
        token_endpoint_auth_method: 'client_secret_basic',
      }),
    ).toThrow(/public clients/);
  });
});

describe('redirectUriAllowed', () => {
  const registered = [
    'https://claude.ai/api/mcp/auth_callback',
    'http://localhost/callback',
    'http://127.0.0.1/callback',
  ];

  it('matches hosted callbacks exactly and loopback callbacks on any port', () => {
    expect(redirectUriAllowed('https://claude.ai/api/mcp/auth_callback', registered)).toBe(true);
    expect(redirectUriAllowed('https://claude.ai/api/mcp/auth_callback2', registered)).toBe(false);
    expect(redirectUriAllowed('https://claude.ai:8443/api/mcp/auth_callback', registered)).toBe(
      false,
    );
    expect(redirectUriAllowed('http://localhost:3118/callback', registered)).toBe(true);
    expect(redirectUriAllowed('http://127.0.0.1:54321/callback', registered)).toBe(true);
    expect(redirectUriAllowed('http://localhost:3118/other', registered)).toBe(false);
    expect(redirectUriAllowed('http://evil.example/callback', registered)).toBe(false);
    expect(redirectUriAllowed('http://localhost:3118/callback#x', registered)).toBe(false);
    expect(redirectUriAllowed('not a url', registered)).toBe(false);
  });
});
