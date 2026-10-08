import * as z from 'zod/v4';
import { placesFilterQuery, PlacesFilterShape, PlaceTypesSchema } from '../shared/geo.js';
import { READ_ONLY, textResult, type NbTool } from '../types.js';

const BatchQuerySchema = z.strictObject({
  query: z.string().min(1).describe('Free-text search query for this entry'),
  ...PlacesFilterShape,
  types: PlaceTypesSchema.optional(),
});

const Schema = z.strictObject({
  queries: z
    .array(BatchQuerySchema)
    .min(1)
    .max(100)
    .describe('Up to 100 forward-geocode queries resolved in a single request'),
  types: PlaceTypesSchema.optional().describe(
    'Default result-type filter applied to every query that does not set its own `types` ' +
      '(houseNumber, addressBlock, street, intersection, place, area)',
  ),
});

export const geocodeBatch: NbTool<typeof Schema> = {
  name: 'geocode_batch',
  title: 'Batch Geocode',
  description:
    'Forward-geocode up to 100 free-text queries in one request; returns one ranked result ' +
    'set per query, in input order. Prefer this over repeated geocode_forward calls - this ' +
    'endpoint has its own low rate limit (60 requests per minute), so batch as much as ' +
    'possible into each call. Parameters: queries (required array; each item: query ' +
    '(required), optional near {latitude, longitude}, radius_m, country_codes, bounding_box, ' +
    'limit, language, view, types); optional top-level types (houseNumber | addressBlock | ' +
    'street | intersection | place | area) as the default for all queries (a per-query types ' +
    'overrides it). Example: {"queries": [{"query": "600-699 Golden Gate Ave, San Francisco, ' +
    'CA", "types": ["addressBlock"]}, {"query": "Empire State Building", "country_codes": ' +
    '["USA"]}]}',
  inputSchema: Schema,
  annotations: READ_ONLY,
  docs: ['places/geocoding/batch-geocode/batch-geocode'],
  async run(args, nb) {
    const body = args.queries.map((entry) => {
      const filters = placesFilterQuery(entry);
      return {
        q: entry.query,
        at: filters.at,
        in: filters.in,
        limit: filters.limit,
        lang: filters.lang,
        types: (entry.types ?? args.types)?.join(','),
      };
    });
    const response = await nb.postJson<unknown>('/geocode/batch', {}, body);
    const resultSets = Array.isArray(response) ? response : [response];
    const lines = resultSets.map((set, index) => {
      const items = (set as { items?: Array<Record<string, unknown>> })?.items ?? [];
      const top = items[0];
      const address = top?.address as Record<string, unknown> | undefined;
      const position = top?.position as Record<string, unknown> | undefined;
      const summary = top
        ? `${(address?.label as string) ?? top.title} (${position?.lat}, ${position?.lng})`
        : 'no match';
      return `${index + 1}. "${args.queries[index]?.query}" → ${summary}${items.length > 1 ? ` [+${items.length - 1} more]` : ''}`;
    });
    return textResult(`Resolved ${resultSets.length} queries:\n${lines.join('\n')}`, {
      results: resultSets,
    });
  },
};
