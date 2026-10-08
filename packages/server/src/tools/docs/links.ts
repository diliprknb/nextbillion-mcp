import type { PageRecord } from '../../docs/types.js';
import type { NbTool } from '../types.js';

interface Links {
  byDoc: Map<string, string[]>;
  byFamily: Map<string, string[]>;
}

const cache = new WeakMap<ReadonlyArray<NbTool>, Links>();
const family = (page: PageRecord): string => `${page.category}/${page.api}`;

function add(map: Map<string, string[]>, key: string, tool: string): void {
  const list = map.get(key) ?? [];
  if (!list.includes(tool)) list.push(tool);
  map.set(key, list);
}

/**
 * Tool names that implement the operation a documentation page describes. A page is
 * linked when a tool declares it in `docs`, or when it belongs to the same API family
 * (category + api) as a declared page, so an API's example pages inherit its tool. The
 * registry is passed in (imported lazily by the caller) because tools/index.ts imports
 * the documentation tools.
 */
export function relatedToolsFor(
  docId: string,
  tools: ReadonlyArray<NbTool>,
  pageOf: (id: string) => PageRecord | undefined,
): string[] {
  let links = cache.get(tools);
  if (links === undefined) {
    links = { byDoc: new Map(), byFamily: new Map() };
    for (const tool of tools) {
      for (const id of tool.docs ?? []) {
        add(links.byDoc, id, tool.name);
        const page = pageOf(id);
        if (page) add(links.byFamily, family(page), tool.name);
      }
    }
    cache.set(tools, links);
  }
  const direct = links.byDoc.get(docId);
  if (direct) return direct;
  const page = pageOf(docId);
  return page ? (links.byFamily.get(family(page)) ?? []) : [];
}
