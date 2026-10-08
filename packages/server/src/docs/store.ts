/**
 * Loads the packed documentation index once per process and builds the in-memory
 * search structures (spec §7). Sync and lazy: the first documentation tool call pays
 * the load; API tools never touch it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Bm25Field } from './bm25.js';
import { tokenize } from './tokenizer.js';
import type {
  ChunkRecord,
  DocsIndexFile,
  DocsIndexMeta,
  PageRecord,
  ParameterRecord,
} from './types.js';

export interface DocsIndex {
  meta: DocsIndexMeta;
  pages: ReadonlyMap<string, PageRecord>;
  pageList: ReadonlyArray<PageRecord>;
  chunks: ReadonlyArray<ChunkRecord>;
  /** Chunk indexes per doc_id, in page order. */
  chunksByDoc: ReadonlyMap<string, number[]>;
  body: Bm25Field;
  head: Bm25Field;
  parameters: ReadonlyArray<ParameterRecord>;
  /** Distinct endpoints in index order. */
  endpoints: ReadonlyArray<string>;
}

/**
 * Candidate locations of the data file relative to this module: `../data/` next to the
 * bundled `dist/index.js` (npm package, Claude Code plugin, Claude Desktop extension) and
 * `../../data/` when running from `src/` under tsx or vitest.
 */
function defaultIndexPath(): string {
  const override = process.env.NBAI_DOCS_INDEX?.trim();
  if (override) return override;
  for (const relative of ['../data/docs-index.json', '../../data/docs-index.json']) {
    const candidate = fileURLToPath(new URL(relative, import.meta.url));
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('documentation index data/docs-index.json not found next to the server');
}

export function buildDocsIndex(file: DocsIndexFile): DocsIndex {
  const pages = new Map(file.pages.map((p) => [p.doc_id, p] as const));
  const chunksByDoc = new Map<string, number[]>();
  const bodyDocs: string[][] = [];
  const headDocs: string[][] = [];
  file.chunks.forEach((chunk, index) => {
    const list = chunksByDoc.get(chunk.doc_id) ?? [];
    list.push(index);
    chunksByDoc.set(chunk.doc_id, list);
    const page = pages.get(chunk.doc_id);
    bodyDocs.push(tokenize(chunk.text));
    headDocs.push(tokenize([page?.title ?? '', page?.api ?? '', ...chunk.heading_path].join(' ')));
  });
  return {
    meta: file.meta,
    pages,
    pageList: file.pages,
    chunks: file.chunks,
    chunksByDoc,
    body: new Bm25Field(bodyDocs),
    head: new Bm25Field(headDocs),
    parameters: file.parameters,
    endpoints: [...new Set(file.parameters.map((p) => p.endpoint))],
  };
}

export function loadDocsIndex(path: string = defaultIndexPath()): DocsIndex {
  const file = JSON.parse(readFileSync(path, 'utf8')) as DocsIndexFile;
  if (file.meta?.format !== 2) throw new Error(`unsupported documentation index format in ${path}`);
  return buildDocsIndex(file);
}

let cached: DocsIndex | undefined;

/** The process-wide index, loaded on first use. */
export function getDocsIndex(): DocsIndex {
  cached ??= loadDocsIndex();
  return cached;
}

/** Test hook: replace or clear the cached index. */
export function setDocsIndexForTests(index: DocsIndex | undefined): void {
  cached = index;
}
