import * as z from 'zod/v4';
import { CoordinateSchema } from '../shared/geo.js';
import { READ_ONLY, ToolInputError, type NbTool } from '../types.js';
import {
  fetchImageResult,
  markerParam,
  MarkerSchema,
  pathParams,
  PathsShape,
  StaticImageShape,
  staticImagePath,
  URL_BYTE_BUDGET,
} from './static-shared.js';
import { decodePolyline, fitPolylineToBudget } from './polyline.js';

const Schema = z.strictObject({
  encoded_polyline: z
    .string()
    .optional()
    .describe(
      'Route geometry as a Google encoded polyline (precision 5) — exactly what the directions ' +
        'tool returns with its default geometry setting',
    ),
  route_points: z
    .array(CoordinateSchema)
    .min(2)
    .optional()
    .describe('Alternative to encoded_polyline: the route as an ordered list of coordinates'),
  markers: z
    .array(MarkerSchema)
    .optional()
    .describe('Extra markers, e.g. origin and destination, with optional color or custom icon'),
  ...PathsShape,
  stroke_color: z
    .string()
    .optional()
    .describe('Route line color (e.g. "blue", "#ff0000"; default blue)'),
  stroke_width: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe('Route line width in pixels (default 4)'),
  padding: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Margin around the route as a fraction of image size (default 0.1)'),
  ...StaticImageShape,
});

/** Progressively tighter encoded-polyline budgets tried when the URL is too long. */
const ENCODED_CHAR_BUDGETS = [4000, 3000, 2000, 1200, 600, 200];

export const staticRouteMap: NbTool<typeof Schema> = {
  name: 'static_route_map',
  title: 'Static Route Map',
  description:
    'Render a static map auto-fitted to a route and/or overlays: a route from directions, ' +
    'and/or lines and filled polygons such as isochrone contours; very long geometry is ' +
    'simplified automatically to fit the map API URL limit (distances unaffected). Returns ' +
    'the image inline and, if NBAI_IMAGE_DIR is set, also saves it as a file (path in the ' +
    'result text). ' +
    'Parameters: at least one of encoded_polyline (the geometry string from directions, ' +
    'preferred), route_points (array of {latitude, longitude}) or paths (array of {points OR ' +
    'geojson_coordinates [[longitude, latitude], ...], stroke_color, stroke_width, ' +
    'fill_color}); optional markers (array of {latitude, longitude, color, icon_url, anchor, ' +
    'scale}), stroke_color, stroke_width (route line), padding, width, height, style, format, ' +
    'retina. Example (isochrone contours) - Example: {"paths": [{"geojson_coordinates": [[-122.42, 37.77], ' +
    '[-122.40, 37.78], [-122.41, 37.79], [-122.42, 37.77]], "fill_color": ' +
    '"rgba(29,78,216,0.35)", "stroke_color": "#1d4ed8"}], "markers": [{"latitude": 37.7749, ' +
    '"longitude": -122.4194, "color": "red"}]}',
  inputSchema: Schema,
  annotations: READ_ONLY,
  docs: ['maps/static-images-api/static-images-api'],
  async run(args, nb) {
    if (args.encoded_polyline && args.route_points) {
      throw new ToolInputError('Provide either `encoded_polyline` or `route_points`, not both.');
    }
    if (!args.encoded_polyline && !args.route_points && !args.paths?.length) {
      throw new ToolInputError(
        'Provide a route (`encoded_polyline` or `route_points`) and/or overlay `paths`.',
      );
    }
    const markers = args.markers?.length ? markerParam(args.markers, 'lat-first') : undefined;
    const padding = args.padding !== undefined ? String(args.padding) : undefined;
    const path = staticImagePath('auto', args);
    const routeStyle = [
      `stroke:${args.stroke_color ?? 'blue'}`,
      `width:${args.stroke_width ?? 4}`,
      'fill:none',
    ].join('|');
    const routePoints = args.encoded_polyline
      ? decodePolyline(args.encoded_polyline)
      : (args.route_points ?? []);

    // Build the `path` values: the route (if any) plus overlay paths. Everything is encoded
    // as polylines; if the URL still exceeds the API limit, simplify progressively.
    const build = (budget: number) => {
      const values: string[] = [];
      let simplified = false;
      if (routePoints.length) {
        const fitted = fitPolylineToBudget(routePoints, budget);
        simplified ||= fitted.simplified;
        values.push(`${routeStyle}|enc:${fitted.encoded}`);
      }
      if (args.paths?.length) {
        const overlay = pathParams(args.paths, budget);
        simplified ||= overlay.simplified;
        values.push(...overlay.values);
      }
      return { values, simplified };
    };
    let built = build(Number.POSITIVE_INFINITY);
    for (const budget of ENCODED_CHAR_BUDGETS) {
      if (nb.buildUrl(path, { path: built.values, markers, padding }).length <= URL_BYTE_BUDGET)
        break;
      built = build(budget);
    }

    const parts = ['Map rendered'];
    if (routePoints.length) parts.push('with the route');
    if (args.paths?.length) parts.push(`${args.paths.length} overlay path(s)`);
    if (args.markers?.length) parts.push(`${args.markers.length} marker(s)`);
    const note = built.simplified
      ? ' Display geometry was simplified to fit the map URL limit; distances are unaffected.'
      : '';
    return fetchImageResult(
      nb,
      path,
      { path: built.values, markers, padding },
      `${parts.join(', ')}.${note}`,
      args,
      'route-map',
    );
  },
};
