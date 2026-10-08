import * as z from 'zod/v4';
import { CoordinateSchema } from '../shared/geo.js';
import { READ_ONLY, type NbTool } from '../types.js';
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

const Schema = z.strictObject({
  center: CoordinateSchema.describe('Center of the map view'),
  zoom: z
    .number()
    .min(0)
    .max(22)
    .describe('Zoom level (0 = world, ~10 = city, ~15 = streets; fractional values allowed)'),
  markers: z
    .array(MarkerSchema)
    .optional()
    .describe('Markers to draw, each with optional color or custom icon'),
  ...PathsShape,
  ...StaticImageShape,
});

export const staticMapImage: NbTool<typeof Schema> = {
  name: 'static_map_image',
  title: 'Static Map Image',
  description:
    'Render a static map image centered on a location, with optional markers and line/polygon ' +
    'overlays; returns the image inline and, if NBAI_IMAGE_DIR is set, also saves it as a file ' +
    '(path in the result text). For a map auto-fitted to a route or to ' +
    'overlays, use static_route_map. Parameters: center {latitude, longitude} and zoom (0-22) ' +
    '(required); optional markers (array of {latitude, longitude, color, icon_url, anchor, ' +
    'scale}), paths (array of {points [{latitude, longitude}] OR geojson_coordinates ' +
    '[[longitude, latitude], ...], stroke_color, stroke_width, fill_color for a filled ' +
    'polygon}), width, height (default 512), style (streets | light | dark | hybrid), format ' +
    '(png | jpg | webp), retina. Example: {"center": {"latitude": 48.8566, "longitude": ' +
    '2.3522}, "zoom": 14, "markers": [{"latitude": 48.8584, "longitude": 2.2945, "color": ' +
    '"red"}], "paths": [{"points": [{"latitude": 48.85, "longitude": 2.29}, {"latitude": ' +
    '48.86, "longitude": 2.30}], "stroke_color": "green"}]}',
  inputSchema: Schema,
  annotations: READ_ONLY,
  docs: ['maps/static-images-api/static-images-api'],
  async run(args, nb) {
    const position = `${args.center.latitude},${args.center.longitude},${args.zoom}`;
    const path = staticImagePath(position, args);
    const markers = args.markers?.length ? markerParam(args.markers, 'lng-first') : undefined;
    let overlay = args.paths?.length ? pathParams(args.paths) : undefined;
    // Long overlays (e.g. isochrone rings) can exceed the GET URL limit; simplify to fit.
    for (const budget of [4000, 2000, 1000, 500, 200]) {
      if (
        !overlay ||
        nb.buildUrl(path, { markers, path: overlay.values }).length <= URL_BYTE_BUDGET
      )
        break;
      overlay = pathParams(args.paths!, budget);
    }
    const parts = [
      `Map centered at (${args.center.latitude}, ${args.center.longitude}), zoom ${args.zoom}`,
    ];
    if (args.markers?.length) parts.push(`${args.markers.length} marker(s)`);
    if (args.paths?.length)
      parts.push(
        `${args.paths.length} overlay path(s)${overlay?.simplified ? ' (simplified to fit the URL limit)' : ''}`,
      );
    return fetchImageResult(
      nb,
      path,
      { markers, path: overlay?.values },
      `${parts.join(', ')}.`,
      args,
      'map',
    );
  },
};
