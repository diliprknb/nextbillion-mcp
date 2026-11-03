import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createHttpApp } from '../../src/http/app.js';
import type { FetchApp } from '../../src/http/node-server.js';
import { fakeNbClient, type RecordedRequest } from '../helpers/fake-fetch.js';

/**
 * Protocol-level tests for the hosted mode: a real MCP client speaking Streamable HTTP to
 * the app's fetch handler (no sockets), with the NextBillion API faked. Covers what a host
 * observes: anonymous discovery and documentation tools, the 401 that starts sign-in, and
 * per-request API keys.
 */
const PUBLIC_URL = new URL('https://mcp.test');
const KEY = 'abcdef0123456789ABCDEF0123456789';

function makeApp(): { app: FetchApp; keysUsed: string[]; requests: () => RecordedRequest[] } {
  const keysUsed: string[] = [];
  const fakes: Array<{ requests: RecordedRequest[] }> = [];
  const app = createHttpApp({
    version: '0.0.0-test',
    publicUrl: PUBLIC_URL,
    issuerUrl: PUBLIC_URL,
    // Called once per authenticated request: the server is rebuilt for every HTTP exchange.
    nbClientFactory: (apiKey) => {
      keysUsed.push(apiKey);
      const fake = fakeNbClient({
        responses: [{ body: { items: [{ id: 'abc', title: 'Empire State Building' }] } }],
        apiKey,
      });
      fakes.push(fake);
      return fake.nb;
    },
  });
  return { app, keysUsed, requests: () => fakes.flatMap((f) => f.requests) };
}

function connect(app: FetchApp, authorization?: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(PUBLIC_URL, {
    fetch: (input, init) => app.fetch(new Request(input, init)),
    requestInit: authorization ? { headers: { authorization } } : undefined,
  });
  const client = new Client({ name: 'http-conformance', version: '0.0.0' });
  return client.connect(transport).then(() => client);
}

const open: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  while (open.length) await open.pop()!.close();
});

describe('hosted HTTP mode', () => {
  it('answers liveness and serves the protected resource metadata', async () => {
    const { app } = makeApp();
    open.push(app);
    const health = await app.fetch(new Request('https://mcp.test/healthz'));
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ok', version: '0.0.0-test' });

    const prm = await app.fetch(
      new Request('https://mcp.test/.well-known/oauth-protected-resource'),
    );
    expect(prm.status).toBe(200);
    expect(prm.headers.get('access-control-allow-origin')).toBe('*');
    expect(await prm.json()).toMatchObject({
      resource: 'https://mcp.test',
      authorization_servers: ['https://mcp.test'],
      bearer_methods_supported: ['header'],
      scopes_supported: ['nextbillion.api'],
    });

    const missing = await app.fetch(new Request('https://mcp.test/nope'));
    expect(missing.status).toBe(404);
  });

  it('lets an anonymous host list tools and use the documentation tools', async () => {
    const { app, keysUsed } = makeApp();
    open.push(app);
    const client = await connect(app);
    open.push(client);
    const tools = await client.listTools();
    expect(tools.tools).toHaveLength(27);
    const result = await client.callTool({
      name: 'search_documentation',
      arguments: { query: 'truck_weight', api: 'Directions' },
    });
    expect(result.isError).toBeFalsy();
    expect(keysUsed).toEqual([]);
  });

  it('refuses an anonymous API tool call with the 401 that starts sign-in', async () => {
    const { app, keysUsed } = makeApp();
    open.push(app);
    const client = await connect(app);
    open.push(client);
    await expect(
      client.callTool({ name: 'geocode_forward', arguments: { query: 'empire state building' } }),
    ).rejects.toBeDefined();
    expect(keysUsed).toEqual([]);

    // The raw HTTP shape, as a host sees it.
    const response = await app.fetch(
      new Request('https://mcp.test/', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'geocode_forward', arguments: { query: 'x' } },
        }),
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain(
      'resource_metadata="https://mcp.test/.well-known/oauth-protected-resource"',
    );
  });

  it('uses the bearer key for the API call and nothing else', async () => {
    const { app, keysUsed, requests } = makeApp();
    open.push(app);
    const client = await connect(app, `Bearer ${KEY}`);
    open.push(client);
    const result = await client.callTool({
      name: 'geocode_forward',
      arguments: { query: 'empire state building' },
    });
    expect(result.isError).toBeFalsy();
    // One client per request (connect, list, call); every one of them got the caller's key.
    expect(keysUsed.length).toBeGreaterThanOrEqual(1);
    expect(new Set(keysUsed)).toEqual(new Set([KEY]));
    expect(requests()).toHaveLength(1);
    expect(requests()[0]!.url.searchParams.get('key')).toBe(KEY);
  });

  it('refuses a malformed bearer token outright', async () => {
    const { app } = makeApp();
    open.push(app);
    const response = await app.fetch(
      new Request('https://mcp.test/', {
        method: 'POST',
        headers: {
          authorization: 'Bearer ${user_config.nbai_api_key}',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('error="invalid_token"');
  });
});
