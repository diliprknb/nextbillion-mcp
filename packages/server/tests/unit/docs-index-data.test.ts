import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hasUnbalancedFence } from '../../src/docs/markdown.js';
import type { DocsIndexFile } from '../../src/docs/types.js';
import { ALL_TOOLS } from '../../src/tools/index.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const index = JSON.parse(readFileSync(`${root}data/docs-index.json`, 'utf8')) as DocsIndexFile;
const pin = JSON.parse(readFileSync(`${root}docs/docs-pin.json`, 'utf8')) as { commit: string };
const pageIds = new Set(index.pages.map((p) => p.doc_id));

describe('committed documentation index', () => {
  it('was built from the pinned docs commit and is internally consistent', () => {
    expect(index.meta.format).toBe(2);
    expect(index.meta.parameters).toBe(index.parameters.length);
    expect(index.parameters.length).toBeGreaterThan(500);
    for (const p of index.parameters) expect(pageIds.has(p.doc_id), p.endpoint).toBe(true);
    expect(index.meta.commit_sha).toBe(pin.commit);
    expect(index.meta.pages).toBe(index.pages.length);
    expect(index.meta.chunks).toBe(index.chunks.length);
    expect(index.pages.length).toBeGreaterThan(300);
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
      if (docsTools.has(tool.name)) continue;
      expect(tool.docs?.length ?? 0, `${tool.name} declares docs`).toBeGreaterThan(0);
      for (const id of tool.docs ?? []) expect(pageIds.has(id), `${tool.name} -> ${id}`).toBe(true);
    }
  });
});
