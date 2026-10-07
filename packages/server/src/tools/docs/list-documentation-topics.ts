import * as z from 'zod/v4';
import { looselyEquals } from '../../docs/search.js';
import { getDocsIndex } from '../../docs/store.js';
import type { PageRecord } from '../../docs/types.js';
import type { NbTool, ToolResult } from '../types.js';
import { DOCS_TOOL_ANNOTATIONS, LIST_DOCUMENTATION_TOPICS_DESCRIPTION } from './descriptions.js';

const Schema = z.strictObject({
  category: z.string().optional().describe('Only this category, e.g. Routing'),
  sdk: z.string().optional().describe('Only pages of this platform: Android, iOS, Flutter, Web'),
});

interface ApiEntry {
  api: string;
  sdk?: string;
  pages: Array<Pick<PageRecord, 'doc_id' | 'title' | 'page_type' | 'source_url'>>;
}

export const listDocumentationTopics: NbTool<typeof Schema> = {
  name: 'list_documentation_topics',
  title: 'List Documentation Topics',
  description: LIST_DOCUMENTATION_TOPICS_DESCRIPTION,
  inputSchema: Schema,
  annotations: DOCS_TOOL_ANNOTATIONS,
  async run(args): Promise<ToolResult> {
    const index = getDocsIndex();
    const sdk = args.sdk?.trim().toLowerCase();
    const categories = new Map<string, Map<string, ApiEntry>>();
    let count = 0;
    for (const page of index.pageList) {
      if (args.category && !looselyEquals(args.category, page.category)) continue;
      if (sdk && (page.sdk ?? '').toLowerCase() !== sdk) continue;
      const apis = categories.get(page.category) ?? new Map<string, ApiEntry>();
      const entry = apis.get(page.api) ?? {
        api: page.api,
        ...(page.sdk ? { sdk: page.sdk } : {}),
        pages: [],
      };
      entry.pages.push({
        doc_id: page.doc_id,
        title: page.title,
        page_type: page.page_type,
        source_url: page.source_url,
      });
      apis.set(page.api, entry);
      categories.set(page.category, apis);
      count += 1;
    }

    const tree = [...categories.entries()].map(([category, apis]) => ({
      category,
      apis: [...apis.values()],
    }));
    const commit = index.meta.commit_sha.slice(0, 7);
    const lines = [
      `${count} documentation page(s) in ${tree.length} categor${tree.length === 1 ? 'y' : 'ies'} ` +
        `(index of ${index.meta.pages} pages, ${index.meta.chunks} chunks, docs commit ${commit}, ` +
        `built ${index.meta.built_at.slice(0, 10)}).`,
    ];
    if (count === 0) {
      lines.push(
        `Nothing matches category="${args.category ?? ''}" sdk="${args.sdk ?? ''}". Categories: ` +
          [...new Set(index.pageList.map((p) => p.category))].join(', '),
      );
    }
    for (const { category, apis } of tree) {
      lines.push('', `## ${category}`);
      for (const entry of apis) {
        lines.push(`- ${entry.api}${entry.sdk ? ` [${entry.sdk}]` : ''} (${entry.pages.length})`);
        for (const page of entry.pages)
          lines.push(`  - ${page.title} — ${page.doc_id} [${page.page_type}]`);
      }
    }
    return {
      content: [{ type: 'text', text: lines.join('\n') }],
      structuredContent: {
        commit_sha: index.meta.commit_sha,
        built_at: index.meta.built_at,
        total_pages: index.meta.pages,
        total_chunks: index.meta.chunks,
        matched_pages: count,
        categories: tree,
      },
    };
  },
};
