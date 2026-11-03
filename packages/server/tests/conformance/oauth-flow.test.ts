import { createHash, randomBytes } from 'node:crypto';
import {
  Client,
  StreamableHTTPClientTransport,
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  exchangeAuthorization,
  refreshAuthorization,
  registerClient,
  startAuthorization,
} from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createHttpApp } from '../../src/http/app.js';
import type { FetchApp } from '../../src/http/node-server.js';
import { KeyRing, randomToken } from '../../src/http/oauth/crypto.js';
import { fakeNbClient } from '../helpers/fake-fetch.js';

/**
 * The complete sign-in flow as Claude runs it, driven with the MCP client SDK's own OAuth
 * helpers against the app's fetch handler: discovery → (CIMD or DCR) → authorization
 * request → the user pastes a key on the sign-in page → code → PKCE token exchange → tool
 * call with the access token → refresh. Nothing is stored server-side at any step.
 */
const PUBLIC_URL = new URL('https://mcp.test');
const CLAUDE_CODE = 'https://claude.ai/oauth/claude-code-client-metadata';
const CLAUDE_CODE_DOC = {
  client_id: CLAUDE_CODE,
  client_name: 'Claude Code',
  redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
};
const GOOD_KEY = 'abcdef0123456789ABCDEF0123456789';

interface Harness {
  app: FetchApp;
  fetchFn: typeof fetch;
  keysUsed: string[];
  probes: string[];
}

function makeHarness(opts: { probe?: boolean } = {}): Harness {
  const keysUsed: string[] = [];
  const probes: string[] = [];
  const cimdFetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    return url === CLAUDE_CODE
      ? Response.json(CLAUDE_CODE_DOC)
      : new Response('nope', { status: 404 });
  }) as typeof fetch;
  const app = createHttpApp({
    version: '0.0.0-test',
    publicUrl: PUBLIC_URL,
    issuerUrl: PUBLIC_URL,
    nbClientFactory: (apiKey) => {
      keysUsed.push(apiKey);
      return fakeNbClient({ responses: [{ body: { items: [{ id: 'abc' }] } }], apiKey }).nb;
    },
    oauth: {
      keyRing: new KeyRing([randomBytes(32)]),
      probeApiKey:
        opts.probe === false
          ? undefined
          : async (key) => {
              probes.push(key);
              return key === GOOD_KEY ? 'valid' : 'invalid';
            },
      fetchFn: cimdFetch,
    },
  });
  // Everything the "network" sees goes to the app; the test is the browser and the host.
  const fetchFn = ((input: string | URL | Request, init?: RequestInit) =>
    app.fetch(new Request(input, init))) as typeof fetch;
  return { app, fetchFn, keysUsed, probes };
}

/** Plays the user: loads the sign-in page, submits the key, returns the redirect location. */
async function signInInBrowser(h: Harness, authorizationUrl: URL, apiKey: string): Promise<URL> {
  const page = await h.app.fetch(new Request(authorizationUrl));
  expect(page.status).toBe(200);
  const body = await page.text();
  expect(body).toContain('claude.ai'); // the app's host is named on the consent page
  const requestToken = /name="request" value="([^"]+)"/.exec(body)?.[1];
  expect(requestToken).toBeTruthy();
  const submit = await h.app.fetch(
    new Request(authorizationUrl.origin + authorizationUrl.pathname, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ request: requestToken!, api_key: apiKey }).toString(),
    }),
  );
  expect(submit.status).toBe(302);
  const location = new URL(submit.headers.get('location')!);
  // Chromium applies form-action to the post-submit redirect: the app's origin must be allowed,
  // and the submit-button script is allowed by hash rather than 'unsafe-inline'.
  const csp = page.headers.get('content-security-policy') ?? '';
  expect(csp).toContain(`form-action 'self' ${location.origin}`);
  expect(csp).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'/);
  expect(body).toContain('<script>');
  return location;
}

const open: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  while (open.length) await open.pop()!.close();
});

describe('OAuth sign-in flow', () => {
  it("runs end to end with Claude Code's client metadata document (CIMD) and PKCE", async () => {
    const h = makeHarness();
    open.push(h.app);

    // 1. Discovery, exactly as the SDK client does it.
    const prm = await discoverOAuthProtectedResourceMetadata(PUBLIC_URL, undefined, h.fetchFn);
    expect(prm.authorization_servers).toEqual(['https://mcp.test']);
    const metadata = await discoverAuthorizationServerMetadata(prm.authorization_servers![0]!, {
      fetchFn: h.fetchFn,
    });
    expect(metadata).toMatchObject({
      issuer: 'https://mcp.test',
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      client_id_metadata_document_supported: true,
    });

    // 2. Authorization request (loopback redirect on an ephemeral port, like Claude Code).
    const redirectUrl = 'http://localhost:31180/callback';
    const { authorizationUrl, codeVerifier } = await startAuthorization('https://mcp.test', {
      metadata,
      clientInformation: { client_id: CLAUDE_CODE },
      redirectUrl,
      scope: 'nextbillion.api',
      state: 'xyz',
      resource: PUBLIC_URL,
    });
    expect(authorizationUrl.pathname).toBe('/oauth/authorize');

    // 3. The user pastes a bad key first, then the right one.
    const page = await h.app.fetch(new Request(authorizationUrl));
    const requestToken = /name="request" value="([^"]+)"/.exec(await page.text())![1]!;
    const bad = await h.app.fetch(
      new Request('https://mcp.test/oauth/authorize', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          request: requestToken,
          api_key: 'wrongwrongwrongwrongwrong',
        }).toString(),
      }),
    );
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain('This API key is not valid');

    const callback = await signInInBrowser(h, authorizationUrl, GOOD_KEY);
    expect(callback.origin + callback.pathname).toBe(redirectUrl);
    expect(callback.searchParams.get('state')).toBe('xyz');
    expect(callback.searchParams.get('iss')).toBe('https://mcp.test');
    const code = callback.searchParams.get('code')!;
    expect(code).toBeTruthy();

    // 4. Token exchange with PKCE.
    const tokens = await exchangeAuthorization('https://mcp.test', {
      metadata,
      clientInformation: { client_id: CLAUDE_CODE },
      authorizationCode: code,
      iss: 'https://mcp.test',
      codeVerifier,
      redirectUri: redirectUrl,
      resource: PUBLIC_URL,
      fetchFn: h.fetchFn,
    });
    expect(tokens).toMatchObject({
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'nextbillion.api',
    });
    expect(tokens.refresh_token).toBeTruthy();
    expect(tokens.access_token).not.toContain(GOOD_KEY); // the key is sealed, not embedded

    // 5. A code is single-use in effect: replaying it with another verifier fails...
    await expect(
      exchangeAuthorization('https://mcp.test', {
        metadata,
        clientInformation: { client_id: CLAUDE_CODE },
        authorizationCode: code,
        codeVerifier: randomToken(48),
        redirectUri: redirectUrl,
        fetchFn: h.fetchFn,
      }),
    ).rejects.toBeDefined();

    // 6. The access token drives an API tool call with the user's key.
    const transport = new StreamableHTTPClientTransport(PUBLIC_URL, {
      fetch: h.fetchFn,
      requestInit: { headers: { authorization: `Bearer ${tokens.access_token}` } },
    });
    const client = new Client({ name: 'oauth-flow', version: '0.0.0' });
    await client.connect(transport);
    open.push(client);
    const result = await client.callTool({ name: 'geocode_forward', arguments: { query: 'x' } });
    expect(result.isError).toBeFalsy();
    expect(new Set(h.keysUsed)).toEqual(new Set([GOOD_KEY]));

    // 7. Refresh rotates the refresh token and keeps the key.
    const refreshed = await refreshAuthorization('https://mcp.test', {
      metadata,
      clientInformation: { client_id: CLAUDE_CODE },
      refreshToken: tokens.refresh_token!,
      resource: PUBLIC_URL,
      fetchFn: h.fetchFn,
    });
    expect(refreshed.access_token).not.toBe(tokens.access_token);
    expect(refreshed.refresh_token).toBeTruthy();
    expect(refreshed.refresh_token).not.toBe(tokens.refresh_token);

    // 8. Garbage refresh tokens are `invalid_grant`, which is what Claude expects.
    const bogus = await h.app.fetch(
      new Request('https://mcp.test/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: 'v1.x.y.z.w',
        }).toString(),
      }),
    );
    expect(bogus.status).toBe(400);
    expect(await bogus.json()).toMatchObject({ error: 'invalid_grant' });
    expect(h.probes).toEqual(['wrongwrongwrongwrongwrong', GOOD_KEY]);
  });

  it('supports dynamic client registration for hosts without a metadata document', async () => {
    const h = makeHarness();
    open.push(h.app);
    const metadata = await discoverAuthorizationServerMetadata('https://mcp.test', {
      fetchFn: h.fetchFn,
    });
    const info = await registerClient('https://mcp.test', {
      metadata,
      clientMetadata: {
        redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
        client_name: 'Claude',
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      },
      fetchFn: h.fetchFn,
    });
    expect(info.client_id.startsWith('dcr.')).toBe(true);
    expect(info.client_secret).toBeUndefined();

    const { authorizationUrl, codeVerifier } = await startAuthorization('https://mcp.test', {
      metadata,
      clientInformation: info,
      redirectUrl: 'https://claude.ai/api/mcp/auth_callback',
      resource: PUBLIC_URL,
    });
    const callback = await signInInBrowser(h, authorizationUrl, GOOD_KEY);
    const tokens = await exchangeAuthorization('https://mcp.test', {
      metadata,
      clientInformation: info,
      authorizationCode: callback.searchParams.get('code')!,
      iss: callback.searchParams.get('iss') ?? undefined,
      codeVerifier,
      redirectUri: 'https://claude.ai/api/mcp/auth_callback',
      fetchFn: h.fetchFn,
    });
    expect(tokens.access_token).toBeTruthy();
  });

  it('accepts any well-formed key when no key check is configured', async () => {
    const h = makeHarness({ probe: false });
    open.push(h.app);
    const metadata = await discoverAuthorizationServerMetadata('https://mcp.test', {
      fetchFn: h.fetchFn,
    });
    const { authorizationUrl } = await startAuthorization('https://mcp.test', {
      metadata,
      clientInformation: { client_id: CLAUDE_CODE },
      redirectUrl: 'http://localhost:31180/callback',
      resource: PUBLIC_URL,
    });
    const callback = await signInInBrowser(
      h,
      authorizationUrl,
      'some-other-well-formed-key-123456',
    );
    expect(callback.searchParams.get('code')).toBeTruthy();
    expect(h.probes).toEqual([]);
  });

  it('never redirects to an unregistered redirect_uri', async () => {
    const h = makeHarness();
    open.push(h.app);
    const challenge = createHash('sha256').update(randomToken(48)).digest('base64url');
    const url = new URL('https://mcp.test/oauth/authorize');
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: CLAUDE_CODE,
      redirect_uri: 'https://evil.example/steal',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();
    const response = await h.app.fetch(new Request(url));
    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
    expect(await response.text()).toContain('not registered');
  });

  it('requires PKCE and reports the error on the registered redirect', async () => {
    const h = makeHarness();
    open.push(h.app);
    const url = new URL('https://mcp.test/oauth/authorize');
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: CLAUDE_CODE,
      redirect_uri: 'http://127.0.0.1:4000/callback',
      state: 's1',
    }).toString();
    const response = await h.app.fetch(new Request(url));
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location')!);
    expect(location.origin + location.pathname).toBe('http://127.0.0.1:4000/callback');
    expect(location.searchParams.get('error')).toBe('invalid_request');
    expect(location.searchParams.get('state')).toBe('s1');
  });
});
