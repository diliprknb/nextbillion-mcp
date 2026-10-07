import { describe, expect, it } from 'vitest';
import { getApiParameters, normalizeEndpoint } from '../../src/tools/docs/get-api-parameters.js';
import { getDocumentation, MAX_PAGE_CHARS } from '../../src/tools/docs/get-documentation.js';
import { listDocumentationTopics } from '../../src/tools/docs/list-documentation-topics.js';
import { searchDocumentation } from '../../src/tools/docs/search-documentation.js';
import { ToolInputError } from '../../src/tools/types.js';
import { fakeNbClient } from '../helpers/fake-fetch.js';

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

  it('truncates oversized pages with a section list and serves one section', async () => {
    const big = await run(getDocumentation, { doc_id: 'routing/directions-api/directions-api' });
    expect(big.data.total_chars).toBeGreaterThan(MAX_PAGE_CHARS);
    expect(big.data.truncated).toBe(true);
    expect(big.data.content.length).toBeLessThanOrEqual(MAX_PAGE_CHARS);
    expect(big.data.sections.map((s: { heading: string }) => s.heading)).toContain(
      'API Query Limits',
    );
    const section = await run(getDocumentation, {
      doc_id: 'routing/directions-api/directions-api',
      section: 'api query limits',
    });
    expect(section.data.section).toBe('API Query Limits');
    expect(section.data.truncated).toBe(false);
    expect(section.data.content).toContain('## API Query Limits');
  });

  it('rejects unknown ids and sections as input errors', async () => {
    await expect(getDocumentation.run({ doc_id: 'nope/missing' }, nb)).rejects.toBeInstanceOf(
      ToolInputError,
    );
    await expect(
      getDocumentation.run(
        { doc_id: 'routing/isochrone-api/isochrone-api', section: 'no such section' },
        nb,
      ),
    ).rejects.toThrow(/Sections:/);
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

  it('reports SDK pages as unsupported and unknown endpoints as input errors', async () => {
    const { data } = await run(getApiParameters, { doc_id: 'maps/mobile-sdks/android/mapview' });
    expect(data.unsupported).toBe(true);
    await expect(getApiParameters.run({ endpoint: 'no-such-api' }, nb)).rejects.toBeInstanceOf(
      ToolInputError,
    );
    await expect(getApiParameters.run({}, nb)).rejects.toBeInstanceOf(ToolInputError);
  });
});
