import * as z from 'zod/v4';
import type { DocsIndex } from '../../docs/store.js';
import type { ParameterRecord } from '../../docs/types.js';
import { type NbTool, ToolInputError, type ToolResult } from '../types.js';
import { DOCS_TOOL_ANNOTATIONS, GET_API_PARAMETERS_DESCRIPTION } from './descriptions.js';
import { withDocsIndex } from './unavailable.js';

const Schema = z.strictObject({
  endpoint: z
    .string()
    .optional()
    .describe(
      'API slug with optional variant (directions, directions/flexible, geofence/create), a tool name (geocode_batch) or a doc_id',
    ),
  doc_id: z.string().optional().describe('Page id instead of endpoint'),
  name: z.string().optional().describe('One parameter name, e.g. truck_weight'),
});

/** Records returned at most per call; ask for a name or a variant to narrow. */
export const MAX_RECORDS = 200;

/** `Directions API` / `directions-api` / `/Directions/` → `directions`; keeps a `/variant`. */
export function normalizeEndpoint(raw: string): string {
  const [api = '', ...rest] = raw
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, '')
    .replace(/[\s_]+/g, '-')
    .split('/');
  const apiSlug = api
    .split('-')
    .filter((t) => t.length > 0 && t !== 'api' && t !== 'apis')
    .join('-');
  return rest.length > 0 ? `${apiSlug}/${rest.join('/')}` : apiSlug;
}

/** Word-order-insensitive key: `geocode/batch`, `geocode-batch` and `batch-geocode` agree. */
function wordKey(slug: string): string {
  return slug
    .split(/[/-]/)
    .filter((t) => t.length > 0 && t !== 'api' && t !== 'apis')
    .sort()
    .join('-');
}

const cleanDocId = (raw: string): string =>
  raw
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.md$/i, '');

export interface EndpointResolution {
  records: ParameterRecord[];
  /** What the records were matched on: an endpoint slug or a doc_id. */
  scope: string;
  /** How the input was understood when it was not an exact endpoint slug. */
  matched_by?: 'word_order' | 'tool_name' | 'doc_id';
}

/**
 * Parameter records for an endpoint spelling. Hosts derive slugs from whatever they have
 * seen: the slug itself (`directions/flexible`), the API title (`Directions API`), a tool
 * name (`geocode_batch`) or the page id, so each of those resolves. Undefined when
 * nothing matches.
 */
export function resolveEndpoint(
  index: DocsIndex,
  raw: string,
  tools: ReadonlyArray<Pick<NbTool, 'name' | 'docs'>>,
): EndpointResolution | undefined {
  const endpoint = normalizeEndpoint(raw);
  const byEndpoint = (e: string): ParameterRecord[] =>
    index.parameters.filter((p) => p.endpoint === e || p.endpoint.startsWith(`${e}/`));
  const exact = byEndpoint(endpoint);
  if (exact.length > 0) return { records: exact, scope: endpoint };

  const key = wordKey(endpoint);
  if (key.length > 0) {
    const variant = index.endpoints.find((e) => wordKey(e) === key);
    if (variant) return { records: byEndpoint(variant), scope: variant, matched_by: 'word_order' };
    const api = index.endpoints.map((e) => e.split('/')[0] ?? e).find((a) => wordKey(a) === key);
    if (api) return { records: byEndpoint(api), scope: api, matched_by: 'word_order' };
  }

  const toolName = raw
    .trim()
    .toLowerCase()
    .replace(/[\s/-]+/g, '_');
  const tool = tools.find((t) => t.name === toolName);
  if (tool?.docs?.length) {
    const ids = new Set(tool.docs);
    const records = index.parameters.filter((p) => ids.has(p.doc_id));
    if (records.length > 0) {
      const apis = [...new Set(records.map((p) => p.endpoint.split('/')[0] ?? p.endpoint))];
      return { records, scope: apis.join(', '), matched_by: 'tool_name' };
    }
  }

  const docId = cleanDocId(raw);
  if (index.pages.has(docId)) {
    const records = index.parameters.filter((p) => p.doc_id === docId);
    if (records.length > 0) return { records, scope: docId, matched_by: 'doc_id' };
  }
  return undefined;
}

/** Up to eight endpoints that share a word with the input, for a miss. */
export function similarEndpoints(index: DocsIndex, raw: string): string[] {
  const words = new Set(wordKey(normalizeEndpoint(raw)).split('-'));
  words.delete('');
  const scored = index.endpoints
    .map((e) => ({
      e,
      n: wordKey(e)
        .split('-')
        .filter((w) => words.has(w)).length,
    }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  return scored.slice(0, 8).map((x) => x.e);
}

export const getApiParameters: NbTool<typeof Schema> = {
  name: 'get_api_parameters',
  title: 'Get API Parameters',
  description: GET_API_PARAMETERS_DESCRIPTION,
  inputSchema: Schema,
  annotations: DOCS_TOOL_ANNOTATIONS,
  async run(args): Promise<ToolResult> {
    if (!args.endpoint && !args.doc_id) throw new ToolInputError('give endpoint or doc_id');
    return withDocsIndex(async (index) => {
      const commit = index.meta.commit_sha.slice(0, 7);
      const knownApis = [...new Set(index.endpoints.map((e) => e.split('/')[0]))];
      const miss = (text: string, extra: Record<string, unknown>): ToolResult => ({
        content: [{ type: 'text', text }],
        structuredContent: {
          commit_sha: index.meta.commit_sha,
          found: false,
          ...extra,
          parameters: [],
        },
      });

      let records: ParameterRecord[];
      let scope: string;
      let matchedBy: EndpointResolution['matched_by'];
      if (args.doc_id) {
        const docId = cleanDocId(args.doc_id);
        const page = index.pages.get(docId);
        if (page === undefined) {
          const similar = similarDocIds(index, docId);
          return miss(
            `No documentation page with doc_id "${args.doc_id}" (docs commit ${commit}).` +
              (similar.length > 0 ? ` Similar doc_ids: ${similar.join(', ')}.` : '') +
              ' Page ids come from search_documentation or list_documentation_topics.',
            { doc_id: docId, similar_doc_ids: similar },
          );
        }
        if (page.sdk !== undefined) {
          const text = `${page.title} is an SDK page (${page.sdk}); SDK method tables are not covered by get_api_parameters. Use get_documentation for the page text.`;
          return {
            content: [{ type: 'text', text }],
            structuredContent: {
              commit_sha: index.meta.commit_sha,
              doc_id: docId,
              unsupported: true,
              reason: text,
              parameters: [],
            },
          };
        }
        records = index.parameters.filter((p) => p.doc_id === docId);
        scope = docId;
        if (records.length === 0) {
          return miss(
            `${page.title} (${docId}) has no request-parameter table in the documentation (docs commit ${commit}). ` +
              'get_documentation returns the page text.',
            { doc_id: docId, title: page.title },
          );
        }
      } else {
        // Loaded at call time: tools/index.ts imports this module, so a static import would cycle.
        const { ALL_TOOLS } = await import('../index.js');
        const resolved = resolveEndpoint(index, args.endpoint!, ALL_TOOLS);
        if (resolved === undefined) {
          const similar = similarEndpoints(index, args.endpoint!);
          return miss(
            `No parameters for endpoint "${args.endpoint}" (docs commit ${commit}).` +
              (similar.length > 0 ? ` Similar endpoints: ${similar.join(', ')}.` : '') +
              ` Known APIs: ${knownApis.join(', ')}.`,
            { endpoint: args.endpoint, similar_endpoints: similar, known_apis: knownApis },
          );
        }
        ({ records, scope } = resolved);
        matchedBy = resolved.matched_by;
      }

      if (args.name) {
        const wanted = args.name.trim().toLowerCase();
        const exact = records.filter((p) => p.name.toLowerCase() === wanted);
        const matched =
          exact.length > 0 ? exact : records.filter((p) => p.name.toLowerCase().includes(wanted));
        if (matched.length === 0) {
          const names = [...new Set(records.map((p) => p.name))];
          return miss(
            `No parameter named "${args.name}" under ${scope} (docs commit ${commit}). ` +
              `Parameters there: ${names.slice(0, 80).join(', ')}${names.length > 80 ? ', …' : ''}.`,
            { scope, name: args.name, parameter_names: names },
          );
        }
        records = matched;
      }

      const total = records.length;
      const truncated = total > MAX_RECORDS;
      if (truncated) records = records.slice(0, MAX_RECORDS);
      const endpoints = [...new Set(records.map((p) => p.endpoint))];

      const lines = [
        `${total} parameter(s) for ${scope} across ${endpoints.length} endpoint variant(s) (docs commit ${commit}). ` +
          (matchedBy ? `"${args.endpoint}" matched by ${matchedBy.replace('_', ' ')}. ` : '') +
          'units null = the docs do not state a unit.' +
          (truncated ? ` Showing the first ${MAX_RECORDS}; narrow with name or a variant.` : ''),
      ];
      for (const endpoint of endpoints) {
        const group = records.filter((p) => p.endpoint === endpoint);
        lines.push(
          '',
          `## ${endpoint} — ${group[0]!.doc_id} > ${group[0]!.heading_path.slice(1).join(' > ')}`,
        );
        for (const p of group) {
          const attrs = [
            p.type ?? 'type unknown',
            p.required === true ? 'required' : p.required === false ? 'optional' : null,
            p.default !== null ? `default ${p.default}` : null,
            p.allowed_values.length > 0 ? `allowed ${p.allowed_values.join(' | ')}` : null,
            p.minimum !== undefined ? `min ${p.minimum}` : null,
            p.maximum !== undefined ? `max ${p.maximum}` : null,
            p.units !== null ? `unit ${p.units}` : null,
            p.location ? `${p.location} parameter` : null,
          ].filter((a) => a !== null);
          lines.push(`- ${p.name} (${attrs.join(', ')}): ${p.description}`);
        }
      }
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        structuredContent: {
          commit_sha: index.meta.commit_sha,
          found: true,
          scope,
          ...(matchedBy ? { matched_by: matchedBy } : {}),
          endpoints,
          total,
          truncated,
          parameters: records,
        },
      };
    });
  },
};

const pathWords = (id: string): string[] =>
  id
    .toLowerCase()
    .split(/[/-]/)
    .filter((w) => w.length > 2 && w !== 'api' && w !== 'apis');

/** `direction` ~ `directions`: equal, or one a prefix of the other from four characters. */
const sameWord = (a: string, b: string): boolean =>
  a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));

/** Up to five page ids sharing the most path words with an unknown id (last word counts double). */
export function similarDocIds(index: DocsIndex, docId: string): string[] {
  const words = pathWords(docId);
  if (words.length === 0) return [];
  const last = words[words.length - 1]!;
  return index.pageList
    .map((p) => {
      const own = pathWords(p.doc_id);
      let n = 0;
      for (const w of words) if (own.some((o) => sameWord(o, w))) n += 1;
      if (own.some((o) => sameWord(o, last))) n += 1;
      return { id: p.doc_id, n };
    })
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || a.id.length - b.id.length || a.id.localeCompare(b.id))
    .slice(0, 5)
    .map((x) => x.id);
}
