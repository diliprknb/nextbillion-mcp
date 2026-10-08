import * as z from 'zod/v4';
import { CoordinateSchema, toLatLngList } from '../shared/geo.js';
import { READ_ONLY, textResult, type NbTool } from '../types.js';

const Schema = z.strictObject({
  route_points: z
    .array(CoordinateSchema)
    .min(2)
    .describe('Waypoints defining the route to search along, in travel order'),
  query: z.string().min(1).describe('What to find along the route, e.g. "gas station", "coffee"'),
  max_detour_seconds: z
    .number()
    .int()
    .min(1)
    .max(3600)
    .optional()
    .describe('Max driving time to reach a result after leaving the route (default 900 = 15 min)'),
  sort_by: z
    .enum(['detour_time', 'detour_offset'])
    .optional()
    .describe('Order by detour driving time, or by distance of the detour point from route start'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe('Maximum results (default 10, max 20)'),
  view: z
    .enum(['Unified', 'AR', 'CN', 'IN', 'PK', 'MA', 'RU', 'RS', 'TW', 'TR'])
    .optional()
    .describe('Geopolitical view for disputed territories (default: requester region or Unified)'),
});

export const searchAlongRoute: NbTool<typeof Schema> = {
  name: 'search_along_route',
  title: 'Search Along Route',
  description:
    'Find places matching a text query along a driving route, with the detour time and ' +
    'distance each stop adds - for "find X on the way" questions. Pass the route as an ' +
    'ordered list of waypoints, e.g. the origin, waypoints and destination used with ' +
    'directions. Parameters: route_points (array of {latitude, longitude}, at least 2, ' +
    'required), query (required); optional max_detour_seconds (default 900, max 3600), ' +
    'sort_by (detour_time | detour_offset), limit (max 20), view. Example: {"route_points": ' +
    '[{"latitude": 34.0493, "longitude": -118.2557}, {"latitude": 34.0415, "longitude": ' +
    '-118.231}], "query": "gas station", "max_detour_seconds": 600}',
  inputSchema: Schema,
  annotations: READ_ONLY,
  docs: ['places/search/search-along-route-api/search-along-route-api'],
  async run(args, nb) {
    const response = await nb.postJson<Record<string, unknown>>(
      '/orbis/alongroute',
      {},
      {
        route: { points: toLatLngList(args.route_points) },
        q: args.query,
        max_detour_time: args.max_detour_seconds,
        sort_by: args.sort_by,
        limit: args.limit,
        view: args.view,
      },
    );
    const items = (response as { items?: Array<Record<string, unknown>> }).items ?? [];
    const lines = items.slice(0, 5).map((item, index) => {
      const address = item.address as Record<string, unknown> | undefined;
      const detourMin =
        typeof item.detour_time === 'number' ? Math.round(item.detour_time / 60) : '?';
      return `${index + 1}. ${item.title} (${(address?.label as string) ?? ''}) — ~${detourMin} min detour`;
    });
    const more = items.length > 5 ? `\n…and ${items.length - 5} more.` : '';
    return textResult(
      items.length > 0
        ? `${items.length} place(s) along the route:\n${lines.join('\n')}${more}`
        : 'No places found along the route.',
      response,
    );
  },
};
