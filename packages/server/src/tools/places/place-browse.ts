import * as z from 'zod/v4';
import { placesFilterQuery, PlacesFilterShape, summarizePlaces } from '../shared/geo.js';
import { READ_ONLY, textResult, type NbTool } from '../types.js';

const Schema = z.strictObject({
  categories: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      'Category names or ids to browse; a place matching any of them is returned (e.g. ["restaurant"], ["schools"], ["7376"])',
    ),
  ...PlacesFilterShape,
});

export const placeBrowse: NbTool<typeof Schema> = {
  name: 'place_browse',
  title: 'Browse Places by Category',
  description:
    'List places of given categories around a location, ranked by distance, without a text ' +
    'query - e.g. all restaurants or schools near a point. Use place_search when the user ' +
    'describes what they want in words; use place_lookup to expand a result by id. ' +
    'Parameters: categories (required array of category names or ids); near {latitude, ' +
    'longitude} (recommended), radius_m (with near), country_codes, bounding_box {west, south, ' +
    'east, north}, limit, language, view. Example: {"categories": ["restaurant"], "near": ' +
    '{"latitude": 1.2839, "longitude": 103.8607}, "radius_m": 800, "limit": 10}',
  inputSchema: Schema,
  annotations: READ_ONLY,
  docs: ['places/search/search-places-api/browse-api'],
  async run(args, nb) {
    const response = await nb.getJson<Record<string, unknown>>('/browse', {
      categories: args.categories.join(','),
      ...placesFilterQuery(args),
    });
    return textResult(summarizePlaces(response, 'place'), response);
  },
};
