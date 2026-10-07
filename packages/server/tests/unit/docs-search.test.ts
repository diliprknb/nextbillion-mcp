import { describe, expect, it } from 'vitest';
import { catalog, search, snippet } from '../../src/docs/search.js';
import { buildDocsIndex } from '../../src/docs/store.js';
import type { DocsIndexFile } from '../../src/docs/types.js';

const file: DocsIndexFile = {
  meta: {
    format: 2,
    commit_sha: 'abc1234',
    built_at: '2026-10-07',
    pages: 3,
    chunks: 5,
    parameters: 0,
  },
  pages: [
    {
      doc_id: 'routing/directions-api/directions-api',
      title: 'Directions API',
      category: 'Routing',
      api: 'Directions API',
      page_type: 'reference',
      source_url: 'https://docs.nextbillion.ai/routing/directions-api',
      path: 'Routing/Directions API/directions-api.md',
      sections: [{ heading: 'Request Parameters', level: 3, anchor: 'request-parameters' }],
    },
    {
      doc_id: 'maps/mobile-sdks/flutter/annotations',
      title: 'Annotations',
      category: 'Maps',
      api: 'Flutter Maps SDK',
      sdk: 'Flutter',
      page_type: 'reference',
      source_url: 'https://docs.nextbillion.ai/maps/flutter-maps-sdk/annotations',
      path: 'Maps/Mobile SDKs/Flutter/annotations.md',
      sections: [],
    },
    {
      doc_id: 'maps/mobile-sdks/android/annotations',
      title: 'Markers',
      category: 'Maps',
      api: 'Android Maps SDK',
      sdk: 'Android',
      page_type: 'reference',
      source_url: 'https://docs.nextbillion.ai/maps/android-maps-sdk/markers',
      path: 'Maps/Mobile SDKs/Android/markers.md',
      sections: [],
    },
  ],
  chunks: [
    {
      chunk_id: 'routing/directions-api/directions-api#0',
      doc_id: 'routing/directions-api/directions-api',
      chunk_type: 'content',
      heading_path: ['Directions API', 'Flexible', 'Request Parameters'],
      text: '| truck_weight | No | Weight of the truck in kilograms |\n| truck_size | No | Dimensions |',
    },
    {
      chunk_id: 'routing/directions-api/directions-api#1',
      doc_id: 'routing/directions-api/directions-api',
      chunk_type: 'content',
      heading_path: ['Directions API', 'Introduction'],
      text: 'The truck weight and the truck size matter for legal routes. The weight limit applies.',
    },
    {
      chunk_id: 'routing/directions-api/directions-api#2',
      doc_id: 'routing/directions-api/directions-api',
      chunk_type: 'example',
      heading_path: ['Directions API', 'Flexible', 'Request'],
      text: '```bash\ncurl truck_weight=5000 truck_weight truck_weight\n```',
    },
    {
      chunk_id: 'maps/mobile-sdks/flutter/annotations#0',
      doc_id: 'maps/mobile-sdks/flutter/annotations',
      chunk_type: 'content',
      heading_path: ['Annotations'],
      text: 'Add a marker annotation to the Flutter map view with an icon.',
    },
    {
      chunk_id: 'maps/mobile-sdks/android/annotations#0',
      doc_id: 'maps/mobile-sdks/android/annotations',
      chunk_type: 'content',
      heading_path: ['Markers'],
      text: 'Add a marker to the Android map view with a custom icon drawable.',
    },
  ],
  parameters: [],
};
const index = buildDocsIndex(file);

describe('search', () => {
  it('ranks a whole-identifier match above a prose match', () => {
    const hits = search(index, { query: 'truck_weight' });
    expect(hits[0]!.heading_path).toContain('Request Parameters');
  });

  it('excludes example chunks unless asked, then penalises them', () => {
    expect(search(index, { query: 'truck_weight' }).every((h) => h.chunk_type !== 'example')).toBe(
      true,
    );
    const withExamples = search(index, { query: 'truck_weight', includeExamples: true });
    expect(withExamples.some((h) => h.chunk_type === 'example')).toBe(true);
    expect(withExamples[0]!.chunk_type).not.toBe('example');
  });

  it('treats sdk as a hard filter and category as a boost', () => {
    const flutter = search(index, { query: 'marker icon', sdk: 'flutter' });
    expect(flutter.map((h) => h.doc_id)).toEqual(['maps/mobile-sdks/flutter/annotations']);
    const plain = search(index, { query: 'truck weight' }).find((h) =>
      h.doc_id.startsWith('routing/'),
    )!;
    const boosted = search(index, { query: 'truck weight', category: 'Routing' }).find((h) =>
      h.doc_id.startsWith('routing/'),
    )!;
    expect(boosted.score / plain.score).toBeCloseTo(1.5, 1);
  });

  it('spreads results over pages and links the section anchor', () => {
    const hits = search(index, { query: 'truck weight marker', limit: 5 });
    const perDoc = new Map<string, number>();
    for (const h of hits) perDoc.set(h.doc_id, (perDoc.get(h.doc_id) ?? 0) + 1);
    expect(Math.max(...perDoc.values())).toBeLessThanOrEqual(2);
    expect(new Set(hits.map((h) => h.doc_id)).size).toBeGreaterThan(1);
    const params = hits.find((h) => h.heading_path.includes('Request Parameters'))!;
    expect(params.source_url).toBe(
      'https://docs.nextbillion.ai/routing/directions-api#request-parameters',
    );
  });

  it('fills related_tools from the callback and returns nothing for an empty query', () => {
    const hits = search(index, {
      query: 'truck_weight',
      relatedTools: (id) => (id.includes('directions') ? ['directions'] : []),
    });
    expect(hits[0]!.related_tools).toEqual(['directions']);
    expect(search(index, { query: 'the of and' })).toEqual([]);
  });

  it('lists the catalog', () => {
    expect(catalog(index)).toEqual([
      { category: 'Routing', apis: ['Directions API'] },
      { category: 'Maps', apis: ['Flutter Maps SDK', 'Android Maps SDK'] },
    ]);
  });
});

describe('snippet', () => {
  it('centres on the matching line and never cuts a fence', () => {
    const text = [
      'intro '.repeat(100),
      '```json',
      '{ "truck_weight": 1 }',
      '```',
      'tail '.repeat(100),
    ].join('\n');
    const out = snippet(text, new Map([['truck_weight', 2]]), 120);
    expect(out).toContain('truck_weight');
    expect((out.match(/```/g) ?? []).length % 2).toBe(0);
    expect(out.length).toBeLessThanOrEqual(120);
  });
});
