import { describe, expect, it } from 'vitest';
import { defaultKeyCheckUrl, probeApiKey } from '../../src/http/oauth/probe.js';

function respond(status: number, body = ''): typeof fetch {
  return (async () => new Response(body, { status })) as unknown as typeof fetch;
}

describe('probeApiKey', () => {
  it('builds the unbilled geocode probe URL', () => {
    expect(defaultKeyCheckUrl('https://api.nextbillion.io')).toBe(
      'https://api.nextbillion.io/h/geocode',
    );
    expect(defaultKeyCheckUrl('https://api.nextbillion.io/')).toBe(
      'https://api.nextbillion.io/h/geocode',
    );
  });

  it('classifies the gateway answers', async () => {
    const url = 'https://api.test/h/geocode';
    expect(
      await probeApiKey(url, 'k', respond(401, '{"status":"401","msg":"Invalid/missing API KEY"}')),
    ).toBe('invalid');
    expect(await probeApiKey(url, 'k', respond(400, '{"msg":"q is required"}'))).toBe('valid');
    // Key is real but the customer has no geocoding SKU: still a valid key.
    expect(
      await probeApiKey(
        url,
        'k',
        respond(403, '{"msg":"Service not enabled for the requested region."}'),
      ),
    ).toBe('valid');
    expect(
      await probeApiKey(url, 'k', respond(403, '{"msg":"IP not allowed for this apikey"}')),
    ).toBe('restricted');
    expect(
      await probeApiKey(
        url,
        'k',
        respond(403, 'Request received from restricted sources for this key.'),
      ),
    ).toBe('restricted');
    expect(await probeApiKey(url, 'k', respond(502))).toBe('unavailable');
    expect(
      await probeApiKey(url, 'k', (async () => {
        throw new Error('ECONNRESET');
      }) as unknown as typeof fetch),
    ).toBe('unavailable');
  });

  it('sends the key as the `key` query parameter and nothing else', async () => {
    let seen = '';
    const fetchFn = (async (input: string | URL | Request) => {
      seen = String(input instanceof Request ? input.url : input);
      return new Response('', { status: 400 });
    }) as unknown as typeof fetch;
    await probeApiKey('https://api.test/h/geocode', 'abc123', fetchFn);
    expect(seen).toBe('https://api.test/h/geocode?key=abc123');
  });
});
