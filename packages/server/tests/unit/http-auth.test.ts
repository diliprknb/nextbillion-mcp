import { describe, expect, it } from 'vitest';
import {
  API_SCOPE,
  ApiKeyVerifier,
  apiKeyFromAuth,
  authenticationRequired,
  callsProtectedTool,
  protectedToolNames,
} from '../../src/http/auth.js';
import { ALL_TOOLS } from '../../src/tools/index.js';

describe('ApiKeyVerifier', () => {
  it('accepts a bare API key and carries it in extra', async () => {
    const info = await new ApiKeyVerifier().verifyAccessToken('abcdef0123456789ABCDEF0123456789');
    expect(apiKeyFromAuth(info)).toBe('abcdef0123456789ABCDEF0123456789');
    expect(info.scopes).toEqual([API_SCOPE]);
    expect(info.expiresAt).toBeGreaterThan(Date.now() / 1000);
  });

  it('accepts short internal keys (the gateway is the authority on validity)', async () => {
    const info = await new ApiKeyVerifier().verifyAccessToken('int-k3y');
    expect(apiKeyFromAuth(info)).toBe('int-k3y');
  });

  it('rejects strings that cannot be keys', async () => {
    const verifier = new ApiKeyVerifier();
    await expect(verifier.verifyAccessToken('')).rejects.toMatchObject({ code: 'invalid_token' });
    await expect(verifier.verifyAccessToken('tab\there0123456789')).rejects.toMatchObject({
      code: 'invalid_token',
    });
    await expect(verifier.verifyAccessToken('x'.repeat(513))).rejects.toMatchObject({
      code: 'invalid_token',
    });
    await expect(verifier.verifyAccessToken('has spaces in it 0123456789')).rejects.toMatchObject({
      code: 'invalid_token',
    });
    await expect(verifier.verifyAccessToken('${user_config.nbai_api_key}')).rejects.toBeDefined();
  });

  it('reads no key from a missing or foreign AuthInfo', () => {
    expect(apiKeyFromAuth(undefined)).toBeUndefined();
    expect(apiKeyFromAuth({ token: 't', clientId: 'c', scopes: [] })).toBeUndefined();
  });
});

describe('protected tools', () => {
  const protectedTools = protectedToolNames(ALL_TOOLS);

  it('protects exactly the API tools and leaves the documentation tools open', () => {
    expect(protectedTools.size).toBe(16);
    expect(protectedTools.has('directions')).toBe(true);
    expect(protectedTools.has('static_map_image')).toBe(true);
    for (const name of [
      'search_documentation',
      'get_documentation',
      'get_api_parameters',
      'list_documentation_topics',
    ]) {
      expect(protectedTools.has(name), name).toBe(false);
    }
  });

  it('detects a protected call from the 2026 routing headers', () => {
    expect(
      callsProtectedTool({ mcpMethod: 'tools/call', mcpName: 'directions' }, protectedTools),
    ).toBe(true);
    expect(
      callsProtectedTool(
        { mcpMethod: 'tools/call', mcpName: 'search_documentation' },
        protectedTools,
      ),
    ).toBe(false);
    expect(callsProtectedTool({ mcpMethod: 'tools/list' }, protectedTools)).toBe(false);
  });

  it('detects a protected call from a 2025 JSON-RPC body, single or batched', () => {
    const call = (name: string) => ({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name },
    });
    expect(callsProtectedTool({ body: call('geocode_forward') }, protectedTools)).toBe(true);
    expect(callsProtectedTool({ body: call('get_documentation') }, protectedTools)).toBe(false);
    expect(
      callsProtectedTool({ body: [call('get_documentation'), call('isochrone')] }, protectedTools),
    ).toBe(true);
    expect(
      callsProtectedTool({ body: { jsonrpc: '2.0', id: 1, method: 'initialize' } }, protectedTools),
    ).toBe(false);
    expect(callsProtectedTool({ body: 'garbage' }, protectedTools)).toBe(false);
    expect(callsProtectedTool({}, protectedTools)).toBe(false);
  });
});

describe('authenticationRequired', () => {
  it('is the 401 challenge hosts need to start sign-in', async () => {
    const response = authenticationRequired(
      'https://mcp.example.com/.well-known/oauth-protected-resource',
      'sign in',
    );
    expect(response.status).toBe(401);
    const challenge = response.headers.get('www-authenticate') ?? '';
    expect(challenge).toMatch(/^Bearer /);
    expect(challenge).toContain('error="invalid_token"');
    expect(challenge).toContain(
      'resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"',
    );
    expect(challenge).toContain(`scope="${API_SCOPE}"`);
    expect(await response.json()).toMatchObject({ error: 'invalid_token' });
  });
});
