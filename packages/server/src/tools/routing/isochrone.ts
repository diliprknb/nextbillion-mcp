import * as z from 'zod/v4';
import { CoordinateSchema, toLatLng } from '../shared/geo.js';
import { READ_ONLY, textResult, ToolInputError, type NbTool } from '../types.js';

const Schema = z.strictObject({
  origin: CoordinateSchema.describe('Starting point of the reachability analysis'),
  contours_minutes: z
    .array(z.number().int().min(1).max(40))
    .max(4)
    .optional()
    .describe('Travel times in minutes, one contour each (max 4 values, increasing, max 40)'),
  contours_meters: z
    .array(z.number().int().min(1).max(60_000))
    .max(4)
    .optional()
    .describe('Travel distances in meters, one contour each (max 4 values, increasing, max 60000)'),
  mode: z
    .enum(['car', 'truck', 'motorcycle', 'bike', 'walk'])
    .optional()
    .describe('Travel mode (default car)'),
  polygons: z
    .boolean()
    .optional()
    .describe('Return contours as GeoJSON Polygons instead of LineStrings'),
  denoise: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(
      'Remove contours smaller than this fraction of the largest (default 1: largest only)',
    ),
  departure_time: z
    .number()
    .int()
    .optional()
    .describe('Departure as a UNIX timestamp in seconds, for typical-traffic analysis'),
  contours_colors: z
    .array(z.string().regex(/^[0-9a-fA-F]{6}$/, 'hex color without #, e.g. ff0000'))
    .max(4)
    .optional()
    .describe('One hex color (without #) per contour, e.g. ["ff0000", "00ff00"]'),
  generalize: z
    .number()
    .positive()
    .optional()
    .describe('Simplification tolerance in meters (Douglas-Peucker); omit for automatic'),
});

export const isochrone: NbTool<typeof Schema> = {
  name: 'isochrone',
  title: 'Isochrone',
  description:
    'Calculate the area reachable from a point within given travel times or distances; ' +
    'returns a GeoJSON FeatureCollection of contours (geometry coordinates are [longitude, ' +
    'latitude]). To draw the result, pass each contour ring to static_route_map as ' +
    'paths[].geojson_coordinates with a fill_color. For how-to questions about this API, use search_documentation. Parameters: origin {latitude, longitude} ' +
    '(required); exactly one of contours_minutes (array, up to 4 values, max 40) or ' +
    'contours_meters (array, up to 4 values, max 60000); optional mode, polygons (true for ' +
    'Polygon geometry), denoise, generalize (meters), contours_colors (hex without #, one per ' +
    'contour), departure_time. Example: {"origin": {"latitude": 37.7749, "longitude": ' +
    '-122.4194}, "contours_minutes": [5, 10], "polygons": true}',
  inputSchema: Schema,
  annotations: READ_ONLY,
  docs: ['routing/isochrone-api/isochrone-api'],
  async run(args, nb) {
    if (!args.contours_minutes?.length && !args.contours_meters?.length) {
      throw new ToolInputError('Provide `contours_minutes` or `contours_meters`.');
    }
    if (args.contours_minutes?.length && args.contours_meters?.length) {
      throw new ToolInputError('Provide either `contours_minutes` or `contours_meters`, not both.');
    }
    const response = await nb.getJson<Record<string, unknown>>('/isochrone/json', {
      coordinates: toLatLng(args.origin),
      contours_minutes: args.contours_minutes?.join(','),
      contours_meters: args.contours_meters?.join(','),
      mode: args.mode,
      polygons: args.polygons,
      denoise: args.denoise,
      departure_time: args.departure_time,
      contours_colors: args.contours_colors?.join(','),
      generalize: args.generalize,
    });
    const features = (response as { features?: unknown[] }).features ?? [];
    const metric = args.contours_minutes?.length ? 'minutes' : 'meters';
    const values = (args.contours_minutes ?? args.contours_meters ?? []).join(', ');
    return textResult(
      `Computed ${features.length} isochrone contour(s) for ${values} ${metric} from ` +
        `(${args.origin.latitude}, ${args.origin.longitude}). GeoJSON is in structured content.`,
      response,
    );
  },
};
