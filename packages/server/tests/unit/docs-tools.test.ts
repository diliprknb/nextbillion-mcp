import { describe, expect, it } from 'vitest';
import { getApiParameters, normalizeEndpoint } from '../../src/tools/docs/get-api-parameters.js';
import {
  getDocumentation,
  MAX_PAGE_CHARS,
  PAGE_OVERSHOOT,
} from '../../src/tools/docs/get-documentation.js';
import { listDocumentationTopics } from '../../src/tools/docs/list-documentation-topics.js';
import { searchDocumentation } from '../../src/tools/docs/search-documentation.js';
import { ToolInputError } from '../../src/tools/types.js';
import { configureDocsIndex } from '../../src/docs/store.js';
import { fakeNbClient } from '../helpers/fake-fetch.js';
import { DOCS_FIXTURE } from '../setup.js';

const nb = fakeNbClient({ responses: [] }).nb;
type Structured = Record<string, any>;
const run = async (
  tool: { run: (a: any, nb: any) => Promise<any> },
  args: unknown,
): Promise<{ text: string; data: Structured }> => {
  const result = await tool.run(args, nb);
  return { text: result.content[0].text as string, data: result.structuredContent as Structured };
};

describe('search_documentation', () => {
  it('passes acceptance test 2: both truck pages in the top 5 with related_tools directions', async () => {
    const { data, text } = await run(searchDocumentation, {
      query: 'How do I get directions for a truck that respects height and weight limits?',
    });
    const ids = data.results.map((r: { doc_id: string }) => r.doc_id);
    expect(ids).toContain('routing/directions-api/examples/directions-for-custom-truck-sizes');
    expect(ids).toContain('routing/directions-api/examples/legal-routes-for-a-given-truck-weight');
    expect(
      data.results.some((r: { related_tools: string[] }) => r.related_tools.includes('directions')),
    ).toBe(true);
    expect(data.commit_sha).toMatch(/^[0-9a-f]{40}$/);
    expect(text).toContain('<documentation-excerpt>');
    expect(text).toContain('source_url: https://docs.nextbillion.ai/');
  });

  it('passes acceptance test 4: sdk=Flutter returns only Flutter pages', async () => {
    const { data } = await run(searchDocumentation, {
      query: 'add a marker to the map',
      sdk: 'Flutter',
      limit: 10,
    });
    expect(data.results.length).toBeGreaterThan(0);
    for (const r of data.results) expect(r.doc_id).toMatch(/\/flutter\//);
  });

  it('returns one result per page section (eval case 3: batch geocode request body)', async () => {
    const { data } = await run(searchDocumentation, {
      query: 'batch geocoding request body format and batch size limit',
    });
    const keys = data.results.map(
      (r: { doc_id: string; heading_path: string[] }) => `${r.doc_id} ${r.heading_path.join('>')}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(data.results[0].doc_id).toBe('places/geocoding/batch-geocode/batch-geocode');
    expect(data.results[0].heading_path).toContain('Request Body');
    expect(data.results[0].snippet).toContain('| `[].');
    for (const r of data.results) expect(r.snippet.length).toBeGreaterThan(100);
  });

  it('names the best unfiltered page when the sdk filter hides it (eval case 1)', async () => {
    const { data, text } = await run(searchDocumentation, {
      query: 'avoid toll roads Flutter SDK',
      sdk: 'flutter',
    });
    for (const r of data.results) expect(r.doc_id).toMatch(/\/flutter\//);
    expect(data.best_unfiltered.doc_id).toBe(
      'routing/directions-api/examples/avoid-tolls-and-highways',
    );
    expect(text).toContain('without that filter the best match is');
    const marker = await run(searchDocumentation, {
      query: 'add a marker to the map',
      sdk: 'Flutter',
    });
    expect(marker.data.best_unfiltered).toBeUndefined();
  });

  it('returns guidance and the catalog when nothing matches', async () => {
    const { data, text } = await run(searchDocumentation, { query: 'zzzz qqqq' });
    expect(data.results).toEqual([]);
    expect(data.available.map((c: { category: string }) => c.category)).toContain('Routing');
    expect(text).toContain('list_documentation_topics');
  });
});

describe('get_documentation', () => {
  it('returns a page without code samples by default and with them on request', async () => {
    const id = 'routing/directions-api/examples/legal-routes-for-a-given-truck-weight';
    const plain = await run(getDocumentation, { doc_id: id });
    expect(plain.data.title).toBe('Legal routes for a given truck weight');
    expect(plain.data.source_url).toBe(
      'https://docs.nextbillion.ai/routing/directions-api/examples/legal-routes-for-a-given-truck-weight',
    );
    expect(plain.text).toContain(`<documentation doc_id="${id}">`);
    const withCode = await run(getDocumentation, { doc_id: id, include_examples: true });
    expect(withCode.data.content.length).toBeGreaterThan(plain.data.content.length);
    expect(withCode.data.content).toContain('```');
  });

  it('returns a page a little over the cap whole (eval case 6: Directions)', async () => {
    const page = await run(getDocumentation, { doc_id: 'routing/directions-api/directions-api' });
    expect(page.data.total_chars).toBeGreaterThan(MAX_PAGE_CHARS);
    expect(page.data.total_chars).toBeLessThanOrEqual(MAX_PAGE_CHARS * PAGE_OVERSHOOT);
    expect(page.data.truncated).toBe(false);
    expect(page.data.content.length).toBe(page.data.total_chars);
    expect(page.text).not.toContain('[Truncated');
  });

  it('truncates oversized pages with the section list first and serves one section', async () => {
    const id = 'tracking/geofence-api/geofence-api';
    const big = await run(getDocumentation, { doc_id: id });
    expect(big.data.total_chars).toBeGreaterThan(MAX_PAGE_CHARS * PAGE_OVERSHOOT);
    expect(big.data.truncated).toBe(true);
    expect(big.data.content.length).toBeLessThanOrEqual(MAX_PAGE_CHARS);
    expect(big.text.indexOf('Sections:')).toBeLessThan(big.text.indexOf('<documentation '));
    expect(big.data.sections.map((s: { heading: string }) => s.heading)).toContain('Request Body');
    const section = await run(getDocumentation, {
      doc_id: 'routing/directions-api/directions-api',
      section: 'api query limits',
    });
    expect(section.data.section).toBe('API Query Limits');
    expect(section.data.truncated).toBe(false);
    expect(section.data.content).toContain('## API Query Limits');
  });

  it('reports an unknown id or section as found: false with suggestions, not as an error', async () => {
    const page = await run(getDocumentation, { doc_id: 'routing/direction-api' });
    expect(page.data.found).toBe(false);
    expect(page.data.similar_doc_ids[0]).toBe('routing/directions-api/directions-api');
    expect(page.text).toContain('Similar doc_ids: routing/directions-api/directions-api');
    const section = await run(getDocumentation, {
      doc_id: 'routing/isochrone-api/isochrone-api',
      section: 'no such section',
    });
    expect(section.data.found).toBe(false);
    expect(section.data.sections.length).toBeGreaterThan(0);
    expect(section.text).toMatch(/Sections:/);
  });
});

describe('list_documentation_topics', () => {
  it('lists categories with page counts and honours filters', async () => {
    const all = await run(listDocumentationTopics, {});
    expect(all.data.matched_pages).toBe(all.data.total_pages);
    expect(all.data.categories.map((c: { category: string }) => c.category)).toEqual(
      expect.arrayContaining(['Routing', 'Places', 'Maps', 'Optimization', 'Tracking']),
    );
    const flutter = await run(listDocumentationTopics, { category: 'Maps', sdk: 'flutter' });
    expect(flutter.data.categories).toHaveLength(1);
    expect(flutter.data.categories[0].apis.every((a: { sdk: string }) => a.sdk === 'Flutter')).toBe(
      true,
    );
    expect(flutter.text).toContain('## Maps');
  });
});

describe('get_api_parameters', () => {
  it('passes acceptance test 3: truck_weight under the Flexible variant with type and description', async () => {
    const { data, text } = await run(getApiParameters, {
      endpoint: 'directions',
      name: 'truck_weight',
    });
    expect(data.parameters.length).toBeGreaterThan(0);
    const record = data.parameters[0];
    expect(record.type).toBe('integer');
    expect(record.description.length).toBeGreaterThan(10);
    expect(record.heading_path.join(' ')).toContain('Flexible');
    expect(record.units).toBe('kilograms');
    expect(text).toContain('truck_weight');
  });

  it('returns every variant for an endpoint and accepts loose endpoint spellings', async () => {
    const { data } = await run(getApiParameters, { endpoint: 'Directions API', name: 'origin' });
    expect(data.endpoints).toEqual(
      expect.arrayContaining(['directions/flexible', 'directions/fast']),
    );
    expect(normalizeEndpoint('/Directions API/')).toBe('directions');
    expect(normalizeEndpoint('distance-matrix-api/synchronous')).toBe(
      'distance-matrix/synchronous',
    );
  });

  it('resolves tool names, swapped word order, titles and doc_ids to the endpoint (eval case 3)', async () => {
    const expectBatch = (data: Structured, matchedBy?: string): void => {
      expect(data.found).toBe(true);
      expect(data.endpoints).toEqual(['batch-geocode']);
      expect(data.matched_by).toBe(matchedBy);
      const names = data.parameters.map((p: { name: string }) => p.name);
      expect(names).toEqual(['key', '[].q', '[].at', '[].in', '[].types', '[].limit', '[].lang']);
    };
    expectBatch((await run(getApiParameters, { endpoint: 'geocode/batch' })).data, 'word_order');
    expectBatch((await run(getApiParameters, { endpoint: 'geocode_batch' })).data, 'word_order');
    expectBatch((await run(getApiParameters, { endpoint: 'Batch Geocode API' })).data, undefined);
    expectBatch(
      (await run(getApiParameters, { endpoint: 'places/geocoding/batch-geocode/batch-geocode' }))
        .data,
      'doc_id',
    );
    const byTool = await run(getApiParameters, { endpoint: 'place_search' });
    expect(byTool.data.matched_by).toBe('tool_name');
    expect(byTool.data.endpoints[0]).toMatch(/^search-places/);
    const limit = await run(getApiParameters, { endpoint: 'geocode/batch', name: '[].limit' });
    expect(limit.data.parameters[0]).toMatchObject({ type: 'integer', location: 'body' });
    expect(limit.text).toContain('matched by word order');
  });

  it('reports SDK pages as unsupported and misses as found: false, not as errors', async () => {
    const { data } = await run(getApiParameters, { doc_id: 'maps/mobile-sdks/android/mapview' });
    expect(data.unsupported).toBe(true);
    const endpoint = await run(getApiParameters, { endpoint: 'no-such-api' });
    expect(endpoint.data.found).toBe(false);
    expect(endpoint.data.known_apis).toContain('directions');
    expect(endpoint.text).toContain('Known APIs:');
    const typo = await run(getApiParameters, { endpoint: 'geocode' });
    expect(typo.data.found).toBe(false);
    expect(typo.data.similar_endpoints).toContain('batch-geocode');
    const name = await run(getApiParameters, { endpoint: 'directions', name: 'no_such_param' });
    expect(name.data.found).toBe(false);
    expect(name.data.parameter_names).toContain('truck_weight');
    const docId = await run(getApiParameters, { doc_id: 'nope/missing' });
    expect(docId.data.found).toBe(false);
    await expect(getApiParameters.run({}, nb)).rejects.toBeInstanceOf(ToolInputError);
  });
});

describe('documentation tools without an index', () => {
  it('answer with the public docs site instead of an error', async () => {
    configureDocsIndex({});
    try {
      for (const tool of [
        searchDocumentation,
        getDocumentation,
        getApiParameters,
        listDocumentationTopics,
      ]) {
        const result = await tool.run(
          {
            query: 'directions',
            doc_id: 'routing/directions-api/directions-api',
            endpoint: 'directions',
          },
          nb,
        );
        expect(result.isError, tool.name).toBeUndefined();
        expect(result.content[0]!.text, tool.name).toContain('temporarily unavailable');
        expect(result.content[0]!.text, tool.name).toContain(
          'https://docs.nextbillion.ai/routing/directions-api',
        );
        expect(result.structuredContent, tool.name).toMatchObject({
          available: false,
          docs_site_url: 'https://docs.nextbillion.ai',
        });
      }
    } finally {
      configureDocsIndex({ file: DOCS_FIXTURE });
    }
  });
});
