/**
 * Builds the packed documentation index (format 2) from the Markdown pages of
 * nb-public-docs. Pure: takes the page contents, returns the index plus the integrity
 * problems and the pages that were skipped. Used at build time by
 * scripts/docs/build-index.ts (from a git clone) and at run time by the hosted server
 * (from a GitHub snapshot, see github.ts), so both produce byte-identical output for the
 * same docs commit.
 */
import { docIdForPath, mapDocPath, type UrlOverrides } from './build/mapping.js';
import { pageMeta } from './build/page-meta.js';
import { dedupe, extractParameters } from './build/parameters.js';
import defaultOverrides from './build/url-overrides.json' with { type: 'json' };
import {
  chunkSection,
  hasUnbalancedFence,
  headingAnchor,
  mergeTinyChunks,
  parseBlocks,
  splitSections,
} from './markdown.js';
import type {
  ChunkRecord,
  DocsIndexFile,
  PageRecord,
  ParameterRecord,
  SectionRecord,
} from './types.js';

export const URL_OVERRIDES: UrlOverrides = defaultOverrides as UrlOverrides;

export interface BuildInput {
  /** Repo-relative Markdown paths (e.g. `Routing/Directions API/directions-api.md`) → content. */
  files: ReadonlyMap<string, string>;
  commitSha: string;
  /** ISO timestamp recorded as `docs_updated_at` (the docs commit date). */
  docsUpdatedAt: string;
  overrides?: UrlOverrides;
}

export interface BuildResult {
  index: DocsIndexFile;
  /** Pages excluded by the URL mapping, with the reason. */
  skipped: Array<{ path: string; reason: string }>;
  /** Chunking integrity problems (a page that does not rejoin, a split fence or table). */
  problems: string[];
}

const PAGE_PRIORITY: Record<string, number> = { reference: 0, guide: 1, example: 2 };

/** True for the repository files the index considers: Markdown pages, README excluded. */
export function isDocsPage(relPath: string): boolean {
  return /\.md$/i.test(relPath) && !/(^|\/)readme\.md$/i.test(relPath);
}

export function buildDocsIndexFile(input: BuildInput): BuildResult {
  const overrides = input.overrides ?? URL_OVERRIDES;
  const pages: PageRecord[] = [];
  const chunks: ChunkRecord[] = [];
  const problems: string[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  const rawParameters: ParameterRecord[] = [];

  const paths = [...input.files.keys()].filter(isDocsPage).sort();
  for (const file of paths) {
    const mapped = mapDocPath(file, overrides);
    if (mapped.kind !== 'url') {
      skipped.push({ path: file, reason: mapped.reason });
      continue;
    }
    const docId = docIdForPath(file);
    const markdown = input.files.get(file)!;
    const blocks = parseBlocks(markdown);
    const sections = splitSections(blocks);
    const meta = pageMeta(file);

    const title =
      blocks.find((b) => b.kind === 'heading' && b.level === 1)?.heading ??
      file.split('/').pop()!.replace(/\.md$/i, '');
    const outline: SectionRecord[] = sections
      .filter((s) => s.level > 0)
      .map((s) => ({
        heading: s.headingPath[s.headingPath.length - 1] ?? '',
        level: s.level,
        anchor: headingAnchor(s.headingPath[s.headingPath.length - 1] ?? ''),
      }));

    const pageChunks: ChunkRecord[] = [];
    for (const chunk of mergeTinyChunks(sections.flatMap((section) => chunkSection(section)))) {
      pageChunks.push({
        chunk_id: `${docId}#${pageChunks.length}`,
        doc_id: docId,
        chunk_type: chunk.chunkType,
        heading_path: chunk.headingPath,
        text: chunk.text,
      });
    }

    // Integrity: lossless join, no split fence, no split table.
    const rejoined = pageChunks.map((c) => c.text).join('\n');
    if (rejoined !== markdown.replace(/\r\n?/g, '\n')) {
      problems.push(`${file}: chunks do not rejoin to the page`);
    }
    for (const chunk of pageChunks) {
      if (hasUnbalancedFence(chunk.text)) problems.push(`${chunk.chunk_id}: unbalanced code fence`);
    }
    for (let i = 1; i < pageChunks.length; i += 1) {
      const prevLast = pageChunks[i - 1]!.text.split('\n').pop() ?? '';
      const first = pageChunks[i]!.text.split('\n')[0] ?? '';
      if (/^\s*\|/.test(prevLast) && /^\s*\|/.test(first)) {
        problems.push(`${pageChunks[i]!.chunk_id}: table split`);
      }
    }

    const pageRecord: PageRecord = {
      doc_id: docId,
      title,
      category: meta.category,
      api: meta.api,
      ...(meta.sdk ? { sdk: meta.sdk } : {}),
      page_type: meta.page_type,
      source_url: mapped.url,
      path: file,
      sections: outline,
    };
    pages.push(pageRecord);
    chunks.push(...pageChunks);
    if (meta.page_type !== 'example' && meta.sdk === undefined) {
      rawParameters.push(...extractParameters(pageRecord, markdown));
    }
  }

  const priority = (docId: string): number =>
    PAGE_PRIORITY[pages.find((p) => p.doc_id === docId)?.page_type ?? 'guide'] ?? 1;
  const parameters = dedupe(
    [...rawParameters].sort((a, b) => priority(a.doc_id) - priority(b.doc_id)),
  );
  const index: DocsIndexFile = {
    meta: {
      format: 2,
      commit_sha: input.commitSha,
      docs_updated_at: input.docsUpdatedAt,
      pages: pages.length,
      chunks: chunks.length,
      parameters: parameters.length,
    },
    pages,
    chunks,
    parameters,
  };
  return { index, skipped, problems };
}
