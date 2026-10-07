import { describe, expect, it } from 'vitest';
import {
  chunkSection,
  hasUnbalancedFence,
  headingAnchor,
  parseBlocks,
  splitSections,
} from '../../src/docs/markdown.js';

const page = [
  '# Directions API',
  '',
  'Intro paragraph.',
  '',
  '## Directions Flexible API',
  '',
  '### Request Parameters',
  '',
  '| Name | Required | Description |',
  '| --- | --- | --- |',
  '| `truck_weight` | No | Weight in kg |',
  '',
  '#### Deeper heading stays inside',
  '',
  'More text.',
  '',
  '### Response Schema',
  '',
  '| Field | Type | Description |',
  '| --- | --- | --- |',
  '| status | string | Ok |',
  '',
  '```bash',
  'curl "https://api.nextbillion.io/directions/json?option=flexible" # a long enough sample to count as an example chunk ......................................................................................................',
  '# not a heading',
  '```',
  '',
  '## API Query Limits',
  '',
  'Limits text.',
].join('\n');

describe('parseBlocks', () => {
  it('recognises headings, tables, fences and text, keeping lines verbatim', () => {
    const blocks = parseBlocks(page);
    const kinds = blocks.filter((b) => b.kind !== 'blank').map((b) => b.kind);
    expect(kinds).toEqual([
      'heading',
      'text',
      'heading',
      'heading',
      'table',
      'heading',
      'text',
      'heading',
      'table',
      'fence',
      'heading',
      'text',
    ]);
    expect(blocks.flatMap((b) => b.lines).join('\n')).toBe(page);
    const fence = blocks.find((b) => b.kind === 'fence')!;
    expect(fence.lang).toBe('bash');
    expect(fence.lines).toHaveLength(4);
  });

  it('does not treat a # line inside a fence as a heading', () => {
    const blocks = parseBlocks(page);
    expect(blocks.filter((b) => b.kind === 'heading').map((b) => b.heading)).not.toContain(
      'not a heading',
    );
  });

  it('runs an unclosed fence to the end of the page', () => {
    const blocks = parseBlocks('```json\n{"a": 1}\n');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe('fence');
  });
});

describe('splitSections', () => {
  it('splits at H1-H3 with the open heading path and keeps H4 inside', () => {
    const sections = splitSections(parseBlocks(page));
    expect(sections.map((s) => s.headingPath)).toEqual([
      ['Directions API'],
      ['Directions API', 'Directions Flexible API'],
      ['Directions API', 'Directions Flexible API', 'Request Parameters'],
      ['Directions API', 'Directions Flexible API', 'Response Schema'],
      ['Directions API', 'API Query Limits'],
    ]);
    const params = sections[2]!;
    expect(params.blocks.some((b) => b.kind === 'heading' && b.level === 4)).toBe(true);
  });
});

describe('chunkSection', () => {
  const sections = splitSections(parseBlocks(page));

  it('classifies response tables and long fences', () => {
    const response = chunkSection(sections[3]!);
    expect(response.map((c) => c.chunkType)).toEqual(['response_schema', 'example', 'content']);
  });

  it('keeps request parameter tables as content', () => {
    expect(chunkSection(sections[2]!).map((c) => c.chunkType)).toEqual(['content']);
  });

  it('rejoins losslessly and never splits a fence or a table', () => {
    const chunks = sections.flatMap((s) => chunkSection(s, { cap: 60 }));
    expect(chunks.map((c) => c.text).join('\n')).toBe(page);
    for (const chunk of chunks) {
      expect(hasUnbalancedFence(chunk.text), chunk.text).toBe(false);
      const rows = chunk.text.split('\n').filter((l) => l.startsWith('|'));
      expect(rows.length === 0 || rows.length === 3, chunk.text).toBe(true);
    }
  });

  it('splits long sections at block boundaries under the cap', () => {
    const long = {
      headingPath: ['T'],
      level: 1,
      blocks: parseBlocks(
        Array.from({ length: 30 }, (_, i) => `para ${i} ${'x'.repeat(100)}\n`).join('\n'),
      ),
    };
    const chunks = chunkSection(long, { cap: 500 });
    expect(chunks.length).toBeGreaterThan(4);
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThan(700);
    expect(chunks.map((c) => c.text).join('\n')).toBe(
      long.blocks.flatMap((b) => b.lines).join('\n'),
    );
  });
});

describe('headingAnchor', () => {
  it('matches the live site ids', () => {
    expect(headingAnchor('Discover API')).toBe('discover-api');
    expect(headingAnchor('API Query Limits')).toBe('api-query-limits');
    expect(headingAnchor('Example 2-Create an *isochrone* Geofence')).toBe(
      'example-2-create-an-isochrone-geofence',
    );
  });
});
