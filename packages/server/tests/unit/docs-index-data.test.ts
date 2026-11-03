import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hasUnbalancedFence, MIN_CHUNK_CHARS } from '../../src/docs/markdown.js';
import type { DocsIndexFile } from '../../src/docs/types.js';
import { ALL_TOOLS } from '../../src/tools/index.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const index = JSON.parse(
  readFileSync(`${root}tests/fixtures/docs-index.json`, 'utf8'),
) as DocsIndexFile;
const pin = JSON.parse(readFileSync(`${root}docs/docs-pin.json`, 'utf8')) as { commit: string };
const pageIds = new Set(index.pages.map((p) => p.doc_id));

describe('committed documentation fixture', () => {
  it('was built from the pinned docs commit and is internally consistent', () => {
    expect(index.meta.format).toBe(2);
    expect(index.meta.parameters).toBe(index.parameters.length);
    expect(index.parameters.length).toBeGreaterThan(200);
    for (const p of index.parameters) expect(pageIds.has(p.doc_id), p.endpoint).toBe(true);
    expect(index.meta.commit_sha).toBe(pin.commit);
    expect(index.meta.pages).toBe(index.pages.length);
    expect(index.meta.chunks).toBe(index.chunks.length);
    expect(index.pages.length).toBeGreaterThan(20);
    expect(new Set(index.chunks.map((c) => c.chunk_id)).size).toBe(index.chunks.length);
    expect(pageIds.size).toBe(index.pages.length);
  });

  it('has at least one chunk per page and no chunk from an unknown page', () => {
    const withChunks = new Set(index.chunks.map((c) => c.doc_id));
    expect(index.pages.filter((p) => !withChunks.has(p.doc_id))).toEqual([]);
    expect(index.chunks.filter((c) => !pageIds.has(c.doc_id))).toEqual([]);
  });

  it('never splits a code fence or a table (acceptance test 5)', () => {
    const broken = index.chunks.filter((c) => hasUnbalancedFence(c.text)).map((c) => c.chunk_id);
    expect(broken).toEqual([]);
    for (let i = 1; i < index.chunks.length; i += 1) {
      const prev = index.chunks[i - 1]!;
      const cur = index.chunks[i]!;
      if (prev.doc_id !== cur.doc_id) continue;
      const prevLast = prev.text.split('\n').pop() ?? '';
      const first = cur.text.split('\n')[0] ?? '';
      expect(/^\s*\|/.test(prevLast) && /^\s*\|/.test(first), cur.chunk_id).toBe(false);
    }
  });

  it('has no near-empty chunks and carries the batch geocode body fields', () => {
    const tiny = index.chunks.filter((c) => c.text.trim().length < MIN_CHUNK_CHARS);
    expect(tiny.map((c) => c.chunk_id)).toEqual([]);
    const batch = index.parameters.filter((p) => p.endpoint === 'batch-geocode');
    expect(batch.map((p) => p.name)).toEqual(
      expect.arrayContaining(['key', '[].q', '[].at', '[].in', '[].types', '[].limit', '[].lang']),
    );
    expect(batch.find((p) => p.name === '[].q')?.location).toBe('body');
  });

  it('tags SDK pages with a platform and all pages with a live URL', () => {
    for (const page of index.pages) {
      expect(page.source_url.startsWith('https://docs.nextbillion.ai/'), page.doc_id).toBe(true);
      if (page.path.includes('Mobile SDKs'))
        expect(['Android', 'iOS', 'Flutter', 'Web']).toContain(page.sdk);
      else expect(page.sdk).toBeUndefined();
    }
  });

  it('is referenced by every API tool (tool-to-doc links)', () => {
    const docsTools = new Set([
      'search_documentation',
      'get_documentation',
      'list_documentation_topics',
      'get_api_parameters',
    ]);
    for (const tool of ALL_TOOLS) {
      // Documentation tools and the local geometry tools call no NextBillion API, so they
      // have no reference page to link.
      if (docsTools.has(tool.name) || tool.annotations?.openWorldHint === false) continue;
      expect(tool.docs?.length ?? 0, `${tool.name} declares docs`).toBeGreaterThan(0);
      for (const id of tool.docs ?? []) expect(pageIds.has(id), `${tool.name} -> ${id}`).toBe(true);
    }
  });
});
