/**
 * Minimal Markdown block parser and section chunker for the docs index. Pure functions,
 * no dependencies. Lines are preserved verbatim: every line of a page belongs to exactly
 * one chunk, so joining a page's chunks with `\n` reproduces the page, and a fence or a
 * table is never split across chunks (spec §6).
 */
import type { ChunkType } from './types.js';

export type BlockKind = 'heading' | 'fence' | 'table' | 'text' | 'blank';

export interface Block {
  kind: BlockKind;
  lines: string[];
  /** Heading level 1-6 (headings only). */
  level?: number;
  /** Heading text without the `#` markers (headings only). */
  heading?: string;
  /** Info string after the opening fence (fences only). */
  lang?: string;
}

const FENCE_OPEN = /^\s{0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^\s{0,3}(`{3,}|~{3,})\s*$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const TABLE_ROW = /^\s*\|/;

export function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const fence = FENCE_OPEN.exec(line);
    if (fence) {
      const marker = fence[1]!;
      const fenceLines = [line];
      i += 1;
      while (i < lines.length) {
        const current = lines[i]!;
        fenceLines.push(current);
        i += 1;
        const close = FENCE_CLOSE.exec(current);
        if (close && close[1]![0] === marker[0] && close[1]!.length >= marker.length) break;
      }
      blocks.push({ kind: 'fence', lines: fenceLines, lang: fence[2]!.trim() });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        kind: 'heading',
        lines: [line],
        level: heading[1]!.length,
        heading: heading[2]!,
      });
      i += 1;
      continue;
    }
    if (TABLE_ROW.test(line)) {
      const tableLines: string[] = [];
      while (i < lines.length && TABLE_ROW.test(lines[i]!)) {
        tableLines.push(lines[i]!);
        i += 1;
      }
      blocks.push({ kind: 'table', lines: tableLines });
      continue;
    }
    if (line.trim() === '') {
      blocks.push({ kind: 'blank', lines: [line] });
      i += 1;
      continue;
    }
    const textLines: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !HEADING.test(lines[i]!) &&
      !FENCE_OPEN.test(lines[i]!) &&
      !TABLE_ROW.test(lines[i]!)
    ) {
      textLines.push(lines[i]!);
      i += 1;
    }
    blocks.push({ kind: 'text', lines: textLines });
  }
  return blocks;
}

export interface Section {
  /** Open headings from H1 down to this section's own heading. */
  headingPath: string[];
  /** Level of the heading that opened the section; 0 for text before any heading. */
  level: number;
  blocks: Block[];
}

/** Split a page at H1/H2/H3 headings. H4 and deeper stay inside their section. */
export function splitSections(blocks: Block[]): Section[] {
  const sections: Section[] = [];
  const open: string[] = [];
  let current: Section = { headingPath: [], level: 0, blocks: [] };
  for (const block of blocks) {
    if (block.kind === 'heading' && block.level !== undefined && block.level <= 3) {
      if (current.blocks.length > 0) sections.push(current);
      open.length = Math.min(open.length, block.level - 1);
      open[block.level - 1] = block.heading ?? '';
      current = {
        headingPath: open.filter((h) => h !== undefined),
        level: block.level,
        blocks: [block],
      };
      continue;
    }
    current.blocks.push(block);
  }
  if (current.blocks.length > 0) sections.push(current);
  return sections;
}

/** Fragment id the docs site derives from a heading (GitHub-style slug). */
export function headingAnchor(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^a-z0-9 -]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

export interface SectionChunk {
  headingPath: string[];
  chunkType: ChunkType;
  text: string;
}

export interface ChunkOptions {
  /** Soft cap in characters; atomic blocks (one fence, one table) may exceed it. */
  cap?: number;
  /** Fences at least this long become `example` chunks of their own. */
  exampleMinChars?: number;
}

const RESPONSE_HEADING = /\bresponse\b/i;

/**
 * Pack a section's blocks into chunks of about `cap` characters. Long code fences become
 * separate `example` chunks; chunks holding a table under a "Response …" heading are
 * `response_schema`; everything else is `content`.
 */
export function chunkSection(section: Section, options: ChunkOptions = {}): SectionChunk[] {
  const cap = options.cap ?? 2000;
  const exampleMinChars = options.exampleMinChars ?? 200;
  const chunks: SectionChunk[] = [];
  let pending: Block[] = [];
  let pendingChars = 0;

  const isResponse = section.headingPath.slice(-2).some((h) => RESPONSE_HEADING.test(h));
  const flush = (): void => {
    if (pending.length === 0) return;
    const hasTable = pending.some((b) => b.kind === 'table');
    chunks.push({
      headingPath: section.headingPath,
      chunkType: isResponse && hasTable ? 'response_schema' : 'content',
      text: pending.flatMap((b) => b.lines).join('\n'),
    });
    pending = [];
    pendingChars = 0;
  };

  for (const block of section.blocks) {
    const chars = block.lines.join('\n').length;
    if (block.kind === 'fence' && chars >= exampleMinChars) {
      flush();
      chunks.push({
        headingPath: section.headingPath,
        chunkType: 'example',
        text: block.lines.join('\n'),
      });
      continue;
    }
    if (pending.length > 0 && pendingChars + chars > cap && block.kind !== 'blank') flush();
    pending.push(block);
    pendingChars += chars + 1;
  }
  flush();
  return chunks;
}

/** Chunks with less text than this (trimmed) are merged into a neighbour. */
export const MIN_CHUNK_CHARS = 100;

/**
 * Merge near-empty chunks into their neighbours so no chunk is just a heading. A heading
 * ends up alone when the block after it is atomic and over the cap (a large table or a
 * long fence) or when a section holds nothing but its heading. Such chunks rank well on
 * BM25 for the heading words and come back with an empty excerpt. A tiny chunk is
 * appended to the front of the next chunk of the page (taking that chunk's heading path
 * and type); the last chunk of a page merges backwards instead. Order and text are kept,
 * so joining the page's chunks with `\n` still reproduces the page.
 */
export function mergeTinyChunks(
  chunks: ReadonlyArray<SectionChunk>,
  minChars = MIN_CHUNK_CHARS,
): SectionChunk[] {
  const out: SectionChunk[] = [];
  let carry: SectionChunk | undefined;
  for (const chunk of chunks) {
    const merged = carry ? { ...chunk, text: `${carry.text}\n${chunk.text}` } : chunk;
    carry = undefined;
    if (merged.text.trim().length < minChars) {
      carry = merged;
      continue;
    }
    out.push(merged);
  }
  if (carry) {
    const last = out.pop();
    out.push(last ? { ...last, text: `${last.text}\n${carry.text}` } : carry);
  }
  return out;
}

/** True when the text has an unmatched fence marker, i.e. a fence was cut. */
export function hasUnbalancedFence(text: string): boolean {
  let open: string | undefined;
  for (const line of text.split('\n')) {
    if (open === undefined) {
      const fence = FENCE_OPEN.exec(line);
      if (fence) open = fence[1]!;
      continue;
    }
    const close = FENCE_CLOSE.exec(line);
    if (close && close[1]![0] === open[0] && close[1]!.length >= open.length) open = undefined;
  }
  return open !== undefined;
}
