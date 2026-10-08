import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/core/server.js';
import { ALL_TOOLS } from '../../src/tools/index.js';
import { fakeNbClient } from '../helpers/fake-fetch.js';

/**
 * Protocol-level tests: a real MCP client connected to the built server over an
 * in-memory transport, with the NextBillion HTTP layer faked. Verifies what an
 * actual host (Claude Code, Codex, Cursor) observes.
 */
describe('MCP conformance', () => {
  let client: Client;
  let requests: ReturnType<typeof fakeNbClient>['requests'];

  beforeEach(async () => {
    const fake = fakeNbClient({
      responses: [
        {
          body: {
            items: [
              {
                title: 'Empire State Building',
                id: 'abc',
                position: { lat: 40.748, lng: -73.985 },
                address: { label: 'Empire State Building, NYC' },
              },
            ],
          },
        },
      ],
    });
    requests = fake.requests;
    const server = buildServer(fake.nb, '0.0.0-test');
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: 'conformance-test', version: '0.0.0' });
    await client.connect(clientTransport);
  });

  it('lists all 20 tools in deterministic sorted order with titles, schemas and annotations', async () => {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name);
    expect(names).toEqual(ALL_TOOLS.map((t) => t.name));
    expect(result.tools).toHaveLength(20);
    for (const tool of result.tools) {
      expect(tool.title, tool.name).toBeTruthy();
      expect(tool.description, tool.name).toBeTruthy();
      expect(tool.inputSchema, tool.name).toBeTruthy();
      // Documentation tools read a bundled index (closed world); API tools call the live API.
      expect(tool.annotations, tool.name).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: !/documentation|api_parameters/.test(tool.name),
      });
    }
  });

  it('sends the server instructions at initialisation', () => {
    expect(client.getInstructions()).toContain('search_documentation');
  });

  it('answers a documentation question without touching the API', async () => {
    const result = await client.callTool({
      name: 'search_documentation',
      arguments: { query: 'truck_weight', api: 'Directions' },
    });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as { results: Array<{ doc_id: string }> };
    expect(structured.results[0]?.doc_id).toMatch(/^routing\/directions-api/);
    expect(requests).toHaveLength(0);
  });

  it('serves identical tool lists across separate connections', async () => {
    const first = await client.listTools();
    const second = await client.listTools();
    expect(second.tools).toEqual(first.tools);
  });

  it('executes a tool call end to end with text + structured content', async () => {
    const result = await client.callTool({
      name: 'geocode_forward',
      arguments: { query: 'empire state building' },
    });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text?: string }>).find(
      (c) => c.type === 'text',
    );
    expect(text?.text).toContain('Empire State Building');
    // The text block mirrors the full response so text-only hosts see every field.
    expect(text?.text).toContain('"id":"abc"');
    expect(text?.text).toContain('"position":{"lat":40.748,"lng":-73.985}');
    expect(result.structuredContent).toMatchObject({ items: [{ id: 'abc' }] });
    expect(requests[0]!.url.pathname).toBe('/geocode');
  });

  it('rejects unknown arguments loudly instead of silently dropping them', async () => {
    // A model that puts `types` at the top level of geocode_forward (it belongs per query in
    // geocode_batch) must get an error naming the key, not a result that ignored the filter.
    const result = await client.callTool({
      name: 'geocode_reverse',
      arguments: { coordinate: { latitude: 1, longitude: 2 }, types: ['addressBlock'] },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? '';
    expect(text).toMatch(/types/);
    expect(requests).toHaveLength(0);
  });

  it('rejects schema-invalid arguments as an in-band tool error', async () => {
    const result = await client.callTool({
      name: 'geocode_forward',
      arguments: { query: 123 },
    });
    expect(result.isError).toBe(true);
  });

  it('returns upstream API failures as readable tool errors, key redacted', async () => {
    const failing = fakeNbClient({
      responses: [{ status: 403, body: { msg: 'region not enabled' } }],
    });
    const server = buildServer(failing.nb, '0.0.0-test');
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const failingClient = new Client({ name: 'conformance-test-2', version: '0.0.0' });
    await failingClient.connect(clientTransport);

    const result = await failingClient.callTool({
      name: 'place_lookup',
      arguments: { id: 'abc' },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? '';
    expect(text).toContain('403');
    expect(text).toContain('region not enabled');
    expect(text).not.toContain('test-key-1234');
  });
});
