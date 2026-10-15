import * as z from 'zod/v4';
import { getDocsIndex } from '../../docs/store.js';
import type { ParameterRecord } from '../../docs/types.js';
import { type NbTool, ToolInputError, type ToolResult } from '../types.js';
import { DOCS_TOOL_ANNOTATIONS, GET_API_PARAMETERS_DESCRIPTION } from './descriptions.js';

const Schema = z.strictObject({
  endpoint: z
    .string()
    .optional()
    .describe(
      'API slug with optional variant, e.g. directions, directions/flexible, geofence/create',
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

/**
 * `geocode/batch` → `batch-geocode`: models often reorder or split a slug's words. Resolves only when
 * the words match exactly one known endpoint, so a genuinely unknown slug still errors.
 */
export function resolveReorderedEndpoint(
  endpoint: string,
  known: readonly string[],
): string | null {
  const words = (value: string) =>
    value
      .split(/[\s/_-]+/)
      .filter((w) => w.length > 0 && w !== 'api' && w !== 'apis')
      .sort()
      .join(' ');
  const wanted = words(endpoint);
  if (wanted === '') return null;
  const matches = [...new Set(known.map((e) => e.split('/')[0] ?? e))].filter(
    (base) => words(base) === wanted,
  );
  return matches.length === 1 ? matches[0]! : null;
}

export const getApiParameters: NbTool<typeof Schema> = {
  name: 'get_api_parameters',
  title: 'Get API Parameters',
  description: GET_API_PARAMETERS_DESCRIPTION,
  inputSchema: Schema,
  annotations: DOCS_TOOL_ANNOTATIONS,
  async run(args): Promise<ToolResult> {
    if (!args.endpoint && !args.doc_id) throw new ToolInputError('give endpoint or doc_id');
    const index = getDocsIndex();
    const commit = index.meta.commit_sha.slice(0, 7);

    let records: ParameterRecord[];
    let scope: string;
    if (args.doc_id) {
      const docId = args.doc_id
        .trim()
        .replace(/^\/+|\/+$/g, '')
        .replace(/\.md$/i, '');
      const page = index.pages.get(docId);
      if (page === undefined) throw new ToolInputError(`unknown doc_id "${args.doc_id}"`);
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
    } else {
      let endpoint = normalizeEndpoint(args.endpoint!);
      const matches = (e: string) => (p: ParameterRecord) =>
        p.endpoint === e || p.endpoint.startsWith(`${e}/`);
      records = index.parameters.filter(matches(endpoint));
      if (records.length === 0) {
        const resolved = resolveReorderedEndpoint(endpoint, index.endpoints);
        if (resolved !== null) {
          endpoint = resolved;
          records = index.parameters.filter(matches(endpoint));
        }
      }
      scope = endpoint;
      if (records.length === 0) {
        const first = endpoint.split('/')[0] ?? endpoint;
        const similar = index.endpoints
          .filter((e) => e.includes(first) || first.includes(e.split('/')[0] ?? e))
          .slice(0, 8);
        throw new ToolInputError(
          `no parameters for endpoint "${args.endpoint}"${similar.length > 0 ? `; similar endpoints: ${similar.join(', ')}` : ''}. ` +
            `Known endpoints: ${[...new Set(index.endpoints.map((e) => e.split('/')[0]))].join(', ')}`,
        );
      }
    }

    if (args.name) {
      const wanted = args.name.trim().toLowerCase();
      const exact = records.filter((p) => p.name.toLowerCase() === wanted);
      records =
        exact.length > 0 ? exact : records.filter((p) => p.name.toLowerCase().includes(wanted));
      if (records.length === 0)
        throw new ToolInputError(`no parameter named "${args.name}" under ${scope}`);
    }

    const total = records.length;
    const truncated = total > MAX_RECORDS;
    if (truncated) records = records.slice(0, MAX_RECORDS);
    const endpoints = [...new Set(records.map((p) => p.endpoint))];

    const lines = [
      `${total} parameter(s) for ${scope} across ${endpoints.length} endpoint variant(s) (docs commit ${commit}). ` +
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
        scope,
        endpoints,
        total,
        truncated,
        parameters: records,
      },
    };
  },
};
