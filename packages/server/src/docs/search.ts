/**
 * Ranked documentation search over the in-memory index (spec §7): BM25 on chunk text
 * and on the title/heading field, whole-identifier emphasis, synonym expansion,
 * category/api boosts, an sdk filter, chunk-type penalties, result diversity and
 * fence-safe snippets centred on the matched terms.
 */
import { hasUnbalancedFence } from './markdown.js';
import type { DocsIndex } from './store.js';
import { expandQuery } from './synonyms.js';
import { isIdentifier, tokenize } from './tokenizer.js';
import type { ChunkRecord, PageRecord } from './types.js';

export interface SearchOptions {
  query: string;
  category?: string;
  api?: string;
  sdk?: string;
  limit?: number;
  includeExamples?: boolean;
  /** Tool names that implement the operation a page documents (tool-to-doc links). */
  relatedTools?: (docId: string) => string[];
}

export interface SearchHit {
  doc_id: string;
  title: string;
  heading_path: string[];
  snippet: string;
  source_url: string;
  related_tools: string[];
  score: number;
  chunk_type: ChunkRecord['chunk_type'];
}

export const SEARCH_WEIGHTS = {
  head: 2.5,
  identifier: 2.0,
  categoryBoost: 1.5,
  apiBoost: 1.5,
  examplePenalty: 0.5,
  responseSchemaPenalty: 0.7,
  maxChunksPerPage: 2,
  snippetChars: 800,
};

/** Loose match for host-supplied category/api values ("Directions" vs "Directions API"). */
export function looselyEquals(given: string | undefined, actual: string): boolean {
  if (!given) return false;
  const a = given.trim().toLowerCase();
  const b = actual.trim().toLowerCase();
  return a === b || b.includes(a) || a.includes(b);
}

export function queryTerms(query: string): Map<string, number> {
  const weights = new Map<string, number>();
  for (const term of tokenize(expandQuery(query))) {
    const weight = isIdentifier(term) ? SEARCH_WEIGHTS.identifier : 1;
    weights.set(term, Math.max(weights.get(term) ?? 0, weight));
  }
  return weights;
}

export function search(index: DocsIndex, options: SearchOptions): SearchHit[] {
  const limit = Math.min(Math.max(options.limit ?? 5, 1), 10);
  const terms = queryTerms(options.query);
  if (terms.size === 0) return [];

  const scores = new Float64Array(index.chunks.length);
  index.body.scoreInto(scores, terms);
  const headScores = new Float64Array(index.chunks.length);
  index.head.scoreInto(headScores, terms);

  const sdk = options.sdk?.trim().toLowerCase();
  const candidates: Array<{ chunk: number; score: number }> = [];
  for (let i = 0; i < scores.length; i += 1) {
    let score = scores[i]! + SEARCH_WEIGHTS.head * headScores[i]!;
    if (score <= 0) continue;
    const chunk = index.chunks[i]!;
    const page = index.pages.get(chunk.doc_id);
    if (page === undefined) continue;
    if (sdk && (page.sdk ?? '').toLowerCase() !== sdk) continue;
    if (chunk.chunk_type === 'example') {
      if (!options.includeExamples) continue;
      score *= SEARCH_WEIGHTS.examplePenalty;
    } else if (chunk.chunk_type === 'response_schema') {
      score *= SEARCH_WEIGHTS.responseSchemaPenalty;
    }
    if (looselyEquals(options.category, page.category)) score *= SEARCH_WEIGHTS.categoryBoost;
    if (looselyEquals(options.api, page.api)) score *= SEARCH_WEIGHTS.apiBoost;
    candidates.push({ chunk: i, score });
  }
  candidates.sort((a, b) => b.score - a.score || a.chunk - b.chunk);

  // Diversity: at most N chunks per page until the list is full; overflow fills the rest.
  const chosen: Array<{ chunk: number; score: number }> = [];
  const overflow: Array<{ chunk: number; score: number }> = [];
  const perPage = new Map<string, number>();
  for (const candidate of candidates) {
    if (chosen.length >= limit) break;
    const docId = index.chunks[candidate.chunk]!.doc_id;
    const count = perPage.get(docId) ?? 0;
    if (count >= SEARCH_WEIGHTS.maxChunksPerPage) {
      overflow.push(candidate);
      continue;
    }
    perPage.set(docId, count + 1);
    chosen.push(candidate);
  }
  for (const candidate of overflow) {
    if (chosen.length >= limit) break;
    chosen.push(candidate);
  }

  return chosen.map(({ chunk: i, score }) => {
    const chunk = index.chunks[i]!;
    const page = index.pages.get(chunk.doc_id)!;
    return {
      doc_id: chunk.doc_id,
      title: page.title,
      heading_path: chunk.heading_path,
      snippet: snippet(chunk.text, terms),
      source_url: sectionUrl(page, chunk),
      related_tools: options.relatedTools?.(chunk.doc_id) ?? [],
      score: Math.round(score * 1000) / 1000,
      chunk_type: chunk.chunk_type,
    };
  });
}

/** Page URL plus the fragment of the chunk's own H2/H3, unless the page URL already has one. */
export function sectionUrl(page: PageRecord, chunk: ChunkRecord): string {
  if (page.source_url.includes('#')) return page.source_url;
  const heading = chunk.heading_path[chunk.heading_path.length - 1];
  if (!heading || chunk.heading_path.length < 2) return page.source_url;
  const anchor = page.sections.find((s) => s.heading === heading)?.anchor;
  return anchor ? `${page.source_url}#${anchor}` : page.source_url;
}

/**
 * Up to `snippetChars` characters of the chunk, centred on the line with the most query
 * term matches, extended line by line in both directions, never cutting a code fence.
 */
export function snippet(
  text: string,
  terms: ReadonlyMap<string, number>,
  max = SEARCH_WEIGHTS.snippetChars,
): string {
  const lines = text.split('\n');
  if (text.length <= max) return text.trim();
  let bestLine = 0;
  let bestHits = -1;
  lines.forEach((line, i) => {
    let hits = 0;
    for (const term of tokenize(line)) if (terms.has(term)) hits += 1;
    if (hits > bestHits) {
      bestHits = hits;
      bestLine = i;
    }
  });
  let start = bestLine;
  let end = bestLine;
  let length = lines[bestLine]!.length;
  while (true) {
    const before = start > 0 ? lines[start - 1]!.length + 1 : Infinity;
    const after = end < lines.length - 1 ? lines[end + 1]!.length + 1 : Infinity;
    if (before === Infinity && after === Infinity) break;
    if (before <= after) {
      if (length + before > max) break;
      start -= 1;
      length += before;
    } else {
      if (length + after > max) break;
      end += 1;
      length += after;
    }
  }
  let window = lines.slice(start, end + 1);
  while (window.length > 1 && hasUnbalancedFence(window.join('\n'))) {
    const lastFence = window.map((l) => /^\s{0,3}(`{3,}|~{3,})/.test(l)).lastIndexOf(true);
    window = lastFence > 0 ? window.slice(0, lastFence) : window.slice(1);
  }
  const result = window.join('\n').trim();
  return result.length > max ? `${result.slice(0, max - 1).trimEnd()}…` : result;
}

/** Categories and APIs present in the index, for empty-result guidance and topic listing. */
export function catalog(index: DocsIndex): Array<{ category: string; apis: string[] }> {
  const byCategory = new Map<string, Set<string>>();
  for (const page of index.pageList) {
    const apis = byCategory.get(page.category) ?? new Set<string>();
    apis.add(page.api);
    byCategory.set(page.category, apis);
  }
  return [...byCategory.entries()].map(([category, apis]) => ({ category, apis: [...apis] }));
}
